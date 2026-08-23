import { createClient } from "@supabase/supabase-js";

// Server-only client using the service role key. All DB access in this app
// goes through API routes (no customer accounts, no client-side RLS needs),
// so a single privileged server client is sufficient — never import this
// from a "use client" component.
let client: ReturnType<typeof createClient<any, any, any>> | null = null;

export function getSupabaseAdmin() {
  if (client) return client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars"
    );
  }

  client = createClient<any, any, any>(url, key, {
    auth: { persistSession: false },
    // Supabase's client uses the ambient global fetch, which in a Next.js
    // server environment is Next.js's own patched fetch with its Data
    // Cache — caching GET requests by URL regardless of what's actually in
    // the database right now. Confirmed live: after fixing the same issue
    // in lib/gmail.ts, a route reading this table moments after a real,
    // verified write still returned the pre-write row. Every DB read in
    // the app goes through this one client, so this single fix covers all
    // of them rather than patching each call site.
    global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) },
  });
  return client;
}
