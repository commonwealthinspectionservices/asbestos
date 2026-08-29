"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { JobWithCustomer } from "@/lib/types";
import { formatCents } from "@/lib/pricing";
import { formatDateMDY } from "@/lib/date-format";

function formatDate(date: string | null | undefined): string {
  return formatDateMDY(date) ?? "—";
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// Same reasoning as InvoicesView.tsx's own localDateOnly — a full UTC
// timestamp naively sliced can land on the wrong calendar date once local
// (Eastern) time disagrees with UTC, e.g. a late-evening upload.
function localDateOnly(iso: string): string {
  return ymd(new Date(iso));
}

// Per Tim, 2026-08-28 — split out of InvoicesView.tsx into its own tab:
// lab fees (what Crystal Analytical charges us) are a completely separate
// concern from customer invoices (what we charge the customer), and were
// crowding the Invoices page. This view owns its own job fetch rather than
// sharing InvoicesView's, matching this codebase's existing convention of
// each admin view loading its own data independently.
export default function LabInvoicesView() {
  const [jobs, setJobs] = useState<JobWithCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Per Tim, 2026-08-28 — "this page should almost just be a link to a
  // bunch of weeks... once you click into the week, it opens up a
  // dropdown of all the jobs from that week": collapsed by default, one
  // toggle per report, so the top-level list is just a week and its total.
  const [expandedReportKeys, setExpandedReportKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch("/api/admin/jobs")
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error ?? "Failed to load lab invoices");
        setJobs(data.jobs);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load lab invoices"))
      .finally(() => setLoading(false));
  }, []);

  // Per Tim, 2026-08-28 — "why does it say $1,108 if only $548 was billed…
  // this is confusing": those two numbers were both real, but answered
  // different questions that looked like they should match and didn't —
  // $1,108 was the whole Friday report (which bills whatever fieldwork
  // happened to get analyzed that week, regardless of which week the
  // fieldwork itself was done in, plus some line items with no job number
  // on them at all), while $548 was only jobs whose fieldwork fell in the
  // current calendar week. Fix: stop computing a second, separately-scoped
  // total that can diverge from the report's own number. Every dollar
  // shown now traces back to one place — the report card it came from —
  // instead of being re-summed under a different label.
  //
  // "I just really want to go off those weekly reports... it should be the
  // main outline": one row per REAL weekly summary email Crystal/
  // QuickBooks actually sent (grouped by content_hash — every lab_invoice
  // document that email produced, across every job it covered, shares the
  // same hash, since they're all unmodified copies of the same downloaded
  // PDF), showing that report's own printed date range and grand total
  // (report_date_range/report_total_cents — see their own comments on
  // JobDocument) plus exactly which jobs it covers and each one's own
  // share — so if the total doesn't equal the sum of the jobs listed
  // (some line items never named a project number Crystal's own end could
  // match to a job), that gap is shown right there, not left to look like
  // an error.
  const weeklyReports = useMemo(() => {
    const groups = new Map<
      string,
      { dateRange: string | null; totalCents: number | null; receivedAt: string; jobAmounts: Map<string, number>; seenNumsByJob: Map<string, Set<string>> }
    >();
    for (const job of jobs) {
      for (const doc of job.documents ?? []) {
        if (doc.kind !== "lab_invoice" || doc.report_total_cents == null) continue;
        // Grouped by the report's own printed billing period, not
        // content_hash — a job whose transaction was already recorded by
        // an earlier, different pipeline (see processWeeklyLabSummaryEmail's
        // own comment in lib/lab-email.ts) keeps ITS OWN document's real
        // content_hash pointing at whichever PDF actually produced it,
        // even after this report's own total/date-range get backfilled
        // onto it — forcing this report's hash onto that document would
        // misattribute which file it actually is. report_date_range is
        // reliably set on every document tied to this report, backfilled
        // or not, so it's the key that actually unifies them.
        const key = doc.report_date_range ?? doc.content_hash ?? "unknown";
        let g = groups.get(key);
        if (!g) {
          g = { dateRange: doc.report_date_range ?? null, totalCents: doc.report_total_cents, receivedAt: doc.uploaded_at, jobAmounts: new Map(), seenNumsByJob: new Map() };
          groups.set(key, g);
        }
        // Max, not min — a backfilled document (see above) can carry a
        // much OLDER uploaded_at from whichever earlier pipeline actually
        // created it, which would otherwise make "Received" read as days
        // before this report actually arrived. Every document genuinely
        // NEW to this report gets uploaded within the same single run, so
        // their timestamps already agree with each other regardless.
        if (doc.uploaded_at > g.receivedAt) g.receivedAt = doc.uploaded_at;

        // Dedupe the per-service-type-label copies of the same
        // transaction (a mixed asbestos+mold job gets one document row per
        // label, all sharing the same lab_invoice_number) so a job with
        // two labels on the same transaction isn't double-counted.
        const numKey = doc.lab_invoice_number ?? doc.id;
        if (!g.seenNumsByJob.has(job.id)) g.seenNumsByJob.set(job.id, new Set());
        const seenNums = g.seenNumsByJob.get(job.id)!;
        if (seenNums.has(numKey)) continue;
        seenNums.add(numKey);

        g.jobAmounts.set(job.id, (g.jobAmounts.get(job.id) ?? 0) + (doc.amount_cents ?? 0));
      }
    }
    return Array.from(groups.entries())
      .map(([key, g]) => {
        const jobEntries = Array.from(g.jobAmounts.entries())
          .map(([jobId, amountCents]) => ({ job: jobs.find((j) => j.id === jobId)!, amountCents }))
          .sort((a, b) => (a.job.project_number ?? "").localeCompare(b.job.project_number ?? ""));
        const linkedCents = jobEntries.reduce((sum, e) => sum + e.amountCents, 0);
        const unlinkedCents = g.totalCents != null ? g.totalCents - linkedCents : null;
        return { key, dateRange: g.dateRange, totalCents: g.totalCents, receivedAt: g.receivedAt, jobEntries, unlinkedCents };
      })
      .sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1));
  }, [jobs]);

  // Per Tim, 2026-08-28 — "some jobs haven't been billed yet, I need to
  // keep track of this": every job with fieldwork already done
  // (confirmed_date up through today) that has no lab_invoice document at
  // all yet, regardless of which calendar week that fieldwork fell in —
  // not scoped to "this week" (that scoping is exactly what produced the
  // confusing second total above). Most recent fieldwork first, since
  // that's the most likely to still be genuinely outstanding rather than
  // just old and forgotten. Per Tim, 2026-08-29 — no dollar estimate here
  // anymore ("I don't know if we really need to do this whole estimated
  // thing anywhere at all") — it was already showing misleading $0.00 for
  // a job with no samples logged yet, and now that Weekly Reports brings
  // in the real number within days, a guess wasn't buying much. Just the
  // job itself; the real amount shows up under Weekly Reports once it's
  // actually billed.
  const notYetBilledJobs = useMemo(() => {
    const todayStr = ymd(new Date());
    return jobs
      .filter((j) => j.confirmed_date && j.confirmed_date <= todayStr)
      .filter((j) => !(j.documents ?? []).some((d) => d.kind === "lab_invoice"))
      .sort((a, b) => (b.confirmed_date ?? "").localeCompare(a.confirmed_date ?? ""));
  }, [jobs]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="text-lg font-semibold text-slate-800">Lab Invoices</h1>

      {loading && <p className="mt-4 text-sm text-slate-500">Loading…</p>}
      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {!loading && !error && (
        <>
          {/* Per Tim, 2026-08-28 — "this page should almost just be a link
              to a bunch of weeks... once you click into the week, it opens
              up a dropdown of all the jobs from that week": collapsed by
              default — just the date range and the report's own real
              total — expanding on click to reveal exactly which jobs it
              covers and each one's own share, so the total is still
              traceable, just not shown until asked for. */}
          <div className="mt-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Weekly Reports</div>
            {weeklyReports.length === 0 ? (
              <p className="mt-2 rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-500">No weekly reports received yet.</p>
            ) : (
              <div className="mt-2 flex flex-col gap-2">
                {weeklyReports.map((r) => {
                  const expanded = expandedReportKeys.has(r.key);
                  return (
                    <div key={r.key} className="rounded-lg border border-slate-200 bg-white text-sm">
                      <button
                        onClick={() =>
                          setExpandedReportKeys((prev) => {
                            const next = new Set(prev);
                            if (next.has(r.key)) next.delete(r.key);
                            else next.add(r.key);
                            return next;
                          })
                        }
                        className="flex w-full flex-wrap items-baseline justify-between gap-x-4 p-3 text-left"
                      >
                        <span className="text-xs font-medium text-brand-600">
                          <span className="mr-1 inline-block w-3 text-slate-400">{expanded ? "▾" : "▸"}</span>
                          {r.dateRange ?? formatDate(localDateOnly(r.receivedAt))}
                        </span>
                        <span className="text-xs font-semibold text-slate-800">{r.totalCents != null ? formatCents(r.totalCents) : "—"}</span>
                      </button>
                      {expanded && (
                        <div className="flex flex-col gap-1.5 border-t border-slate-100 p-3 pt-2">
                          {r.jobEntries.map((e) => (
                            <div key={e.job.id} className="flex items-baseline justify-between gap-2">
                              <Link href={`/admin/dashboard?jobId=${e.job.id}`} className="font-mono text-xs text-brand-600 hover:underline">
                                {e.job.project_number}
                              </Link>
                              <span className="whitespace-nowrap text-xs font-semibold text-slate-800">{formatCents(e.amountCents)}</span>
                            </div>
                          ))}
                          {/* Per Tim, 2026-08-28 — "why does it say $1,108 if
                              only $548 was billed" — this is exactly that
                              gap, shown in place instead of left to look
                              like an error: some line items on the real
                              report never named a project number Crystal's
                              own end could match to a job. */}
                          {r.unlinkedCents != null && r.unlinkedCents !== 0 && (
                            <div className="text-xs text-slate-400">+ {formatCents(r.unlinkedCents)} not linked to a job on file</div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Per Tim, 2026-08-28 — "some jobs haven't been billed yet, I
              need to keep track of this": every job with fieldwork done
              that hasn't shown up in any report yet, most recent first. */}
          <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3 text-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Not Yet Billed</div>
            {notYetBilledJobs.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">Everything's been billed.</p>
            ) : (
              <div className="mt-2 flex flex-col gap-1.5">
                {notYetBilledJobs.map((job) => (
                  <Link key={job.id} href={`/admin/dashboard?jobId=${job.id}`} className="font-mono text-xs text-brand-600 hover:underline">
                    {job.project_number}
                  </Link>
                ))}
              </div>
            )}
          </div>

        </>
      )}
    </div>
  );
}
