import { NextRequest, NextResponse } from "next/server";
import { requireCronAuth, withCronAlert } from "@/lib/cron-auth";
import { withApiErrors } from "@/lib/api-handler";
import { isQuickBooksConnected, syncMileageToQuickBooks } from "@/lib/quickbooks";

export const dynamic = "force-dynamic";

// Per Tim, 2026-09-27 — daily sync of app-tracked mileage into QuickBooks
// as Journal Entries (see lib/quickbooks.ts's own comment for why a
// Journal Entry rather than an Expense). A no-op, not an error, until
// Tim's actually clicked "Connect to QuickBooks" once.
export const GET = withApiErrors(withCronAlert("sync-mileage-to-quickbooks", async (req: NextRequest) => {
  const unauthorized = requireCronAuth(req);
  if (unauthorized) return unauthorized;

  if (!(await isQuickBooksConnected())) {
    return NextResponse.json({ ok: true, skipped: "not connected yet" });
  }

  const result = await syncMileageToQuickBooks();
  return NextResponse.json({ ok: true, ...result });
}));
