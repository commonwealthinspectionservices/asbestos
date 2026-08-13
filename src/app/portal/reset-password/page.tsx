"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

// Module-level (not component-level) so it survives any re-invocation of
// the effect below across a component remount within the same page load —
// a plain useRef wouldn't, since a true remount creates a fresh instance
// with its own fresh ref. Recovery codes/tokens are one-time-use, so a
// second exchange attempt for the same value always fails even though the
// first one already succeeded; this stops a second attempt from ever
// firing and clobbering the correct result.
const processedAuthValues = new Set<string>();

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
    // createSupabaseBrowserClient() defaults to PKCE flow, so the recovery
    // link comes back as ?code=... in the query string (exchanged via
    // exchangeCodeForSession) — not as a #access_token=... hash fragment.
    // A used/expired link redirects with ?error=... in the query string
    // instead. Fall back to the hash-fragment form too, in case flowType
    // is ever changed to implicit.
    //
    // Confirmed via a real network capture that exchangeCodeForSession can
    // return a fully valid session (verified: HTTP 200, complete
    // access_token/refresh_token/user in the response body) and this page
    // still ends up rendering "expired" — this effect fires more than
    // once for the same code, and the second attempt, hitting the
    // by-then-consumed one-time code, resolves after the first and
    // clobbers the correct `ready=true` with `false`. processedAuthValues
    // guards against exactly that: a code/token combo is only ever
    // exchanged once per page load, no matter how many times this effect
    // re-runs.
    const params = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const supabase = createSupabaseBrowserClient();

    if (params.get("error") || hash.get("error")) {
      setReady(false);
      return;
    }

    const code = params.get("code");
    if (code) {
      console.log("[reset-password] effect run, code=", code.slice(0, 8), "already processed:", processedAuthValues.has(code));
      if (processedAuthValues.has(code)) {
        // Already exchanged by an earlier invocation of this effect (this
        // may be a fresh component instance) — the code itself is now
        // burned, so re-exchanging would fail even on the legitimate
        // success path. Read the actual session instead, which reflects
        // the earlier exchange's real outcome regardless of which
        // instance performed it (session storage is shared, not
        // per-instance).
        supabase.auth.getSession().then(({ data }) => {
          console.log("[reset-password] getSession fallback result:", data.session ? "has session" : "NO session", data);
          setReady(Boolean(data.session));
        });
        return;
      }
      processedAuthValues.add(code);
      supabase.auth.exchangeCodeForSession(code).then(({ data, error }) => {
        console.log("[reset-password] exchangeCodeForSession result:", { hasSession: Boolean(data.session), error, data });
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
    if (processedAuthValues.has(accessToken)) {
      supabase.auth.getSession().then(({ data }) => setReady(Boolean(data.session)));
      return;
    }
    processedAuthValues.add(accessToken);
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
