import { NextRequest, NextResponse } from "next/server";
import { getPlaceDetails } from "@/lib/geocode";
import { withApiErrors } from "@/lib/api-handler";

// Public counterpart of /api/admin and /api/portal's place-details —
// resolves a picked autocomplete suggestion, no auth, for the marketing
// site's pricing calculator.
export const GET = withApiErrors(async (req: NextRequest) => {
  const placeId = new URL(req.url).searchParams.get("placeId")?.trim();
  if (!placeId) {
    return NextResponse.json({ error: "placeId is required" }, { status: 400 });
  }

  const details = await getPlaceDetails(placeId);
  return NextResponse.json(details);
});
