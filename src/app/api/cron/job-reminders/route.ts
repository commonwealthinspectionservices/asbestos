import { NextRequest, NextResponse } from "next/server";
import { requireCronAuth, withCronAlert } from "@/lib/cron-auth";
import { withApiErrors } from "@/lib/api-handler";
import { sendJobReminders } from "@/lib/job-reminders";

// Fires once daily (see vercel.json) — sends the "your inspection is
// tomorrow" reminder to every scheduled job whose confirmed_date is
// tomorrow. Runs every day of the week, including weekends, since a
// Monday job's reminder needs to go out on Sunday.
export const GET = withApiErrors(withCronAlert("job-reminders", async (req: NextRequest) => {
  const unauthorized = requireCronAuth(req);
  if (unauthorized) return unauthorized;

  const result = await sendJobReminders();
  return NextResponse.json({ ok: true, ...result });
}));
