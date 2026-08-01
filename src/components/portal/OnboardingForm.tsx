"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function OnboardingForm({
  accountType,
}: {
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
      {error && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <input className="w-full rounded-lg border border-slate-300 px-3 py-2" placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} />
      <input className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2" placeholder="Company" value={company} onChange={(e) => setCompany(e.target.value)} />
      <input className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2" placeholder="Phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
      <input className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2" placeholder="Billing address" value={billingAddress} onChange={(e) => setBillingAddress(e.target.value)} />

      <button
        className="mt-4 flex w-full items-center justify-center border-[3px] border-brand-700 bg-brand-50 py-3 pt-[14px] text-sm font-extrabold uppercase leading-none text-brand-700 hover:bg-yellow-100 disabled:opacity-50"
        disabled={loading || !name || !phone || !company}
        onClick={submit}
      >
        {loading ? "Saving…" : "Continue"}
      </button>
    </div>
  );
}
