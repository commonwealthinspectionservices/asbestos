"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { JobWithCustomer } from "@/lib/types";
import { formatCents, computeMarginCents } from "@/lib/pricing";
import { formatDateMDY } from "@/lib/date-format";
import { expandAddress } from "@/lib/address";

function formatDate(date: string | null | undefined): string {
  return formatDateMDY(date) ?? "—";
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// Same reasoning as LabInvoicesView's own localDateOnly — a full UTC
// timestamp naively sliced can land on the wrong calendar date once local
// (Eastern) time disagrees with UTC, e.g. a late-evening upload.
function localDateOnly(iso: string): string {
  return ymd(new Date(iso));
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

type PeriodKey = "weekly" | "monthly" | "yearly";
const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: "weekly", label: "Weekly" },
  { key: "monthly", label: "Monthly" },
  { key: "yearly", label: "Yearly" },
];

interface JobEntry {
  job: JobWithCustomer;
  revenueCents: number;
  labCostCents: number;
  stripeFeeCents: number;
  marginCents: number;
}

interface Group {
  key: string;
  label: string;
  sortKey: string;
  jobEntries: JobEntry[];
  revenueCents: number;
  labCostCents: number;
  stripeFeeCents: number;
  marginCents: number;
}

// Per Tim, 2026-08-29 — marginCents itself now comes from
// computeMarginCents (lib/pricing.ts), the same function the per-job
// Profit line on the Invoice tab uses, rather than a second, independently
// computed margin figure for the same job — those two drifted out of sync
// once already. stripe_fee_cents is only ever populated once an invoice is
// actually paid (see its own comment on Job) — null just means no fee was
// charged yet, not that it's zero.
function summarizeGroup(key: string, label: string, sortKey: string, jobsInGroup: { job: JobWithCustomer; labCostCents: number }[]): Group {
  const jobEntries = jobsInGroup
    .map(({ job, labCostCents }) => {
      const revenueCents = job.invoice_total_cents ?? 0;
      const stripeFeeCents = job.stripe_fee_cents ?? 0;
      return { job, revenueCents, labCostCents, stripeFeeCents, marginCents: computeMarginCents(revenueCents, labCostCents, stripeFeeCents) };
    })
    .sort((a, b) => (a.job.project_number ?? "").localeCompare(b.job.project_number ?? ""));
  const revenueCents = jobEntries.reduce((sum, e) => sum + e.revenueCents, 0);
  const labCostCents = jobEntries.reduce((sum, e) => sum + e.labCostCents, 0);
  const stripeFeeCents = jobEntries.reduce((sum, e) => sum + e.stripeFeeCents, 0);
  return { key, label, sortKey, jobEntries, revenueCents, labCostCents, stripeFeeCents, marginCents: computeMarginCents(revenueCents, labCostCents, stripeFeeCents) };
}

