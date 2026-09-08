import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";

// One-off diagnostic, 2026-09-08 — confirms the new GOOGLE_PLACES_API_KEY
// (Places API (New), separate project/billing from the existing
// GOOGLE_MAPS_API_KEY used for geocoding/address autocomplete) is
// actually enabled and billed before building the real sourcing sweep
// on top of it. Delete once confirmed working.
export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Missing GOOGLE_PLACES_API_KEY env var" }, { status: 500 });

  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.id,places.websiteUri,places.nationalPhoneNumber",
    },
    body: JSON.stringify({ textQuery: "mold remediation company in Boston MA" }),
  });
  const data = await res.json();
  return NextResponse.json({ status: res.status, data });
});
