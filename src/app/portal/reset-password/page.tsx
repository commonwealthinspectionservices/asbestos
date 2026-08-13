"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

export default function PortalResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // null = still checking the link, true = a recovery session was
  // established, false = the link is invalid/expired/already used.
  const [ready, setReady] = useState<boolean | null>(null);

  useEffect(() => {
    // createSupabaseBrowserClient() now forces implicit flow (see that
    // file for why), so the recovery link delivers its session as a URL
    // hash fragment (#access_token=...&refresh_token=...&type=recovery)
    // — or #error=... if the one-time link was already used. Fragments
    // never reach a server, so this can only be handled client-side.
    // Needs an explicit setSession call, not just waiting on getSession()
    // to "notice" the hash — the ssr package's browser client doesn't
    // pick up an implicit-flow hash fragment on its own. Also checks
    // ?code=/?error= in the query string as a defensive fallback in case
    // flowType is ever reverted to PKCE.
    const params = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const supabase = createSupabaseBrowserClient();

    if (params.get("error") || hash.get("error")) {
      setReady(false);
      return;
    }

    const code = params.get("code");
    if (code) {
      supabase.auth.exchangeCodeForSession(code).then(({ data, error }) => {
        setReady(Boolean(data.session) && !error);
      });
      return;
    }

    const accessToken = hash.get("access_token");
    const refreshToken = hash.get("refresh_token");
    if (!accessToken || !refreshToken) {
      setReady(false);
      return;
    }
    supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken }).then(({ data }) => {
      setReady(Boolean(data.session));
    });
  }, []);

  async function updatePassword() {
    if (password !== confirmPassword) {
      setError("Passwords don't match");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      router.push("/portal/dashboard");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update password");
    } finally {
      setLoading(false);
    }
  }

  if (ready === null) {
    return (
      <div className="mx-auto max-w-sm px-4 py-16">
        <p className="text-sm text-slate-500">Loading…</p>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="mx-auto max-w-sm px-4 py-16">
        <h1 className="text-xl font-semibold text-brand-700">This link has expired</h1>
        <p className="mt-4 text-sm text-slate-600">
          Password reset links only work once and expire quickly — this one isn&apos;t valid anymore.
          Request a new one below.
        </p>
        <p className="mt-2 text-sm text-slate-600">
          If you requested more than one reset email, only the most recent one works — older links stop
          working as soon as a new one is sent.
        </p>
        <Link
          href="/portal/forgot-password"
          className="mt-6 block w-full rounded-lg bg-brand-600 px-4 py-3 text-center font-medium text-white"
        >
          Send a new reset link
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-sm px-4 py-16">
      <h1 className="text-xl font-semibold text-brand-700">Set a new password</h1>

      {error && <div className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <input
        type="password"
        className="mt-6 w-full rounded-lg border border-slate-300 px-3 py-2"
        placeholder="New password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <input
        type="password"
        className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2"
        placeholder="Confirm new password"
        value={confirmPassword}
        onChange={(e) => setConfirmPassword(e.target.value)}
      />
      <button
        className="mt-4 w-full rounded-lg bg-brand-600 px-4 py-3 font-medium text-white disabled:opacity-50"
        disabled={loading || password.length < 6 || password !== confirmPassword}
        onClick={updatePassword}
      >
        {loading ? "Saving…" : "Set new password"}
      </button>
    </div>
  );
}
