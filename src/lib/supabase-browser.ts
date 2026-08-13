import { createBrowserClient } from "@supabase/ssr";

/** Supabase Auth client for client components (portal login/signup forms). */
export function createSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY env vars"
    );
  }
  // PKCE (the default) needs a code_verifier secret stored in the SAME
  // browser at request time, matched against the code when the emailed
  // link is later clicked — Supabase's own SDK throws
  // AuthPKCECodeVerifierMissingError whenever that round-trip doesn't
  // hold up (confirmed live: a real user hit this on a genuinely fresh,
  // single click, no incognito/different-browser involved — the gap
  // between requesting and clicking an email link is just inherently
  // unreliable for carrying browser-local state). This app has no OAuth
  // providers, so PKCE's actual purpose (protecting an OAuth
  // authorization code from interception) doesn't apply — only email
  // recovery/signup/invite links do, where implicit flow's self-contained
  // hash token needs no matching state at all.
  return createBrowserClient(url, anonKey, {
    auth: { flowType: "implicit" },
  });
}
