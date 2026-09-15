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

  const groups = useMemo(() => {
    const byDate = new Map<string, JobWithCustomer[]>();
    for (const job of outstanding) {
      const due = dueDateFor(job);
      if (!due) continue;
      if (!byDate.has(due)) byDate.set(due, []);
      byDate.get(due)!.push(job);
    }
    return Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, jobsForDate]) => ({
        date,
        overdue: isPastDue(date),
        jobs: jobsForDate.sort((a, b) => (a.project_number ?? "").localeCompare(b.project_number ?? "")),
        totalCents: jobsForDate.reduce((sum, j) => sum + (j.invoice_total_cents ?? 0), 0),
      }));
  }, [outstanding]);

  const grandTotalCents = useMemo(() => outstanding.reduce((sum, j) => sum + (j.invoice_total_cents ?? 0), 0), [outstanding]);

  return (
    <div>
      <h1 className="text-lg font-bold text-slate-800">Payment Calendar</h1>
      <p className="mt-1 text-sm text-slate-500">
        Every date a sent, unpaid invoice is due — or, for a job on file with a card on file, scheduled to auto-charge.
      </p>

      {error && <div className="mt-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

      {!loaded && !error && <p className="mt-6 text-sm text-slate-500">Loading…</p>}

      {loaded && !error && groups.length === 0 && (
        <p className="mt-6 text-sm text-slate-500">Nothing outstanding — every sent invoice is paid.</p>
      )}

      {loaded && !error && groups.length > 0 && (
        <>
          <div className="mt-4 text-sm text-slate-500">
            Total Outstanding <span className="font-semibold text-slate-800">{formatCents(grandTotalCents)}</span>
          </div>

          <div className="mt-4 space-y-4">
            {groups.map((g) => (
              <div key={g.date} className="rounded-lg border border-slate-200 bg-white p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 pb-2">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-semibold text-slate-800">{formatDateMDY(g.date)}</span>
                    {g.overdue ? (
                      <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">Overdue</span>
                    ) : (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">Due</span>
                    )}
                  </div>
                  <span className="text-sm text-slate-500">{formatCents(g.totalCents)}</span>
                </div>
                <div className="mt-2 space-y-1.5">
                  {g.jobs.map((job) => {
                    const isNewton = job.customers?.company_id === NEWTON_FIRE_FLOOD_COMPANY_ID;
                    return (
                      <div key={job.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">
                        <div className="flex min-w-0 items-center gap-2">
                          <Link
                            href={`/admin/dashboard?jobId=${job.id}`}
                            className="whitespace-nowrap rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-700 hover:bg-slate-200"
                          >
                            {job.project_number}
                          </Link>
                          <span className="truncate text-slate-700">{job.customers?.company || job.customers?.name}</span>
                          {isNewton && (
                            <span className="whitespace-nowrap rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">
                              Scheduled to auto-charge
                            </span>
                          )}
                        </div>
                        <span className="whitespace-nowrap font-medium text-slate-800">{formatCents(job.invoice_total_cents ?? 0)}</span>
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
