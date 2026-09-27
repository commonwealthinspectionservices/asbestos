import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminFresh } from "@/lib/supabase";
import { withApiErrors } from "@/lib/api-handler";

// Intuit's "Disconnect URL" — called when the connection is revoked from
// QuickBooks' own side (Apps → Disconnect), so our stored tokens don't sit
// around stale. Best-effort and always 200s: Intuit doesn't retry on
// failure here, and there's nothing useful to do differently either way —
// we only ever have the one (id=1) connection row, so any disconnect call
// just clears it.
export const POST = withApiErrors(async (req: NextRequest) => {
  const supabase = getSupabaseAdminFresh();
  await supabase.from("quickbooks_connection").delete().eq("id", 1);
  return NextResponse.json({ ok: true });
});

export const GET = POST;
