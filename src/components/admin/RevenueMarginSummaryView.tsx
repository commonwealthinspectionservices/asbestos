"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { JobWithCustomer } from "@/lib/types";
import { formatCents, knownStripeFeeCentsForJob } from "@/lib/pricing";
import { effectiveJobDate } from "@/lib/mileage-shared";
import { billingDateFor, invoiceStatus, ymd } from "@/components/admin/BillingView";

// Per Tim, 2026-09-24 — "I feel like it's better than having daily and
// weekly and monthly because I can just do it on there": replaced the
// Daily/Weekly/Monthly toggle (itself only hours old) with a real date
// range — one shared "From"/"To" pair covers a single day (From === To),
// any custom range, or everything (both left blank), instead of being
// locked into three fixed granularities. There's no separate "mode," so
// the selected range and its own total can never disagree the way period
// groupings vs. an "All time" row once did (see
// project_mileage_and_taxable_income for that whole history). Quick-select
// buttons (Today/This Week/This Month/All Time) existed briefly the same
// day, then Tim asked to drop them — From/To are typed directly now.
// startOfWeek/endOfWeek still used for the page's own default range on
// load (the current week).
function startOfWeek(d: Date): Date {
  const s = new Date(d);
  s.setHours(0, 0, 0, 0);
  s.setDate(s.getDate() - s.getDay());
  return s;
}
function endOfWeek(d: Date): Date {
  const e = startOfWeek(d);
  e.setDate(e.getDate() + 6);
  return e;
}

// Per Tim, 2026-09-15 — split out of BillingView's own collapsed-by-
// default "Revenue & Margin Summary" dropdown into its own page. Runs its
// own /api/admin/jobs fetch — same self-contained-page pattern as
// LabInvoicesView, not a shared data source with BillingView.
//
// Per Tim, 2026-09-24 — replaced entirely: "I think this would be a lot
// simpler if it was by job." The whole Weekly/Monthly period-bucketed
// table (periodHistory, goToPeriod, summaryRows, allTimeEarnings) is
// gone, after a full day of back-and-forth about which date basis a
// period row should use, whether Paid/Lab Cost/Net Earnings/Tax all
// correlated with the same week, and an "All time" tax figure that could
// disagree with its own Net Earnings. All of that complexity existed
// because a WEEK is an artificial container that different jobs' money
// flows through at different times — a job-per-row table sidesteps it: no
// bucketing, no date-basis question, each row is fully self-contained.
// No mileage or tax figures on this page at all (Tim, 2026-09-24: "this
// screen should just calculate the net earnings") — those questions go to
// his accountant; mileage stays tracked on its own Mileage page.
function formatWhole(cents: number): string {
  return formatCents(cents);
}

