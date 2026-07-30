import { NextRequest, NextResponse } from "next/server";
import { requireContractorApi } from "@/lib/contractor-api";
import { autocompleteAddress, autocompleteCity } from "@/lib/geocode";
import { withApiErrors } from "@/lib/api-handler";

// Portal counterpart of /api/admin/places-autocomplete — same type-ahead,
// gated by contractor auth instead of admin auth for the Book a Project form.
export const GET = withApiErrors(async (req: NextRequest) => {
  const auth = await requireContractorApi();
  if (auth.error) return auth.error;

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
