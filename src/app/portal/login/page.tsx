"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

export default function PortalLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function login() {
    setLoading(true);
    setError(null);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error: loginError } = await supabase.auth.signInWithPassword({ email, password });
      if (loginError) throw loginError;
      router.push("/portal");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign in failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm px-4 py-16">
      <h1 className="text-xl font-semibold text-brand-700">Contractor sign in</h1>

      {error && <div className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <input
        type="email"
        className="mt-6 w-full rounded-lg border border-slate-300 px-3 py-2"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && login()}
      />
      <input
        type="password"
        className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && login()}
      />
      <button
        className="mt-4 w-full rounded-lg bg-brand-600 px-4 py-3 font-medium text-white disabled:opacity-50"
        disabled={loading || !email || !password}
        onClick={login}
      >
        {loading ? "Signing in…" : "Sign in"}
      </button>

      <p className="mt-4 text-center text-sm text-slate-500">
        New here? <Link href="/portal/signup" className="text-brand-600 underline">Create an account</Link>
      </p>
    </div>
  );
}
