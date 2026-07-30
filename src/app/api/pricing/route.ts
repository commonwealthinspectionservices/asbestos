import { NextResponse } from "next/server";
import { getSettings } from "@/lib/settings";
import { serviceRateLabel } from "@/lib/pricing";

// Public, read-only defaults for the marketing site's pricing calculator —
// unzoned base fees (the /api/book "address" step is what applies a
// zone-specific override once a real address is entered).
export const dynamic = "force-dynamic";

export async function GET() {
  const settings = await getSettings();
  return NextResponse.json({
    serviceTypes: settings.service_types.map((s) => ({ ...s, rateLabel: serviceRateLabel(s) })),
  });
}
