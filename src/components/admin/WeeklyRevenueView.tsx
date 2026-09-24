"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { JobWithCustomer } from "@/lib/types";
import { formatCents, knownStripeFeeCentsForJob } from "@/lib/pricing";
import { billingDateFor, ymd } from "@/components/admin/BillingView";

// Per Tim, 2026-09-24 — "what I was talking about was just wanting to see
// the weekly revenues": one row per week (Sunday–Saturday, the same week
// Crystal Analytical's own weekly report uses), newest first. Same rules
// as Net Earnings by Job so the two pages always agree: a job belongs to
// the week of its fieldwork date (billingDateFor), Invoiced counts every
// invoiced job, and Paid / Lab Cost / Stripe Fee / Net Earnings only
// count jobs that are actually paid.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function weekLabel(start: Date, end: Date): string {
  return start.getMonth() === end.getMonth()
    ? `${MONTHS[start.getMonth()]} ${start.getDate()}-${end.getDate()}`
    : `${MONTHS[start.getMonth()]} ${start.getDate()}-${MONTHS[end.getMonth()]} ${end.getDate()}`;
}

const GRID = "grid grid-cols-[repeat(6,minmax(96px,1fr))] gap-x-2";

export default function WeeklyRevenueView() {
  const [jobs, setJobs] = useState<JobWithCustomer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/admin/jobs")
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error ?? "Failed to load weekly revenue");
        setJobs(data.jobs);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load weekly revenue"))
      .finally(() => setLoaded(true));
  }, []);

  const weeks = useMemo(() => {
    const today = new Date();
    const currentStart = new Date(today);
    currentStart.setHours(0, 0, 0, 0);
    currentStart.setDate(currentStart.getDate() - currentStart.getDay());

    // Weeks run back to the earliest invoiced job's own week, so no job is
    // ever silently dropped (26-0002 was done 8/20, before the company
    // start date, and still counts on Net Earnings by Job).
    const invoiced = jobs.filter((j) => j.source !== "subcontractor" && j.invoice_total_cents != null && (j.invoice_sent_at || j.paid_date));
    const dates = invoiced.map((j) => billingDateFor(j)).filter((d): d is string => Boolean(d));
    const earliest = dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : ymd(currentStart);

    const list: { label: string; start: string; end: string; invoiced: number; paid: number; lab: number; fee: number }[] = [];
    for (let i = 0; i < 200; i++) {
      const start = new Date(currentStart);
      start.setDate(start.getDate() - i * 7);
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      if (ymd(end) < earliest) break;
      list.push({ label: weekLabel(start, end), start: ymd(start), end: ymd(end), invoiced: 0, paid: 0, lab: 0, fee: 0 });
    }

    for (const job of invoiced) {
      const date = billingDateFor(job);
      if (!date) continue;
      const week = list.find((w) => date >= w.start && date <= w.end);
      if (!week) continue;
      const cents = job.invoice_total_cents ?? 0;
      week.invoiced += cents;
      if (job.status === "paid" || job.paid_date) {
        week.paid += cents;
        week.lab += job.lab_cost_cents ?? 0;
        week.fee += knownStripeFeeCentsForJob(job) ?? 0;
      }
    }
    return list;
  }, [jobs]);

  const totals = useMemo(
    () => weeks.reduce((t, w) => ({ invoiced: t.invoiced + w.invoiced, paid: t.paid + w.paid, lab: t.lab + w.lab, fee: t.fee + w.fee }), { invoiced: 0, paid: 0, lab: 0, fee: 0 }),
    [weeks]
  );

  const money = (cents: number, tone: string) => (cents > 0 ? <span className={tone}>{formatCents(cents)}</span> : <span className="text-slate-400">—</span>);
  const net = (cents: number) =>
    cents === 0 ? (
      <span className="text-slate-400">—</span>
    ) : (
      <span className={cents < 0 ? "text-red-600" : "text-emerald-700"}>
        {cents < 0 ? "−" : ""}
        {formatCents(Math.abs(cents))}
      </span>
    );

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-bold text-slate-800">Weekly Revenue</h1>
        <Link href="/admin/billing" className="inline-flex shrink-0 items-center gap-1 text-sm text-brand-600 hover:text-brand-700">
          ← Billing
        </Link>
      </div>

      {error && <div className="mt-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}
      {!loaded && !error && <p className="mt-6 text-sm text-slate-500">Loading…</p>}

      {loaded && !error && (
        <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <div className="min-w-[640px]">
            <div className={`${GRID} border-b border-slate-200 bg-slate-50 px-3 py-2 text-[8px] font-bold uppercase text-slate-500 sm:text-xs`}>
              <div>Week</div>
              <div>Invoiced</div>
              <div>Paid</div>
              <div>Lab Cost</div>
              <div>Stripe Fee</div>
              <div>Net Earnings</div>
            </div>
            {weeks.map((w) => (
              <div key={w.start} className={`${GRID} items-center border-b border-slate-100 px-3 py-3 text-sm`}>
                <div className="text-[11px] font-medium text-slate-800 sm:text-sm">{w.label}</div>
                <div className="whitespace-nowrap text-[12px] sm:text-sm">{money(w.invoiced, "text-slate-600")}</div>
                <div className="whitespace-nowrap text-[12px] font-medium sm:text-sm">{money(w.paid, "text-emerald-700")}</div>
                <div className="whitespace-nowrap text-[12px] sm:text-sm">{money(w.lab, "text-red-600")}</div>
                <div className="whitespace-nowrap text-[12px] sm:text-sm">{money(w.fee, "text-red-600")}</div>
                <div className="whitespace-nowrap text-[12px] sm:text-sm">{net(w.paid - w.lab - w.fee)}</div>
              </div>
            ))}
            <div className={`${GRID} items-center border-t-2 border-slate-200 bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-800`}>
              <div className="text-[11px] uppercase sm:text-sm">Total</div>
              <div className="whitespace-nowrap text-[12px] sm:text-sm">{money(totals.invoiced, "text-slate-600")}</div>
              <div className="whitespace-nowrap text-[12px] sm:text-sm">{money(totals.paid, "text-emerald-700")}</div>
              <div className="whitespace-nowrap text-[12px] sm:text-sm">{money(totals.lab, "text-red-600")}</div>
              <div className="whitespace-nowrap text-[12px] sm:text-sm">{money(totals.fee, "text-red-600")}</div>
              <div className="whitespace-nowrap text-[12px] sm:text-sm">{net(totals.paid - totals.lab - totals.fee)}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
