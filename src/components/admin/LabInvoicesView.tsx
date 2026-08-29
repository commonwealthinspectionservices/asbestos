"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { JobDocument, JobWithCustomer } from "@/lib/types";
import { formatCents } from "@/lib/pricing";
import { formatDateMDY } from "@/lib/date-format";
import { estimatedLabCostCents } from "@/lib/lab-rate-estimate";

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

// Monday–Friday range containing dateStr, computed from explicit Y/M/D
// components (not `new Date(dateStr)`, which parses as UTC midnight and can
// shift a day in local time) so a date near midnight lands in the correct
// week regardless of this browser's timezone.
function mondayFridayOfWeek(dateStr: string): { weekStartStr: string; weekEndStr: string } {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const daysSinceMonday = (date.getDay() + 6) % 7;
  const monday = new Date(date);
  monday.setDate(date.getDate() - daysSinceMonday);
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  return { weekStartStr: ymd(monday), weekEndStr: ymd(friday) };
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
  // just old and forgotten.
  const notYetBilledJobs = useMemo(() => {
    const todayStr = ymd(new Date());
    return jobs
      .filter((j) => j.confirmed_date && j.confirmed_date <= todayStr)
      .filter((j) => !(j.documents ?? []).some((d) => d.kind === "lab_invoice"))
      .map((job) => ({ job, cents: estimatedLabCostCents(job) }))
      .sort((a, b) => (b.job.confirmed_date ?? "").localeCompare(a.job.confirmed_date ?? ""));
  }, [jobs]);

  // Per Tim, 2026-08-28 — "It should be the main outline and then use
  // other documents that you find along the way": everything the weekly
  // reports above already account for is excluded here (report_total_cents
  // != null) — this is only what's left over. In practice that's just the
  // three Crystal per-invoice emails from before the weekly summary became
  // the sole source (#6491/#6497/#6498, confirmed against his real inbox)
  // — the automated pipeline no longer files anything else here going
  // forward (see lib/lab-email.ts), so this section should stay short.
  // Same content_hash/lab_invoice_number grouping as before.
  const otherLabInvoices = useMemo(() => {
    const seenPerJobPath = new Set<string>();
    const flat: { job: JobWithCustomer; doc: JobDocument }[] = [];
    for (const job of jobs) {
      for (const doc of job.documents ?? []) {
        if (doc.kind !== "lab_invoice" || doc.report_total_cents != null) continue;
        const key = `${job.id}:${doc.storage_path}`;
        if (seenPerJobPath.has(key)) continue;
        seenPerJobPath.add(key);
        flat.push({ job, doc });
      }
    }

    const groups = new Map<string, { job: JobWithCustomer; doc: JobDocument }[]>();
    const ungrouped: { job: JobWithCustomer; doc: JobDocument }[][] = [];
    for (const row of flat) {
      const key = row.doc.lab_invoice_number ? `n:${row.doc.lab_invoice_number}` : row.doc.content_hash ? `h:${row.doc.content_hash}` : null;
      if (!key) {
        ungrouped.push([row]);
        continue;
      }
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(row);
    }

    return [...groups.values(), ...ungrouped]
      .map((rows) => {
        const sorted = [...rows].sort((a, b) => (a.job.project_number ?? "").localeCompare(b.job.project_number ?? ""));
        const receivedAt = sorted.reduce((min, r) => (r.doc.uploaded_at < min ? r.doc.uploaded_at : min), sorted[0].doc.uploaded_at);
        const weeks = sorted
          .map((r) => (r.job.confirmed_date ? mondayFridayOfWeek(r.job.confirmed_date) : null))
          .filter((w): w is { weekStartStr: string; weekEndStr: string } => w != null);
        const covers =
          weeks.length > 0
            ? {
                weekStartStr: weeks.reduce((min, w) => (w.weekStartStr < min ? w.weekStartStr : min), weeks[0].weekStartStr),
                weekEndStr: weeks.reduce((max, w) => (w.weekEndStr > max ? w.weekEndStr : max), weeks[0].weekEndStr),
              }
            : null;
        return { rows: sorted, receivedAt, covers };
      })
      .sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1));
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
              <div className="mt-2 space-y-1.5">
                {notYetBilledJobs.map(({ job, cents }) => (
                  <div key={job.id} className="flex items-baseline justify-between gap-2">
                    <Link href={`/admin/dashboard?jobId=${job.id}`} className="font-mono text-xs text-brand-600 hover:underline">
                      {job.project_number}
                    </Link>
                    <span className="whitespace-nowrap text-xs text-amber-600">Est. {formatCents(cents)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Per Tim, 2026-08-28 — "then use other documents that you find
              along the way": whatever the weekly reports above don't
              already account for — in practice just the three Crystal
              per-invoice emails from before the weekly summary became the
              sole source. */}
          <div className="mt-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Other Lab Invoices</div>
            {otherLabInvoices.length === 0 ? (
              <p className="mt-2 rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-500">Nothing else on file.</p>
            ) : (
              // Per Tim, 2026-08-28 — its own bordered cell per invoice,
              // same card pattern as the mobile Invoices-list cards
              // (InvoicesView.tsx), not one shared card with thin dividers
              // between rows.
              <div className="mt-2 flex flex-col gap-2">
                {otherLabInvoices.map((entry) => {
                  const first = entry.rows[0];
                  // Per Tim, 2026-08-28 — "track each invoice and then all
                  // the jobs that it includes": each row's own amount_cents
                  // is that JOB's own dollar share of this real invoice (see
                  // computeLabCostCentsFromDocuments's own comment in
                  // lib/lab-cost.ts), so summing across entry.rows gives the
                  // whole invoice's real total without double-counting the
                  // per-service-type-label document copies (already
                  // collapsed to one row per job before this point). Null
                  // for a document uploaded before amount_cents existed and
                  // not yet backfilled (see
                  // /api/admin/backfill-lab-invoice-amounts) — shown as "—"
                  // rather than a misleading $0.
                  const knownAmounts = entry.rows.filter((r) => r.doc.amount_cents != null);
                  const totalCents = knownAmounts.length > 0 ? knownAmounts.reduce((sum, r) => sum + (r.doc.amount_cents ?? 0), 0) : null;
                  return (
                    <div
                      key={first.doc.lab_invoice_number ?? first.doc.content_hash ?? `${first.job.id}:${first.doc.id}`}
                      className="flex flex-col gap-1 rounded-lg border border-slate-200 bg-white p-3 text-sm"
                    >
                      {/* Per Tim, 2026-08-28 — corners anchored, same "fill
                          the cell" pattern as the mobile Invoices-list cards:
                          title top-left, Received top-right, job numbers
                          middle-left, date range bottom-right. Title is
                          Crystal's own printed invoice number ("Invoice no.:
                          6491" on the PDF itself — see extractInvoiceNumber
                          in lib/parse-lab-invoice.ts) when known, since
                          that's what Tim actually sees on their invoice/
                          email; falls back to a generic "Lab invoice" label
                          for a document uploaded before that field existed
                          and not yet backfilled (see
                          /api/admin/backfill-lab-invoice-numbers). */}
                      <div className="flex flex-wrap items-start justify-between gap-x-4">
                        <a
                          href={`/api/admin/jobs/${first.job.id}/documents/${first.doc.id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs font-medium text-brand-600 hover:underline"
                        >
                          {first.doc.lab_invoice_number ? `Invoice #${first.doc.lab_invoice_number}` : "Lab invoice"} ↗
                        </a>
                        <span className="whitespace-nowrap text-xs text-slate-500">Received {formatDate(localDateOnly(entry.receivedAt))}</span>
                      </div>
                      {/* Per Tim, 2026-08-28 — comma-separated inline links
                          instead of a stacked bullet list, so a cell's
                          height doesn't grow with how many jobs one
                          invoice covers. Each project number links to
                          that job in the admin dashboard. */}
                      <div className="flex flex-wrap text-xs text-slate-500">
                        {entry.rows.map((r, i) => (
                          <span key={r.job.id} className="whitespace-nowrap">
                            <Link href={`/admin/dashboard?jobId=${r.job.id}`} className="font-mono text-brand-600 hover:underline">
                              {r.job.project_number}
                            </Link>
                            {r.doc.amount_cents != null && <span className="ml-0.5 text-slate-400">({formatCents(r.doc.amount_cents)})</span>}
                            {i < entry.rows.length - 1 && <span className="mr-1">,</span>}
                          </span>
                        ))}
                      </div>
                      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                        <span className="whitespace-nowrap text-xs font-semibold text-slate-700">{totalCents != null ? formatCents(totalCents) : "—"}</span>
                        <span className="whitespace-nowrap text-xs text-slate-500">
                          {entry.covers ? `${formatDate(entry.covers.weekStartStr)} – ${formatDate(entry.covers.weekEndStr)}` : "—"}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
