import { NextRequest, NextResponse } from "next/server";
import { geocodeAddress, GeocodeError, logGeocodeFailure } from "@/lib/geocode";
import { withApiErrors } from "@/lib/api-handler";

// Public counterpart of /api/admin and /api/portal's geocode-zip — no auth,
// for the marketing site's pricing calculator.
export const GET = withApiErrors(async (req: NextRequest) => {
  const address = new URL(req.url).searchParams.get("address")?.trim();
  if (!address) {
    return NextResponse.json({ error: "address is required" }, { status: 400 });
  }

  try {
    const geo = await geocodeAddress(address);
    return NextResponse.json({ zip: geo.zip });
  } catch (e) {
    if (e instanceof GeocodeError) {
      logGeocodeFailure(e, "GET /api/geocode-zip");
      return NextResponse.json({ zip: null });
    }
    throw e;
  }
});
