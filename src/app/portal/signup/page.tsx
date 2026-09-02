"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createSupabaseEmailLinkClient } from "@/lib/supabase-browser";

export default function PortalSignupPage() {
  const [email, setEmail] = useState("");
  const [accountType, setAccountType] = useState<"company" | "individual" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checkEmail, setCheckEmail] = useState(false);
  // Carried over from a deep link (see login/page.tsx's own comment) so the
  // confirmation email's link, then onboarding, then the final redirect all
  // keep pointing at the same job instead of losing it along the way.
  const [jobId, setJobId] = useState<string | null>(null);
  useEffect(() => {
    setJobId(new URLSearchParams(window.location.search).get("jobId"));
  }, []);

  async function signUp() {
    setLoading(true);
    setError(null);
    try {
      // createSupabaseEmailLinkClient(), not createSupabaseBrowserClient() —
      // the latter hardcodes PKCE, which needs a code_verifier secret
      // matched between this request and whenever the emailed link is
      // later clicked. That doesn't survive the gap of opening an email
      // reliably (confirmed live via AuthPKCECodeVerifierMissingError on
      // the equivalent password-reset flow). See that function's comment.
      const supabase = createSupabaseEmailLinkClient();
      // No password here — just proving the email is real. Password gets
      // set on /portal/onboarding once they've clicked through, alongside
      // the rest of their profile (same place an Invite recipient sets
      // theirs too, since neither path involves a password until then).
      const { error: signUpError } = await supabase.auth.signInWithOtp({
        email,
        options: {
          // Stored in auth user metadata (not the customers row, which
          // doesn't exist yet) so it survives the round trip — read back
          // in getContractorSession() and applied to the customers row on
          // /portal/onboarding.
          data: { account_type: accountType },
          // Delivers its session as a URL hash fragment, not a ?code=
          // query param — /portal/confirm reads it client-side (a server
          // route structurally can't) and forwards to onboarding once a
          // real session exists. See its comment.
          emailRedirectTo: `${window.location.origin}/portal/confirm${jobId ? `?jobId=${jobId}` : ""}`,
        },
      });
      if (signUpError) throw signUpError;
      // Internal owner alert — best-effort, never blocks the signup the
      // client is waiting on. See its own comment for why this is safe
      // to leave unauthenticated.
      fetch("/api/portal/signup-notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      }).catch(() => {});
      setCheckEmail(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign up failed");
    } finally {
      setLoading(false);
    }
  }

  if (checkEmail) {
    return (
      <div className="mx-auto max-w-sm px-4 py-16">
        <h1 className="text-xl font-semibold text-brand-700">Check your email</h1>
        <p className="mt-4 text-sm text-slate-600">
          We sent a link to {email}. Click it to set up your password and finish creating your account.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-sm px-4 py-16">
      <h1 className="text-xl font-semibold uppercase text-brand-700">Create an account</h1>

      {error && <div className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className="mt-6 space-y-3 text-sm text-slate-700">
        <label className="flex items-start gap-2">
          <input
            type="radio"
            name="accountType"
            className="mt-0.5"
            checked={accountType === "company"}
            onChange={() => setAccountType("company")}
          />
          <span>
            <span className="font-medium">Company</span>
            <span className="block text-slate-500">
              This will start a new company account. If you're looking to join an existing one, ask a teammate to invite you in.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2">
          <input
            type="radio"
            name="accountType"
            className="mt-0.5"
            checked={accountType === "individual"}
            onChange={() => setAccountType("individual")}
          />
          <span>
            <span className="font-medium">Individual</span>
            <span className="block text-slate-500">
              You're paying for this yourself — typically a homeowner. Reports become available once payment is received.
            </span>
          </span>
        </label>
      </div>

      <input
        type="email"
        className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <button
        className="mt-4 w-full rounded-lg bg-brand-600 px-4 py-3 font-medium text-white disabled:opacity-50"
        disabled={loading || !email || !accountType}
        onClick={signUp}
      >
        {loading ? "Sending…" : "Continue"}
      </button>

      <p className="mt-4 text-center text-sm text-slate-500">
        Already have an account? <Link href={jobId ? `/portal/login?jobId=${jobId}` : "/portal/login"} className="text-brand-600 underline">Sign in</Link>
      </p>
    </div>
  );
}
