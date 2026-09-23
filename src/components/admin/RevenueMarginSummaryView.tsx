"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { JobWithCustomer } from "@/lib/types";
import { formatCents, computeMarginCents, knownStripeFeeCentsForJob } from "@/lib/pricing";
import { TAX_SET_ASIDE_PERCENT, MILEAGE_RATE_CENTS } from "@/lib/mileage-shared";
import { formatDateMDY } from "@/lib/date-format";
import { FLI_ENVIRONMENTAL_COMPANY_ID } from "@/lib/report-findings";
import {
  billingDateFor,
  parseReportDateRange,
  marginPercentOf,
  ordinal,
  ymd,
  MONTH_NAMES,
  COMPANY_START_DATE,
  invoiceStatus,
} from "@/components/admin/BillingView";

// Per Tim, 2026-09-15 — split out of BillingView's own collapsed-by-
// default "Revenue & Margin Summary" dropdown into its own page: "they
// should each be their own page and instead of being drop downs they
// should be links... at the top right... just linking to their own
// page." All the period-bucketing math here is unchanged from that
// dropdown, just moved — a period row can no longer set BillingView's
// periodFilter directly (different page now), so it instead navigates to
// /admin/billing?ptype=week&label=...&start=...&end=... (or
// ptype=month&...&key=...), which BillingView reads on load to seed the
// exact same "check this period's total against the job list" view. Runs
// its own /api/admin/jobs fetch — same self-contained-page pattern as
// LabInvoicesView, not a shared data source with BillingView.
// Every week/month since the company started, not just the latest few — the
// COMPANY_START_DATE filter below trims the excess.
const ALL_PERIODS_COUNT = 520;

