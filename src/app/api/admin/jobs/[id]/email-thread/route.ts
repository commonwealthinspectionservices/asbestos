import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { getSupabaseAdmin } from "@/lib/supabase";
import { withApiErrors } from "@/lib/api-handler";
import { getValidAccessToken, listMessagesByQuery, getMessage, getHeader } from "@/lib/gmail";

// email_gmail_thread_id is deliberately NOT in the jobs PATCH route's
// EDITABLE_FIELDS — it's meant to be captured automatically the moment a
// job is created from an inbound email (see job-intake.ts), and letting it
// be hand-edited through the general Edit form risks silently breaking the
// threading these routes rely on (report drafts land as a reply onto
// whatever this points at — see reportDraftBodyHtml's threadId usage in
// lib/lab-email.ts). A job that instead started life as an ordinary
// back-and-forth negotiation thread (quoted, scheduled, and priced over
// email before ever becoming a job here — see job 26-0030, "Burt Condo
// Trust") never goes through that automatic capture, so its mail-icon link
// (JobsDashboard.tsx) has nothing to point at and its own report draft
// can't thread onto that conversation either. This is the deliberate,
// narrow way to backfill it: search Gmail for the real thread and link it
// by its own id, never by hand-typing or pasting a URL (Gmail's web UI
// permalink fragment, e.g. "#inbox/FMfcgz...", is a different id format
// than the API's own threadId this app actually needs).
export const GET = withApiErrors(async (
  req: NextRequest,
  { params }: { params: { id: string } }
) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q) return NextResponse.json({ error: "q is required" }, { status: 400 });

  const accessToken = await getValidAccessToken();
  if (!accessToken) return NextResponse.json({ error: "Gmail is not connected" }, { status: 400 });

  const candidates = await listMessagesByQuery(accessToken, `${q} newer_than:180d`);
  const seenThreads = new Map<string, { gmailThreadId: string; subject: string; from: string; date: string }>();
  for (const c of candidates) {
    if (seenThreads.has(c.threadId)) continue;
    const message = await getMessage(accessToken, c.id);
    seenThreads.set(c.threadId, {
      gmailThreadId: c.threadId,
      subject: getHeader(message, "Subject") ?? "(no subject)",
      from: getHeader(message, "From") ?? "",
      date: message.internalDate ? new Date(Number(message.internalDate)).toISOString() : "",
    });
    if (seenThreads.size >= 8) break;
  }
  const threads = Array.from(seenThreads.values()).sort((a, b) => b.date.localeCompare(a.date));
  return NextResponse.json({ threads });
});

export const POST = withApiErrors(async (
  req: NextRequest,
  { params }: { params: { id: string } }
) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const body = await req.json().catch(() => null);
  const gmailThreadId = typeof body?.gmailThreadId === "string" ? body.gmailThreadId.trim() : "";
  if (!gmailThreadId) return NextResponse.json({ error: "gmailThreadId is required" }, { status: 400 });

  // Confirm it's a real, currently-reachable thread before saving a
  // reference to it — same reasoning as verifying any other foreign id
  // before persisting it.
  const accessToken = await getValidAccessToken();
  if (!accessToken) return NextResponse.json({ error: "Gmail is not connected" }, { status: 400 });
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${gmailThreadId}?format=minimal`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!res.ok) return NextResponse.json({ error: "That thread could not be found in Gmail" }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("jobs")
    .update({ email_gmail_thread_id: gmailThreadId })
    .eq("id", params.id)
    .select("id, email_gmail_thread_id")
    .single();
  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Failed to link thread" }, { status: 500 });
  }
  return NextResponse.json({ job: data });
});
