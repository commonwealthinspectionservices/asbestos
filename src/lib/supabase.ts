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
  });
  return client;
}
