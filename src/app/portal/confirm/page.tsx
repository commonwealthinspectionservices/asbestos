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
    // session as a URL hash fragment (#access_token=...&type=signup|invite)
    // — or #error=... if the one-time link was already used — same as
    // password recovery. Fragments never reach a server, so this can only
    // be handled client-side; a server route (like the old /auth/callback)
    // is structurally unable to see them. The Supabase browser client
    // auto-establishes the session from the hash on init; this just waits
    // for that and checks whether it actually worked.
    const hash = new URLSearchParams(window.location.hash.slice(1));
    if (hash.get("error")) {
      setReady(false);
      return;
    }
    const supabase = createSupabaseBrowserClient();
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        router.push("/portal/onboarding");
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
