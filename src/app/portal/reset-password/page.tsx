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
    // The recovery link's session arrives as a URL hash fragment
    // (#access_token=...&type=recovery) — or, if the one-time link was
    // already used (a second click, or Gmail's own link-scanning silently
    // opening it before the user does), as #error=access_denied&error_
    // code=otp_expired instead. Either way it never reaches any server
    // (fragments aren't sent in HTTP requests), so this can only be
    // detected client-side. The Supabase browser client auto-establishes
    // the session from the hash on load; this just waits for that and
    // checks whether it actually worked before showing the form.
    const hash = new URLSearchParams(window.location.hash.slice(1));
    if (hash.get("error")) {
      setReady(false);
      return;
    }
    const supabase = createSupabaseBrowserClient();
    supabase.auth.getSession().then(({ data }) => {
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
