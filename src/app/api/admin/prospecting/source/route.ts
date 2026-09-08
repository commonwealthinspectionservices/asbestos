import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";
import { getSupabaseAdminFresh } from "@/lib/supabase";

// Real Google-network calls per (category, town) pair, run sequentially —
// well past the platform's 15s default, so this needs the longer budget
// explicitly (see next.config's absence of any route already needing
// this; this is the first one).
export const maxDuration = 120;

// The sourcing half of the restoration-company prospecting effort, 2026-
// 09-08 — separate on purpose from draft-outreach/route.ts (the sending
// half), which stays untouched by anything this route finds. Per Tim:
// "we're not gonna be using this bot for a long time until it's fully
// developed" — this only ever writes to the prospects table, never
// touches Gmail, never drafts anything.
//
// Text Search (not Nearby Search) deliberately — restoration/abatement
// isn't one of Places' fixed `includedTypes` categories, so a free-text
// query ("water damage restoration company in Quincy, MA") is the only
// way to match Google's real business-category taxonomy for this
// industry. Caller supplies both categories and towns explicitly (no
// baked-in defaults) so a sweep's size/cost is always an explicit choice,
// not a hidden default silently scaling up.
//
// Idempotent by design: google_place_id is the natural dedup key for a
// real business, so re-running the same sweep tomorrow only touches
// company_name/phone/address/website/updated_at on existing rows —
// status (set by hand as Tim actually works a prospect) is deliberately
// left out of the upsert payload so a rerun can never silently reset it
// back to "new".
export const POST = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Missing GOOGLE_PLACES_API_KEY env var" }, { status: 500 });

  const body = await req.json().catch(() => null);
  const categories: string[] = Array.isArray(body?.categories) ? body.categories : [];
  const towns: string[] = Array.isArray(body?.towns) ? body.towns : [];
  if (categories.length === 0 || towns.length === 0) {
    return NextResponse.json({ error: "categories[] and towns[] both required" }, { status: 400 });
  }

  // getSupabaseAdminFresh, not the shared getSupabaseAdmin — this route
  // reads back existing google_place_ids on every call to compute new-vs-
  // seen counts, and the shared client's Next.js Data Cache would
  // otherwise silently serve a stale read here (see project memory on
  // this exact footgun).
  const supabase = getSupabaseAdminFresh();

  type Place = {
    id: string;
    displayName?: { text?: string };
    formattedAddress?: string;
    nationalPhoneNumber?: string;
    websiteUri?: string;
  };

  let totalFound = 0;
  let totalNew = 0;
  const errors: { category: string; town: string; error: string }[] = [];

  for (const category of categories) {
    for (const town of towns) {
      try {
        const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": apiKey,
            "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri",
          },
          body: JSON.stringify({ textQuery: `${category} in ${town}, MA` }),
        });
        const data = await res.json();
        if (!res.ok) {
          errors.push({ category, town, error: data?.error?.message ?? `HTTP ${res.status}` });
          continue;
        }
        const places: Place[] = Array.isArray(data.places) ? data.places : [];
        totalFound += places.length;
        if (places.length === 0) continue;

        const ids = places.map((p) => p.id);
        const { data: existing } = await supabase.from("prospects").select("google_place_id").in("google_place_id", ids);
        const existingIds = new Set((existing ?? []).map((r: { google_place_id: string }) => r.google_place_id));
        totalNew += places.filter((p) => !existingIds.has(p.id)).length;

        const rows = places.map((p) => ({
          google_place_id: p.id,
          company_name: p.displayName?.text ?? "(unknown)",
          phone: p.nationalPhoneNumber ?? null,
          address: p.formattedAddress ?? null,
          website: p.websiteUri ?? null,
          category,
          town,
          updated_at: new Date().toISOString(),
        }));
        const { error } = await supabase.from("prospects").upsert(rows, { onConflict: "google_place_id" });
        if (error) errors.push({ category, town, error: error.message });
      } catch (err) {
        errors.push({ category, town, error: err instanceof Error ? err.message : "Unknown error" });
      }
    }
  }

  return NextResponse.json({ ok: true, totalFound, totalNew, errors });
});
