"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { JobWithCustomer } from "@/lib/types";
import { formatCents } from "@/lib/pricing";
import { formatDateMDY } from "@/lib/date-format";
import { expandAddress } from "@/lib/address";

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
        if (!r.ok) throw new Error(data.error ?? "Failed to load lab costs");
        setJobs(data.jobs);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load lab costs"))
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
      {
        dateRange: string | null;
        totalCents: number | null;
        receivedAt: string;
        jobAmounts: Map<string, number>;
        seenNumsByJob: Map<string, Set<string>>;
        pdfLink: { jobId: string; docId: string } | null;
        jobDocId: Map<string, string>;
        jobDocFallbackId: Map<string, string>;
      }
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
          g = { dateRange: doc.report_date_range ?? null, totalCents: doc.report_total_cents, receivedAt: doc.uploaded_at, jobAmounts: new Map(), seenNumsByJob: new Map(), pdfLink: null, jobDocId: new Map(), jobDocFallbackId: new Map() };
          groups.set(key, g);
        }
        // Per Tim, 2026-08-29 — "shouldn't each week have a link to the PDF
        // for that week?": only a document whose file_name actually starts
        // with "weekly-lab-summary" is a real copy of THIS report's own
        // PDF (see processWeeklyLabSummaryEmail in lib/lab-email.ts) — a
        // backfilled document (see the comment above) keeps its own older
        // per-invoice PDF's file_name and storage_path untouched, so
        // linking to one of those would open the wrong document entirely.
        if (!g.pdfLink && doc.file_name.startsWith("weekly-lab-summary")) {
          g.pdfLink = { jobId: job.id, docId: doc.id };
        }
        // Per Tim, 2026-08-30 — "clicking anywhere else should just open
        // up the lab invoice": each job's OWN copy of this report's PDF
        // (every job gets one uploaded to its own storage path — see
        // processWeeklyLabSummaryEmail), same weekly-lab-summary
        // preference as the report-level pdfLink above; jobDocFallbackId
        // covers the rare job whose only document here is a backfilled
        // one, so the click still opens something rather than nothing.
        if (!g.jobDocId.has(job.id) && doc.file_name.startsWith("weekly-lab-summary")) {
          g.jobDocId.set(job.id, doc.id);
        }
        if (!g.jobDocFallbackId.has(job.id)) {
          g.jobDocFallbackId.set(job.id, doc.id);
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
          .map(([jobId, amountCents]) => ({
            job: jobs.find((j) => j.id === jobId)!,
            amountCents,
            docId: g.jobDocId.get(jobId) ?? g.jobDocFallbackId.get(jobId) ?? null,
          }))
          .sort((a, b) => (a.job.project_number ?? "").localeCompare(b.job.project_number ?? ""));
        const linkedCents = jobEntries.reduce((sum, e) => sum + e.amountCents, 0);
        const unlinkedCents = g.totalCents != null ? g.totalCents - linkedCents : null;
        return { key, dateRange: g.dateRange, totalCents: g.totalCents, receivedAt: g.receivedAt, jobEntries, unlinkedCents, pdfLink: g.pdfLink };
      })
      .sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1));
  }, [jobs]);

  // Per Tim, 2026-08-30 — "lab costs and margins should have these
  // headers", pointing at Invoices' own Pending Payment/Overdue summary
  // box. This week is just weeklyReports[0] (already sorted most-recent
  // first); Total sums every real report on file.
  const summary = useMemo(() => {
    const thisWeekCents = weeklyReports[0]?.totalCents ?? null;
    const totalCents = weeklyReports.reduce((sum, r) => sum + (r.totalCents ?? 0), 0);
    return { thisWeekCents, totalCents };
  }, [weeklyReports]);

  // Per Tim, 2026-08-30 — "the current week should always open by
  // default": same one-time auto-expand pattern as Margins' own "always
  // open the current year" — fires once, the first time weeklyReports
  // actually has data; the ref guard means a later manual collapse
  // sticks instead of getting silently re-expanded on every refetch.
  // weeklyReports[0] is "this week" by the same definition the summary
  // box above already uses (most recent report, sorted first).
  const hasAutoExpandedThisWeek = useRef(false);
  useEffect(() => {
    if (hasAutoExpandedThisWeek.current || weeklyReports.length === 0) return;
    setExpandedReportKeys((prev) => new Set(prev).add(weeklyReports[0].key));
    hasAutoExpandedThisWeek.current = true;
  }, [weeklyReports]);

  // Per Tim, 2026-08-30 — "every single job should go on this page
  // regardless of whether or not we have a lab invoice so that we can
  // keep track of which ones we have and which ones we don't": every job
  // with fieldwork already done (confirmed_date up through today) that
  // has no lab_invoice document at all yet — same fieldwork-done scoping
  // as the rest of this app's "is this job actually billable yet" checks,
  // not every job regardless of status (a job still To Be Scheduled has
  // no fieldwork to have billed in the first place).
  const jobsWithoutLabInvoice = useMemo(() => {
    const todayStr = ymd(new Date());
    return jobs
      .filter((j) => j.confirmed_date && j.confirmed_date <= todayStr)
      .filter((j) => !(j.documents ?? []).some((d) => d.kind === "lab_invoice"))
      .sort((a, b) => (b.confirmed_date ?? "").localeCompare(a.confirmed_date ?? ""));
  }, [jobs]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="text-lg font-semibold text-slate-800">Lab Costs</h1>

      {loading && <p className="mt-4 text-sm text-slate-500">Loading…</p>}
      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {!loading && !error && (
        <>
          <div className="mt-3 flex flex-wrap gap-4 rounded-lg border border-slate-200 bg-white p-3 text-sm">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">This Week</div>
              <div className="text-base font-semibold text-slate-800">
                {summary.thisWeekCents != null ? formatCents(summary.thisWeekCents) : "—"}
              </div>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Total</div>
              <div className="text-base font-semibold text-slate-800">{formatCents(summary.totalCents)}</div>
            </div>
          </div>

          {/* Per Tim, 2026-08-28 — "this page should almost just be a link
              to a bunch of weeks... once you click into the week, it opens
              up a dropdown of all the jobs from that week": collapsed by
              default — just the date range and the report's own real
              total — expanding on click to reveal exactly which jobs it
              covers and each one's own share, so the total is still
              traceable, just not shown until asked for. */}
          <div className="mt-3">
            {weeklyReports.length === 0 ? (
              <p className="rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-500">No weekly reports received yet.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {weeklyReports.map((r) => {
                  const expanded = expandedReportKeys.has(r.key);
                  return (
                    <div key={r.key} className="rounded-lg border border-slate-200 bg-white text-sm">
                      <div className="flex w-full flex-wrap items-baseline justify-between gap-x-4 p-3">
                        <div className="flex items-baseline gap-2">
                          <button
                            onClick={() =>
                              setExpandedReportKeys((prev) => {
                                const next = new Set(prev);
                                if (next.has(r.key)) next.delete(r.key);
                                else next.add(r.key);
                                return next;
                              })
                            }
                            className="text-left text-sm font-medium text-brand-600"
                          >
                            <span className="mr-1 inline-block w-3 text-slate-400">{expanded ? "▾" : "▸"}</span>
                            {r.dateRange ?? formatDate(localDateOnly(r.receivedAt))}
                          </button>
                          {/* Per Tim, 2026-08-29 — "shouldn't each week have
                              a link to the PDF for that week?" (moved to sit
                              directly next to the date, per his follow-up)
                              — the real weekly report PDF itself, same ↗
                              link convention this app already uses for other
                              document links. */}
                          {r.pdfLink && (
                            <a
                              href={`/api/admin/jobs/${r.pdfLink.jobId}/documents/${r.pdfLink.docId}`}
                              target="_blank"
                              rel="noreferrer"
                              className="whitespace-nowrap text-sm text-slate-400 hover:text-brand-600 hover:underline"
                            >
                              PDF ↗
                            </a>
                          )}
                        </div>
                        <span className="whitespace-nowrap text-sm font-semibold text-slate-800">
                          Total {r.totalCents != null ? formatCents(r.totalCents) : "—"}
                        </span>
                      </div>
                      {expanded && (
                        <div className="border-t border-slate-100 p-3 pt-2">
                          {/* Per Tim, 2026-08-30 — "I want lab costs to be
                              this format too job by job", pointing at
                              Invoices' own per-job card row: project #
                              badge + company name on the left, amount on
                              the right, one full-width card per job instead
                              of the tight auto-fill grid this used to be. */}
                          <div className="flex flex-col gap-2">
                            {/* Per Tim, 2026-08-30 — "clicking the project
                                number should open the project info tab, and
                                clicking anywhere else should just open up
                                the lab invoice... I want to be able to
                                easily access the lab invoice": split into
                                two clickable regions instead of one link
                                covering the whole card — the badge on its
                                own goes to the job, everything else opens
                                that job's own copy of this report's PDF
                                directly (see jobDocId/jobDocFallbackId
                                above), falling back to the job page only if
                                this job genuinely has no document on file
                                for this report. */}
                            {r.jobEntries.map((e) => (
                              <div key={e.job.id} className="flex items-stretch gap-0 rounded-lg border border-slate-200 bg-white hover:border-brand-400">
                                <Link
                                  href={`/admin/dashboard?jobId=${e.job.id}`}
                                  title="Open project info"
                                  className="flex shrink-0 items-center rounded-l-lg py-3 pl-3 pr-2 hover:bg-slate-50"
                                >
                                  <span className="whitespace-nowrap rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-600">
                                    {e.job.project_number}
                                  </span>
                                </Link>
                                <a
                                  href={e.docId ? `/api/admin/jobs/${e.job.id}/documents/${e.docId}` : `/admin/dashboard?jobId=${e.job.id}`}
                                  target={e.docId ? "_blank" : undefined}
                                  rel={e.docId ? "noreferrer" : undefined}
                                  title={e.docId ? "Open lab invoice PDF" : "Open project info"}
                                  className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-r-lg py-3 pr-3"
                                >
                                  <div className="min-w-0">
                                    {/* Per Tim, 2026-08-30 — a <span> here
                                        truncated unreliably once splitting
                                        this row into two clickable regions
                                        narrowed its available width — span
                                        is inline by default, so overflow:
                                        hidden doesn't constrain it to the
                                        parent's width the way it does for
                                        the address <div> right below. */}
                                    <div className="truncate text-sm font-medium text-slate-800">
                                      {e.job.customers?.company || e.job.customers?.name}
                                    </div>
                                    {/* Per Tim, 2026-08-30 — "i need address on
                                        these": the job site address, same
                                        expandAddress abbreviation-expansion
                                        every other address in the app uses. */}
                                    {e.job.service_address && (
                                      <div className="mt-0.5 truncate text-xs text-slate-500">{expandAddress(e.job.service_address)}</div>
                                    )}
                                  </div>
                                  <span className="shrink-0 whitespace-nowrap text-sm font-semibold text-slate-800">{formatCents(e.amountCents)}</span>
                                </a>
                              </div>
                            ))}
                          </div>
                          {/* Per Tim, 2026-08-28 — "why does it say $1,108 if
                              only $548 was billed" — this is exactly that
                              gap, shown in place instead of left to look
                              like an error: some line items on the real
                              report never named a project number Crystal's
                              own end could match to a job. */}
                          {r.unlinkedCents != null && r.unlinkedCents !== 0 && (
                            <div className="mt-2 text-xs text-slate-400">+ {formatCents(r.unlinkedCents)} not linked to a job on file</div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Per Tim, 2026-08-30 — "every single job should go on this
              page regardless of whether or not we have a lab invoice so
              that we can keep track of which ones we have and which ones
              we don't." Same card format as Weekly Reports' own job rows,
              minus the amount/PDF (there's nothing to open yet) — the
              whole card just goes to the job's Project Info tab. No
              section title (per Tim's follow-up) — stays at the bottom,
              below every real Weekly Report. */}
          <div className="mt-3">
            {jobsWithoutLabInvoice.length === 0 ? (
              <p className="rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-500">Everything's been billed.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {jobsWithoutLabInvoice.map((job) => (
                  <Link
                    key={job.id}
                    href={`/admin/dashboard?jobId=${job.id}`}
                    className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3 hover:border-brand-400"
                  >
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="shrink-0 whitespace-nowrap rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-600">
                          {job.project_number}
                        </span>
                        <span className="block min-w-0 truncate text-sm font-medium text-slate-800">
                          {job.customers?.company || job.customers?.name}
                        </span>
                      </div>
                      {job.service_address && (
                        <div className="mt-0.5 truncate text-xs text-slate-500">{expandAddress(job.service_address)}</div>
                      )}
                    </div>
                    <span className="shrink-0 whitespace-nowrap text-xs text-slate-400">No lab invoice yet</span>
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
