import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForConnection } from "@/lib/quickbooks";
import { withApiErrors } from "@/lib/api-handler";

// Intuit redirects the browser here after the owner approves the consent
// screen from /connect — not gated behind requireOwnerApi, since Intuit's
// own redirect is what's hitting this URL, not an authenticated fetch from
// our own app. The state-cookie check below is what actually verifies
// this really followed our own /connect redirect (CSRF protection) rather
// than a bare guess at this URL with someone else's code/realmId.
export const GET = withApiErrors(async (req: NextRequest) => {
  const code = req.nextUrl.searchParams.get("code");
  const realmId = req.nextUrl.searchParams.get("realmId");
  const state = req.nextUrl.searchParams.get("state");
  const expectedState = req.cookies.get("qb_oauth_state")?.value;

  if (!code || !realmId) {
    return NextResponse.json({ error: "Missing code or realmId from QuickBooks" }, { status: 400 });
  }
  if (!expectedState || state !== expectedState) {
    return NextResponse.json({ error: "State mismatch — please retry the Connect to QuickBooks button" }, { status: 400 });
  }

  await exchangeCodeForConnection(code, realmId);

  const res = NextResponse.redirect(new URL("/admin/mileage?quickbooks=connected", req.url));
  res.cookies.delete("qb_oauth_state");
  return res;
});
