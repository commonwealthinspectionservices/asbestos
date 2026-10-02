"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { JobWithCustomer } from "@/lib/types";
import { formatCents } from "@/lib/pricing";
import { formatDateMDY } from "@/lib/date-format";
import { dueDateFor, localDateOnly } from "@/lib/invoice-due-date";
import { NEWTON_FIRE_FLOOD_COMPANY_ID } from "@/lib/report-findings";
import { stripeDashboardInvoiceUrl } from "@/lib/stripe-dashboard";
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
  const [draftingId, setDraftingId] = useState<string | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [reminderSentAt, setReminderSentAt] = useState<Record<string, string>>({});

  // Per Tim, 2026-10-02 — "I just want to be able to send a reminder email
  // for each overdue job": creates a Gmail draft (never sends) and jumps
  // straight to it, same flow as the Email tab's "View Draft" buttons. The
  // tab has to open synchronously inside the click — after the await the
  // click's user gesture is gone and the popup gets blocked.
  async function draftReminder(jobId: string) {
    const newTab = window.open("", "_blank");
    setDraftingId(jobId);
    setDraftError(null);
    try {
      const res = await fetch(`/api/admin/jobs/${jobId}/create-draft?kind=overdue_reminder`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to create reminder draft");
      const url = `https://mail.google.com/mail/u/0/#drafts/${data.messageId}`;
      if (newTab) newTab.location.href = url;
      else window.open(url, "_blank");
      setJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, payment_reminder_draft_gmail_id: "pending", payment_reminder_drafted_at: new Date().toISOString(), payment_reminder_sent_at: null } : j)));
    } catch (e) {
      newTab?.close();
      setDraftError(e instanceof Error ? e.message : "Failed to create reminder draft");
    } finally {
      setDraftingId(null);
    }
  }

  // Per Tim, 2026-09-28 — "this should be updated as many of them were
  // paid this page needs to auto update": a job gets marked paid from
  // outside this page entirely (a customer's own Stripe payment, a
  // webhook), so the one-time fetch on mount could sit showing stale
  // "Overdue"/outstanding jobs indefinitely if he just leaves this tab
  // open. Refetches whenever the tab regains focus/visibility (the
  // common case — he switches away and back), plus a 60s poll as a
  // backstop for whenever he leaves it focused in the foreground the
  // whole time. No loading flicker on these background refetches —
  // setLoaded(true) only ever needs to fire once, after the very first
  // load.
  useEffect(() => {
    let cancelled = false;
    function load() {
      fetch("/api/admin/jobs")
        .then(async (r) => {
          const data = await r.json();
          if (!r.ok) throw new Error(data.error ?? "Failed to load payment calendar");
          if (!cancelled) setJobs(data.jobs);
        })
        .catch((e) => {
          if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load payment calendar");
        })
        .finally(() => {
          if (!cancelled) setLoaded(true);
        });
    }
    load();
    function onVisible() {
      if (document.visibilityState === "visible") load();
    }
    window.addEventListener("focus", load);
    document.addEventListener("visibilitychange", onVisible);
    const interval = setInterval(load, 60000);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", load);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(interval);
    };
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
  // Per Tim, 2026-10-02 — "the draft reminder button should turn into
  // reminder sent once reminder is sent": a drafted reminder is checked
  // against Gmail on every jobs refresh (focus + 60s poll), so it flips as
  // soon as the draft is actually sent.
  useEffect(() => {
    for (const { job } of overdueJobs) {
      if (!job.payment_reminder_draft_gmail_id || job.payment_reminder_sent_at) continue;
      fetch(`/api/admin/jobs/${job.id}/draft-status?kind=overdue_reminder`)
        .then((r) => r.json())
        .then((d) => {
          if (d.status === "sent" && d.sentAt) setReminderSentAt((prev) => ({ ...prev, [job.id]: d.sentAt }));
        })
        .catch(() => {});
    }
  }, [overdueJobs]);
  // Per Tim, 2026-10-02 — drafts still to send on top, already-reminded jobs
  // at the bottom; each half keeps the due date, then project number, order.
  function reminderSentAtFor(job: JobWithCustomer, due: string): string | null {
    const sentAt = job.payment_reminder_sent_at ?? reminderSentAt[job.id];
    return sentAt && localDateOnly(sentAt) >= due ? sentAt : null;
  }
  const sortedOverdueJobs = useMemo(
    () =>
      [...overdueJobs].sort((a, b) => {
        const aSent = reminderSentAtFor(a.job, a.due) ? 1 : 0;
        const bSent = reminderSentAtFor(b.job, b.due) ? 1 : 0;
        return aSent - bSent;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [overdueJobs, reminderSentAt]
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
        <h1 className="text-lg font-bold text-slate-800">Outstanding Payments</h1>
        {loaded && !error && (overdueJobs.length > 0 || groups.length > 0) && (
          <div className="whitespace-nowrap text-sm text-slate-500">
            Total Outstanding <span className="font-semibold text-slate-800">{formatCents(grandTotalCents)}</span>
          </div>
        )}
      </div>

      {error && <div className="mt-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}
      {draftError && <div className="mt-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{draftError}</div>}

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
                  {sortedOverdueJobs.map(({ job, due }) => {
                    return (
                      <div
                        key={job.id}
                        className="grid grid-cols-[5rem_minmax(0,1fr)_6rem_5rem] items-center sm:grid-cols-[5rem_minmax(0,1fr)_6rem_7rem_5rem] gap-2 text-sm"
                      >
                        <Link
                          href={`/admin/dashboard?jobId=${job.id}`}
                          className="whitespace-nowrap font-mono text-xs text-slate-700 hover:text-slate-900 hover:underline"
                        >
                          {job.project_number}
                        </Link>
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-slate-700">{job.customers?.company || job.customers?.name}</span>
                        </div>
                        {/* Per Tim, 2026-09-27 — every overdue job now lives in
                            this one combined card instead of its own
                            per-date group, so each row needs its own due
                            date shown inline. */}
                        <span className="whitespace-nowrap text-xs text-slate-700">Due on {formatDateMDY(due)}</span>
                        {(() => {
                          // Per Tim, 2026-10-02 — Newton Fire & Flood is charged by
                          // hand in Stripe, so a reminder email is the wrong action
                          // for them: this opens the invoice in the Stripe dashboard.
                          if (job.customers?.company_id === NEWTON_FIRE_FLOOD_COMPANY_ID && job.stripe_invoice_id) {
                            return (
                              <a
                                href={stripeDashboardInvoiceUrl(job.stripe_invoice_id)}
                                target="_blank"
                                rel="noreferrer"
                                className="order-last col-span-4 justify-self-end whitespace-nowrap rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:border-brand-600 sm:order-none sm:col-span-1"
                              >
                                Charge in Stripe
                              </a>
                            );
                          }
                          if (reminderSentAtFor(job, due)) {
                            return <span className="order-last col-span-4 justify-self-end whitespace-nowrap px-2 py-1 text-xs font-medium text-slate-500 sm:order-none sm:col-span-1">Reminder sent</span>;
                          }
                          return (
                            <button
                              type="button"
                              onClick={() => draftReminder(job.id)}
                              disabled={draftingId === job.id}
                              className="order-last col-span-4 justify-self-end whitespace-nowrap rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:border-brand-600 disabled:opacity-50 sm:order-none sm:col-span-1"
                            >
                              {draftingId === job.id ? "Drafting…" : "Draft reminder"}
                            </button>
                          );
                        })()}
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
                          {job.customers?.company_id === NEWTON_FIRE_FLOOD_COMPANY_ID && job.stripe_invoice_id && (
                            <a
                              href={stripeDashboardInvoiceUrl(job.stripe_invoice_id)}
                              target="_blank"
                              rel="noreferrer"
                              className="whitespace-nowrap rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:border-brand-600"
                            >
                              Charge in Stripe
                            </a>
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
