import { NextRequest, NextResponse } from "next/server";
import { runMorningRoute } from "@/lib/route-runner";
import { nowInTimeZone } from "@/lib/tz";
import { getSettings } from "@/lib/settings";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireCronAuth } from "@/lib/cron-auth";
import { withApiErrors } from "@/lib/api-handler";

// Vercel Cron schedules run in UTC, and Hobby-tier cron jobs are limited to
// one invocation per day — so this can't poll every few minutes until local
// time catches up to route_email_time_local. Instead vercel.json fires this
// once daily at a fixed UTC time (09:00 UTC = 05:00 ET during EDT / 04:00 ET
// during EST) — the simpler of the two options the spec allows, with a
// one-hour shift in winter that's a documented tradeoff, not a bug.
// The idempotency check below still guards against double-sends if the
// route is ever triggered twice for the same day (e.g. a manual admin
// recompute right before the cron fires).
export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireCronAuth(req);
  if (unauthorized) return unauthorized;

  const settings = await getSettings();
  const { dateIso } = nowInTimeZone(settings.timezone);

  // 0 = Sunday, 6 = Saturday — the business doesn't route on weekends, so
  // skip the send entirely rather than mailing an empty "no projects today".
  // Read as UTC noon (not the settings timezone) so the weekday can't shift
  // across a date boundary the way a raw new Date(dateIso) would.
  const dayOfWeek = new Date(`${dateIso}T12:00:00Z`).getUTCDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return NextResponse.json({ skipped: true, reason: "weekend" });
  }

  const supabase = getSupabaseAdmin();
  const { data: existing } = await supabase
    .from("daily_routes")
    .select("id")
    .eq("route_date", dateIso)
    .not("sent_at", "is", null)
    .limit(1)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ skipped: true, reason: "already sent today" });
  }

  const result = await runMorningRoute(dateIso);
  return NextResponse.json({ ok: true, date: dateIso, ...result });
});
