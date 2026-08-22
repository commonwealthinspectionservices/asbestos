import { NextRequest, NextResponse } from "next/server";
import { requireCronAuth, withCronAlert } from "@/lib/cron-auth";
import { withApiErrors } from "@/lib/api-handler";
import { checkForJobIntakeEmails } from "@/lib/job-intake";

// Reads req.headers (via requireCronAuth) — without this, Next tries to
// statically render the route at build time and throws "Dynamic server
// usage", which surfaced as this cron failing every single invocation
// once deployed (see withCronAlert's failure emails).
export const dynamic = "force-dynamic";

// Polls every 15 minutes (see vercel.json), same cadence as check-lab-emails
// — a new job request deserves showing up on the dashboard about as
// promptly as a lab result does. Separate cron/route from check-lab-emails
// on purpose even though they poll the same inbox: genuinely different
// concerns (matching an incoming PDF to an existing job vs. creating a
// brand new job from an email's own text), and keeping them separate means
// each shows up as its own line in the automation-failure alerting
// (withCronAlert) instead of one cron's failure being ambiguous about
// which job it actually broke.
export const GET = withApiErrors(withCronAlert("check-job-intake", async (req: NextRequest) => {
  const unauthorized = requireCronAuth(req);
  if (unauthorized) return unauthorized;

  const result = await checkForJobIntakeEmails();
  return NextResponse.json({ ok: true, ...result });
}));
