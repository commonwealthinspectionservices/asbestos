"use client";

import { useState } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

export default function PortalForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function sendResetLink() {
    setLoading(true);
    setError(null);
    try {
      const supabase = createSupabaseBrowserClient();
      // Straight to /portal/reset-password, not through /auth/callback — a
      // recovery link's session arrives in the URL hash (#access_token=...),
      // which browsers never send to a server at all, so routing it through
      // a server redirect first has nothing to work with and just adds a
      // hop for the fragment to (usually, but not reliably) survive.
      // /portal/reset-password reads the hash itself, client-side.
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/portal/reset-password`,
      });
      if (resetError) throw resetError;
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send reset link");
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <div className="mx-auto max-w-sm px-4 py-16">
        <h1 className="text-xl font-semibold text-brand-700">Check your email</h1>
        <p className="mt-4 text-sm text-slate-600">
          If an account exists for {email}, we sent a link to reset your password.
        </p>
        <p className="mt-4 text-center text-sm text-slate-500">
          <Link href="/portal/login" className="text-brand-600 underline">Back to sign in</Link>
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-sm px-4 py-16">
      <h1 className="text-xl font-semibold text-brand-700">Reset your password</h1>
      <p className="mt-1 text-sm text-slate-500">We&apos;ll email you a link to set a new one.</p>

      {error && <div className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <input
        type="email"
        className="mt-6 w-full rounded-lg border border-slate-300 px-3 py-2"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && sendResetLink()}
      />
      <button
        className="mt-4 w-full rounded-lg bg-brand-600 px-4 py-3 font-medium text-white disabled:opacity-50"
        disabled={loading || !email}
        onClick={sendResetLink}
      >
        {loading ? "Sending…" : "Send reset link"}
      </button>

      <p className="mt-4 text-center text-sm text-slate-500">
        <Link href="/portal/login" className="text-brand-600 underline">Back to sign in</Link>
      </p>
    </div>
  );
}
