import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";
import { exchangeCodeForTokens, getGmailProfileEmail, saveGmailTokens } from "@/lib/gmail";

export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const settingsUrl = new URL("/admin/settings", req.url);
  const code = req.nextUrl.searchParams.get("code");
  const oauthError = req.nextUrl.searchParams.get("error");

  if (oauthError) {
    settingsUrl.searchParams.set("gmail_error", oauthError);
    return NextResponse.redirect(settingsUrl);
  }
  if (!code) {
    settingsUrl.searchParams.set("gmail_error", "missing_code");
    return NextResponse.redirect(settingsUrl);
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    const email = await getGmailProfileEmail(tokens.access_token);
    await saveGmailTokens({
      email,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresIn: tokens.expires_in,
    });
  } catch (e) {
    settingsUrl.searchParams.set("gmail_error", e instanceof Error ? e.message : "connect_failed");
    return NextResponse.redirect(settingsUrl);
  }

  settingsUrl.searchParams.set("gmail_connected", "1");
  return NextResponse.redirect(settingsUrl);
});
