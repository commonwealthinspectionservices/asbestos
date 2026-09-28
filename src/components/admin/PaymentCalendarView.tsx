"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { JobWithCustomer } from "@/lib/types";
import { formatCents } from "@/lib/pricing";
import { formatDateMDY } from "@/lib/date-format";
import { NEWTON_FIRE_FLOOD_COMPANY_ID } from "@/lib/report-findings";
import { dueDateFor } from "@/lib/invoice-due-date";
import { isPastDue } from "@/components/admin/BillingView";

// Per Tim, 2026-09-15 — "a full list of when I'm going to get paid or when
// jobs are officially due... every date listed out where there is a
// certain payment that is due by that date or scheduled to be charged on
// that date." One date-grouped calendar of every outstanding (unpaid,
// invoiced, non-cancelled) job's due date — same dueDateFor Billing
// already uses for its own per-job "Due by" line and Overdue filter, just
// grouped by date here instead of listed job-by-job. Self-contained page
// like LabInvoicesView/RevenueMarginSummaryView, not embedded in Billing.
export default function PaymentCalendarView() {
  const [jobs, setJobs] = useState<JobWithCustomer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/admin/jobs")
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error ?? "Failed to load payment calendar");
        setJobs(data.jobs);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load payment calendar"))
      .finally(() => setLoaded(true));
  }, []);

  // Per Tim, 2026-08-28 (Billing's own invoicedJobs) — only invoices that
  // have actually gone out; here further narrowed to still-unpaid, since a
  // paid job has no future payment date left to show on a calendar of
  // what's still coming.
  const outstanding = useMemo(
    () =>
      jobs.filter(
        (j) => j.source !== "subcontractor" && j.invoice_total_cents != null && j.invoice_sent_at && !j.paid_date
      ),
    [jobs]
  );

  // Per Tim, 2026-09-27 — overdue invoices used to get their own small
  // date-grouped card per past-due date, scattering them across several
  // tiny cards at the top of the list. Now every overdue job lives in one
  // combined "Overdue" card instead, each row showing its own due date
  // inline (since they no longer share a single group date) — upcoming
  // (not-yet-due) jobs keep the original one-card-per-date grouping.
  const overdueJobs = useMemo(
    () =>
      outstanding
        .map((job) => ({ job, due: dueDateFor(job) }))
        .filter((j): j is { job: JobWithCustomer; due: string } => j.due !== null && isPastDue(j.due))
        .sort((a, b) => a.due.localeCompare(b.due) || (a.job.project_number ?? "").localeCompare(b.job.project_number ?? "")),
    [outstanding]
  );
  const overdueTotalCents = useMemo(() => overdueJobs.reduce((sum, { job }) => sum + (job.invoice_total_cents ?? 0), 0), [overdueJobs]);

  const groups = useMemo(() => {
    const byDate = new Map<string, JobWithCustomer[]>();
    for (const job of outstanding) {
      const due = dueDateFor(job);
      if (!due || isPastDue(due)) continue;
      if (!byDate.has(due)) byDate.set(due, []);
      byDate.get(due)!.push(job);
    }
    return Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, jobsForDate]) => ({
        date,
        jobs: jobsForDate.sort((a, b) => (a.project_number ?? "").localeCompare(b.project_number ?? "")),
        totalCents: jobsForDate.reduce((sum, j) => sum + (j.invoice_total_cents ?? 0), 0),
      }));
  }, [outstanding]);

  const grandTotalCents = useMemo(() => outstanding.reduce((sum, j) => sum + (j.invoice_total_cents ?? 0), 0), [outstanding]);

  return (
    <div>
      {/* Per Tim, 2026-09-16 — "when I go into any of those tabs, they
          should all have a back arrow to get me back to the last window". */}
      <Link href="/admin/billing" className="mb-2 inline-flex items-center gap-1 text-sm text-brand-600 hover:text-brand-700">
        ← Billing
      </Link>
      <div className="flex items-baseline justify-between gap-2">
        <h1 className="text-lg font-bold text-slate-800">Payment Calendar</h1>
        {loaded && !error && (overdueJobs.length > 0 || groups.length > 0) && (
          <div className="whitespace-nowrap text-sm text-slate-500">
            Total Outstanding <span className="font-semibold text-slate-800">{formatCents(grandTotalCents)}</span>
          </div>
        )}
      </div>

      {error && <div className="mt-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

      {!loaded && !error && <p className="mt-6 text-sm text-slate-500">Loading…</p>}

      {loaded && !error && overdueJobs.length === 0 && groups.length === 0 && (
        <p className="mt-6 text-sm text-slate-500">Nothing outstanding — every sent invoice is paid.</p>
      )}

      {loaded && !error && (overdueJobs.length > 0 || groups.length > 0) && (
        <>
          <div className="mt-4 space-y-4">
            {overdueJobs.length > 0 && (
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 pb-2">
                  <span className="text-sm font-semibold text-slate-800">Overdue</span>
                  <span className="text-sm text-slate-500">{formatCents(overdueTotalCents)}</span>
                </div>
                <div className="mt-2 space-y-1.5">
                  {overdueJobs.map(({ job, due }) => {
                    const isNewton = job.customers?.company_id === NEWTON_FIRE_FLOOD_COMPANY_ID;
                    return (
                      <div
                        key={job.id}
                        className="grid grid-cols-[5rem_minmax(0,1fr)_6rem_5rem] items-center gap-2 text-sm"
                      >
                        <Link
                          href={`/admin/dashboard?jobId=${job.id}`}
                          className="whitespace-nowrap font-mono text-xs text-slate-700 hover:text-slate-900 hover:underline"
                        >
                          {job.project_number}
                        </Link>
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-slate-700">{job.customers?.company || job.customers?.name}</span>
                          {isNewton && (
                            <span className="whitespace-nowrap rounded-lg bg-brand-50 px-2 py-0.5 text-xs font-medium uppercase text-brand-700">
                              Charge manually
                            </span>
                          )}
                        </div>
                        {/* Per Tim, 2026-09-27 — every overdue job now lives in
                            this one combined card instead of its own
                            per-date group, so each row needs its own due
                            date shown inline. */}
                        <span className="whitespace-nowrap text-xs text-red-600">Due on {formatDateMDY(due)}</span>
                        <span className="whitespace-nowrap text-right font-medium text-slate-800">{formatCents(job.invoice_total_cents ?? 0)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {groups.map((g) => (
              <div key={g.date} className="rounded-lg border border-slate-200 bg-white p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 pb-2">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-semibold text-slate-800">Due on {formatDateMDY(g.date)}</span>
                  </div>
                  <span className="text-sm text-slate-500">{formatCents(g.totalCents)}</span>
                </div>
                <div className="mt-2 space-y-1.5">
                  {g.jobs.map((job) => {
                    const isNewton = job.customers?.company_id === NEWTON_FIRE_FLOOD_COMPANY_ID;
                    return (
                      <div
                        key={job.id}
                        className="grid grid-cols-[5rem_minmax(0,1fr)_5rem] items-center gap-2 text-sm"
                      >
                        <Link
                          href={`/admin/dashboard?jobId=${job.id}`}
                          className="whitespace-nowrap font-mono text-xs text-slate-700 hover:text-slate-900 hover:underline"
                        >
                          {job.project_number}
                        </Link>
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-slate-700">{job.customers?.company || job.customers?.name}</span>
                          {isNewton && (
                            <span className="whitespace-nowrap rounded-lg bg-brand-50 px-2 py-0.5 text-xs font-medium uppercase text-brand-700">
                              {/* Per Tim, 2026-09-26 — auto-charge is off (he charges
                                  Newton manually in Stripe), so this no longer says
                                  "Scheduled to auto-charge". */}
                              Charge manually
                            </span>
                          )}
                        </div>
                        <span className="whitespace-nowrap text-right font-medium text-slate-800">{formatCents(job.invoice_total_cents ?? 0)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
