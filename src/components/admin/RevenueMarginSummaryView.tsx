"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { JobWithCustomer } from "@/lib/types";
import { formatCents, knownStripeFeeCentsForJob } from "@/lib/pricing";
import { TAX_SET_ASIDE_PERCENT, effectiveJobDate } from "@/lib/mileage-shared";
import { formatDateMDY } from "@/lib/date-format";
import { FLI_ENVIRONMENTAL_COMPANY_ID } from "@/lib/report-findings";
import { billingDateFor, invoiceStatus, ymd, MONTH_NAMES } from "@/components/admin/BillingView";

type Granularity = "daily" | "weekly" | "monthly";

// Per Tim, 2026-09-24 — "it needs to be daily, weekly, monthly. One huge
// row/list isn't going to work... if we can break it down smaller": the
// per-job table itself stays (each row still fully self-contained, no
// bucketing math to get wrong — see the file's own top comment), but 48+
// flat rows is a lot to scroll. This groups those same rows under a
// period header + subtotal, without changing how any individual row is
// computed. Sunday-start weeks match Crystal's own report convention
// (see BillingView's old periodHistory comment, now removed but the
// reasoning still applies): "Commonwealth Inspection Weekly Report,
// September 6-12, 2026".
function periodInfo(dateStr: string, granularity: Granularity): { key: string; label: string } {
  if (granularity === "daily") return { key: dateStr, label: formatDateMDY(dateStr) ?? dateStr };
  const d = new Date(`${dateStr}T00:00:00`);
  if (granularity === "monthly") return { key: dateStr.slice(0, 7), label: `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}` };
  const start = new Date(d);
  start.setDate(d.getDate() - d.getDay());
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const label =
    start.getMonth() === end.getMonth()
      ? `${MONTH_NAMES[start.getMonth()]} ${start.getDate()}-${end.getDate()}`
      : `${MONTH_NAMES[start.getMonth()]} ${start.getDate()}-${MONTH_NAMES[end.getMonth()]} ${end.getDate()}`;
  return { key: ymd(start), label };
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
// Mileage is dropped from this page entirely (Tim's explicit choice) —
// miles aren't a property of any one job (a day of driving can touch
// several jobs or none), so it never had a clean home in a per-job table;
// it stays tracked on its own Mileage page.
function formatWhole(cents: number): string {
  return formatCents(cents);
}

export default function RevenueMarginSummaryView() {
  const router = useRouter();
  const [jobs, setJobs] = useState<JobWithCustomer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [granularity, setGranularity] = useState<Granularity>("weekly");
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

  // Per Tim, 2026-09-23 — "show me the list of what's not been billed":
  // every job with fieldwork actually done (confirmed_date set) and no
  // lab_cost_cents recorded yet — deliberately NOT the same, narrower set
  // audit-invoices flags (that one only surfaces a job once its own week
  // is over, to avoid noise on fieldwork from the last day or two that
  // just hasn't been billed yet — worth worrying about vs. worth knowing
  // about are different lists, and Tim wants the second, complete one
  // here). Same FLI exclusion as everywhere else — FLI jobs never get a
  // real Commonwealth lab invoice at all (see knownLabCostCentsForJob's
  // own comment), so $0 there is correct, not "unbilled".
  const notYetBilled = useMemo(
    () =>
      jobs
        .filter((j) => effectiveJobDate(j) && j.source !== "subcontractor" && j.customers?.company_id !== FLI_ENVIRONMENTAL_COMPANY_ID && !j.lab_cost_cents)
        .sort((a, b) => (effectiveJobDate(b) ?? "").localeCompare(effectiveJobDate(a) ?? "")),
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

  // Per Tim, 2026-09-24 — "I just want 35% for taxes to be 35% of my net
  // earnings. And my net earnings are what I get paid minus lab cost,
  // stripe fee": one row per job, fully self-contained — no period
  // bucketing, no date-basis question, nothing to reconcile against a
  // different row. paidCents is 0 (shown as "—") until the job is
  // actually paid; labCents is the job's own real, Crystal-reported cost
  // regardless of paid status (lab costs are charged whether or not
  // Commonwealth's own invoice has been paid yet). netEarningsCents is
  // allowed to go negative (a job can genuinely cost more than it's
  // brought in so far); taxCents floors at 0 so a loss never produces a
  // negative tax.
  const jobRows = useMemo(
    () =>
      invoicedJobs
        .map((job) => {
          const isPaid = job.status === "paid" || Boolean(job.paid_date);
          const paidCents = isPaid ? job.invoice_total_cents ?? 0 : 0;
          const labCents = job.lab_cost_cents ?? 0;
          const stripeFeeCents = knownStripeFeeCentsForJob(job) ?? 0;
          const netEarningsCents = paidCents - labCents - stripeFeeCents;
          const taxCents = Math.max(0, Math.round((Math.max(0, netEarningsCents) * TAX_SET_ASIDE_PERCENT) / 100));
          const date = billingDateFor(job);
          return {
            id: job.id,
            project_number: job.project_number,
            company: job.customers?.company || job.customers?.name || null,
            date,
            isPaid,
            paidCents,
            labCents,
            stripeFeeCents,
            netEarningsCents,
            taxCents,
          };
        })
        .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")),
    [invoicedJobs]
  );

  // Per Tim, 2026-09-24 — "it needs to be daily, weekly, monthly... if we
  // can break it down smaller": groups the same jobRows (unchanged, still
  // sorted newest-first) under a period header + subtotal. A job with no
  // fieldwork/requested date at all (rare — see paidButNotTracked) can't
  // be grouped by period, so it lands in its own "No fieldwork date"
  // group at the very end rather than being silently dropped. Each
  // group's own subtotal uses the same computed-once-floored-once pattern
  // as allJobsTotals below — see that memo's own comment for why summing
  // each job's already-floored tax instead would be wrong.
  const groupedJobRows = useMemo(() => {
    const dated = new Map<string, { label: string; rows: typeof jobRows; totalPaid: number; totalLabCost: number; totalStripeFee: number }>();
    const undated: typeof jobRows = [];
    for (const row of jobRows) {
      if (!row.date) {
        undated.push(row);
        continue;
      }
      const { key, label } = periodInfo(row.date, granularity);
      let g = dated.get(key);
      if (!g) {
        g = { label, rows: [], totalPaid: 0, totalLabCost: 0, totalStripeFee: 0 };
        dated.set(key, g);
      }
      g.rows.push(row);
      g.totalPaid += row.paidCents;
      g.totalLabCost += row.labCents;
      g.totalStripeFee += row.stripeFeeCents;
    }
    const groups = Array.from(dated.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([key, g]) => ({ key, ...g }));
    if (undated.length > 0) {
      groups.push({
        key: "no-date",
        label: "No fieldwork date",
        rows: undated,
        totalPaid: undated.reduce((s, r) => s + r.paidCents, 0),
        totalLabCost: undated.reduce((s, r) => s + r.labCents, 0),
        totalStripeFee: undated.reduce((s, r) => s + r.stripeFeeCents, 0),
      });
    }
    return groups.map((g) => {
      const totalPay = g.totalPaid - g.totalLabCost - g.totalStripeFee;
      const totalTaxable = Math.max(0, totalPay);
      const totalTax = Math.max(0, Math.round((totalTaxable * TAX_SET_ASIDE_PERCENT) / 100));
      return { ...g, totalPay, totalTaxable, totalTax };
    });
  }, [jobRows, granularity]);

  // Per Tim, 2026-09-24 — "why want the numbers to match is the point...
  // I want these numbers to be showing all the same thing": the same
  // "All time" fix from the old period table applies here too — sum every
  // job's own Paid/Lab Cost/Stripe Fee first into one true totalPay, then
  // compute totalTaxable/totalTax from THAT one number, floored once at
  // the end. Never sum each job's own already-floored tax — a job that
  // lost money contributes $0 tax with no credit toward a different job's
  // profit, same reasoning as before, just per-job now instead of
  // per-week.
  const allJobsTotals = useMemo(() => {
    let totalPaid = 0, totalLabCost = 0, totalStripeFee = 0;
    for (const row of jobRows) {
      totalPaid += row.paidCents;
      totalLabCost += row.labCents;
      totalStripeFee += row.stripeFeeCents;
    }
    const totalPay = totalPaid - totalLabCost - totalStripeFee;
    const totalTaxable = Math.max(0, totalPay);
    const totalTax = Math.max(0, Math.round((totalTaxable * TAX_SET_ASIDE_PERCENT) / 100));
    return { totalPaid, totalLabCost, totalStripeFee, totalPay, totalTaxable, totalTax };
  }, [jobRows]);

  function goToJob(jobId: string) {
    router.push(`/admin/dashboard?jobId=${jobId}`);
  }

  return (
    <div>
      {/* Per Tim, 2026-09-16 — "when I go into any of those tabs, they
          should all have a back arrow to get me back to the last window". */}
      <Link href="/admin/billing" className="mb-2 inline-flex items-center gap-1 text-sm text-brand-600 hover:text-brand-700">
        ← Billing
      </Link>
      <h1 className="text-lg font-bold text-slate-800">Revenue &amp; Earnings Summary</h1>

      {error && <div className="mt-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

      {!loaded && !error && <p className="mt-6 text-sm text-slate-500">Loading…</p>}

      {loaded && !error && (
        <>
          {/* Per Tim, 2026-09-18 — moved here from the Billing page; an
              all-time total, not tied to any per-row basis below. */}
          <div className="mt-3 text-sm text-slate-500">
            Total Amount Pending <span className="font-semibold text-slate-800">{formatCents(awaitingPaymentCents)}</span>
          </div>

          {/* Per Tim, 2026-09-24 — "I think this would be a lot simpler if
              it was by job", then "it needs to be daily, weekly, monthly...
              if we can break it down smaller": one row per job (newest
              fieldwork first), grouped under a period header + subtotal so
              a 48+ row flat list isn't one huge scroll. Job links straight
              to that job's own page instead of a period-filtered list,
              since a row already IS one job — no click-through ambiguity
              like the old table's Paid-vs-Lab-Cost links had. Same cents
              precision (formatCents) and horizontal scroll pattern as
              before — 5 dollar columns still don't fit a phone's width.
              Lab Cost/Stripe Fee render as plain positive red numbers (a
              real cost); Net Earnings/Tax same treatment as before (Net
              Earnings signed, Tax floored at $0). */}
          <div className="mt-4 flex gap-2">
            {(["daily", "weekly", "monthly"] as const).map((g) => (
              <button
                key={g}
                onClick={() => setGranularity(g)}
                className={`shrink-0 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium capitalize ${granularity === g ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"}`}
              >
                {g}
              </button>
            ))}
          </div>

          <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <div className="min-w-[640px]">
              <div className="grid grid-cols-[minmax(140px,1fr)_74px_78px_70px_92px_92px] gap-x-2 border-b border-slate-200 bg-slate-50 px-3 py-2 text-[8px] font-bold uppercase text-slate-500 sm:text-xs">
                <div>Job</div>
                <div className="text-right">Paid</div>
                <div className="text-right">Lab Cost</div>
                <div className="text-right">Stripe Fee</div>
                <div className="text-right">Net Earnings</div>
                <div className="text-right">35% for Taxes</div>
              </div>
              {groupedJobRows.map((group) => (
                <div key={group.key}>
                  <div className="grid grid-cols-[minmax(140px,1fr)_74px_78px_70px_92px_92px] gap-x-2 items-center bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700">
                    <div className="text-[11px] sm:text-sm">{group.label}</div>
                    <div className="whitespace-nowrap text-right text-[12px] text-emerald-700 sm:text-sm">{formatWhole(group.totalPaid)}</div>
                    <div className="whitespace-nowrap text-right text-[12px] text-red-600 sm:text-sm">{formatWhole(group.totalLabCost)}</div>
                    <div className="whitespace-nowrap text-right text-[12px] text-red-600 sm:text-sm">
                      {group.totalStripeFee > 0 ? formatWhole(group.totalStripeFee) : "—"}
                    </div>
                    <div className="whitespace-nowrap text-right text-[12px] sm:text-sm">
                      <span className={group.totalPay < 0 ? "text-red-600" : "text-emerald-700"}>
                        {group.totalPay < 0 ? "−" : ""}
                        {formatWhole(Math.abs(group.totalPay))}
                      </span>
                    </div>
                    <div
                      className="whitespace-nowrap text-right text-[12px] text-amber-700 sm:text-sm"
                      title={`Taxable: ${formatCents(group.totalTaxable)}`}
                    >
                      {group.totalTax > 0 ? formatWhole(group.totalTax) : "—"}
                    </div>
                  </div>
                  {group.rows.map((row) => (
                    <div
                      key={row.id}
                      onClick={() => goToJob(row.id)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && goToJob(row.id)}
                      className="grid cursor-pointer grid-cols-[minmax(140px,1fr)_74px_78px_70px_92px_92px] gap-x-2 items-center border-b border-slate-100 px-3 py-3 text-sm last:border-b-0 hover:bg-slate-50"
                    >
                      <div className="min-w-0">
                        <div className="text-[11px] font-medium leading-tight text-slate-800 sm:text-sm">{row.project_number}</div>
                        <div className="truncate text-[10px] leading-tight text-slate-500 sm:text-xs">{row.company}</div>
                      </div>
                      <div className="whitespace-nowrap text-right text-[12px] font-medium text-emerald-700 sm:text-sm">
                        {row.isPaid ? formatWhole(row.paidCents) : "—"}
                      </div>
                      <div className="whitespace-nowrap text-right text-[12px] text-red-600 sm:text-sm">{formatWhole(row.labCents)}</div>
                      <div className="whitespace-nowrap text-right text-[12px] text-red-600 sm:text-sm">
                        {row.stripeFeeCents > 0 ? formatWhole(row.stripeFeeCents) : "—"}
                      </div>
                      <div className="whitespace-nowrap text-right text-[12px] font-semibold sm:text-sm">
                        <span className={row.netEarningsCents < 0 ? "text-red-600" : "text-emerald-700"}>
                          {row.netEarningsCents < 0 ? "−" : ""}
                          {formatWhole(Math.abs(row.netEarningsCents))}
                        </span>
                      </div>
                      <div
                        className="whitespace-nowrap text-right text-[12px] text-amber-700 sm:text-sm"
                        title={`Taxable (Paid − Lab Cost − Stripe Fee): ${formatCents(Math.max(0, row.netEarningsCents))}`}
                      >
                        {row.taxCents > 0 ? formatWhole(row.taxCents) : "—"}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
              <div className="grid grid-cols-[minmax(140px,1fr)_74px_78px_70px_92px_92px] gap-x-2 items-center border-t-2 border-slate-200 bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-800">
                <div className="text-[11px] sm:text-sm">All jobs</div>
                <div className="whitespace-nowrap text-right text-[12px] text-emerald-700 sm:text-sm">{formatWhole(allJobsTotals.totalPaid)}</div>
                <div className="whitespace-nowrap text-right text-[12px] text-red-600 sm:text-sm">{formatWhole(allJobsTotals.totalLabCost)}</div>
                <div className="whitespace-nowrap text-right text-[12px] text-red-600 sm:text-sm">
                  {allJobsTotals.totalStripeFee > 0 ? formatWhole(allJobsTotals.totalStripeFee) : "—"}
                </div>
                <div className="whitespace-nowrap text-right text-[12px] sm:text-sm">
                  <span className={allJobsTotals.totalPay < 0 ? "text-red-600" : "text-emerald-700"}>
                    {allJobsTotals.totalPay < 0 ? "−" : ""}
                    {formatWhole(Math.abs(allJobsTotals.totalPay))}
                  </span>
                </div>
                <div
                  className="whitespace-nowrap text-right text-[12px] text-amber-700 sm:text-sm"
                  title={`Taxable: ${formatCents(allJobsTotals.totalTaxable)}`}
                >
                  {formatWhole(allJobsTotals.totalTax)}
                </div>
              </div>
            </div>
          </div>

          {/* Per Tim, 2026-09-23 — "show me the list of what's not been
              billed" / "feel like it's more than this no??" (the earlier,
              audit-invoices-based version only surfaced a job once its own
              week was over, so it under-reported — see notYetBilled's own
              comment) / "i dont love the format" / "it should be at the
              very bottom" — three rounds of feedback landing here: a plain
              table matching the job table's own look, at the bottom of
              the page. */}
          {notYetBilled.length > 0 && (
            <>
              <h2 className="mt-8 text-lg font-bold text-slate-800">Not yet billed by the lab</h2>
              <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white">
                <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_90px] gap-x-3 border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold uppercase tracking-wide text-slate-500 sm:px-4">
                  <div>Project</div>
                  <div>Company</div>
                  <div className="text-right">Fieldwork</div>
                </div>
                {notYetBilled.map((j) => (
                  <div key={j.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_90px] items-center gap-x-3 border-b border-slate-100 px-3 py-2.5 text-sm last:border-b-0 sm:px-4">
                    <div className="font-medium text-slate-800">{j.project_number}</div>
                    <div className="truncate text-slate-600">{j.customers?.company || j.customers?.name}</div>
                    <div className="whitespace-nowrap text-right text-slate-500">{formatDateMDY(effectiveJobDate(j))}</div>
                  </div>
                ))}
              </div>
            </>
          )}

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
