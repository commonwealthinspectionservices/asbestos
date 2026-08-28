import { NextRequest, NextResponse } from "next/server";
import { requireCronAuth, withCronAlert } from "@/lib/cron-auth";
import { withApiErrors } from "@/lib/api-handler";
import { runNet30AutoCharges } from "@/lib/net30-autocharge";

export const dynamic = "force-dynamic";

// Fires once daily (see vercel.json) — attempts to charge any Newton Fire
// & Flood invoice that's come due against the card they left on file, see
// net30-autocharge.ts for the actual logic and reasoning.
export const GET = withApiErrors(withCronAlert("charge-net30-invoices", async (req: NextRequest) => {
  const unauthorized = requireCronAuth(req);
  if (unauthorized) return unauthorized;

  const result = await runNet30AutoCharges();
  return NextResponse.json({ ok: true, ...result });
}));
