import { NextRequest, NextResponse } from "next/server";
import { requireOwnerApi } from "@/lib/admin-api";
import { quickbooksAuthorizeUrl } from "@/lib/quickbooks";
import { withApiErrors } from "@/lib/api-handler";
import crypto from "crypto";

// Owner-only, one-time "Connect to QuickBooks" button — kicks off Intuit's
// OAuth consent screen. The random state value round-trips through
// Intuit and back to our own callback route (see its own comment) purely
// as CSRF protection, not to carry any real data.
export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireOwnerApi(req);
  if (unauthorized) return unauthorized;

  const state = crypto.randomBytes(24).toString("hex");
  const res = NextResponse.redirect(await quickbooksAuthorizeUrl(state));
  res.cookies.set("qb_oauth_state", state, { httpOnly: true, maxAge: 600, sameSite: "lax", secure: true });
  return res;
});
