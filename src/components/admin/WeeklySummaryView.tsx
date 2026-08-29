"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { JobWithCustomer } from "@/lib/types";
import { formatCents } from "@/lib/pricing";
import { formatDateMDY } from "@/lib/date-format";

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

// Per Tim, 2026-08-29 — pulled out of Lab Invoices into its own page:
// "margin cuts across both what customers owe you and what you owe the
// lab, so it doesn't cleanly belong on either page... it's starting to
// feel a little unorganized." This page tracks exactly one thing — revenue
// vs. lab cost vs. margin, per real weekly report — and nothing else. Not
// "net profit": this app has no labor/materials/overhead tracking at all,
// so a true profit figure would be misleading rather than just fancier;
// this is deliberately scoped to what's actually trackable today. Same
// collapsed-list-of-weeks pattern as Lab Invoices' own Weekly Reports
// section, and the same per-report grouping logic (duplicated rather than
// shared, matching this codebase's existing convention of each admin view
// owning its own data independently).
export default function WeeklySummaryView() {
  const [jobs, setJobs] = useState<JobWithCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch("/api/admin/jobs")
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error ?? "Failed to load weekly summary");
        setJobs(data.jobs);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load weekly summary"))
      .finally(() => setLoading(false));
  }, []);

  const weeklyMargins = useMemo(() => {
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
        const jobEntries = Array.from(g.jobAmounts.entries())
          .map(([jobId, labCostCents]) => {
            const job = jobs.find((j) => j.id === jobId)!;
            const revenueCents = job.invoice_total_cents ?? 0;
            return { job, labCostCents, revenueCents, marginCents: revenueCents - labCostCents };
          })
          .sort((a, b) => (a.job.project_number ?? "").localeCompare(b.job.project_number ?? ""));
        const revenueCents = jobEntries.reduce((sum, e) => sum + e.revenueCents, 0);
        const labCostCents = jobEntries.reduce((sum, e) => sum + e.labCostCents, 0);
        return { key, dateRange: g.dateRange, receivedAt: g.receivedAt, jobEntries, revenueCents, labCostCents, marginCents: revenueCents - labCostCents };
      })
      .sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1));
  }, [jobs]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="text-lg font-semibold text-slate-800">Weekly Summary</h1>

      {loading && <p className="mt-4 text-sm text-slate-500">Loading…</p>}
      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {!loading && !error && (
        <div className="mt-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Revenue vs. Lab Cost</div>
          {weeklyMargins.length === 0 ? (
            <p className="mt-2 rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-500">No weekly reports received yet.</p>
          ) : (
            <div className="mt-2 flex flex-col gap-2">
              {weeklyMargins.map((w) => {
                const expanded = expandedKeys.has(w.key);
                return (
                  <div key={w.key} className="rounded-lg border border-slate-200 bg-white text-sm">
                    <button
                      onClick={() =>
                        setExpandedKeys((prev) => {
                          const next = new Set(prev);
                          if (next.has(w.key)) next.delete(w.key);
                          else next.add(w.key);
                          return next;
                        })
                      }
                      className="flex w-full flex-wrap items-baseline justify-between gap-x-4 p-3 text-left"
                    >
                      <span className="text-xs font-medium text-brand-600">
                        <span className="mr-1 inline-block w-3 text-slate-400">{expanded ? "▾" : "▸"}</span>
                        {w.dateRange ?? formatDate(localDateOnly(w.receivedAt))}
                      </span>
                      <span className={`whitespace-nowrap text-xs font-semibold ${w.marginCents < 0 ? "text-red-600" : "text-emerald-600"}`}>
                        {formatCents(w.marginCents)} margin
                      </span>
                    </button>
                    {expanded && (
                      <div className="flex flex-col gap-1.5 border-t border-slate-100 p-3 pt-2">
                        <div className="flex items-baseline justify-between text-xs text-slate-500">
                          <span>{formatCents(w.revenueCents)} revenue − {formatCents(w.labCostCents)} lab cost</span>
                        </div>
                        {w.jobEntries.map((e) => (
                          <div key={e.job.id} className="flex items-baseline justify-between gap-2">
                            <Link href={`/admin/dashboard?jobId=${e.job.id}`} className="font-mono text-xs text-brand-600 hover:underline">
                              {e.job.project_number}
                            </Link>
                            <span className="whitespace-nowrap text-xs text-slate-500">
                              {formatCents(e.revenueCents)} − {formatCents(e.labCostCents)} ={" "}
                              <span className={e.marginCents < 0 ? "font-semibold text-red-600" : "font-semibold text-slate-800"}>{formatCents(e.marginCents)}</span>
                            </span>
                          </div>
                        ))}
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
