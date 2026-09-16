"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { JobWithCustomer } from "@/lib/types";
import { formatCents, computeMarginCents, knownStripeFeeCentsForJob } from "@/lib/pricing";
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
  HISTORY_PERIOD_COUNT,
  PeriodHistoryTable,
  MarginHistoryTable,
  AllTimeLine,
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
export default function RevenueMarginSummaryView() {
  const router = useRouter();
  const [jobs, setJobs] = useState<JobWithCustomer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [summaryTab, setSummaryTab] = useState<"weekly" | "monthly">("weekly");

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

    const weekly = Array.from({ length: HISTORY_PERIOD_COUNT }, (_, i) => {
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

    const monthly = Array.from({ length: HISTORY_PERIOD_COUNT }, (_, i) => {
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
    const docs: { jobId: string; docId: string; startStr: string; endStr: string }[] = [];
    for (const job of jobs) {
      for (const doc of job.documents ?? []) {
        if (doc.kind !== "lab_invoice" || !doc.report_date_range || !doc.file_name.startsWith("weekly-lab-summary")) continue;
        const key = doc.content_hash ?? doc.storage_path;
        if (seenKeys.has(key)) continue;
        const range = parseReportDateRange(doc.report_date_range);
        if (!range) continue;
        seenKeys.add(key);
        docs.push({ jobId: job.id, docId: doc.id, ...range });
      }
    }
    const result: Record<string, string[]> = {};
    for (const week of periodHistory.weekly) {
      const hrefs = docs
        .filter((d) => d.startStr >= week.startStr && d.startStr <= week.endStr)
        .map((d) => `/api/admin/jobs/${d.jobId}/documents/${d.docId}`);
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
          <div className="mt-4 flex gap-2">
            <button
              onClick={() => setSummaryTab("weekly")}
              className={`shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium ${isWeekly ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"}`}
            >
              Weekly
            </button>
            <button
              onClick={() => setSummaryTab("monthly")}
              className={`shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium ${!isWeekly ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"}`}
            >
              Monthly
            </button>
          </div>

          <div className="mt-3">
            <PeriodHistoryTable
              title={isWeekly ? "Weekly Revenue" : "Monthly Revenue"}
              rows={isWeekly ? periodHistory.weekly : periodHistory.monthly}
              onSelectRow={goToPeriod}
            />
            <AllTimeLine label="All-Time Gross Revenue" value={formatCents(allTimeTotal.grossCents)} />
          </div>

          <div className="mt-3">
            <PeriodHistoryTable
              title={isWeekly ? "Weekly Lab Costs" : "Monthly Lab Costs"}
              rows={
                isWeekly
                  ? periodHistory.weekly.map((w) => ({
                      label: w.label,
                      grossCents: w.labCostCents + w.estimatedLabCostCents,
                      netCents: 0,
                      estimated: w.estimatedLabCostCents > 0,
                      pdfHrefs: weeklyLabInvoicePdfHrefs[w.label],
                    }))
                  : periodHistory.monthly.map((m) => ({
                      label: m.label,
                      grossCents: m.labCostCents + m.estimatedLabCostCents,
                      netCents: 0,
                      estimated: m.estimatedLabCostCents > 0,
                    }))
              }
              onSelectRow={goToPeriod}
            />
            <AllTimeLine
              label="All-Time Lab Costs"
              value={`${allTimeTotal.estimatedLabCostCents > 0 ? "≈ " : ""}${formatCents(allTimeTotal.labCostCents + allTimeTotal.estimatedLabCostCents)}`}
              italic={allTimeTotal.estimatedLabCostCents > 0}
            />
          </div>

          <div className="mt-3">
            <MarginHistoryTable
              title={isWeekly ? "Weekly Margin" : "Monthly Margin"}
              rows={
                isWeekly
                  ? periodHistory.weekly.map((w) => ({ label: w.label, marginPercent: marginPercentOf(w), estimated: w.estimatedLabCostCents > 0 }))
                  : periodHistory.monthly.map((m) => ({ label: m.label, marginPercent: marginPercentOf(m), estimated: m.estimatedLabCostCents > 0 }))
              }
              onSelectRow={goToPeriod}
            />
            <AllTimeLine label="All-Time Margin" value={allTimeMarginText} italic={isMarginEstimated} />
          </div>
        </>
      )}
    </div>
  );
}
