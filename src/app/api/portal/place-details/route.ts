import { NextRequest, NextResponse } from "next/server";
import { requireContractorApi } from "@/lib/contractor-api";
import { getPlaceDetails } from "@/lib/geocode";
import { withApiErrors } from "@/lib/api-handler";

// Portal counterpart of /api/admin/place-details — resolves a picked
// autocomplete suggestion to its full formatted address for the Book a
// Project form.
export const GET = withApiErrors(async (req: NextRequest) => {
  const auth = await requireContractorApi();
  if (auth.error) return auth.error;

  const placeId = new URL(req.url).searchParams.get("placeId")?.trim();
  if (!placeId) {
    return NextResponse.json({ error: "placeId is required" }, { status: 400 });
  }

  const details = await getPlaceDetails(placeId);
  return NextResponse.json(details);
});
