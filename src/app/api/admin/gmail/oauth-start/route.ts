import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";
import { getGoogleAuthUrl } from "@/lib/gmail";

// Browser-navigated (the Settings page's "Connect Gmail" button is a plain
// link, not a fetch), so the admin session cookie rides along automatically.
export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  return NextResponse.redirect(getGoogleAuthUrl("admin"));
});
