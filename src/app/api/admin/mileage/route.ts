import { NextRequest, NextResponse } from "next/server";
import { requireOwnerApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";
import { ensureMileageDays, sumSavedMileageByDay } from "@/lib/mileage";
import { COMPANY_START_DATE } from "@/lib/company-dates";

// ?month=YYYY-MM → that month's days (syncs that month's stops against the
// schedule); ?summary=1 → miles per month AND per day since the company
// started, read-only (see sumSavedMileageByDay's own comment for why this
// must never rewrite an already-saved day). dailyMiles added 2026-09-23 for
// Revenue & Margin Summary's weekly earnings view, which needs to re-bucket
// into its own Sun–Sat weeks — a month total can't be sliced that finely.
export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireOwnerApi(req);
  if (unauthorized) return unauthorized;

  const url = new URL(req.url);
  if (url.searchParams.get("summary")) {
    // One day-level read (which may also create missing route days — see
    // its own comment), not two — calling both sumSavedMileageByDay and
    // sumSavedMileageByMonth separately would double that work and race
    // itself on the same missing-day upserts.
    const dailyMiles = await sumSavedMileageByDay(COMPANY_START_DATE, "9999-12-31");
    const monthlyMiles: Record<string, number> = {};
    for (const [day, miles] of Object.entries(dailyMiles)) {
      const key = day.slice(0, 7);
      monthlyMiles[key] = Math.round(((monthlyMiles[key] ?? 0) + miles) * 10) / 10;
    }
    return NextResponse.json({ monthlyMiles, dailyMiles });
  }

  const month = url.searchParams.get("month");
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return NextResponse.json({ error: "month=YYYY-MM required" }, { status: 400 });
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const days = await ensureMileageDays(`${month}-01`, `${month}-${String(last).padStart(2, "0")}`);
  return NextResponse.json({ days });
});
