"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

export default function PortalConfirmPage() {
  const router = useRouter();
  // null = still checking, true = a session was established, false = the
  // link is invalid/expired/already used.
  const [ready, setReady] = useState<boolean | null>(null);

  useEffect(() => {
    // Signup and Invite links (both admin- and portal-sent) deliver their
    // session as a URL hash fragment (#access_token=...&refresh_token=...
    // &type=signup|invite) — or #error=... if the one-time link was
    // already used — same as password recovery. Fragments never reach a
    // server, so this can only be handled client-side; a server route
    // (like the old /auth/callback) is structurally unable to see them.
    // Needs an explicit setSession call, not just waiting on getSession()
    // to "notice" the hash — the ssr package's browser client (needed so
    // Server Components can read the session via cookies) is tuned for
    // ?code= exchanges, not implicit-flow hash fragments, and silently
    // never establishes a session from one on its own.
    const hash = new URLSearchParams(window.location.hash.slice(1));
    if (hash.get("error")) {
      setReady(false);
      return;
    }
    const accessToken = hash.get("access_token");
    const refreshToken = hash.get("refresh_token");
    if (!accessToken || !refreshToken) {
      setReady(false);
      return;
    }
    const supabase = createSupabaseBrowserClient();
    // jobId rides in the query string (not the hash, which Supabase owns
    // for the session tokens above) — set by signup/page.tsx's own
    // emailRedirectTo when this link started from a deep-linked email.
    const jobId = new URLSearchParams(window.location.search).get("jobId");
    supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken }).then(({ data }) => {
      if (data.session) {
        router.push(jobId ? `/portal/onboarding?jobId=${jobId}` : "/portal/onboarding");
        router.refresh();
      } else {
        setReady(false);
      }
    });
  }, [router]);

  if (ready === null) {
    return (
      <div className="mx-auto max-w-sm px-4 py-16">
        <p className="text-sm text-slate-500">Confirming…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-sm px-4 py-16">
      <h1 className="text-xl font-semibold text-brand-700">This link has expired</h1>
      <p className="mt-4 text-sm text-slate-600">
        Confirmation links only work once and expire quickly — this one isn&apos;t valid anymore.
      </p>
      <Link
        href="/portal/signup"
        className="mt-6 block w-full rounded-lg bg-brand-600 px-4 py-3 text-center font-medium text-white"
      >
        Sign up again
      </Link>
    </div>
  );
}
