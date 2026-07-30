"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function OnboardingForm({
  email,
  accountType,
}: {
  email: string;
  accountType: "contractor" | "homeowner" | null;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [phone, setPhone] = useState("");
  const [billingAddress, setBillingAddress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/portal/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, company, phone, billingAddress, accountType }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save profile");
      router.push("/portal/dashboard");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save profile");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm px-4 py-16">
      <h1 className="text-xl font-semibold text-brand-700">A few details</h1>
      <p className="mt-1 text-sm text-slate-500">
        Signed in as {email}. This saves your info so future bookings are one click.
      </p>

      {error && <div className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <input className="mt-6 w-full rounded-lg border border-slate-300 px-3 py-2" placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} />
      <input className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2" placeholder="Company (optional)" value={company} onChange={(e) => setCompany(e.target.value)} />
      <input className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2" placeholder="Phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
      <input className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2" placeholder="Billing address" value={billingAddress} onChange={(e) => setBillingAddress(e.target.value)} />

      <button
        className="mt-4 w-full rounded-lg bg-brand-600 px-4 py-3 font-medium text-white disabled:opacity-50"
        disabled={loading || !name || !phone}
        onClick={submit}
      >
        {loading ? "Saving…" : "Continue"}
      </button>
    </div>
  );
}