export default function RevenueMarginSummaryView() {
  const router = useRouter();
  const [jobs, setJobs] = useState<JobWithCustomer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  // Empty string means "no bound" — both blank together means "All time".
  const [fromDate, setFromDate] = useState(() => ymd(startOfWeek(new Date())));
  const [toDate, setToDate] = useState(() => ymd(endOfWeek(new Date())));
  // Per Tim, 2026-09-23 — "make sure all stripe fees are recorded":
  // reuses audit-invoices' existing check for this rather than
  // re-deriving it — it already does the important part right (a live
  // Stripe lookup to tell "still processing" apart from "genuinely
  // missing," see that route's own isPaymentStillProcessing comment).
  // Filtered down to just the two Stripe-fee issues out of that route's
  // full "invoice" category (which also covers unrelated things like
  // base-fee mismatches).
  const [stripeFeeGaps, setStripeFeeGaps] = useState<
    { project_number: string | null; company: string | null; issue: string; severity?: string }[]
  >([]);

  useEffect(() => {
    fetch("/api/admin/jobs")
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error ?? "Failed to load revenue summary");
        setJobs(data.jobs);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load revenue summary"))
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    fetch("/api/admin/audit-invoices")
      .then(async (r) => {
        if (!r.ok) return;
        const data = await r.json();
        const issues = (data.issues ?? []) as { category: string; severity?: string; project_number: string | null; company: string | null; issue: string }[];
        setStripeFeeGaps(
          issues.filter((i) => i.category === "invoice" && (i.issue.startsWith("Paid via ACH, still waiting") || i.issue.startsWith("Paid via Stripe but no processing fee")))
        );
      })
      .catch(() => {});
  }, []);

  // Per Tim, 2026-08-28 — this summary is only for invoices that have
  // actually gone out (or been paid), not ones merely ready to send —
  // same predicate as BillingView's own invoicedJobs.
  const invoicedJobs = useMemo(
    () => jobs.filter((j) => j.source !== "subcontractor" && j.invoice_total_cents != null && (j.invoice_sent_at || j.paid_date)),
    [jobs]
  );

  // Per Tim, 2026-09-23 — "how are you going to make sure that you track
  // everything that gets paid... I need a way to verify that everything
  // that gets into this column is actually being tracked": every job row
  // below needs a fieldwork date (billingDateFor) to sort by — a job
  // that's genuinely paid but has no confirmed_date/requested_date
  // recorded would still show up in the job list itself (it doesn't
  // depend on a date to exist), but two distinct real gaps are still
  // worth surfacing separately, checked per job:
  //   1. Invoiced (has a total, sent or paid) but no fieldwork date.
  //   2. Marked paid but has no invoice total at all — invoicedJobs
  //      itself requires a total, so a job missing one never appears in
  //      the main list below at all.
  const paidButNotTracked = useMemo(
    () =>
      jobs
        .filter((j) => j.source !== "subcontractor")
        .map((j) => {
          const isInvoiced = j.invoice_total_cents != null && Boolean(j.invoice_sent_at || j.paid_date);
          const isPaid = j.status === "paid" || Boolean(j.paid_date);
          if (isInvoiced && !effectiveJobDate(j)) {
            return { job: j, reason: "No fieldwork or requested date recorded" };
          }
          if (isPaid && j.invoice_total_cents == null) {
            return { job: j, reason: "Marked paid but has no invoice total recorded" };
          }
          return null;
        })
        .filter((x): x is { job: JobWithCustomer; reason: string } => x !== null)
        .sort((a, b) => (b.job.paid_date ?? effectiveJobDate(b.job) ?? "").localeCompare(a.job.paid_date ?? effectiveJobDate(a.job) ?? "")),
    [jobs]
  );

  // Per Tim, 2026-09-18 — moved here from BillingView ("this part should
  // not be on the billing page, it should be on the revenue and margin
  // summary page"), unchanged math (same invoicedJobs, same invoiceStatus
  // predicate as its old home there).
  const awaitingPaymentCents = useMemo(() => {
    let cents = 0;
    for (const job of invoicedJobs) {
      const status = invoiceStatus(job);
      if (status === "sent" || status === "overdue") cents += job.invoice_total_cents ?? 0;
    }
    return cents;
  }, [invoicedJobs]);

  // Per Tim, 2026-09-24 — one row per job, fully self-contained — no
  // period bucketing, no date-basis question, nothing to reconcile
  // against a different row. invoicedCents is what the job was actually
  // billed for, shown regardless of paid status. paidCents is 0 (shown as
  // "—") until the job is actually paid; labCents is the job's own real,
  // Crystal-reported cost. netEarningsCents is allowed to go negative (a
  // job can genuinely cost more than it's brought in so far).
  //
  // Per Tim, 2026-09-24 (later same day) — "delete the 35% taxes column
  // entirely... all we should be trying to calculate on this is net
  // earnings": the whole tax calculation (taxCents, and totalTaxable/
  // totalTax on the totals row below) is gone. This page is now purely
  // Invoiced/Paid/Lab Cost/Stripe Fee/Net Earnings — no tax figure at all.
  const jobRows = useMemo(
    () =>
      invoicedJobs
        .map((job) => {
          const isPaid = job.status === "paid" || Boolean(job.paid_date);
          const invoicedCents = job.invoice_total_cents ?? 0;
          const paidCents = isPaid ? invoicedCents : 0;
          const labCents = job.lab_cost_cents ?? 0;
          const stripeFeeCents = knownStripeFeeCentsForJob(job) ?? 0;
          const netEarningsCents = paidCents - labCents - stripeFeeCents;
          const date = billingDateFor(job);
          return {
            id: job.id,
            project_number: job.project_number,
            date,
            isPaid,
            invoicedCents,
            paidCents,
            labCents,
            stripeFeeCents,
            netEarningsCents,
          };
        })
        // Per Tim, 2026-09-24 — "jobs should always just be in order by
        // number high to low": project number, numeric-aware so 26-0100
        // sorts above 26-0099 and a revisit (26-0002.1) sits right after
        // its parent's number, not by fieldwork date.
        .sort((a, b) => (b.project_number ?? "").localeCompare(a.project_number ?? "", undefined, { numeric: true })),
    [invoicedJobs]
  );

  // Per Tim, 2026-09-24 — "I feel like it's better... because I can just
  // do it on there": jobRows (unchanged, still sorted newest-first)
  // filtered down to whichever From/To range is set. Swaps the two bounds
  // if Tim picks them out of order rather than silently showing nothing.
  // Both blank = no filter at all (every job, including ones with no
  // fieldwork date — those can never match a real bound anyway).
  const effectiveRange = useMemo(() => {
    if (!fromDate && !toDate) return { lo: null as string | null, hi: null as string | null };
    const lo = !fromDate || (toDate && toDate < fromDate) ? toDate : fromDate;
    const hi = !toDate || (fromDate && toDate < fromDate) ? fromDate : toDate;
    return { lo, hi };
  }, [fromDate, toDate]);

  const filteredJobRows = useMemo(() => {
    const { lo, hi } = effectiveRange;
    if (!lo && !hi) return jobRows;
    return jobRows.filter((row) => row.date && (!lo || row.date >= lo) && (!hi || row.date <= hi));
  }, [jobRows, effectiveRange]);

  // Per Tim, 2026-09-24 — reversed course, same day: "lab costs should
  // only ever appear on jobs that have been paid. All we care about here
  // is jobs that have been paid." Supersedes the earlier "lab costs are
  // always charged to me no matter what" rule for THIS page (that rule
  // still governs job.lab_cost_cents itself and the Lab Cost column on
  // other pages — nothing about how the cost is recorded changed, only
  // when it's surfaced here). Lab Cost — per row and in the total — now
  // only shows/counts for jobs where isPaid, same gate Paid/Stripe Fee
  // already use. An unpaid job's real recorded lab cost still exists
  // (still visible on the job's own
  // page), it just doesn't appear anywhere on THIS page until paid.
  const invoicedTotalCents = useMemo(() => filteredJobRows.reduce((sum, row) => sum + row.invoicedCents, 0), [filteredJobRows]);

  // totalPay (Net Earnings) comes from these three aggregate totals, not
  // from summing each row's own netEarningsCents (which stays internally
  // negative-but-hidden on unpaid rows even though Lab Cost display
  // doesn't show it — summing it directly would double-count).
  const filteredTotals = useMemo(() => {
    let totalPaid = 0, totalLabCost = 0, totalStripeFee = 0;
    for (const row of filteredJobRows) {
      if (row.isPaid) {
        totalPaid += row.paidCents;
        totalLabCost += row.labCents;
        totalStripeFee += row.stripeFeeCents;
      }
    }
    const totalPay = totalPaid - totalLabCost - totalStripeFee;
    return { totalPaid, totalLabCost, totalStripeFee, totalPay };
  }, [filteredJobRows]);

  function goToJob(jobId: string) {
    router.push(`/admin/dashboard?jobId=${jobId}`);
  }

  return (
    <div>
      {/* Per Tim, 2026-09-16 — "when I go into any of those tabs, they
          should all have a back arrow to get me back to the last window",
          then 2026-09-24 — "the back button to the billing link thing
          should be on the same line as revenue and earnings summary
          title aligned right directly across from it": title and back
          link share one row now instead of the link sitting above it. */}
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-bold text-slate-800">Revenue &amp; Earnings Summary</h1>
        <Link href="/admin/billing" className="inline-flex shrink-0 items-center gap-1 text-sm text-brand-600 hover:text-brand-700">
          ← Billing
        </Link>
      </div>

      {error && <div className="mt-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

      {!loaded && !error && <p className="mt-6 text-sm text-slate-500">Loading…</p>}

      {loaded && !error && (
        <>
          {/* Per Tim, 2026-09-18 — moved here from the Billing page; an
              all-time total, not tied to any per-row basis below. */}
          <div className="mt-3 text-sm text-slate-500">
            Total Amount Pending <span className="font-semibold text-slate-800">{formatCents(awaitingPaymentCents)}</span>
          </div>

          {/* Per Tim, 2026-09-24 — quick-select buttons and the From/To
              inputs went through several rounds the same day (moved onto
              the Pending line, deleted, restored) before landing here: all
              one row, buttons left / date range right — "let's make sure
              that the height of the cells and buttons over there are the
              exact same height. And then let's make sure that the date
              feature is aligned right. And the buttons should be aligned
              left, like they are." Buttons and date inputs share a fixed
              h-10 (not just matching padding — a native <input
              type="date"> and a <button> can render at slightly different
              heights from UA defaults even with identical padding). */}
          <div className="mt-3 flex flex-nowrap items-center justify-between gap-2 overflow-x-auto pb-1">
            <div className="flex flex-nowrap items-center gap-2">
              <button
                onClick={() => { const t = ymd(new Date()); setFromDate(t); setToDate(t); }}
                className="inline-flex h-10 shrink-0 items-center justify-center whitespace-nowrap rounded-lg bg-slate-100 px-4 text-sm font-medium text-slate-600"
              >
                Today
              </button>
              <button
                onClick={() => { const now = new Date(); setFromDate(ymd(startOfWeek(now))); setToDate(ymd(endOfWeek(now))); }}
                className="inline-flex h-10 shrink-0 items-center justify-center whitespace-nowrap rounded-lg bg-slate-100 px-4 text-sm font-medium text-slate-600"
              >
                This Week
              </button>
              <button
                onClick={() => {
                  const now = new Date();
                  setFromDate(ymd(new Date(now.getFullYear(), now.getMonth(), 1)));
                  setToDate(ymd(new Date(now.getFullYear(), now.getMonth() + 1, 0)));
                }}
                className="inline-flex h-10 shrink-0 items-center justify-center whitespace-nowrap rounded-lg bg-slate-100 px-4 text-sm font-medium text-slate-600"
              >
                This Month
              </button>
              <button
                onClick={() => { setFromDate(""); setToDate(""); }}
                className="inline-flex h-10 shrink-0 items-center justify-center whitespace-nowrap rounded-lg bg-slate-100 px-4 text-sm font-medium text-slate-600"
              >
                All Time
              </button>
            </div>
            <div className="flex flex-nowrap items-center gap-2">
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="h-10 shrink-0 rounded-lg border border-slate-300 px-4 text-sm text-slate-800"
              />
              <span className="shrink-0 text-slate-400">–</span>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="h-10 shrink-0 rounded-lg border border-slate-300 px-4 text-sm text-slate-800"
              />
            </div>
          </div>

          {/* Per Tim, 2026-09-24 — "I think this would be a lot simpler if
              it was by job": one row per job (newest fieldwork first),
              filtered to a real From/To date range instead of fixed
              period buckets — pick a single day (From === To), any custom
              stretch, or leave both blank for everything. Job links
              straight to that job's own page instead of a period-filtered
              list, since a row already IS one job. Lab Cost/Stripe Fee
              render as plain positive red numbers (a real cost); Net
              Earnings is signed (red if negative). No tax column — see
              jobRows' own comment for why it was dropped. */}
          <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <div className="min-w-[620px]">
              <div className="grid grid-cols-[minmax(140px,1fr)_74px_74px_78px_70px_92px] gap-x-2 border-b border-slate-200 bg-slate-50 px-3 py-2 text-[8px] font-bold uppercase text-slate-500 sm:text-xs">
                <div>Job</div>
                <div className="text-right">Invoiced</div>
                <div className="text-right">Paid</div>
                <div className="text-right">Lab Cost</div>
                <div className="text-right">Stripe Fee</div>
                <div className="text-right">Net Earnings</div>
              </div>
              {filteredJobRows.length === 0 && (
                <div className="px-3 py-6 text-center text-sm text-slate-500">No jobs in this range.</div>
              )}
              {filteredJobRows.map((row) => (
                <div
                  key={row.id}
                  onClick={() => goToJob(row.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && goToJob(row.id)}
                  className="group grid cursor-pointer grid-cols-[minmax(140px,1fr)_74px_74px_78px_70px_92px] gap-x-2 items-center border-b border-slate-100 px-3 py-3 text-sm last:border-b-0 hover:bg-slate-50"
                >
                  <div className="min-w-0">
                    <div className="text-[11px] font-medium leading-tight text-slate-800 group-hover:underline sm:text-sm">{row.project_number}</div>
                  </div>
                  <div className="whitespace-nowrap text-right text-[12px] sm:text-sm">
                    {row.invoicedCents > 0 ? <span className="text-slate-600">{formatWhole(row.invoicedCents)}</span> : <span className="text-slate-400">—</span>}
                  </div>
                  <div className="whitespace-nowrap text-right text-[12px] font-medium sm:text-sm">
                    {row.isPaid ? <span className="text-emerald-700">{formatWhole(row.paidCents)}</span> : <span className="text-slate-400">—</span>}
                  </div>
                  <div className="whitespace-nowrap text-right text-[12px] sm:text-sm">
                    {/* Per Tim, 2026-09-24 — "lab costs should only ever
                        appear on jobs that have been paid. All we care
                        about here is jobs that have been paid": gated on
                        isPaid now, same as Paid/Net Earnings, reversing
                        the earlier "always shows regardless of paid
                        status" rule for this page specifically. */}
                    {row.isPaid && row.labCents > 0 ? <span className="text-red-600">{formatWhole(row.labCents)}</span> : <span className="text-slate-400">—</span>}
                  </div>
                  <div className="whitespace-nowrap text-right text-[12px] sm:text-sm">
                    {row.stripeFeeCents > 0 ? <span className="text-red-600">{formatWhole(row.stripeFeeCents)}</span> : <span className="text-slate-400">—</span>}
                  </div>
                  <div className="whitespace-nowrap text-right text-[12px] sm:text-sm">
                    {/* Per Tim, 2026-09-24 — "it should never be negative
                        when there are lab costs... but the job has not
                        been paid yet, we need to just leave that section
                        blank": Net Earnings only ever shows a real number
                        once the job is actually paid — a real cost against
                        a job that hasn't been paid yet isn't a confirmed
                        loss, it's just pending. Also never bold anymore
                        (was font-semibold). */}
                    {!row.isPaid || row.netEarningsCents === 0 ? (
                      <span className="text-slate-400">—</span>
                    ) : (
                      <span className={row.netEarningsCents < 0 ? "text-red-600" : "text-emerald-700"}>
                        {row.netEarningsCents < 0 ? "−" : ""}
                        {formatWhole(Math.abs(row.netEarningsCents))}
                      </span>
                    )}
                  </div>
                </div>
              ))}
              {/* Per Tim, 2026-09-24 — went from bottom row → second row
                  (right under the header, "so the summary is visible
                  without scrolling") → back to the bottom row: "make it so
                  that total is the bottom row." Also "let's make it so
                  that total is all caps." Invoiced respects the current
                  From/To range like everything else here, just not the
                  "complete jobs only" restriction the other columns use —
                  see invoicedTotalCents' own comment. */}
              <div className="grid grid-cols-[minmax(140px,1fr)_74px_74px_78px_70px_92px] gap-x-2 items-center border-t-2 border-slate-200 bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-800">
                <div className="text-[11px] uppercase leading-tight sm:text-sm">Total</div>
                <div className="whitespace-nowrap text-right text-[12px] sm:text-sm">
                  {invoicedTotalCents > 0 ? <span className="text-slate-600">{formatWhole(invoicedTotalCents)}</span> : <span className="text-slate-400">—</span>}
                </div>
                <div className="whitespace-nowrap text-right text-[12px] sm:text-sm">
                  {filteredTotals.totalPaid > 0 ? <span className="text-emerald-700">{formatWhole(filteredTotals.totalPaid)}</span> : <span className="text-slate-400">—</span>}
                </div>
                <div className="whitespace-nowrap text-right text-[12px] sm:text-sm">
                  {filteredTotals.totalLabCost > 0 ? <span className="text-red-600">{formatWhole(filteredTotals.totalLabCost)}</span> : <span className="text-slate-400">—</span>}
                </div>
                <div className="whitespace-nowrap text-right text-[12px] sm:text-sm">
                  {filteredTotals.totalStripeFee > 0 ? <span className="text-red-600">{formatWhole(filteredTotals.totalStripeFee)}</span> : <span className="text-slate-400">—</span>}
                </div>
                <div className="whitespace-nowrap text-right text-[12px] sm:text-sm">
                  {filteredTotals.totalPay === 0 ? (
                    <span className="text-slate-400">—</span>
                  ) : (
                    <span className={filteredTotals.totalPay < 0 ? "text-red-600" : "text-emerald-700"}>
                      {filteredTotals.totalPay < 0 ? "−" : ""}
                      {formatWhole(Math.abs(filteredTotals.totalPay))}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Per Tim, 2026-09-23 — "how are you going to make sure that
              you track everything that gets paid... I need a way to
              verify": see paidButNotTracked's own comment for exactly
              which two gaps this catches. */}
          {paidButNotTracked.length > 0 && (
            <>
              <h2 className="mt-8 text-lg font-bold text-slate-800">Not showing up above</h2>
              <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white">
                <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_1fr] gap-x-3 border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold uppercase tracking-wide text-slate-500 sm:px-4">
                  <div>Project</div>
                  <div>Company</div>
                  <div>Why</div>
                </div>
                {paidButNotTracked.map(({ job: j, reason }) => (
                  <div key={j.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_1fr] items-center gap-x-3 border-b border-slate-100 px-3 py-2.5 text-sm last:border-b-0 sm:px-4">
                    <div className="font-medium text-slate-800">{j.project_number}</div>
                    <div className="truncate text-slate-600">{j.customers?.company || j.customers?.name}</div>
                    <div className="text-slate-500">{reason}</div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Per Tim, 2026-09-23 — "make sure all stripe fees are
              recorded" — see stripeFeeGaps' own comment. */}
          {stripeFeeGaps.length > 0 && (
            <>
              <h2 className="mt-8 text-lg font-bold text-slate-800">Stripe fee not recorded</h2>
              <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white">
                <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_1fr] gap-x-3 border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold uppercase tracking-wide text-slate-500 sm:px-4">
                  <div>Project</div>
                  <div>Company</div>
                  <div>Status</div>
                </div>
                {stripeFeeGaps.map((i, idx) => (
                  <div key={idx} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_1fr] items-center gap-x-3 border-b border-slate-100 px-3 py-2.5 text-sm last:border-b-0 sm:px-4">
                    <div className="font-medium text-slate-800">{i.project_number ?? "—"}</div>
                    <div className="truncate text-slate-600">{i.company}</div>
                    <div className={i.severity === "waiting" ? "text-slate-500" : "text-red-600"}>
                      {i.severity === "waiting" ? "Still processing (ACH)" : "Missing"}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
