import { NextRequest, NextResponse } from "next/server";
import { requireContractorApi } from "@/lib/contractor-api";
import { geocodeAddress, GeocodeError } from "@/lib/geocode";
import { withApiErrors } from "@/lib/api-handler";

// Portal counterpart of /api/admin/geocode-zip — resolves a zip code for a
// street/city/state combination typed into the Book a Project address
// fields, same as the admin Add Project form's structured address.
export const GET = withApiErrors(async (req: NextRequest) => {
  const auth = await requireContractorApi();
  if (auth.error) return auth.error;

  const address = new URL(req.url).searchParams.get("address")?.trim();
  if (!address) {
    return NextResponse.json({ error: "address is required" }, { status: 400 });
  }

  try {
    const geo = await geocodeAddress(address);
    return NextResponse.json({ zip: geo.zip });
  } catch (e) {
    if (e instanceof GeocodeError) {
      return NextResponse.json({ zip: null });
    }
    throw e;
  }
});
