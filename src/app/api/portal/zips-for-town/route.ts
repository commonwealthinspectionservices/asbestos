import { NextRequest, NextResponse } from "next/server";
import { requireContractorApi } from "@/lib/contractor-api";
import { getZipsForTown, GeocodeError } from "@/lib/geocode";
import { withApiErrors } from "@/lib/api-handler";

// Portal counterpart of /api/admin/zips-for-town — lists every ZIP code for
// a town, so the Town field can auto-fill when there's only one and offer a
// pick-list when there are several, same as the admin Add Project form.
export const GET = withApiErrors(async (req: NextRequest) => {
  const auth = await requireContractorApi();
  if (auth.error) return auth.error;

  const params = new URL(req.url).searchParams;
  const town = params.get("town")?.trim();
  const state = params.get("state")?.trim();
  if (!town || !state) {
    return NextResponse.json({ zips: [] });
  }

  try {
    const zips = await getZipsForTown(town, state);
    return NextResponse.json({ zips });
  } catch (e) {
    if (e instanceof GeocodeError) return NextResponse.json({ zips: [] });
    throw e;
  }
});
