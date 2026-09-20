"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { JobWithCustomer } from "@/lib/types";
import { formatCents, computeMarginCents, knownStripeFeeCentsForJob } from "@/lib/pricing";
import { MILEAGE_RATE_CENTS, TAX_SET_ASIDE_PERCENT } from "@/lib/mileage-shared";
import {
  totalSampleCount,
  estimatedLabCostCentsForJob,
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
  const [monthlyMiles, setMonthlyMiles] = useState<Record<string, number> | null>(null);
  const [expandedPdfWeeks, setExpandedPdfWeeks] = useState<Set<string>>(new Set());

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
    fetch("/api/admin/mileage?summary=1")
      .then(async (r) => (r.ok ? setMonthlyMiles((await r.json()).monthlyMiles) : null))
      .catch(() => {});
  }, []);

  // Per Tim, 2026-08-28 — this summary is only for invoices that have
  // actually gone out (or been paid), not ones merely ready to send —
  // same predicate as BillingView's own invoicedJobs.
  const invoicedJobs = useMemo(
    () => jobs.filter((j) => j.source !== "subcontractor" && j.invoice_total_cents != null && (j.invoice_sent_at || j.paid_date)),
    [jobs]
  );

  // Per Tim, 2026-09-04 — "estimate a lab cost based off of the number of
  // samples I entered on the invoice": the average $/sample across every
  // job that DOES have a real lab invoice in, applied to jobs that don't
  // yet — same formula as BillingView's own copy (there, feeding each job
  // card's own MoneyGrid estimate too, so kept as a real function import
  // rather than shared state neither page actually has here).
  const avgLabCostPerSampleCents = useMemo(() => {
    let totalCents = 0;
    let totalSamples = 0;
    for (const job of invoicedJobs) {
      if (job.lab_cost_cents == null || job.lab_cost_cents <= 0) continue;
      const samples = totalSampleCount(job);
      if (samples <= 0) continue;
      totalCents += job.lab_cost_cents;
      totalSamples += samples;
    }
    return totalSamples > 0 ? totalCents / totalSamples : 0;
  }, [invoicedJobs]);

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
      return { label, startStr: ymd(start), endStr: ymd(end), grossCents: 0, netCents: 0, labCostCents: 0, estimatedLabCostCents: 0 };
    }).filter((b) => b.endStr >= COMPANY_START_DATE);

    const monthly = Array.from({ length: ALL_PERIODS_COUNT }, (_, i) => {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const label = `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
      return { label, key, grossCents: 0, netCents: 0, labCostCents: 0, estimatedLabCostCents: 0 };
    }).filter((b) => b.key >= COMPANY_START_DATE.slice(0, 7));

    for (const job of invoicedJobs) {
      const bucketDate = billingDateFor(job);
      if (!bucketDate) continue;
      const grossCents = job.invoice_total_cents ?? 0;
      const labCostCents = job.lab_cost_cents ?? 0;
      const estimatedCents = estimatedLabCostCentsForJob(job, avgLabCostPerSampleCents);
      const netCents = computeMarginCents(grossCents, labCostCents + estimatedCents, knownStripeFeeCentsForJob(job) ?? 0);

      const w = weekly.find((b) => bucketDate >= b.startStr && bucketDate <= b.endStr);
      if (w) {
        w.grossCents += grossCents;
        w.netCents += netCents;
        w.labCostCents += labCostCents;
        w.estimatedLabCostCents += estimatedCents;
      }

      const monthKey = bucketDate.slice(0, 7);
      const m = monthly.find((b) => b.key === monthKey);
      if (m) {
        m.grossCents += grossCents;
        m.netCents += netCents;
        m.labCostCents += labCostCents;
        m.estimatedLabCostCents += estimatedCents;
      }
    }

    return { weekly, monthly };
  }, [invoicedJobs, avgLabCostPerSampleCents]);

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
    let estimatedLabCostCents = 0;
    let stripeFeeCents = 0;
    for (const job of invoicedJobs) {
      grossCents += job.invoice_total_cents ?? 0;
      labCostCents += job.lab_cost_cents ?? 0;
      stripeFeeCents += knownStripeFeeCentsForJob(job) ?? 0;
      estimatedLabCostCents += estimatedLabCostCentsForJob(job, avgLabCostPerSampleCents);
    }
    return { grossCents, labCostCents, estimatedLabCostCents, stripeFeeCents };
  }, [invoicedJobs, avgLabCostPerSampleCents]);

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

  // Net profit (invoice − lab cost − Stripe fee) of PAID jobs, by the month
  // they were paid — what has actually landed, unlike the invoiced-date
  // tables above.
  const paidMonthly = useMemo(() => {
    const byMonth: Record<string, number> = {};
    for (const job of invoicedJobs) {
      if (job.status !== "paid" && !job.paid_date) continue;
      const date = job.paid_date ?? billingDateFor(job);
      if (!date) continue;
      const labCents = (job.lab_cost_cents ?? 0) + estimatedLabCostCentsForJob(job, avgLabCostPerSampleCents);
      const net = computeMarginCents(job.invoice_total_cents ?? 0, labCents, knownStripeFeeCentsForJob(job) ?? 0);
      const key = date.slice(0, 7);
      byMonth[key] = (byMonth[key] ?? 0) + net;
    }
    return byMonth;
  }, [invoicedJobs, avgLabCostPerSampleCents]);

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

  const summaryRows = useMemo(() => {
    const source = isWeekly ? periodHistory.weekly : periodHistory.monthly;
    return source.map((p) => ({
      label: p.label,
      grossCents: p.grossCents,
      labCents: p.labCostCents + p.estimatedLabCostCents,
      estimated: p.estimatedLabCostCents > 0,
      marginPercent: marginPercentOf(p),
      pdfHrefs: isWeekly ? weeklyLabInvoicePdfHrefs[p.label] : undefined,
    }));
  }, [isWeekly, periodHistory, weeklyLabInvoicePdfHrefs]);

  const allTimeMarginPercent = allTimeTotal.grossCents > 0
    ? ((allTimeTotal.grossCents - allTimeTotal.labCostCents - allTimeTotal.estimatedLabCostCents - allTimeTotal.stripeFeeCents) / allTimeTotal.grossCents) * 100
    : null;
  const isMarginEstimated = allTimeTotal.estimatedLabCostCents > 0;
  const allTimeMarginText = allTimeMarginPercent != null ? `${isMarginEstimated ? "≈ " : ""}${allTimeMarginPercent.toFixed(1)}%` : "—";

  return (
    <div>
      {/* Per Tim, 2026-09-16 — "when I go into any of those tabs, they
          should all have a back arrow to get me back to the last window". */}
      <Link href="/admin/billing" className="mb-2 inline-flex items-center gap-1 text-sm text-brand-600 hover:text-brand-700">
        ← Billing
      </Link>
      <h1 className="text-lg font-bold text-slate-800">Revenue &amp; Margin Summary</h1>

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
              narrow enough for a phone. */}
          <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="grid grid-cols-[minmax(0,1fr)_76px_92px_50px] gap-x-2 sm:grid-cols-[minmax(0,1fr)_130px_150px_100px] sm:gap-x-4 border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold uppercase tracking-wide text-slate-500 sm:px-4">
              <div>{isWeekly ? "Week" : "Month"}</div>
              <div className="whitespace-nowrap text-right">Revenue</div>
              <div className="whitespace-nowrap text-right">Lab cost</div>
              <div className="whitespace-nowrap text-right">Margin</div>
            </div>
            {summaryRows.map((row) => (
              <div
                key={row.label}
                onClick={() => goToPeriod(row.label)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && goToPeriod(row.label)}
                className="grid cursor-pointer grid-cols-[minmax(0,1fr)_76px_92px_50px] gap-x-2 sm:grid-cols-[minmax(0,1fr)_130px_150px_100px] sm:gap-x-4 items-start border-b border-slate-100 px-3 py-3 text-sm hover:bg-slate-50 sm:px-4"
              >
                <div className="text-slate-700">
                  {row.label}
                </div>
                <div className="whitespace-nowrap text-right text-[13px] font-medium text-slate-800 sm:text-sm">{formatCents(row.grossCents)}</div>
                <div className={`text-right text-[13px] text-slate-700 sm:text-sm ${row.estimated ? "italic" : ""}`}>
                  {row.pdfHrefs && row.pdfHrefs.length > 0 ? (
                    <>
                      {/* The Crystal report is where this number comes from,
                          so the number itself is the link (newest summary —
                          each is a running total that includes the earlier
                          ones); older snapshots sit behind the small arrow. */}
                      <a
                        href={row.pdfHrefs[0].href}
                        target="_blank"
                        rel="noreferrer"
                        title="Open this week's Crystal report"
                        onClick={(e) => e.stopPropagation()}
                        className="whitespace-nowrap underline decoration-slate-300 underline-offset-2 hover:decoration-slate-500"
                      >
                        {row.estimated ? "≈ " : ""}{formatCents(row.labCents)}
                      </a>
                      {row.pdfHrefs.length > 1 && (
                        <button
                          type="button"
                          title="Earlier versions of this week's report"
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpandedPdfWeeks((prev) => {
                              const next = new Set(prev);
                              if (next.has(row.label)) next.delete(row.label);
                              else next.add(row.label);
                              return next;
                            });
                          }}
                          className="ml-1 text-xs text-slate-400 hover:text-slate-600"
                        >
                          {expandedPdfWeeks.has(row.label) ? "▴" : "▾"}
                        </button>
                      )}
                      {expandedPdfWeeks.has(row.label) && (
                        <div className="mt-1 flex flex-col items-end gap-0.5 text-xs text-slate-500">
                          {row.pdfHrefs.slice(1).map((p) => (
                            <a
                              key={p.href}
                              href={p.href}
                              target="_blank"
                              rel="noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="underline"
                            >
                              {new Date(p.uploadedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                            </a>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <span className="whitespace-nowrap">{row.estimated ? "≈ " : ""}{formatCents(row.labCents)}</span>
                  )}
                </div>
                <div className={`whitespace-nowrap text-right text-[13px] text-slate-700 sm:text-sm ${row.estimated ? "italic" : ""}`}>
                  {row.marginPercent != null ? `${row.marginPercent.toFixed(1)}%` : "—"}
                </div>
              </div>
            ))}
            <div className="grid grid-cols-[minmax(0,1fr)_76px_92px_50px] gap-x-2 sm:grid-cols-[minmax(0,1fr)_130px_150px_100px] sm:gap-x-4 items-start bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-800 sm:px-4">
              <div>All time</div>
              <div className="whitespace-nowrap text-right text-[13px] sm:text-sm">{formatCents(allTimeTotal.grossCents)}</div>
              <div className={`whitespace-nowrap text-right text-[13px] sm:text-sm ${allTimeTotal.estimatedLabCostCents > 0 ? "italic" : ""}`}>
                {allTimeTotal.estimatedLabCostCents > 0 ? "≈ " : ""}{formatCents(allTimeTotal.labCostCents + allTimeTotal.estimatedLabCostCents)}
              </div>
              <div className={`whitespace-nowrap text-right text-[13px] sm:text-sm ${isMarginEstimated ? "italic" : ""}`}>{allTimeMarginText.replace("≈ ", "")}</div>
            </div>
          </div>

          {/* Per Tim, 2026-09-20 — "one spot that shows me my monthly net
              earnings after all this stuff": only jobs that have actually
              been PAID count (money in hand, bucketed by the month it was
              paid), net of lab cost and Stripe fee, minus mileage at the
              IRS rate; the tax set-aside is taken on what's left after
              mileage, and the rest is that month's take-home. */}
          <h2 className="mt-8 text-lg font-bold text-slate-800">Monthly earnings</h2>
          <p className="mt-1 text-sm text-slate-500">
            Paid jobs only, after lab costs and Stripe fees, minus mileage, minus {TAX_SET_ASIDE_PERCENT}% for taxes.
          </p>
          <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="grid grid-cols-[48px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-x-2 border-b border-slate-200 bg-slate-50 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-slate-500 sm:grid-cols-[120px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] sm:px-4 sm:text-xs">
              <div>Month</div>
              <div className="text-right">Profit</div>
              <div className="text-right">Mileage</div>
              <div className="text-right">Tax</div>
              <div className="text-right">Take-home</div>
            </div>
            {(() => {
              let totalNet = 0, totalMileage = 0, totalTax = 0, totalPay = 0;
              const rows = periodHistory.monthly.map((m) => {
                const netCents = paidMonthly[m.key] ?? 0;
                const miles = monthlyMiles ? monthlyMiles[m.key] ?? 0 : null;
                const mileageCents = miles != null ? Math.round(miles * MILEAGE_RATE_CENTS) : 0;
                const afterMileage = netCents - mileageCents;
                const taxCents = Math.max(0, Math.round((afterMileage * TAX_SET_ASIDE_PERCENT) / 100));
                const payCents = afterMileage - taxCents;
                totalNet += netCents; totalMileage += mileageCents; totalTax += taxCents; totalPay += payCents;
                return { key: m.key, label: m.label, netCents, miles, mileageCents, taxCents, payCents };
              });
              const cell = "whitespace-nowrap text-right text-[12px] sm:text-sm";
              return (
                <>
                  {rows.map((r) => (
                    <div key={r.key} className="grid grid-cols-[48px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] items-start gap-x-2 border-b border-slate-100 px-3 py-3 text-sm sm:grid-cols-[120px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] sm:px-4">
                      <div className="text-slate-700">
                        <span className="sm:hidden">{r.label.slice(0, 3)}</span>
                        <span className="hidden sm:inline">{r.label}</span>
                      </div>
                      <div className={`${cell} text-slate-800`}>{formatCents(r.netCents)}</div>
                      <div className={`${cell} text-slate-600`}>{r.miles != null ? `−${formatCents(r.mileageCents)}` : "—"}</div>
                      <div className={`${cell} text-slate-600`}>−{formatCents(r.taxCents)}</div>
                      <div className={`${cell} font-bold ${r.payCents < 0 ? "text-red-600" : "text-emerald-700"}`}>{r.payCents < 0 ? "−" : ""}{formatCents(Math.abs(r.payCents))}</div>
                    </div>
                  ))}
                  <div className="grid grid-cols-[48px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] items-start gap-x-2 bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-800 sm:grid-cols-[120px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] sm:px-4">
                    <div>All</div>
                    <div className={cell}>{formatCents(totalNet)}</div>
                    <div className={cell}>−{formatCents(totalMileage)}</div>
                    <div className={cell}>−{formatCents(totalTax)}</div>
                    <div className={`${cell} ${totalPay < 0 ? "text-red-600" : "text-emerald-700"}`}>{totalPay < 0 ? "−" : ""}{formatCents(Math.abs(totalPay))}</div>
                  </div>
                </>
              );
            })()}
          </div>
        </>
      )}
    </div>
  );
}
