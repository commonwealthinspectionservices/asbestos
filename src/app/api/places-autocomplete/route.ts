import { NextRequest, NextResponse } from "next/server";
import { autocompleteAddress, autocompleteCity } from "@/lib/geocode";
import { withApiErrors } from "@/lib/api-handler";

// Public counterpart of /api/admin and /api/portal's places-autocomplete —
// same type-ahead, no auth, for the marketing site's pricing calculator.
export const GET = withApiErrors(async (req: NextRequest) => {
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
