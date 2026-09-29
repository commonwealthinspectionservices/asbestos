import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";
import { findQuickBooksDepositsByDate, deleteQuickBooksDeposit } from "@/lib/quickbooks";

// One-off admin tool, 2026-09-29 — companion to recordProjectRevenueInQuickBooks
// being turned off (see subcontractor-payment-intake.ts's own comment):
// lists every Deposit on a given date so the automation's own
// now-duplicate entry can be identified, then deletes it by id/syncToken
// once confirmed. GET with no id lists candidates; GET with id+syncToken+
// confirm=true deletes that one. Never touches the real bank-feed
// transaction QuickBooks created independently — only a Deposit this
// automation itself posted (identifiable by its own PrivateNote text)
// should ever be the one removed.
export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const date = req.nextUrl.searchParams.get("date");
  if (!date) return NextResponse.json({ error: "date (YYYY-MM-DD) required" }, { status: 400 });

  const id = req.nextUrl.searchParams.get("id");
  const syncToken = req.nextUrl.searchParams.get("syncToken");
  const confirm = req.nextUrl.searchParams.get("confirm");

  if (id && syncToken) {
    if (confirm !== "true") {
      return NextResponse.json({ error: "pass confirm=true to actually delete this deposit" }, { status: 400 });
    }
    await deleteQuickBooksDeposit(id, syncToken);
    return NextResponse.json({ ok: true, deleted: id });
  }

  const deposits = await findQuickBooksDepositsByDate(date);
  return NextResponse.json({ deposits });
});
