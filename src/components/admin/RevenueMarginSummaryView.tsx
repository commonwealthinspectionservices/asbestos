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

// Per Tim, 2026-09-23 — "I don't have to scroll across": whole dollars,
// no cents, just for this compact table — every other dollar figure in
// the app (invoices, the job list, etc.) still uses formatCents' full
// precision; this is purely a display-width concession for a table with
// 6 dollar columns across a phone-width screen.
function formatWhole(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString("en-US")}`;
}

export default function RevenueMarginSummaryView() {
  const router = useRouter();
  const [jobs, setJobs] = useState<JobWithCustomer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [summaryTab, setSummaryTab] = useState<"weekly" | "monthly">("weekly");
  // Miles driven per day, from the Mileage page's saved routes — read-only
  // here (see sumSavedMileageByDay's own comment). Per Tim, 2026-09-23:
  // mileage is back in this page, but only as a tax deduction, not a cash
  // cost — see the earnings section's math below for exactly how. Kept at
  // day granularity (not pre-summed by month) so it can be re-bucketed into
  // either weeks or months depending on the same toggle as the table above.
  const [dailyMiles, setDailyMiles] = useState<Record<string, number>>({});
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

  useEffect(() => {
    fetch("/api/admin/mileage?summary=1")
      .then(async (r) => (r.ok ? setDailyMiles((await r.json()).dailyMiles ?? {}) : null))
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
        .filter((j) => j.confirmed_date && j.source !== "subcontractor" && j.customers?.company_id !== FLI_ENVIRONMENTAL_COMPANY_ID && !j.lab_cost_cents)
        .sort((a, b) => (b.confirmed_date ?? "").localeCompare(a.confirmed_date ?? "")),
    [jobs]
  );

  // Per Tim, 2026-09-23 — "how are you going to make sure that you track
  // everything that gets paid... I need a way to verify that everything
  // that gets into this column is actually being tracked": every dollar
  // column on this page is bucketed by confirmed_date (billingDateFor) —
  // a job that's genuinely paid but has no confirmed_date recorded would
  // silently never land in any week/month row, invisible everywhere on
  // this page including "All time". Same idea for invoice_total_cents,
  // which invoicedJobs itself requires be non-null to be counted at all.
  // This is the real, literal answer to "how do I verify" — every paid
  // job that this page's own math would actually drop, and exactly why.
  // Excludes subcontractor jobs on purpose (they're never invoiced by
  // Commonwealth at all, same exclusion invoicedJobs uses — not a gap).
  // Per Tim, 2026-09-23 — "go check the numbers" surfaced a second, wider
  // gap than the original paid-only check covered: ANY invoiced job
  // missing confirmed_date (not just a paid one) is invisible to every
  // week/month row on this page (Lab Cost included — see allTimeTotal's
  // own comment for the real live mismatch this caused, $5,583 vs $3,761).
  // Two distinct reasons, checked per job:
  //   1. Invoiced (has a total, sent or paid) but no fieldwork date —
  //      excluded from every row, paid or not.
  //   2. Marked paid but has no invoice total at all — a different gap,
  //      not caught by #1 since invoicedJobs itself requires a total.
  const paidButNotTracked = useMemo(
    () =>
      jobs
        .filter((j) => j.source !== "subcontractor")
        .map((j) => {
          const isInvoiced = j.invoice_total_cents != null && Boolean(j.invoice_sent_at || j.paid_date);
          const isPaid = j.status === "paid" || Boolean(j.paid_date);
          if (isInvoiced && !j.confirmed_date) {
            return { job: j, reason: "No fieldwork date recorded — excluded from every week/month row on this page" };
          }
          if (isPaid && j.invoice_total_cents == null) {
            return { job: j, reason: "Marked paid but has no invoice total recorded" };
          }
          return null;
        })
        .filter((x): x is { job: JobWithCustomer; reason: string } => x !== null)
        .sort((a, b) => (b.job.paid_date ?? b.job.confirmed_date ?? "").localeCompare(a.job.paid_date ?? a.job.confirmed_date ?? "")),
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
      // Per Tim, 2026-09-23 — "I don't have to scroll across": a compact
      // table needs a compact period label too, not just narrower number
      // columns — "Sep 20-26" instead of "September 20th - 26th". Every
      // English month name's first 3 letters are already its standard
      // abbreviation, so slicing MONTH_NAMES is safe here.
      const shortLabel =
        start.getMonth() === end.getMonth()
          ? `${MONTH_NAMES[start.getMonth()].slice(0, 3)} ${start.getDate()}-${end.getDate()}`
          : `${MONTH_NAMES[start.getMonth()].slice(0, 3)} ${start.getDate()}-${MONTH_NAMES[end.getMonth()].slice(0, 3)} ${end.getDate()}`;
      return { label, shortLabel, startStr: ymd(start), endStr: ymd(end), grossCents: 0, netCents: 0, labCostCents: 0, paidGrossCents: 0, paidNetCents: 0, paidStripeFeeCents: 0 };
    }).filter((b) => b.endStr >= COMPANY_START_DATE);

    const monthly = Array.from({ length: ALL_PERIODS_COUNT }, (_, i) => {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const label = `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
      const shortLabel = `${MONTH_NAMES[d.getMonth()].slice(0, 3)} '${String(d.getFullYear()).slice(2)}`;
      return { label, shortLabel, key, grossCents: 0, netCents: 0, labCostCents: 0, paidGrossCents: 0, paidNetCents: 0, paidStripeFeeCents: 0 };
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
      const stripeFeeCents = knownStripeFeeCentsForJob(job) ?? 0;
      const netCents = computeMarginCents(grossCents, labCostCents, stripeFeeCents);
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
        if (isPaid) { w.paidGrossCents += grossCents; w.paidNetCents += netCents; w.paidStripeFeeCents += stripeFeeCents; }
      }

      const monthKey = bucketDate.slice(0, 7);
      const m = monthly.find((b) => b.key === monthKey);
      if (m) {
        m.grossCents += grossCents;
        m.netCents += netCents;
        m.labCostCents += labCostCents;
        if (isPaid) { m.paidGrossCents += grossCents; m.paidNetCents += netCents; m.paidStripeFeeCents += stripeFeeCents; }
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

  const isWeekly = summaryTab === "weekly";

  // Per Tim, 2026-09-23 — "go check it live" caught a second edge case in
  // the first fix: this used to always sum periodHistory.monthly
  // regardless of which tab was active, but monthly bucket inclusion is
  // looser than weekly's (a whole calendar month vs. an exact date range
  // — see periodHistory's own two .filter() calls), so a job right at the
  // company's own start-date boundary could count in the monthly sum
  // without ever appearing in any *weekly* row. All time disagreeing with
  // the weekly rows while agreeing with the (invisible, on this tab)
  // monthly ones was exactly as broken as the original bug. Now always
  // sums whichever set of rows (weekly or monthly) is actually on screen,
  // so "All time" can never mathematically disagree with what's shown
  // above it, on either tab. Real waterfall unchanged from before: Paid −
  // ALL Lab Cost − paid Stripe fee − Mileage, allowed to go negative.
  const allTimeEarnings = useMemo(() => {
    const source = isWeekly ? periodHistory.weekly : periodHistory.monthly;
    const miles = isWeekly ? weeklyMiles : monthlyMiles;
    let totalPaidGross = 0, totalLabCost = 0, totalStripeFee = 0, totalMileageCents = 0, totalTaxable = 0, totalTax = 0, totalPay = 0;
    for (const p of source) {
      const id = isWeekly ? (p as typeof periodHistory.weekly[number]).label : (p as typeof periodHistory.monthly[number]).key;
      const mileageDeductionCents = Math.round((miles[id] ?? 0) * MILEAGE_RATE_CENTS);
      const netBeforeTaxCents = p.paidGrossCents - p.labCostCents - p.paidStripeFeeCents - mileageDeductionCents;
      const taxableCents = Math.max(0, netBeforeTaxCents);
      const taxCents = Math.max(0, Math.round((taxableCents * TAX_SET_ASIDE_PERCENT) / 100));
      totalPaidGross += p.paidGrossCents; totalLabCost += p.labCostCents; totalStripeFee += p.paidStripeFeeCents; totalMileageCents += mileageDeductionCents; totalTaxable += taxableCents; totalTax += taxCents; totalPay += netBeforeTaxCents - taxCents;
    }
    return { totalPaidGross, totalLabCost, totalStripeFee, totalMileageCents, totalTaxable, totalTax, totalPay };
  }, [isWeekly, periodHistory, weeklyMiles, monthlyMiles]);

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
  // periodHistory) — used as this row's own React key.
  const summaryRows = useMemo(() => {
    const source = isWeekly ? periodHistory.weekly : periodHistory.monthly;
    return source.map((p) => {
      const id = isWeekly ? (p as typeof periodHistory.weekly[number]).label : (p as typeof periodHistory.monthly[number]).key;
      const miles = (isWeekly ? weeklyMiles : monthlyMiles)[id] ?? 0;
      const mileageDeductionCents = Math.round(miles * MILEAGE_RATE_CENTS);
      // Per Tim, 2026-09-23 — "this math doesn't make sense, I should be
      // way in the negative" / "I've been getting charged so many lab
      // costs, but I haven't been getting paid": a real bug, not a display
      // quirk. Lab Cost (the column) already shows every real cost for
      // this period's jobs regardless of paid status — per Tim's own
      // explicit "lab costs are always charged to me no matter what" — but
      // Net Earnings was still only ever subtracting the PAID subset's own
      // lab cost (via paidNetCents), so a period with lots of unpaid lab
      // work silently never reflected those costs here at all. Now a real
      // waterfall: what actually came in (paidGrossCents) minus every real
      // cost for the period (labCostCents — ALL of it, paid or not) minus
      // the paid jobs' own Stripe fee minus mileage. Allowed to go
      // negative — no floor — since that's the actual, honest cash
      // position when lab costs outrun collections. Only the *taxable*
      // step floors at 0 (never tax a loss).
      const netBeforeTaxCents = p.paidGrossCents - p.labCostCents - p.paidStripeFeeCents - mileageDeductionCents;
      const taxableCents = Math.max(0, netBeforeTaxCents);
      const taxCents = Math.max(0, Math.round((taxableCents * TAX_SET_ASIDE_PERCENT) / 100));
      const netEarningsCents = netBeforeTaxCents - taxCents;
      return {
        id,
        label: p.label,
        shortLabel: p.shortLabel,
        grossCents: p.grossCents,
        labCents: p.labCostCents,
        pdfHrefs: isWeekly ? weeklyLabInvoicePdfHrefs[p.label] : undefined,
        paidGrossCents: p.paidGrossCents,
        stripeFeeCents: p.paidStripeFeeCents,
        miles,
        mileageDeductionCents,
        taxableCents,
        taxCents,
        netEarningsCents,
      };
    });
  }, [isWeekly, periodHistory, weeklyLabInvoicePdfHrefs, weeklyMiles, monthlyMiles]);

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
              Per Tim, 2026-09-23 — went through several rounds the same
              day: "one big table that calculates everything" → "Paid and
              Net should be their own separate columns... calculate
              absolutely everything" (9 columns, horizontally scrollable)
              → "I don't have to scroll across" + "delete the other costs
              tab" → "this column [Margin] def delete it doesnt matter".
              Landed here: Other Costs is gone entirely (its own feature,
              not just this column — monthly-overhead route removed too).
              Margin, Mileage Deduction, and Taxable are no longer their
              own columns — Mileage Deduction/Taxable folded into the "Tax
              Savings" cell's title tooltip instead, since dropping all
              three (plus whole-dollar formatting via formatWhole, plus
              short period labels) is what actually gets this under a
              phone's width with zero horizontal scroll. Revenue/Lab Cost
              stayed — per Tim, "I don't think I'm trying to use this as my
              entire business overview... but I do need [it] pre-calculated
              in terms of what I need to move to my general checking
              account and what I need to move to my 35% tax savings
              account" — so "Tax Savings"/"Checking" are named for the two
              accounts he's actually moving money into, not generic
              "Tax"/"Net". Lab Cost renders in red with a "−" prefix (per
              Tim) since it's the one column here that's actually a cost,
              not incoming/outgoing money. */}
          <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="grid grid-cols-[minmax(0,1fr)_58px_62px_58px_62px_74px_74px] gap-x-1.5 border-b border-slate-200 bg-slate-50 px-2 py-2 text-[9px] font-bold uppercase leading-tight tracking-wide text-slate-500 sm:gap-x-3 sm:px-4 sm:text-xs">
              <div>{isWeekly ? "Week" : "Month"}</div>
              <div className="text-right">Paid</div>
              <div className="text-right">Lab Cost</div>
              <div className="text-right">Stripe Fee</div>
              <div className="text-right">Mileage</div>
              <div className="text-right">Net Earnings</div>
              <div className="text-right">35% for Taxes</div>
            </div>
            {summaryRows.map((row) => (
              <div
                key={row.id}
                onClick={() => goToPeriod(row.label)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && goToPeriod(row.label)}
                className="grid cursor-pointer grid-cols-[minmax(0,1fr)_58px_62px_58px_62px_74px_74px] gap-x-1.5 items-center border-b border-slate-100 px-2 py-3 text-sm last:border-b-0 hover:bg-slate-50 sm:gap-x-3 sm:px-4"
              >
                <div className="text-[11px] leading-tight text-slate-700 sm:text-sm">{row.shortLabel}</div>
                <div className="whitespace-nowrap text-right text-[12px] font-medium text-slate-800 sm:text-sm">{formatWhole(row.paidGrossCents)}</div>
                <div className="text-right text-[12px] text-red-600 sm:text-sm">
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
                      className="whitespace-nowrap underline decoration-red-300 underline-offset-2 hover:decoration-red-500"
                    >
                      {row.labCents > 0 ? `−${formatWhole(row.labCents)}` : formatWhole(row.labCents)}
                    </a>
                  ) : (
                    <span className="whitespace-nowrap">{row.labCents > 0 ? `−${formatWhole(row.labCents)}` : formatWhole(row.labCents)}</span>
                  )}
                </div>
                <div className="whitespace-nowrap text-right text-[12px] text-red-600 sm:text-sm">
                  {row.stripeFeeCents > 0 ? `−${formatWhole(row.stripeFeeCents)}` : "—"}
                </div>
                <div className="whitespace-nowrap text-right text-[12px] text-red-600 sm:text-sm">
                  {row.mileageDeductionCents > 0 ? `−${formatWhole(row.mileageDeductionCents)}` : "—"}
                </div>
                <div className="whitespace-nowrap text-right text-[12px] font-semibold sm:text-sm">
                  <span className={row.netEarningsCents < 0 ? "text-red-600" : "text-emerald-700"}>
                    {row.netEarningsCents < 0 ? "−" : ""}{formatWhole(Math.abs(row.netEarningsCents))}
                  </span>
                </div>
                <div
                  className="whitespace-nowrap text-right text-[12px] text-amber-700 sm:text-sm"
                  title={`Taxable (Paid − Lab Cost − Stripe Fee − Mileage Deduction): ${formatCents(row.taxableCents)}`}
                >
                  {row.taxCents > 0 ? formatWhole(row.taxCents) : "—"}
                </div>
              </div>
            ))}
            <div className="grid grid-cols-[minmax(0,1fr)_58px_62px_58px_62px_74px_74px] gap-x-1.5 items-center bg-slate-50 px-2 py-3 text-sm font-semibold text-slate-800 sm:gap-x-3 sm:px-4">
              <div className="text-[11px] sm:text-sm">All time</div>
              <div className="whitespace-nowrap text-right text-[12px] sm:text-sm">{formatWhole(allTimeEarnings.totalPaidGross)}</div>
              <div className="whitespace-nowrap text-right text-[12px] text-red-600 sm:text-sm">
                {allTimeEarnings.totalLabCost > 0 ? `−${formatWhole(allTimeEarnings.totalLabCost)}` : formatWhole(allTimeEarnings.totalLabCost)}
              </div>
              <div className="whitespace-nowrap text-right text-[12px] text-red-600 sm:text-sm">
                {allTimeEarnings.totalStripeFee > 0 ? `−${formatWhole(allTimeEarnings.totalStripeFee)}` : "—"}
              </div>
              <div className="whitespace-nowrap text-right text-[12px] text-red-600 sm:text-sm">
                {allTimeEarnings.totalMileageCents > 0 ? `−${formatWhole(allTimeEarnings.totalMileageCents)}` : "—"}
              </div>
              {/* Sums whichever set of rows (weekly or monthly) is actually
                  on screen — see allTimeEarnings' own comment for why this
                  can (correctly) shift slightly when you flip the tab. */}
              <div className="whitespace-nowrap text-right text-[12px] sm:text-sm">
                <span className={allTimeEarnings.totalPay < 0 ? "text-red-600" : "text-emerald-700"}>
                  {allTimeEarnings.totalPay < 0 ? "−" : ""}{formatWhole(Math.abs(allTimeEarnings.totalPay))}
                </span>
              </div>
              <div
                className="whitespace-nowrap text-right text-[12px] text-amber-700 sm:text-sm"
                title={`Taxable: ${formatCents(allTimeEarnings.totalTaxable)}${allTimeEarnings.totalMileageCents > 0 ? ` (mileage deduction: ${formatCents(allTimeEarnings.totalMileageCents)})` : ""}`}
              >
                {formatWhole(allTimeEarnings.totalTax)}
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
