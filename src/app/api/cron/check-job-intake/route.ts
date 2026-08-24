import { NextRequest, NextResponse } from "next/server";
import { requireCronAuth, withCronAlert } from "@/lib/cron-auth";
import { withApiErrors } from "@/lib/api-handler";
import { checkForJobIntakeEmails } from "@/lib/job-intake";
import { getGmailConnectionStatus } from "@/lib/gmail";
import { getSupabaseAdminFresh } from "@/lib/supabase";

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

  // TEMPORARY — one-off read-only diagnostic for the 26-0003/Framingham-
  // data mixup reported 2026-08-24. Remove once resolved.
  const debugProjectNumber = req.nextUrl.searchParams.get("debug_project_number");
  if (debugProjectNumber) {
    const supabase = getSupabaseAdminFresh();
    const { data: job, error } = await supabase
      .from("jobs")
      .select("*")
      .eq("project_number", debugProjectNumber)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!job) return NextResponse.json({ job: null });
    const { data: customer } = await supabase
      .from("customers")
      .select("id, name, company, email, phone")
      .eq("id", job.customer_id)
      .maybeSingle();
    return NextResponse.json({ job, customer });
  }

  const result = await checkForJobIntakeEmails();
  // connectedEmail is a cheap, ongoing diagnostic — the search silently
  // returning 0 candidates looks identical whether nothing matched or the
  // stored refresh token belongs to the wrong mailbox entirely, so this
  // is worth always exposing in the response rather than digging into
  // Supabase by hand the next time this needs debugging.
  const { email: connectedEmail } = await getGmailConnectionStatus();
  return NextResponse.json({ ok: true, connectedEmail, ...result });
}));
