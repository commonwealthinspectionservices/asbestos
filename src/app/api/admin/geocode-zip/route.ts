import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { geocodeAddress, GeocodeError, logGeocodeFailure } from "@/lib/geocode";
import { withApiErrors } from "@/lib/api-handler";

// Resolves a zip code for a street/city/state combination typed into the
// Add Project billing address fields — unlike place-details, there's no
// placeId here since the admin is typing into separate fields rather than
// picking an autocomplete suggestion.
export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const address = new URL(req.url).searchParams.get("address")?.trim();
  if (!address) {
    return NextResponse.json({ error: "address is required" }, { status: 400 });
  }

  try {
    const geo = await geocodeAddress(address);
    return NextResponse.json({ zip: geo.zip });
  } catch (e) {
    if (e instanceof GeocodeError) {
      logGeocodeFailure(e, "GET /api/admin/geocode-zip");
      return NextResponse.json({ zip: null });
    }
    throw e;
  }
});
