import { NextRequest, NextResponse } from "next/server";
import { requireCronAuth, withCronAlert } from "@/lib/cron-auth";
import { withApiErrors } from "@/lib/api-handler";
import { importContactsFromRecentEmail } from "@/lib/contact-import";

// Reads req.headers (via requireCronAuth) — without this, Next tries to
// statically render the route at build time and throws "Dynamic server
// usage" (see check-lab-emails' own identical comment).
export const dynamic = "force-dynamic";

// 50 messages/run at one Gmail API call each is comfortably under 15s in
// practice, but a slow run (or a Gmail hiccup) could still run long — see
// prospecting/source's own precedent for why this needs stating explicitly
// rather than trusting the platform's 15s default.
export const maxDuration = 60;

// Per Tim, 2026-09-11 — "anyone that emails me... should be saved [as a
// contact]": every 15 minutes, scans up to 50 not-yet-seen inbox messages
// and adds any new person on their From/To/Cc as a Directory contact (see
// lib/contact-import.ts for the real logic and its own reasoning). No
// separate one-off backfill script — calling this same route by hand
// (GET with ?secret=<CRON_SECRET>, repeatedly) catches up on older mail
// exactly the same way, since a message already labeled just gets skipped.
export const GET = withApiErrors(withCronAlert("import-contacts", async (req: NextRequest) => {
  const unauthorized = requireCronAuth(req);
  if (unauthorized) return unauthorized;

  const result = await importContactsFromRecentEmail(50);
  return NextResponse.json(result);
}));
