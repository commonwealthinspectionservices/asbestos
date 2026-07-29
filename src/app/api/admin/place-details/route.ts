import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { getPlaceDetails } from "@/lib/geocode";
import { withApiErrors } from "@/lib/api-handler";

// Resolves a picked autocomplete suggestion to its full formatted address
// (including zip) for the Add Project form.
export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const placeId = new URL(req.url).searchParams.get("placeId")?.trim();
  if (!placeId) {
    return NextResponse.json({ error: "placeId is required" }, { status: 400 });
  }

  const details = await getPlaceDetails(placeId);
  return NextResponse.json(details);
});
