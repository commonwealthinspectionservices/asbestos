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

  // Per Tim, 2026-08-28 — lab fees actually paid out, bucketed by
  // invoice_sent_at (converted to local time via localDateOnly — see that
  // function's own comment on why a raw UTC slice would put some
  // late-evening sends in the wrong bucket). This Week is always Monday
  // through Friday of the current week specifically (not a rolling 7 days,
  // and not Sunday-anchored) — a weekend send belongs to neither the week
  // before nor after. Month/Year to Date are the standard cumulative
  // reading (1st of the month/year through today). Each carries its own
  // actual date range for the subtext under it, since the label alone
  // doesn't say which days that currently covers.
  const labFeesSummary = useMemo(() => {
    const now = new Date();
    const todayStr = ymd(now);

    // getDay(): 0=Sun..6=Sat. Days since this week's own Monday — Sunday
    // (0) is 6 days after the prior Monday, everything else is dayOfWeek-1.
    const daysSinceMonday = (now.getDay() + 6) % 7;
    const monday = new Date(now);
    monday.setDate(now.getDate() - daysSinceMonday);
    const friday = new Date(monday);
    friday.setDate(monday.getDate() + 4);
    const weekStartStr = ymd(monday);
    const weekEndStr = ymd(friday);

    const monthStartStr = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-01`;
    const yearStartStr = `${now.getFullYear()}-01-01`;

    let monthCents = 0;
    let yearCents = 0;
    for (const job of jobs) {
      if (!job.invoice_sent_at || !job.lab_cost_cents) continue;
      const sentDateStr = localDateOnly(job.invoice_sent_at);
      if (sentDateStr >= monthStartStr) monthCents += job.lab_cost_cents;
      if (sentDateStr >= yearStartStr) yearCents += job.lab_cost_cents;
    }
    return {
      monthCents,
      yearCents,
      weekStartStr,
      weekEndStr,
      weekRangeLabel: `${formatDate(weekStartStr)} – ${formatDate(weekEndStr)}`,
      monthRangeLabel: `${formatDate(monthStartStr)} – ${formatDate(todayStr)}`,
      yearRangeLabel: `${formatDate(yearStartStr)} – ${formatDate(todayStr)}`,
    };
  }, [jobs]);

  // Per Tim, 2026-08-28 — Crystal Analytical bills once a week (Fridays)
  // for everything analyzed that week, and he wants to see a running
  // estimate of what that invoice will total *before* it arrives (see
  // lib/lab-rate-estimate.ts for the rates this is based on). Bucketed by
  // confirmed_date — when the fieldwork/sampling actually happened, the
  // thing that determines which week's lab invoice a job's samples land
  // on — not invoice_sent_at (that's when *our* invoice to the customer
  // goes out, a separate, often much later, event). Estimate only, never
  // an "actual" figure — the real invoice for an in-progress week doesn't
  // exist until Friday, so there's nothing real to show yet (see
  // allLabInvoices below for the real thing, once it's actually uploaded).
  const weeklyLabEstimate = useMemo(() => {
    let estimatedCents = 0;
    for (const job of jobs) {
      if (!job.confirmed_date) continue;
      if (job.confirmed_date < labFeesSummary.weekStartStr || job.confirmed_date > labFeesSummary.weekEndStr) continue;
      estimatedCents += estimatedLabCostCents(job);
    }
    return { estimatedCents };
  }, [jobs, labFeesSummary.weekStartStr, labFeesSummary.weekEndStr]);

  // Per Tim, 2026-08-28 — "once a week is done, we need to put all those
  // invoices together and file [them] away together": once a week has
  // actually finished (its Friday is in the past — the in-progress week
  // stays on the This Week estimate card above, not here) every job whose
  // fieldwork fell in that week should be filed together in one place,
  // with a link straight to each one's Lab Invoice document. Grouped by
  // confirmed_date for the same reason weeklyLabEstimate above uses it,
  // not invoice_sent_at. Capped to the 10 most recent completed weeks —
  // this is a filing aid for reconciling recent invoices, not an
  // unbounded archive.
  const pastWeeklyLabInvoices = useMemo(() => {
    const todayStr = ymd(new Date());
    const weeks = new Map<string, { weekStartStr: string; weekEndStr: string; jobs: JobWithCustomer[] }>();
    for (const job of jobs) {
      if (!job.confirmed_date) continue;
      const { weekStartStr, weekEndStr } = mondayFridayOfWeek(job.confirmed_date);
      if (weekEndStr >= todayStr) continue;
      if (!weeks.has(weekStartStr)) weeks.set(weekStartStr, { weekStartStr, weekEndStr, jobs: [] });
      weeks.get(weekStartStr)!.jobs.push(job);
    }
    return Array.from(weeks.values())
      .sort((a, b) => (a.weekStartStr < b.weekStartStr ? 1 : -1))
      .slice(0, 10)
      .map((week) => ({
        ...week,
        actualCents: week.jobs.reduce((sum, j) => sum + (j.lab_cost_cents ?? 0), 0),
        jobs: [...week.jobs].sort((a, b) => (a.project_number ?? "").localeCompare(b.project_number ?? "")),
      }));
  }, [jobs]);

  // Per Tim, 2026-08-28 — "a list of every single pdf invoice that gets
  // sent to me by the lab and when it was sent to me and which dates it
  // covers": literally one row per real email Crystal Analytical actually
  // sent (confirmed against his real inbox: 3 emails on file, invoices
  // #6491/#6497/#6498), not one row per (job, document) pair. Two
  // dedup/group passes get there:
  //
  // 1. Same job, same file — a mixed job (asbestos + mold) gets one
  //    lab_invoice document PER SERVICE-TYPE LABEL, all pointing at the
  //    same storage_path (see the "one station per label" comment in
  //    lib/lab-email.ts's processMatchedLabInvoiceEmail) — collapse those
  //    to one row per (job, storage_path) first.
  // 2. Different jobs, same real invoice — Crystal Analytical bills
  //    several jobs on one shared PDF (see processMultiJobLabInvoiceEmail),
  //    which gets uploaded as its own byte-identical copy under every job
  //    it covers. content_hash (see its own comment on JobDocument) is
  //    what recognizes those copies as one real invoice again — grouped
  //    into a single row listing every job it covers. A document without a
  //    hash yet (predates that field, not yet backfilled — see
  //    /api/admin/backfill-lab-invoice-hashes) stays its own standalone
  //    row rather than silently vanishing from the list.
  //
  // "Received" is the earliest uploaded_at across the group (when it
  // actually landed in our system); "Covers" is the Monday–Friday week
  // containing each covered job's confirmed_date, widened to the full
  // min–max span across the group (normally identical for every job on one
  // real invoice, since Crystal Analytical bills everything analyzed that
  // week together) — the invoice itself doesn't carry a machine-readable
  // billing-period field.
  const allLabInvoices = useMemo(() => {
    const seenPerJobPath = new Set<string>();
    const flat: { job: JobWithCustomer; doc: JobDocument }[] = [];
    for (const job of jobs) {
      for (const doc of job.documents ?? []) {
        if (doc.kind !== "lab_invoice") continue;
        const key = `${job.id}:${doc.storage_path}`;
        if (seenPerJobPath.has(key)) continue;
        seenPerJobPath.add(key);
        flat.push({ job, doc });
      }
    }

    // Group key preference: lab_invoice_number (Crystal's own printed
    // number, e.g. "6491") over content_hash. Crystal's own number is what
    // actually identifies "the same real invoice," independent of exactly
    // how each copy got into this system — content_hash only catches
    // byte-identical copies (the automated multi-job path re-uploads the
    // exact same buffer per job), but the same real invoice manually
    // uploaded separately per job (a different export/scan each time) can
    // still print the identical invoice number while never hashing the
    // same. Confirmed live 2026-08-28 — Tim: "I thought that I've only got
    // three invoices from the lab so far," but content_hash alone was
    // still showing more than three, because several of Boston Harbor's
    // copies weren't byte-identical even though they're the same invoice.
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
          <div className="mt-3 flex flex-wrap gap-4 rounded-lg border border-slate-200 bg-white p-3 text-sm">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">This Week</div>
              <div className="text-base font-semibold text-slate-800">
                Est. {formatCents(weeklyLabEstimate.estimatedCents)}
              </div>
              <div className="text-xs text-slate-400">{labFeesSummary.weekRangeLabel}</div>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Month to Date</div>
              <div className="text-base font-semibold text-slate-800">{formatCents(labFeesSummary.monthCents)}</div>
              <div className="text-xs text-slate-400">{labFeesSummary.monthRangeLabel}</div>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Year to Date</div>
              <div className="text-base font-semibold text-slate-800">{formatCents(labFeesSummary.yearCents)}</div>
              <div className="text-xs text-slate-400">{labFeesSummary.yearRangeLabel}</div>
            </div>
          </div>

          <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3 text-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Weekly Lab Invoice Filing</div>
            {pastWeeklyLabInvoices.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">No completed weeks yet.</p>
            ) : (
              <div className="mt-2 space-y-3">
                {pastWeeklyLabInvoices.map((week) => (
                  <div key={week.weekStartStr} className="border-t border-slate-100 pt-2 first:border-t-0 first:pt-0">
                    <div className="flex items-baseline justify-between">
                      <span className="text-xs font-medium text-slate-600">
                        {formatDate(week.weekStartStr)} – {formatDate(week.weekEndStr)}
                      </span>
                      <span className="text-xs font-semibold text-slate-800">{formatCents(week.actualCents)}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                      {week.jobs.map((job) => {
                        const doc = (job.documents ?? []).find((d) => d.kind === "lab_invoice");
                        return (
                          <div key={job.id} className="flex items-center gap-1.5 text-xs">
                            <span className="font-mono text-slate-500">{job.project_number}</span>
                            {doc ? (
                              <a
                                href={`/api/admin/jobs/${job.id}/documents/${doc.id}`}
                                target="_blank"
                                rel="noreferrer"
                                className="text-brand-600 hover:underline"
                              >
                                Lab invoice ↗
                              </a>
                            ) : (
                              <span className="text-slate-400">No lab invoice</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mt-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">All Lab Invoices</div>
            {allLabInvoices.length === 0 ? (
              <p className="mt-2 rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-500">No lab invoices uploaded yet.</p>
            ) : (
              // Per Tim, 2026-08-28 — its own bordered cell per invoice,
              // same card pattern as the mobile Invoices-list cards
              // (InvoicesView.tsx), not one shared card with thin dividers
              // between rows.
              <div className="mt-2 flex flex-col gap-2">
                {allLabInvoices.map((entry) => {
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