export default function RevenueMarginSummaryView() {
  const router = useRouter();
  const [jobs, setJobs] = useState<JobWithCustomer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [summaryTab, setSummaryTab] = useState<"weekly" | "monthly">("weekly");
  // Miles driven per month ("YYYY-MM"), from the Mileage page's saved routes.
  // null until loaded; stays null if the mileage table isn't set up yet.
  // Hand-typed "other costs" per month (equipment, ads, office — see
  // monthly-overhead route), cents — monthly only, no such thing per week
  // (see the earnings section's own comment on why that row just doesn't
  // show up in weekly view).
  const [overhead, setOverhead] = useState<Record<string, number>>({});
  // Miles driven per day, from the Mileage page's saved routes — read-only
  // here (see sumSavedMileageByDay's own comment). Per Tim, 2026-09-23:
  // mileage is back in this page, but only as a tax deduction, not a cash
  // cost — see the earnings section's math below for exactly how. Kept at
  // day granularity (not pre-summed by month) so it can be re-bucketed into
  // either weeks or months depending on the same toggle as the table above.
  const [dailyMiles, setDailyMiles] = useState<Record<string, number>>({});

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
    fetch("/api/admin/monthly-overhead")
      .then(async (r) => (r.ok ? setOverhead((await r.json()).overhead) : null))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/admin/mileage?summary=1")
      .then(async (r) => (r.ok ? setDailyMiles((await r.json()).dailyMiles ?? {}) : null))
      .catch(() => {});
  }, []);

  async function saveOverhead(month: string, dollars: string) {
    const cents = Math.round((parseFloat(dollars) || 0) * 100);
    setOverhead((cur) => ({ ...cur, [month]: cents }));
    await fetch("/api/admin/monthly-overhead", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ month, cents }),
    }).catch(() => {});
  }

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
        .filter((j) => j.confirmed_date && j.source !== "subcontractor" && j.customers?.company_id !== FLI_ENVIRONMENTAL_COMPANY_ID && !j.lab_cost_cents)
        .sort((a, b) => (b.confirmed_date ?? "").localeCompare(a.confirmed_date ?? "")),
    [jobs]
  );

  const periodHistory = useMemo(() => {
    const today = new Date();

    // Per Tim, 2026-09-08 — "this is how they measure weeks so our system
    // should follow the exact format", from a real Crystal Analytical
    // report header ("Commonwealth Inspection Weekly Report, September
    // 6-12, 2026" — Sunday through Saturday). getDay() is already
    // 0=Sun..6=Sat, so it IS the day count since Sunday — no offset needed.
    const currentWeekStart = new Date(today);
    currentWeekStart.setHours(0, 0, 0, 0);
    currentWeekStart.setDate(currentWeekStart.getDate() - currentWeekStart.getDay());

    const weekly = Array.from({ length: ALL_PERIODS_COUNT }, (_, i) => {
      const start = new Date(currentWeekStart);
      start.setDate(start.getDate() - i * 7);
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      const label =
        start.getMonth() === end.getMonth()
          ? `${MONTH_NAMES[start.getMonth()]} ${ordinal(start.getDate())} - ${ordinal(end.getDate())}`
          : `${MONTH_NAMES[start.getMonth()]} ${ordinal(start.getDate())} - ${MONTH_NAMES[end.getMonth()]} ${ordinal(end.getDate())}`;
      return { label, startStr: ymd(start), endStr: ymd(end), grossCents: 0, netCents: 0, labCostCents: 0, paidGrossCents: 0, paidNetCents: 0 };
    }).filter((b) => b.endStr >= COMPANY_START_DATE);

    const monthly = Array.from({ length: ALL_PERIODS_COUNT }, (_, i) => {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const label = `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
      return { label, key, grossCents: 0, netCents: 0, labCostCents: 0, paidGrossCents: 0, paidNetCents: 0 };
    }).filter((b) => b.key >= COMPANY_START_DATE.slice(0, 7));

    for (const job of invoicedJobs) {
      const bucketDate = billingDateFor(job);
      if (!bucketDate) continue;
      const grossCents = job.invoice_total_cents ?? 0;
      // Per Tim, 2026-09-23 — "I would just remove the estimate and show
      // it when the real number actually lands": labCostCents is only ever
      // the job's own real, Crystal-reported lab_cost_cents now — no more
      // avg-$/sample guess filling the gap before that lands (see
      // notYetBilled below for how that gap is surfaced instead). A job
      // with no real cost recorded yet contributes $0 here, not a guess.
      const labCostCents = job.lab_cost_cents ?? 0;
      const netCents = computeMarginCents(grossCents, labCostCents, knownStripeFeeCentsForJob(job) ?? 0);
      // Per Tim, 2026-09-23 — "for a given week what I billed out and what
      // I actually got paid also": paidGrossCents/paidNetCents are the
      // SAME job population as grossCents above (this period's own
      // fieldwork), just the subset that's actually been paid — not a
      // separate paid-date-bucketed population (that was the old
      // paidWeekly/paidMonthly, removed). Keeps every column in a row
      // talking about the same jobs, same "apples to apples" reasoning as
      // billingDateFor's own reversal earlier today.
      const isPaid = job.status === "paid" || Boolean(job.paid_date);

      const w = weekly.find((b) => bucketDate >= b.startStr && bucketDate <= b.endStr);
      if (w) {
        w.grossCents += grossCents;
        w.netCents += netCents;
        w.labCostCents += labCostCents;
        if (isPaid) { w.paidGrossCents += grossCents; w.paidNetCents += netCents; }
      }

      const monthKey = bucketDate.slice(0, 7);
      const m = monthly.find((b) => b.key === monthKey);
      if (m) {
        m.grossCents += grossCents;
        m.netCents += netCents;
        m.labCostCents += labCostCents;
        if (isPaid) { m.paidGrossCents += grossCents; m.paidNetCents += netCents; }
      }
    }

    return { weekly, monthly };
  }, [invoicedJobs]);

  // Per Tim, 2026-09-05 — "a small PDF text only link... a link to the PDF
  // for each week from Crystal": one link per distinct real weekly/daily
  // summary document, deduped by content_hash. Scans every job, not just
  // invoicedJobs — a lab PDF can arrive before Commonwealth's own invoice
  // for that job goes out.
  const weeklyLabInvoicePdfHrefs = useMemo(() => {
    const seenKeys = new Set<string>();
    const docs: { jobId: string; docId: string; startStr: string; endStr: string; uploadedAt: string }[] = [];
    for (const job of jobs) {
      for (const doc of job.documents ?? []) {
        if (doc.kind !== "lab_invoice" || !doc.report_date_range || !doc.file_name.startsWith("weekly-lab-summary")) continue;
        const key = doc.content_hash ?? doc.storage_path;
        if (seenKeys.has(key)) continue;
        const range = parseReportDateRange(doc.report_date_range);
        if (!range) continue;
        seenKeys.add(key);
        docs.push({ jobId: job.id, docId: doc.id, uploadedAt: doc.uploaded_at, ...range });
      }
    }
    const result: Record<string, { href: string; uploadedAt: string }[]> = {};
    for (const week of periodHistory.weekly) {
      // Newest first — each Crystal summary is a running total that
      // includes everything in the earlier ones, so the newest is the one
      // that matters and the rest are just older snapshots.
      const hrefs = docs
        .filter((d) => d.startStr >= week.startStr && d.startStr <= week.endStr)
        .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))
        .map((d) => ({ href: `/api/admin/jobs/${d.jobId}/documents/${d.docId}`, uploadedAt: d.uploadedAt }));
      if (hrefs.length > 0) result[week.label] = hrefs;
    }
    return result;
  }, [jobs, periodHistory.weekly]);

  // Per Tim, 2026-09-02 — all-time total, not just what the capped
  // weekly/monthly tables above happen to show. Every invoiced job counts,
  // same gross computation as each period bucket above.
  const allTimeTotal = useMemo(() => {
    let grossCents = 0;
    let labCostCents = 0;
    let stripeFeeCents = 0;
    for (const job of invoicedJobs) {
      grossCents += job.invoice_total_cents ?? 0;
      labCostCents += job.lab_cost_cents ?? 0;
      stripeFeeCents += knownStripeFeeCentsForJob(job) ?? 0;
    }
    return { grossCents, labCostCents, stripeFeeCents };
  }, [invoicedJobs]);

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

  const monthlyMiles = useMemo(() => {
    const byMonth: Record<string, number> = {};
    for (const [date, miles] of Object.entries(dailyMiles)) {
      const key = date.slice(0, 7);
      byMonth[key] = Math.round(((byMonth[key] ?? 0) + miles) * 10) / 10;
    }
    return byMonth;
  }, [dailyMiles]);

  const weeklyMiles = useMemo(() => {
    const byWeekLabel: Record<string, number> = {};
    for (const [date, miles] of Object.entries(dailyMiles)) {
      const w = periodHistory.weekly.find((b) => date >= b.startStr && date <= b.endStr);
      if (w) byWeekLabel[w.label] = Math.round(((byWeekLabel[w.label] ?? 0) + miles) * 10) / 10;
    }
    return byWeekLabel;
  }, [dailyMiles, periodHistory.weekly]);

  // Always computed on the monthly basis, regardless of the Weekly/Monthly
  // toggle below — Other costs (monthly_overhead) has no weekly breakdown,
  // so a weekly-basis "All time" would always read lower than the true
  // total (missing every dollar of Other costs) and the figure would
  // visibly jump depending on which tab happened to be selected. Net
  // profit and the mileage deduction sum identically either way (every
  // paid job/day falls into exactly one week and exactly one month), so
  // only Other costs (and what it does to tax/Net earnings) actually
  // differs — using the monthly basis here keeps this one number stable.
  const allTimeEarnings = useMemo(() => {
    let totalPaidGross = 0, totalNet = 0, totalOther = 0, totalMileageCents = 0, totalTaxable = 0, totalTax = 0, totalPay = 0;
    for (const m of periodHistory.monthly) {
      const netCents = m.paidNetCents;
      const otherCents = overhead[m.key] ?? 0;
      const afterCosts = netCents - otherCents;
      const mileageDeductionCents = Math.round((monthlyMiles[m.key] ?? 0) * MILEAGE_RATE_CENTS);
      const taxableCents = Math.max(0, afterCosts - mileageDeductionCents);
      const taxCents = Math.max(0, Math.round((taxableCents * TAX_SET_ASIDE_PERCENT) / 100));
      totalPaidGross += m.paidGrossCents; totalNet += netCents; totalOther += otherCents; totalMileageCents += mileageDeductionCents; totalTaxable += taxableCents; totalTax += taxCents; totalPay += afterCosts - taxCents;
    }
    return { totalPaidGross, totalNet, totalOther, totalMileageCents, totalTaxable, totalTax, totalPay };
  }, [periodHistory.monthly, overhead, monthlyMiles]);

  const isWeekly = summaryTab === "weekly";

  // A period row navigates to Billing pre-filtered to that period, instead
  // of setting local state here — see this file's own top-of-file comment.
  function goToPeriod(label: string) {
    if (isWeekly) {
      const row = periodHistory.weekly.find((w) => w.label === label);
      if (row) router.push(`/admin/billing?ptype=week&label=${encodeURIComponent(row.label)}&start=${row.startStr}&end=${row.endStr}`);
    } else {
      const row = periodHistory.monthly.find((m) => m.label === label);
      if (row) router.push(`/admin/billing?ptype=month&label=${encodeURIComponent(row.label)}&key=${row.key}`);
    }
  }

  // Per Tim, 2026-09-23 — "my goal is to just have one big table that
  // calculates everything", then "it should pretty much be showing me for
  // a given week what I billed out and what I actually got paid also,
  // right?": every column in a row now describes the SAME job population
  // — this period's own fieldwork (billingDateFor/confirmed_date, same as
  // Revenue/Lab Cost/Margin) — split into the whole period (Revenue) and
  // just the paid subset of it (Paid, Net Earnings). Not a separate
  // paid-date-bucketed population anymore (that was the old
  // paidWeekly/paidMonthly) — genuinely apples to apples now, same
  // reasoning as billingDateFor's own reversal earlier today. id is the
  // period's own key (month) or label (week, which IS unique — see
  // periodHistory) — used for both the Other-costs input and this row's
  // own React key.
  const summaryRows = useMemo(() => {
    const source = isWeekly ? periodHistory.weekly : periodHistory.monthly;
    return source.map((p) => {
      const id = isWeekly ? (p as typeof periodHistory.weekly[number]).label : (p as typeof periodHistory.monthly[number]).key;
      const otherCents = isWeekly ? 0 : overhead[id] ?? 0;
      const afterCosts = p.paidNetCents - otherCents;
      const miles = (isWeekly ? weeklyMiles : monthlyMiles)[id] ?? 0;
      const mileageDeductionCents = Math.round(miles * MILEAGE_RATE_CENTS);
      const taxableCents = Math.max(0, afterCosts - mileageDeductionCents);
      const taxCents = Math.max(0, Math.round((taxableCents * TAX_SET_ASIDE_PERCENT) / 100));
      const netEarningsCents = afterCosts - taxCents;
      return {
        id,
        label: p.label,
        grossCents: p.grossCents,
        labCents: p.labCostCents,
        marginPercent: marginPercentOf(p),
        pdfHrefs: isWeekly ? weeklyLabInvoicePdfHrefs[p.label] : undefined,
        otherCents,
        paidGrossCents: p.paidGrossCents,
        miles,
        mileageDeductionCents,
        taxableCents,
        taxCents,
        netEarningsCents,
      };
    });
  }, [isWeekly, periodHistory, weeklyLabInvoicePdfHrefs, overhead, weeklyMiles, monthlyMiles]);

  const allTimeMarginPercent = allTimeTotal.grossCents > 0
    ? ((allTimeTotal.grossCents - allTimeTotal.labCostCents - allTimeTotal.stripeFeeCents) / allTimeTotal.grossCents) * 100
    : null;
  const allTimeMarginText = allTimeMarginPercent != null ? `${allTimeMarginPercent.toFixed(1)}%` : "—";

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
              all-time total, not tied to the Weekly/Monthly toggle below. */}
          <div className="mt-3 text-sm text-slate-500">
            Total Amount Pending <span className="font-semibold text-slate-800">{formatCents(awaitingPaymentCents)}</span>
          </div>

          <div className="mt-4 flex gap-2">
            <button
              onClick={() => setSummaryTab("weekly")}
              className={`shrink-0 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium ${isWeekly ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"}`}
            >
              Weekly
            </button>
            <button
              onClick={() => setSummaryTab("monthly")}
              className={`shrink-0 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium ${!isWeekly ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"}`}
            >
              Monthly
            </button>
          </div>

          {/* Per Tim, 2026-09-19 — "is this page really formatted the
              best": three separate boxes (revenue, lab costs, margin)
              listing the same weeks three times became one table, a row
              per period, so a week reads left to right. Same math and the
              same click-through to Billing as before. The lab-invoice PDF
              links sit under the period name so the number columns stay
              narrow enough for a phone.
              Per Tim, 2026-09-23 — "my goal is to just have one big table
              that calculates everything", then "Paid and Net should be
              their own separate columns... I want to calculate absolutely
              everything": every step of the calculation is now its own
              real column — Revenue, Lab Cost, Margin, Paid, Other Costs,
              Mileage Deduction, Taxable, To Tax Savings, To Checking —
              instead of compressing several into one cell. That's too many
              columns to fit a phone width by shrinking them further
              (already tried, per Tim, 2026-09-19 — don't re-compress), so
              the table scrolls horizontally instead (min-width forces a
              scrollbar rather than squeezing columns unreadably thin) —
              same "wide content gets its own horizontal scroll" pattern as
              everywhere else wide content shows up in this app. Other
              Costs is the one column that's also an editable input,
              monthly-only (no weekly breakdown exists for it — shows "—"
              in weekly view).
              Per Tim, 2026-09-23 — "I don't think I'm trying to use this
              as like my entire business overview... I do need to have it
              pre-calculated in terms of what I need to move to my general
              checking account and what I need to move to my 35% tax
              savings account": the actual point of this whole row, spelled
              out as three connected columns instead of implied math —
              Taxable (= Paid − Other Costs − Mileage Deduction, what the
              35% actually applies to — added specifically because "is Tax
              really 35% of X" wasn't visible/provable before, see
              session's own back-and-forth on this same day) → To Tax
              Savings (Taxable × 35%) → To Checking (Taxable − that). Named
              for the two accounts he's actually moving money into, not
              generic "Tax"/"Net" labels. */}
          <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <div className="min-w-[1080px]">
              <div className="grid grid-cols-[minmax(170px,1fr)_90px_90px_60px_90px_120px_100px_100px_120px_120px] gap-x-3 border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold uppercase tracking-wide text-slate-500 sm:px-4">
                <div>{isWeekly ? "Week" : "Month"}</div>
                <div className="text-right">Revenue</div>
                <div className="text-right">Lab Cost</div>
                <div className="text-right">Margin</div>
                <div className="text-right">Paid</div>
                <div className="text-right">Other Costs</div>
                <div className="text-right">Mileage Ded.</div>
                <div className="text-right">Taxable</div>
                <div className="text-right">To Tax Savings</div>
                <div className="text-right">To Checking</div>
              </div>
              {summaryRows.map((row) => (
                <div
                  key={row.id}
                  onClick={() => goToPeriod(row.label)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && goToPeriod(row.label)}
                  className="grid cursor-pointer grid-cols-[minmax(170px,1fr)_90px_90px_60px_90px_120px_100px_100px_120px_120px] gap-x-3 items-center border-b border-slate-100 px-3 py-3 text-sm last:border-b-0 hover:bg-slate-50 sm:px-4"
                >
                  <div className="text-slate-700">{row.label}</div>
                  <div className="whitespace-nowrap text-right text-[13px] font-medium text-slate-800 sm:text-sm">{formatCents(row.grossCents)}</div>
                  <div className="text-right text-[13px] text-slate-700 sm:text-sm">
                    {row.pdfHrefs && row.pdfHrefs.length > 0 ? (
                      // The Crystal report is where this number comes from,
                      // so the number itself is the link (newest summary —
                      // each is a running total that includes the earlier
                      // ones). Per Tim, 2026-09-23 — dropped the "earlier
                      // versions" dropdown that used to sit behind this;
                      // just the current one.
                      <a
                        href={row.pdfHrefs[0].href}
                        target="_blank"
                        rel="noreferrer"
                        title="Open this week's Crystal report"
                        onClick={(e) => e.stopPropagation()}
                        className="whitespace-nowrap underline decoration-slate-300 underline-offset-2 hover:decoration-slate-500"
                      >
                        {formatCents(row.labCents)}
                      </a>
                    ) : (
                      <span className="whitespace-nowrap">{formatCents(row.labCents)}</span>
                    )}
                  </div>
                  <div className="whitespace-nowrap text-right text-[13px] text-slate-700 sm:text-sm">
                    {row.marginPercent != null ? `${row.marginPercent.toFixed(1)}%` : "—"}
                  </div>
                  <div className="whitespace-nowrap text-right text-[13px] text-slate-800 sm:text-sm">{formatCents(row.paidGrossCents)}</div>
                  <div className="text-right" onClick={(e) => e.stopPropagation()}>
                    {isWeekly ? (
                      <span className="text-[13px] text-slate-300 sm:text-sm">—</span>
                    ) : (
                      <div className="flex items-center justify-end gap-1">
                        <span className="text-xs text-slate-400">−$</span>
                        <input
                          id={`overhead-${row.id}`}
                          type="number"
                          step="0.01"
                          min="0"
                          defaultValue={row.otherCents ? (row.otherCents / 100).toFixed(2) : ""}
                          placeholder="0.00"
                          onBlur={(e) => saveOverhead(row.id, e.target.value)}
                          className="h-7 w-16 rounded border border-slate-300 bg-white px-1 text-right text-xs text-slate-700"
                        />
                      </div>
                    )}
                  </div>
                  <div className="whitespace-nowrap text-right text-[13px] text-slate-400 sm:text-sm" title="Reduces what's taxable, not To Checking directly">
                    {row.mileageDeductionCents > 0 ? `−${formatCents(row.mileageDeductionCents)}` : "—"}
                  </div>
                  <div className="whitespace-nowrap text-right text-[13px] font-medium text-slate-800 sm:text-sm" title="Paid − Other Costs − Mileage Deduction — what the 35% below is taken on">
                    {formatCents(row.taxableCents)}
                  </div>
                  <div className="whitespace-nowrap text-right text-[13px] text-amber-700 sm:text-sm">
                    {row.taxCents > 0 ? formatCents(row.taxCents) : "—"}
                  </div>
                  <div className="whitespace-nowrap text-right text-[13px] font-semibold sm:text-sm">
                    <span className={row.netEarningsCents < 0 ? "text-red-600" : "text-emerald-700"}>
                      {row.netEarningsCents < 0 ? "−" : ""}{formatCents(Math.abs(row.netEarningsCents))}
                    </span>
                  </div>
                </div>
              ))}
              <div className="grid grid-cols-[minmax(170px,1fr)_90px_90px_60px_90px_120px_100px_100px_120px_120px] gap-x-3 items-center bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-800 sm:px-4">
                <div>All time</div>
                <div className="whitespace-nowrap text-right text-[13px] sm:text-sm">{formatCents(allTimeTotal.grossCents)}</div>
                <div className="whitespace-nowrap text-right text-[13px] sm:text-sm">{formatCents(allTimeTotal.labCostCents)}</div>
                <div className="whitespace-nowrap text-right text-[13px] sm:text-sm">{allTimeMarginText}</div>
                <div className="whitespace-nowrap text-right text-[13px] sm:text-sm">{formatCents(allTimeEarnings.totalPaidGross)}</div>
                <div className="whitespace-nowrap text-right text-[13px] font-normal text-slate-500 sm:text-sm">− {formatCents(allTimeEarnings.totalOther)}</div>
                <div className="whitespace-nowrap text-right text-[13px] font-normal text-slate-400 sm:text-sm">
                  {allTimeEarnings.totalMileageCents > 0 ? `−${formatCents(allTimeEarnings.totalMileageCents)}` : "—"}
                </div>
                <div className="whitespace-nowrap text-right text-[13px] sm:text-sm">{formatCents(allTimeEarnings.totalTaxable)}</div>
                <div className="whitespace-nowrap text-right text-[13px] text-amber-700 sm:text-sm">{formatCents(allTimeEarnings.totalTax)}</div>
                {/* Always the monthly-basis total (see allTimeEarnings' own
                    comment) — doesn't change when you flip Weekly/Monthly. */}
                <div className="whitespace-nowrap text-right text-[13px] sm:text-sm">
                  <span className={allTimeEarnings.totalPay < 0 ? "text-red-600" : "text-emerald-700"}>
                    {allTimeEarnings.totalPay < 0 ? "−" : ""}{formatCents(Math.abs(allTimeEarnings.totalPay))}
                  </span>
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
              table matching the period table's own look, at the bottom of
              the page. */}
          {notYetBilled.length > 0 && (
            <>
              <h2 className="mt-8 text-lg font-bold text-slate-800">Not yet billed by the lab</h2>
              <p className="mt-1 text-sm text-slate-500">Fieldwork done, no lab cost recorded yet.</p>
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
                    <div className="whitespace-nowrap text-right text-slate-500">{formatDateMDY(j.confirmed_date)}</div>
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
