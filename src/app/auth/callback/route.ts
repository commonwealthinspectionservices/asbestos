import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";

// Handles Supabase Auth email links (signup confirmation, password reset)
// via the standard exchangeCodeForSession flow.
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  // Only signup confirmation routes through here now (password reset moved
  // to /portal/reset-password directly — see its comment for why), so this
  // always means onboarding. Defaulting it removes the need for signup's
  // emailRedirectTo to carry a ?next= query string at all, which is one
  // less thing that has to survive Supabase's Redirect URL allowlist check
  // intact (a query string not matching that allowlist is exactly what
  // broke the password-reset link earlier — same failure mode here).
  const next = req.nextUrl.searchParams.get("next") ?? "/portal/onboarding";

  if (code) {
    const supabase = createSupabaseServerClient();
    await supabase.auth.exchangeCodeForSession(code);
  }

  return NextResponse.redirect(new URL(next, req.url));
}
