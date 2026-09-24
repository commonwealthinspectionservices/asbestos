import { NextRequest, NextResponse } from "next/server";
import { requireOwnerApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";
import { getSupabaseAdminFresh } from "@/lib/supabase";
import { mileageRateCentsForDay, type MileageStop, type MileageLeg } from "@/lib/mileage-shared";
import { COMPANY_START_DATE } from "@/lib/company-dates";

function csvField(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

// A CSV of every logged trip since the company started — one row per
// route leg for a normal day, one row per past QuickBooks-imported
// (total-only) day — for handing to an accountant at tax time.
export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireOwnerApi(req);
  if (unauthorized) return unauthorized;

  const { data, error } = await getSupabaseAdminFresh()
    .from("mileage_days")
    .select("day, stops, legs")
    .gte("day", COMPANY_START_DATE)
    .order("day");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = ["Date,From,To,Miles,Deduction"];
  for (const row of (data ?? []) as { day: string; stops: MileageStop[]; legs: MileageLeg[] }[]) {
    const isSummary = !!row.legs[0]?.total;
    if (isSummary) {
      const miles = row.legs.reduce((s, l) => s + l.miles, 0);
      rows.push([row.day, csvField("Day total"), "", miles.toFixed(1), (miles * mileageRateCentsForDay(row.day) / 100).toFixed(2)].join(","));
      continue;
    }
    row.legs.forEach((leg, i) => {
      const from = row.stops[i]?.label ?? "";
      const to = row.stops[i + 1]?.label ?? "";
      rows.push([row.day, csvField(from), csvField(to), leg.miles.toFixed(1), (leg.miles * mileageRateCentsForDay(row.day) / 100).toFixed(2)].join(","));
    });
  }

  return new NextResponse(rows.join("\n"), {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="mileage-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
});
