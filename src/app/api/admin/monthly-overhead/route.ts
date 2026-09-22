import { NextRequest, NextResponse } from "next/server";
import { requireOwnerApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";
import { getSupabaseAdminFresh } from "@/lib/supabase";

// Hand-typed "other costs" per month (equipment, ads, office — whatever
// QuickBooks tracks that the app itself doesn't) — netted into the Monthly
// earnings table. month is "YYYY-MM".
export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireOwnerApi(req);
  if (unauthorized) return unauthorized;
  const { data, error } = await getSupabaseAdminFresh().from("monthly_overhead").select("month, cents");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const byMonth: Record<string, number> = {};
  for (const row of data ?? []) byMonth[row.month] = row.cents;
  return NextResponse.json({ overhead: byMonth });
});

export const PUT = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireOwnerApi(req);
  if (unauthorized) return unauthorized;
  const body = await req.json().catch(() => null);
  const month = body?.month;
  const cents = Number(body?.cents);
  if (!/^\d{4}-\d{2}$/.test(month) || !Number.isFinite(cents) || cents < 0) {
    return NextResponse.json({ error: "month (YYYY-MM) and a non-negative cents value are required" }, { status: 400 });
  }
  const { error } = await getSupabaseAdminFresh().from("monthly_overhead").upsert({ month, cents: Math.round(cents), updated_at: new Date().toISOString() });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
});
