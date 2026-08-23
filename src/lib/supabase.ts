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

// A second client, distinct from getSupabaseAdmin() above, whose queries are
// never served from Next.js's fetch Data Cache. getSupabaseAdmin()'s plain
// client has to stay cache-eligible — marketing pages like /contact call it
// (via getSettings()) during static prerendering, and forcing no-store there
// broke the production build outright ("Dynamic server usage: no-store
// fetch ... /contact"). This client is for the opposite case: a caller that
// needs the database's actual current state, not whatever Next.js cached
// from an earlier request — e.g. lib/gmail.ts's connection status, where a
// stale cached read of the gmail_connection row kept masking a real,
// already-fixed OAuth token as still broken.
let freshClient: ReturnType<typeof createClient<any, any, any>> | null = null;

export function getSupabaseAdminFresh() {
  if (freshClient) return freshClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars"
    );
  }

  freshClient = createClient<any, any, any>(url, key, {
    auth: { persistSession: false },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) },
  });
  return freshClient;
}
