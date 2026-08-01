import { NextRequest, NextResponse } from "next/server";
import { getZipsForTown, GeocodeError } from "@/lib/geocode";
import { withApiErrors } from "@/lib/api-handler";

// Public counterpart of /api/admin and /api/portal's zips-for-town — no
// auth, for the marketing site's pricing calculator.
export const GET = withApiErrors(async (req: NextRequest) => {
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