// Per Tim, 2026-08-29 — pulled out of Lab Invoices into its own page:
// "margin cuts across both what customers owe you and what you owe the
// lab, so it doesn't cleanly belong on either page... it's starting to
// feel a little unorganized." Not "net profit": this app has no labor/
// materials/overhead tracking at all, so a true profit figure would be
// misleading rather than just fancier; this is deliberately scoped to
// what's actually trackable today. Named "Margins" (not "Summaries",
// its first name) per Tim, 2026-08-29 — "is Summaries the best name for
// this? Could I call it Margins?" — Margins says exactly what's on the
// page, matching every other nav label in this app (Invoices, Lab
// Invoices) being a specific noun rather than a vague one. "we should be
// able to make them weekly and monthly and yearly": Weekly stays tied to
// real weekly reports (same reasoning as LabInvoicesView's own Weekly
// Reports — a report's own printed total is ground truth, not a number
// this system reconstructs); Monthly/Yearly have no equivalent real
// document to anchor to, so those bucket by confirmed_date instead,
// reading straight off each job's own current lab_cost_cents/
// invoice_total_cents. Both are also scoped to fully-billed jobs only
// (see the "Awaiting Lab Bill"-style check below) — per Tim, "shouldn't
// be able to get onto the page until they're fully billed": an unbilled
// job's lab_cost_cents is stuck at 0, which would overstate its margin.
export default function MarginsView() {
  const [jobs, setJobs] = useState<JobWithCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [period, setPeriod] = useState<PeriodKey>("weekly");

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch("/api/admin/jobs")
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error ?? "Failed to load margins");
        setJobs(data.jobs);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load margins"))
      .finally(() => setLoading(false));
  }, []);

  const weeklyGroups = useMemo(() => {
    const groups = new Map<
      string,
      { dateRange: string | null; receivedAt: string; jobAmounts: Map<string, number>; seenNumsByJob: Map<string, Set<string>> }
    >();
    for (const job of jobs) {
      for (const doc of job.documents ?? []) {
        if (doc.kind !== "lab_invoice" || doc.report_total_cents == null) continue;
        // Same report_date_range grouping as LabInvoicesView's own Weekly
        // Reports — a job's document keeps its own real PDF's hash even
        // after this report's total/date-range get backfilled onto it, so
        // content_hash can't be the group key (see that file's own comment).
        const key = doc.report_date_range ?? doc.content_hash ?? "unknown";
        let g = groups.get(key);
        if (!g) {
          g = { dateRange: doc.report_date_range ?? null, receivedAt: doc.uploaded_at, jobAmounts: new Map(), seenNumsByJob: new Map() };
          groups.set(key, g);
        }
        if (doc.uploaded_at > g.receivedAt) g.receivedAt = doc.uploaded_at;

        const numKey = doc.lab_invoice_number ?? doc.id;
        if (!g.seenNumsByJob.has(job.id)) g.seenNumsByJob.set(job.id, new Set());
        const seenNums = g.seenNumsByJob.get(job.id)!;
        if (seenNums.has(numKey)) continue;
        seenNums.add(numKey);

        g.jobAmounts.set(job.id, (g.jobAmounts.get(job.id) ?? 0) + (doc.amount_cents ?? 0));
      }
    }
    return Array.from(groups.entries())
      .map(([key, g]) => {
        const jobsInGroup = Array.from(g.jobAmounts.entries()).map(([jobId, labCostCents]) => ({
          job: jobs.find((j) => j.id === jobId)!,
          labCostCents,
        }));
        const label = g.dateRange ?? formatDate(localDateOnly(g.receivedAt));
        return summarizeGroup(key, label, g.receivedAt, jobsInGroup);
      })
      .sort((a, b) => (a.sortKey < b.sortKey ? 1 : -1));
  }, [jobs]);

  const monthlyGroups = useMemo(() => {
    const groups = new Map<string, JobWithCustomer[]>();
    for (const job of jobs) {
      // Per Tim, 2026-08-29 — "shouldn't be able to get onto the page
      // until they're fully billed": a job with no lab_invoice document
      // yet has lab_cost_cents stuck at null/0, which would overstate its
      // margin here — same "Awaiting Lab Bill" check LabInvoicesView uses,
      // kept out of these rollups entirely rather than shown with a
      // misleadingly-complete-looking $0 lab cost.
      if (!(job.documents ?? []).some((d) => d.kind === "lab_invoice")) continue;
      // Falls back to requested_date, same as everywhere else in this app
      // that needs "the job's own date" and confirmed_date isn't set yet
      // (report-pdf.tsx, invoice-pdf.tsx, JobsDashboard's dueDateFor) —
      // without it, a job like 26-0007 (real revenue and lab cost on file,
      // but never got a confirmed_date) would just silently vanish from
      // every monthly/yearly rollup instead of showing up somewhere.
      const bucketDate = job.confirmed_date ?? job.requested_date;
      if (!bucketDate) continue;
      const key = bucketDate.slice(0, 7); // "YYYY-MM"
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(job);
    }
    return Array.from(groups.entries())
      .map(([key, jobsInGroup]) => {
        const [y, m] = key.split("-");
        const label = `${MONTH_NAMES[Number(m) - 1]} ${y}`;
        return summarizeGroup(
          key,
          label,
          key,
          jobsInGroup.map((job) => ({ job, labCostCents: job.lab_cost_cents ?? 0 }))
        );
      })
      .sort((a, b) => (a.sortKey < b.sortKey ? 1 : -1));
  }, [jobs]);

  const yearlyGroups = useMemo(() => {
    const groups = new Map<string, JobWithCustomer[]>();
    for (const job of jobs) {
      // Same "fully billed" and date-fallback reasoning as monthlyGroups above.
      if (!(job.documents ?? []).some((d) => d.kind === "lab_invoice")) continue;
      const bucketDate = job.confirmed_date ?? job.requested_date;
      if (!bucketDate) continue;
      const key = bucketDate.slice(0, 4); // "YYYY"
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(job);
    }
    return Array.from(groups.entries())
      .map(([key, jobsInGroup]) =>
        summarizeGroup(
          key,
          key,
          key,
          jobsInGroup.map((job) => ({ job, labCostCents: job.lab_cost_cents ?? 0 }))
        )
      )
      .sort((a, b) => (a.sortKey < b.sortKey ? 1 : -1));
  }, [jobs]);

  // Per Tim, 2026-08-29 — "when in yearly, the default should always be to
  // open the current year": fires once, the first time yearlyGroups
  // actually has data — the ref guard means a later manual collapse by
  // Tim sticks instead of getting silently re-expanded on every refetch.
  const hasAutoExpandedYearly = useRef(false);
  useEffect(() => {
    if (hasAutoExpandedYearly.current || yearlyGroups.length === 0) return;
    const currentYear = String(new Date().getFullYear());
    if (yearlyGroups.some((g) => g.key === currentYear)) {
      setExpandedKeys((prev) => new Set(prev).add(`yearly:${currentYear}`));
    }
    hasAutoExpandedYearly.current = true;
  }, [yearlyGroups]);

  const groups = period === "weekly" ? weeklyGroups : period === "monthly" ? monthlyGroups : yearlyGroups;
  const emptyMessage =
    period === "weekly" ? "No weekly reports received yet." : `No jobs with a confirmed date yet.`;

  // Per Tim, 2026-08-30 — "lab costs and margins should have these
  // headers", pointing at Invoices' own summary box: total revenue and
  // total margin across every group in the currently selected period, so
  // the overall picture doesn't require expanding every card by hand.
  const summary = useMemo(() => {
    return groups.reduce(
      (acc, g) => ({ revenueCents: acc.revenueCents + g.revenueCents, marginCents: acc.marginCents + g.marginCents }),
      { revenueCents: 0, marginCents: 0 }
    );
  }, [groups]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="text-lg font-semibold text-slate-800">Margins</h1>

      <div className="mt-3 flex flex-wrap gap-4 rounded-lg border border-slate-200 bg-white p-3 text-sm">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Total Revenue</div>
          <div className="text-base font-semibold text-slate-800">{formatCents(summary.revenueCents)}</div>
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Total Margin</div>
          <div className={`text-base font-semibold ${summary.marginCents < 0 ? "text-red-600" : "text-slate-800"}`}>
            {formatCents(summary.marginCents)}
          </div>
        </div>
      </div>

      <div className="mt-3 flex gap-1.5">
        {PERIODS.map((p) => (
          <button
            key={p.key}
            onClick={() => setPeriod(p.key)}
            className={`shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium ${
              period === p.key ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {loading && <p className="mt-4 text-sm text-slate-500">Loading…</p>}
      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {!loading && !error && (
        <div className="mt-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Revenue vs. Lab Cost</div>
          {groups.length === 0 ? (
            <p className="mt-2 rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-500">{emptyMessage}</p>
          ) : (
            <div className="mt-2 flex flex-col gap-2">
              {groups.map((g) => {
                const expanded = expandedKeys.has(`${period}:${g.key}`);
                return (
                  <div key={g.key} className="rounded-lg border border-slate-200 bg-white text-sm">
                    <button
                      onClick={() =>
                        setExpandedKeys((prev) => {
                          const next = new Set(prev);
                          const k = `${period}:${g.key}`;
                          if (next.has(k)) next.delete(k);
                          else next.add(k);
                          return next;
                        })
                      }
                      className="flex w-full flex-wrap items-baseline justify-between gap-x-4 p-3 text-left"
                    >
                      <span className="text-xs font-medium text-brand-600">
                        <span className="mr-1 inline-block w-3 text-slate-400">{expanded ? "▾" : "▸"}</span>
                        {g.label}
                      </span>
                      <span className={`whitespace-nowrap text-xs font-semibold ${g.marginCents < 0 ? "text-red-600" : "text-emerald-600"}`}>
                        {formatCents(g.marginCents)} margin
                      </span>
                    </button>
                    {expanded && (
                      <div className="flex flex-col gap-2.5 border-t border-slate-100 p-3 pt-2">
                        <div className="text-xs text-slate-500">
                          {formatCents(g.revenueCents)} revenue − {formatCents(g.labCostCents)} lab cost
                          {g.stripeFeeCents !== 0 && <> − {formatCents(g.stripeFeeCents)} Stripe fees</>}
                        </div>
                        {/* Per Tim, 2026-08-30 — "I want all the formatting
                            to be consistent throughout": same full-width
                            card per job as Lab Costs and Invoices (project
                            # badge + company + address on the left), not
                            the old tight grid this used to be — this was
                            the one card style still left behind after the
                            other two pages picked it up. */}
                        <div className="flex flex-col gap-2">
                          {g.jobEntries.map((e) => (
                            <Link
                              key={e.job.id}
                              href={`/admin/dashboard?jobId=${e.job.id}`}
                              className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3 hover:border-brand-400"
                            >
                              <div className="min-w-0">
                                <div className="flex min-w-0 items-center gap-2">
                                  <span className="shrink-0 whitespace-nowrap rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-600">
                                    {e.job.project_number}
                                  </span>
                                  <span className="min-w-0 truncate text-sm font-medium text-slate-800">
                                    {e.job.customers?.company || e.job.customers?.name}
                                  </span>
                                </div>
                                {e.job.service_address && (
                                  <div className="mt-0.5 truncate text-xs text-slate-500">{expandAddress(e.job.service_address)}</div>
                                )}
                              </div>
                              <div className="shrink-0 text-right">
                                <div className={`whitespace-nowrap text-sm font-semibold ${e.marginCents < 0 ? "text-red-600" : "text-slate-800"}`}>
                                  {formatCents(e.marginCents)}
                                </div>
                                <div className="whitespace-nowrap text-xs text-slate-500">
                                  {formatCents(e.revenueCents)} − {formatCents(e.labCostCents)}
                                  {e.stripeFeeCents !== 0 && <> − {formatCents(e.stripeFeeCents)}</>}
                                </div>
                              </div>
                            </Link>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
