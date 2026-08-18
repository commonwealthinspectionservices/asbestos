import { NextRequest, NextResponse } from "next/server";
import { sendEmail, emailShell } from "@/lib/email";
import { escapeHtml } from "@/lib/html";
import { getSupabaseAdmin } from "@/lib/supabase";

/**
 * Verifies a cron-triggered request. Vercel Cron automatically sends
 * `Authorization: Bearer $CRON_SECRET` when a CRON_SECRET env var is set —
 * this checks that header, with a `?secret=` query param fallback for
 * manual/local testing (e.g. curl).
 */
export function requireCronAuth(req: NextRequest): NextResponse | null {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }

  const authHeader = req.headers.get("authorization");
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const queryToken = req.nextUrl.searchParams.get("secret");

  if (bearerToken === expected || queryToken === expected) {
    return null;
  }
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

// A sustained outage on check-lab-emails (every 15 minutes) would otherwise
// alert 96 times a day for the same underlying cause — this skips re-
// alerting for the same cron within the window, so a broken cron still
// gets exactly one heads-up, not a flood. Stored on the settings singleton
// row (see schema.sql) rather than anywhere per-cron, since there are only
// three crons total and a whole table would be overkill.
const ALERT_DEDUPE_MINUTES = 60;

async function shouldAlert(cronName: string): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase.from("settings").select("cron_alert_sent_at").eq("id", 1).maybeSingle();
  const sentAt = (data?.cron_alert_sent_at as Record<string, string> | null)?.[cronName];
  if (sentAt && Date.now() - new Date(sentAt).getTime() < ALERT_DEDUPE_MINUTES * 60_000) {
    return false;
  }
  const merged = { ...(data?.cron_alert_sent_at as Record<string, string> | undefined), [cronName]: new Date().toISOString() };
  await supabase.from("settings").update({ cron_alert_sent_at: merged }).eq("id", 1);
  return true;
}

/**
 * Every cron route wraps its handler in this, innermost of the two
 * wrappers (withApiErrors still runs after it, turning the error into the
 * JSON 500 response) — a cron that throws (bad token, an upstream API
 * outage, a real bug) used to fail completely silently from the owner's
 * side: caught, console.error'd into Vercel's own server logs, and nothing
 * else. Since these run unattended on a timer, a silent failure could run
 * for days before anyone noticed nothing was happening. Now it emails the
 * owner instead (deduped, see shouldAlert above) — best-effort itself (a
 * broken alert must never mask the original error) and still re-thrown so
 * the route's normal error handling/logging is unaffected.
 */
export function withCronAlert<Args extends unknown[]>(
  cronName: string,
  handler: (...args: Args) => Promise<NextResponse>
) {
  return async (...args: Args): Promise<NextResponse> => {
    try {
      return await handler(...args);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      try {
        if (await shouldAlert(cronName)) {
          await sendEmail({
            to: process.env.OWNER_EMAIL!,
            subject: `Automated task failed: ${cronName}`,
            html: emailShell(`
              <p style="font-size:15px;">The <strong>${escapeHtml(cronName)}</strong> automated task just failed and didn't finish — worth checking that nothing's silently broken.</p>
              <p style="font-size:13px; color:#64748b; font-family:monospace;">${escapeHtml(message)}</p>
            `),
          });
        }
      } catch {
        // Best-effort — a broken alert (or the dedupe check itself) must
        // never mask the original error below.
      }
      throw err;
    }
  };
}
