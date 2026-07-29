import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { getZipsForTown, GeocodeError } from "@/lib/geocode";
import { withApiErrors } from "@/lib/api-handler";

// Lists every ZIP code for a town, so the Town field can auto-fill when
// there's only one and offer a pick-list when there are several.
export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

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
