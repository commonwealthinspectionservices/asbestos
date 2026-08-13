import { createBrowserClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

function getEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY env vars"
    );
  }
  return { url, anonKey };
}

/** Supabase Auth client for client components (portal login/signup forms). */
export function createSupabaseBrowserClient() {
  const { url, anonKey } = getEnv();
  return createBrowserClient(url, anonKey);
}

/**
 * A plain (non-cookie, non-persisted) client for the ONE call that
 * requests an email link: resetPasswordForEmail / signUp. createBrowserClient()
 * above hardcodes flowType: "pkce" unconditionally in its own source
 * (@supabase/ssr's createBrowserClient.js sets it *after* spreading in
 * whatever options.auth is passed, so overriding it there is silently
 * discarded — confirmed by reading the installed package's source, not a
 * config mistake). PKCE needs a code_verifier secret stored in the SAME
 * browser at request time, matched against the code when the emailed
 * link is later clicked — confirmed live via
 * AuthPKCECodeVerifierMissingError on a genuinely fresh, single click,
 * no incognito/different-browser involved. This app has no OAuth
 * providers, so PKCE's actual purpose (protecting an OAuth authorization
 * code from interception) never applied here anyway. This client exists
 * only to make that one initiating call without a code_challenge, so
 * Supabase mails a self-contained hash token instead — it's never used
 * to hold a session (persistSession: false), so it doesn't need cookie
 * storage. The resulting link's session is picked up by
 * createSupabaseBrowserClient() as normal on the completion page, via
 * setSession(accessToken, refreshToken) — which doesn't care what flow
 * created those tokens.
 */
export function createSupabaseEmailLinkClient() {
  const { url, anonKey } = getEnv();
  return createClient(url, anonKey, {
    auth: { flowType: "implicit", persistSession: false },
  });
}
