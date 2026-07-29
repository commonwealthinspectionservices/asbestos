import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Supabase Auth client scoped to the current request, for use in Route
 * Handlers and Server Components on the contractor portal. This is ONLY for
 * `.auth.*` session verification — all actual data reads/writes still go
 * through the privileged `getSupabaseAdmin()` client (src/lib/supabase.ts),
 * scoped in application code by the authenticated contractor's id. See
 * `src/lib/contractor-api.ts`.
 */
export function createSupabaseServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY env vars"
    );
  }

  const cookieStore = cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components can't set cookies — safe to ignore. Session
          // refresh writes happen in middleware.ts and Route Handlers instead.
        }
      },
    },
  });
}
