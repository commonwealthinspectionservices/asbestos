import { NextRequest, NextResponse } from "next/server";
import { requireOwnerApi } from "@/lib/admin-api";
import { getSupabaseAdminFresh } from "@/lib/supabase";
import { withApiErrors } from "@/lib/api-handler";

// Connection status for the small QuickBooks widget on the Mileage page —
// whether it's connected at all, and the most recent mileage day synced,
// so the admin can tell at a glance if the daily cron is actually running.
export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireOwnerApi(req);
  if (unauthorized) return unauthorized;

  const supabase = getSupabaseAdminFresh();
  const { data: conn } = await supabase.from("quickbooks_connection").select("environment, updated_at").eq("id", 1).maybeSingle();
  const { data: lastSynced } = await supabase
    .from("mileage_days")
    .select("day, qb_synced_at")
    .not("qb_synced_at", "is", null)
    .order("qb_synced_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return NextResponse.json({
    connected: Boolean(conn),
    environment: conn?.environment ?? null,
    lastSyncedDay: lastSynced?.day ?? null,
    lastSyncedAt: lastSynced?.qb_synced_at ?? null,
  });
});
