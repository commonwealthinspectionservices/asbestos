import { NextRequest, NextResponse } from "next/server";
import { requireOwnerApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";
import { ensureMileageDays, totalMiles } from "@/lib/mileage";
import { COMPANY_START_DATE } from "@/lib/company-dates";

// ?month=YYYY-MM → that month's days; ?summary=1 → miles per month since the
// company started (creates any missing auto-routes on the way).
export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireOwnerApi(req);
  if (unauthorized) return unauthorized;

  const url = new URL(req.url);
  if (url.searchParams.get("summary")) {
    const days = await ensureMileageDays(COMPANY_START_DATE, "9999-12-31");
    const monthlyMiles: Record<string, number> = {};
    for (const d of days) {
      const key = d.day.slice(0, 7);
      monthlyMiles[key] = Math.round(((monthlyMiles[key] ?? 0) + totalMiles(d)) * 10) / 10;
    }
    return NextResponse.json({ monthlyMiles });
  }

  const month = url.searchParams.get("month");
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return NextResponse.json({ error: "month=YYYY-MM required" }, { status: 400 });
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const days = await ensureMileageDays(`${month}-01`, `${month}-${String(last).padStart(2, "0")}`);
  return NextResponse.json({ days });
});
