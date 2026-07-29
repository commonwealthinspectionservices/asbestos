import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { autocompleteAddress, autocompleteCity } from "@/lib/geocode";
import { withApiErrors } from "@/lib/api-handler";

// Backs the address type-ahead in the Add Project form. `mode=city`
// switches to town-only suggestions (no street) for a Town field used
// before a street address is known.
export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const params = new URL(req.url).searchParams;
  const input = params.get("input")?.trim();
  if (!input || input.length < 3) {
    return NextResponse.json({ suggestions: [] });
  }

  const suggestions =
    params.get("mode") === "city"
      ? await autocompleteCity(input)
      : await autocompleteAddress(input, params.get("town")?.trim() || undefined);
  return NextResponse.json({ suggestions });
});
