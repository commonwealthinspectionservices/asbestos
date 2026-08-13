"use client";

import { useEffect } from "react";

// Supabase's Redirect URLs / Site URL configuration isn't honoring the
// redirectTo/emailRedirectTo requested by resetPasswordForEmail, signUp,
// or the admin/portal invite routes — confirmed via repeated
// admin.generateLink tests that every requested redirect (wildcard entry,
// exact literal entry, corrected Site URL) still comes back collapsed to
// the bare Site URL, which is this homepage. Rather than depend on a
// dashboard setting that isn't taking effect, catch the auth hash
// wherever it lands and forward it to the page that actually knows how
// to consume it (which needs setSession, not just a hash present).
export default function AuthHashRedirect() {
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash) return;
    const params = new URLSearchParams(hash.slice(1));
    const type = params.get("type");
    if (type === "recovery") {
      window.location.replace(`/portal/reset-password${hash}`);
    } else if (type === "signup" || type === "invite" || type === "email_change") {
      window.location.replace(`/portal/confirm${hash}`);
    } else if (params.get("error")) {
      // An expired/already-used link's error redirect carries no `type`,
      // so we can't tell which flow it came from. Default to password
      // reset — the more common of the two self-service email links.
      window.location.replace(`/portal/reset-password${hash}`);
    }
  }, []);

  return null;
}
