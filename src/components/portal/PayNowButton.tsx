"use client";

import { useState } from "react";
import type { Job } from "@/lib/types";
import { formatCents } from "@/lib/pricing";

// Per Tim, 2026-09-19 — Oscar Cruz (Restore to New): the pay link from the
// invoice email should also be reachable on each job in the portal, not just
// buried in a job's Invoice tab. Only for a job whose invoice has actually
// been sent and isn't paid yet (a job marked paid — including one whose ACH
// is still clearing — has nothing left to pay), and never for a
// check-paying customer.
export function canPayOnline(job: Job): boolean {
  return (
    job.invoice_total_cents != null &&
    Boolean(job.invoice_sent_at) &&
    job.status !== "paid" &&
    job.status !== "cancelled" &&
    job.payment_type !== "check"
  );
}

export default function PayNowButton({ job, showAmount = true }: { job: Job; showAmount?: boolean }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pay(e: React.MouseEvent) {
    e.stopPropagation();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/portal/projects/${job.id}/pay`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Something went wrong");
      window.open(data.url, "_blank", "noreferrer");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2" onClick={(e) => e.stopPropagation()}>
      {showAmount && (
        <span className="text-sm text-slate-600">
          Invoice <span className="font-semibold text-slate-800">{formatCents(job.invoice_total_cents!)}</span>
        </span>
      )}
      <button
        onClick={pay}
        disabled={loading}
        className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-medium uppercase text-white disabled:opacity-50"
      >
        {loading ? "Loading…" : "Pay now"}
      </button>
      {error && <div className="w-full text-sm text-red-700">{error}</div>}
    </div>
  );
}
