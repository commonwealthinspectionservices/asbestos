"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { JobWithCustomer } from "@/lib/types";
import { formatCents, knownStripeFeeCentsForJob } from "@/lib/pricing";
import { TAX_SET_ASIDE_PERCENT, MILEAGE_RATE_CENTS, effectiveJobDate } from "@/lib/mileage-shared";
import { formatDateMDY } from "@/lib/date-format";
import { FLI_ENVIRONMENTAL_COMPANY_ID } from "@/lib/report-findings";
import {
  billingDateFor,
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

// Per Tim, 2026-09-23 — first whole dollars only ("I don't have to scroll
// across"), then same day, reversed ("I want to display everything,
// including the cents"): now just formatCents, kept as its own name since
// every call site below already reads as "the compact table's own
// formatter" — same full precision as every other dollar figure in the
// app (invoices, the job list, etc.).
const formatWhole = formatCents;

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
        .filter((j) => effectiveJobDate(j) && j.source !== "subcontractor" && j.customers?.company_id !== FLI_ENVIRONMENTAL_COMPANY_ID && !j.lab_cost_cents)
        .sort((a, b) => (effectiveJobDate(b) ?? "").localeCompare(effectiveJobDate(a) ?? "")),
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
          if (isInvoiced && !effectiveJobDate(j)) {
            return { job: j, reason: "No fieldwork or requested date recorded — excluded from every week/month row on this page" };
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
      return { label, shortLabel, startStr: ymd(start), endStr: ymd(end), labCostCents: 0, paidGrossCents: 0, paidStripeFeeCents: 0 };
    }).filter((b) => b.endStr >= COMPANY_START_DATE);

    const monthly = Array.from({ length: ALL_PERIODS_COUNT }, (_, i) => {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const label = `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
      const shortLabel = `${MONTH_NAMES[d.getMonth()].slice(0, 3)} '${String(d.getFullYear()).slice(2)}`;
      return { label, shortLabel, key, labCostCents: 0, paidGrossCents: 0, paidStripeFeeCents: 0 };
    }).filter((b) => b.key >= COMPANY_START_DATE.slice(0, 7));

    for (const job of invoicedJobs) {
      const bucketDate = billingDateFor(job);
      if (!bucketDate) continue;
      // This period's own invoice total for the job — used below only for
      // the paid subset (paidGrossCents); every job in the period
      // contributes to Lab Cost regardless of paid status, per Tim's own
      // "lab costs are always charged to me no matter what".
      const grossCents = job.invoice_total_cents ?? 0;
      // Per Tim, 2026-09-23 — "I would just remove the estimate and show
      // it when the real number actually lands": labCostCents is only ever
      // the job's own real, Crystal-reported lab_cost_cents now — no more
      // avg-$/sample guess filling the gap before that lands (see
      // notYetBilled below for how that gap is surfaced instead). A job
      // with no real cost recorded yet contributes $0 here, not a guess.
      const labCostCents = job.lab_cost_cents ?? 0;
      const stripeFeeCents = knownStripeFeeCentsForJob(job) ?? 0;
      // Per Tim, 2026-09-23 — "for a given week what I billed out and what
      // I actually got paid also": paidGrossCents is the SAME job
      // population as this period's own fieldwork, just the subset that's
      // actually been paid — not a separate paid-date-bucketed population
      // (that was the old paidWeekly/paidMonthly, removed). Keeps every
      // column in a row talking about the same jobs, same "apples to
      // apples" reasoning as billingDateFor's own reversal earlier today.
      const isPaid = job.status === "paid" || Boolean(job.paid_date);

      const w = weekly.find((b) => bucketDate >= b.startStr && bucketDate <= b.endStr);
      if (w) {
        w.labCostCents += labCostCents;
        if (isPaid) { w.paidGrossCents += grossCents; w.paidStripeFeeCents += stripeFeeCents; }
      }

      const monthKey = bucketDate.slice(0, 7);
      const m = monthly.find((b) => b.key === monthKey);
      if (m) {
        m.labCostCents += labCostCents;
        if (isPaid) { m.paidGrossCents += grossCents; m.paidStripeFeeCents += stripeFeeCents; }
      }
    }

    return { weekly, monthly };
  }, [invoicedJobs]);

  // Per Tim, 2026-09-24 — "these links don't actually match the lab
  // costs... I don't trust this thing": this used to link the Lab Cost
  // number to whichever single Crystal PDF's own printed date range
  // happened to start in that calendar week — a different question from
  // "which jobs make up this number" (Lab Cost sums each job's own
  // lab_cost_cents, bucketed by that JOB's fieldwork date, not by any
  // report's date range — see the periodHistory loop above). The two
  // could legitimately disagree, and worse, tracing a truly correct
  // per-report total back out client-side turned out to be unsafe to
  // reconstruct: a resend that only bumps one job's own amount_cents
  // updates that job's document in place without touching its
  // content_hash (see the resend-handling block in
  // processWeeklyLabSummaryEmail, lib/lab-email.ts), so grouping by
  // content_hash to find "one real report" can silently split or
  // duplicate a report's total depending on exactly which jobs got
  // touched by which resend — not something worth risking on real money
  // without being able to verify it against production data. Simpler and
  // provably correct instead: the Lab Cost link now goes to the exact
  // same jobs the number is computed from (see goToPeriod below), not a
  // PDF guess — click through and every job listed there is one this
  // total actually includes, full stop.

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
  // Per Tim, 2026-09-24 — "why want the numbers to match is the point...
  // I want these numbers to be showing all the same thing": caught a real
  // internal inconsistency, not just a confusing juxtaposition. totalTax
  // used to be the SUM of each week's own already-floored tax (a
  // profitable week kicks in its own 35% with no credit for a different
  // week's loss, since each row floors independently — the right call for
  // a single row deciding what to set aside in real time, without
  // hindsight about weeks that haven't happened yet). But summed up that
  // way, "All time" could show real, positive tax owed while its own Net
  // Earnings sat deeply negative — the exact "these should agree" problem
  // Tim flagged (Sept 6-12 alone was profitable and owed $247.33; the
  // all-time total, dragged down by other weeks, was -$3,986.47). Fixed
  // by treating "All time" as one single period, same formula as any row:
  // totalPay is the true sum of every week's own Net Earnings first, and
  // totalTax/totalTaxable are computed from THAT one number, floored once
  // — not accumulated from each week's own separate floor. If the true
  // all-time total is negative, all-time tax is exactly $0, full stop.
  const allTimeEarnings = useMemo(() => {
    const source = isWeekly ? periodHistory.weekly : periodHistory.monthly;
    const miles = isWeekly ? weeklyMiles : monthlyMiles;
    let totalPaidGross = 0, totalLabCost = 0, totalStripeFee = 0, totalMileageCents = 0, totalPay = 0;
    for (const p of source) {
      const id = isWeekly ? (p as typeof periodHistory.weekly[number]).label : (p as typeof periodHistory.monthly[number]).key;
      const mileageDeductionCents = Math.round((miles[id] ?? 0) * MILEAGE_RATE_CENTS);
      const netEarningsCents = p.paidGrossCents - p.labCostCents - p.paidStripeFeeCents - mileageDeductionCents;
      totalPaidGross += p.paidGrossCents; totalLabCost += p.labCostCents; totalStripeFee += p.paidStripeFeeCents; totalMileageCents += mileageDeductionCents; totalPay += netEarningsCents;
    }
    const totalTaxable = Math.max(0, totalPay);
    const totalTax = Math.max(0, Math.round((totalTaxable * TAX_SET_ASIDE_PERCENT) / 100));
    return { totalPaidGross, totalLabCost, totalStripeFee, totalMileageCents, totalTaxable, totalTax, totalPay };
  }, [isWeekly, periodHistory, weeklyMiles, monthlyMiles]);

  // A period row navigates to Billing pre-filtered to that period, instead
  // of setting local state here — see this file's own top-of-file comment.
  //
  // Per Tim, 2026-09-24 — "instead of bringing me to all the projects from
  // that week, bring me to the paid projects it's calculating from": the
  // row's own Paid figure only ever sums the period's PAID jobs (see
  // periodHistory's own isPaid gate above), so clicking the row should
  // land on that same subset, not every invoiced job in the period —
  // paidOnly=1 tells BillingView to filter down to invoiceStatus ===
  // "paid" on top of the usual period-date filter. Lab Cost, by contrast,
  // sums every job in the period regardless of paid status (lab costs are
  // charged whether or not Commonwealth's own invoice is paid), so its own
  // click-through (see the Lab Cost cell below) passes paidOnly=false —
  // same period-date filter, no paid gate, landing on exactly the job
  // population Lab Cost is actually summed from.
  function goToPeriod(label: string, paidOnly: boolean) {
    if (isWeekly) {
      const row = periodHistory.weekly.find((w) => w.label === label);
      if (row) router.push(`/admin/billing?ptype=week&label=${encodeURIComponent(row.label)}&start=${row.startStr}&end=${row.endStr}${paidOnly ? "&paidOnly=1" : ""}`);
    } else {
      const row = periodHistory.monthly.find((m) => m.label === label);
      if (row) router.push(`/admin/billing?ptype=month&label=${encodeURIComponent(row.label)}&key=${row.key}${paidOnly ? "&paidOnly=1" : ""}`);
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
      // lab cost, so a period with lots of unpaid lab
      // work silently never reflected those costs here at all. Now a real
      // waterfall: what actually came in (paidGrossCents) minus every real
      // cost for the period (labCostCents — ALL of it, paid or not) minus
      // the paid jobs' own Stripe fee. Allowed to go negative — no floor —
      // since that's the actual, honest cash position when lab costs
      // outrun collections.
      //
      // Per Tim, 2026-09-24 — settled the mileage question with a direct,
      // explicit formula after the "is it a cost or a tax deduction"
      // back-and-forth above: "I just want 35% for taxes to be 35% of my
      // net earnings. And my net earnings are what I get paid minus lab
      // cost, stripe fee, and the mileage numeric value for dollars."
      // Net Earnings IS the pre-tax figure now (Paid − Lab Cost − Stripe
      // Fee − Mileage, allowed to go negative — same "honest cash
      // position" reasoning as Lab Cost above), and Tax is simply 35% of
      // it (floored at 0 so a loss never produces a negative tax). No
      // separate "taxable" concept anymore — it's the same number, just
      // floored for the tax step specifically.
      const netEarningsCents = p.paidGrossCents - p.labCostCents - p.paidStripeFeeCents - mileageDeductionCents;
      const taxableCents = Math.max(0, netEarningsCents);
      const taxCents = Math.max(0, Math.round((taxableCents * TAX_SET_ASIDE_PERCENT) / 100));
      return {
        id,
        label: p.label,
        shortLabel: p.shortLabel,
        labCents: p.labCostCents,
        paidGrossCents: p.paidGrossCents,
        stripeFeeCents: p.paidStripeFeeCents,
        miles,
        mileageDeductionCents,
        taxableCents,
        taxCents,
        netEarningsCents,
      };
    });
  }, [isWeekly, periodHistory, weeklyMiles, monthlyMiles]);

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
              per period, so a week reads left to right. Same click-through
              to Billing as before (see goToPeriod and the Lab Cost cell's
              own comments for how each column's click-through targets the
              exact job population that column is summed from).
              Per Tim, 2026-09-23 — went through several rounds the same
              day: "one big table that calculates everything" → "Paid and
              Net should be their own separate columns... calculate
              absolutely everything" (9 columns, horizontally scrollable)
              → "I don't have to scroll across" + "delete the other costs
              tab" → "this column [Margin] def delete it doesnt matter".
              Landed here: Other Costs is gone entirely (its own feature,
              not just this column — monthly-overhead route removed too).
              Margin and Taxable are no longer their own columns — Taxable
              folded into the "35% for Taxes" cell's title tooltip instead.
              Per Tim, 2026-09-23 (later same day) — "I want to display
              everything, including the cents": reversed the whole-dollar
              formatWhole rounding from earlier the same day, which brings
              back horizontal scroll on this table (only this table, not
              the page) — cents-precision figures across 6 dollar columns
              genuinely don't fit a phone's width no matter how tight the
              rest gets; verified in a throwaway mobile mockup that
              min-w-[700px] + overflow-x-auto on just this table's own
              wrapper renders every column cleanly, just scrollable. Paid
              and Lab Cost stayed — per Tim, "I don't think I'm trying to
              use this as my entire business overview... but I do need [it]
              pre-calculated in terms of what I need to move to my general
              checking account and what I need to move to my 35% tax
              savings account" — so "35% for Taxes" and "Net Earnings" are
              named for what he's actually doing with each figure (move it
              to that tax account vs. keep it), not generic "Tax"/"Net".
              Lab Cost/Stripe Fee render in red as plain positive numbers,
              not a signed "−" figure — per Tim, 2026-09-24, the red color
              alone already says "this is a cost," and a minus sign on top
              of it was redundant clutter on a table already tight on
              width. Mileage renders in neutral slate instead of red — per
              Tim the same day, "it's calculating mileage like it's a cost
              of mine, but that's the dollar value of the miles I drove
              that I can write off": it's a tax deduction (see the waterfall
              math above), not a cash cost, so it shouldn't carry the same
              "this is money leaving your pocket" color as the columns that
              actually are. Net Earnings keeps its own "−" since that one
              can genuinely go negative as a real bottom-line figure, not
              just a cost being subtracted. */}
          <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <div className="min-w-[700px]">
            <div className="grid grid-cols-[minmax(100px,1fr)_74px_78px_70px_70px_92px_92px] gap-x-2 border-b border-slate-200 bg-slate-50 px-3 py-2 text-[8px] font-bold uppercase text-slate-500 sm:text-xs">
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
                onClick={() => goToPeriod(row.label, true)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && goToPeriod(row.label, true)}
                className="grid cursor-pointer grid-cols-[minmax(100px,1fr)_74px_78px_70px_70px_92px_92px] gap-x-2 items-center border-b border-slate-100 px-3 py-3 text-sm last:border-b-0 hover:bg-slate-50"
              >
                <div className="text-[11px] leading-tight text-slate-700 sm:text-sm">{row.shortLabel}</div>
                <div className="whitespace-nowrap text-right text-[12px] font-medium text-emerald-700 sm:text-sm">{formatWhole(row.paidGrossCents)}</div>
                <div className="text-right text-[12px] text-red-600 sm:text-sm">
                  {/* Per Tim, 2026-09-24 — "these links don't actually
                      match the lab costs": used to link straight to a
                      "best guess" Crystal PDF, which could legitimately be
                      a different real report than what this number is
                      summed from (see this section's own top comment).
                      Now the number links to the exact same jobs it's
                      computed from instead — no guessing, every job listed
                      there is one this total actually includes. */}
                  <button
                    type="button"
                    title="See the jobs this total is calculated from"
                    onClick={(e) => {
                      e.stopPropagation();
                      goToPeriod(row.label, false);
                    }}
                    className="whitespace-nowrap underline decoration-red-300 underline-offset-2 hover:decoration-red-500"
                  >
                    {formatWhole(row.labCents)}
                  </button>
                </div>
                <div className="whitespace-nowrap text-right text-[12px] text-red-600 sm:text-sm">
                  {row.stripeFeeCents > 0 ? formatWhole(row.stripeFeeCents) : "—"}
                </div>
                <div className="whitespace-nowrap text-right text-[12px] text-slate-500 sm:text-sm">
                  {row.mileageDeductionCents > 0 ? formatWhole(row.mileageDeductionCents) : "—"}
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
            <div className="grid grid-cols-[minmax(100px,1fr)_74px_78px_70px_70px_92px_92px] gap-x-2 items-center bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-800">
              <div className="text-[11px] sm:text-sm">All time</div>
              <div className="whitespace-nowrap text-right text-[12px] text-emerald-700 sm:text-sm">{formatWhole(allTimeEarnings.totalPaidGross)}</div>
              <div className="whitespace-nowrap text-right text-[12px] text-red-600 sm:text-sm">
                {formatWhole(allTimeEarnings.totalLabCost)}
              </div>
              <div className="whitespace-nowrap text-right text-[12px] text-red-600 sm:text-sm">
                {allTimeEarnings.totalStripeFee > 0 ? formatWhole(allTimeEarnings.totalStripeFee) : "—"}
              </div>
              <div className="whitespace-nowrap text-right text-[12px] text-slate-500 sm:text-sm">
                {allTimeEarnings.totalMileageCents > 0 ? formatWhole(allTimeEarnings.totalMileageCents) : "—"}
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
