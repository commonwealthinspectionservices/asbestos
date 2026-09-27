import { NextRequest, NextResponse } from "next/server";
import { requireOwnerApi } from "@/lib/admin-api";
import { syncMileageToQuickBooks } from "@/lib/quickbooks";
import { withApiErrors } from "@/lib/api-handler";

// Owner-triggered manual "Sync now" button on the Mileage page. The daily
// automatic version of this same sync lives at
// /api/cron/sync-mileage-to-quickbooks (cron-authed, not this route).
export const POST = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireOwnerApi(req);
  if (unauthorized) return unauthorized;

  const result = await syncMileageToQuickBooks();
  return NextResponse.json({ ok: true, ...result });
});
