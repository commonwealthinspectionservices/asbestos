import { NextRequest, NextResponse } from "next/server";
import { requireOwnerApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";
import { ensureMileageDays, sumSavedMileageByMonth } from "@/lib/mileage";
import { COMPANY_START_DATE } from "@/lib/company-dates";

// ?month=YYYY-MM → that month's days (syncs that month's stops against the
// schedule); ?summary=1 → miles per month since the company started,
// read-only (see sumSavedMileageByMonth's own comment for why this must
// never rewrite an already-saved day).
export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireOwnerApi(req);
  if (unauthorized) return unauthorized;

  const url = new URL(req.url);
  if (url.searchParams.get("summary")) {
    const monthlyMiles = await sumSavedMileageByMonth(COMPANY_START_DATE, "9999-12-31");
    return NextResponse.json({ monthlyMiles });
  }

  const month = url.searchParams.get("month");
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return NextResponse.json({ error: "month=YYYY-MM required" }, { status: 400 });
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const days = await ensureMileageDays(`${month}-01`, `${month}-${String(last).padStart(2, "0")}`);
  return NextResponse.json({ days });
});
