"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

export default function PortalLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Carried over from a deep link (e.g. the "job is now scheduled" email's
  // portal button — see ProjectsList.tsx) via dashboard/page.tsx's own
  // redirect, so signing in still lands back on that specific job instead
  // of just the general dashboard. Read in an effect, not a useState
  // initializer, since the initializer also runs during SSR (no window
  // there) and would trip a hydration mismatch.
  const [jobId, setJobId] = useState<string | null>(null);
  useEffect(() => {
    setJobId(new URLSearchParams(window.location.search).get("jobId"));
  }, []);
  const dashboardUrl = jobId ? `/portal/dashboard?jobId=${jobId}` : "/portal/dashboard";
  const signupUrl = jobId ? `/portal/signup?jobId=${jobId}` : "/portal/signup";

  async function login() {
    setLoading(true);
    setError(null);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error: loginError } = await supabase.auth.signInWithPassword({ email, password });
      if (loginError) throw loginError;
      // Not "/portal" — that's the passive nav-link entry point and never
      // resumes onboarding (see src/app/portal/page.tsx). An explicit sign-in
      // still needs to route a mid-onboarding account back to onboarding,
      // which the dashboard route's own redirect already handles.
      router.push(dashboardUrl);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign in failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-md px-4 py-24">
      <div className="flex flex-col items-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="" width={190} height={190} className="rounded-full" />
      </div>

      {error && <div className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-base text-red-700">{error}</div>}

      <input
        type="email"
        className="mt-8 w-full rounded-lg border border-slate-300 px-4 py-3 text-base"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && login()}
      />
      <input
        type="password"
        className="mt-4 w-full rounded-lg border border-slate-300 px-4 py-3 text-base"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && login()}
      />
      <button
        className="mt-5 w-full rounded-lg bg-brand-600 px-4 py-4 text-lg font-medium uppercase text-white disabled:opacity-50"
        disabled={loading || !email || !password}
        onClick={login}
      >
        {loading ? "Signing in…" : "Sign in"}
      </button>

      <p className="mt-4 text-center text-base text-slate-500">
        <Link href="/portal/forgot-password" className="text-brand-600 underline">Forgot password?</Link>
      </p>
      <p className="mt-2 text-center text-base text-slate-500">
        New here? <Link href={signupUrl} className="text-brand-600 underline">Create an account</Link>
      </p>
    </div>
  );
}
