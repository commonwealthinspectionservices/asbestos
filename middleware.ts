import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Server Components can't write cookies in the App Router, so without this,
// a contractor's session token has nowhere to be refreshed on expiry. This
// middleware does ONLY that — no redirect/gate logic lives here, that stays
// in src/lib/contractor-api.ts to match the existing admin auth pattern.
//
// Scoped narrowly to the portal so it never touches /admin, /api/admin,
// /api/cron, or /api/webhooks — and deliberately never imports
// src/lib/auth.ts (Node's `crypto` isn't available on the Edge runtime
// middleware runs on; the admin cookie logic stays in Route Handlers).
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    }
  );

  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: ["/portal/:path*", "/api/portal/:path*"],
};
