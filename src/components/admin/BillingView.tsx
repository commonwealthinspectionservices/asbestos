"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import type { JobWithCustomer } from "@/lib/types";
import { formatCents, computeMarginCents } from "@/lib/pricing";
import { ProjectDetailDialog, EditProjectDialog, formatDateTime } from "@/components/admin/JobsDashboard";
import { formatDateMDY } from "@/lib/date-format";
import { NEWTON_FIRE_FLOOD_COMPANY_ID } from "@/lib/report-findings";
import { dueDateFor } from "@/lib/invoice-due-date";
import { expandAddress, splitAddress } from "@/lib/address";

// Per Tim, 2026-08-30 — "too many clicks to get an answer, and I feel like
// maybe there's a lot of repeating information": Invoices, Lab Costs, and
// Margins were three separate pages each re-fetching the same jobs and
// re-rendering nearly the same card (project #, company, address) to
// answer three different slices of the same question — what a job
// invoiced, what the lab charged, and the margin between them. First
// merged into one page with two full-page views (By Job / By Period)
// behind a toggle — then per Tim, "I'm very confused by the billing screen
// and the by job and by period options... I don't understand the
// difference... it feels like too much on one page": tried collapsing
// those two views into one list with a "Group by" control instead — then
// per Tim, "I don't really like the group by feature... drop it, just the
// flat list": removed grouping entirely. This is now one flat, filterable/
// sortable list of invoiced jobs, same shape as the old standalone
// Invoices page. One JobRow component renders every row.

type InvoiceStatus = "ready_to_send" | "sent" | "overdue" | "paid";

// Per Tim, 2026-08-28 — ready_to_send/sent match the exact same wording as
// the real job.status pipeline's own labels (JobsDashboard.tsx's
// STATUS_LABEL: ready_to_send → "Ready for Review", report_invoice_sent
// → "Payment Pending") rather than this view's own separate phrasing, so a
// job reads the same status whichever page you're looking at it from.
const STATUS_LABEL: Record<InvoiceStatus, string> = {
  ready_to_send: "Ready for Review",
  sent: "Payment Pending",
  overdue: "Overdue",
  paid: "Paid",
};

// Per Tim, 2026-08-29 — one neutral style for every status, not a color per
// status — matches the plain slate pill every other status badge in the
// app already uses (e.g. JobRow's own status pill on the Projects list).
const STATUS_PILL_CLASS = "bg-slate-200 text-slate-700";

function formatDate(date: string | null | undefined): string {
  return formatDateMDY(date) ?? "—";
}

function isPastDue(dueIso: string | null): boolean {
  if (!dueIso) return false;
  const due = new Date(`${dueIso}T00:00:00`);
  if (Number.isNaN(due.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return due.getTime() < today.getTime();
}

// Local calendar date (not UTC) as YYYY-MM-DD, for comparing against the
// plain date strings (confirmed_date/requested_date) jobs are stored with.
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// Per Tim, 2026-08-30 — "instead of Aug 24-30 it should say August 24th
// - 30th": full month name plus an ordinal day, used by the Weekly
// table's date-range labels.
function ordinal(n: number): string {
  const j = n % 10;
  const k = n % 100;
  if (j === 1 && k !== 11) return `${n}st`;
  if (j === 2 && k !== 12) return `${n}nd`;
  if (j === 3 && k !== 13) return `${n}rd`;
  return `${n}th`;
}

// Per Tim, 2026-08-30 — "it should only just start at August 24th 2026,
// that's when my company started": the Weekly/Monthly history tables
// never show a period entirely before this date.
const COMPANY_START_DATE = "2026-08-24";

// Per Tim, 2026-08-30 — "I don't want the weekly and monthly at the top
// to get too crowded": how many rows each history table shows, capped
// rather than growing forever as more real weeks/months pass.
const HISTORY_PERIOD_COUNT = 3;

function invoiceStatus(job: JobWithCustomer): InvoiceStatus {
  if (job.paid_date) return "paid";
  if (job.invoice_sent_at) return isPastDue(dueDateFor(job)) ? "overdue" : "sent";
  return "ready_to_send";
}

// Per Tim, 2026-08-30 — "some jobs get sampled Thursday or Friday but
// might not get billed until the next week... we need to decide a
// specific system on where jobs are getting placed historically": the
// week/month a job counts toward is the week/month its invoice actually
// went out (invoice_sent_at), not the day it was sampled. Shared by
// Revenue and Lab Costs (both real and estimated) so a job's own numbers
// always land in the same bucket on both cards.
//
// Per Tim, 2026-09-04 (follow-up) — "I just want the weekly revenue to
// directly match [invoice date, no fallback dates]": a job with no
// invoice_sent_at yet just doesn't count toward any week/month row
// (still counted in All-Time, which doesn't bucket by date at all) —
// no falling back to paid_date/confirmed_date/requested_date, which
// could put a job in a different week than its own invoice actually
// shows and make the weekly total impossible to verify by eye against
// the job list below.
function billingDateFor(job: JobWithCustomer): string | null {
  return job.invoice_sent_at ? ymd(new Date(job.invoice_sent_at)) : null;
}

// netCents already includes the same lab cost estimate as Lab Costs above
// (see the periodHistory loop) — null when there's no revenue yet to
// divide by, rather than a misleading 0%.
function marginPercentOf(bucket: { grossCents: number; netCents: number }): number | null {
  return bucket.grossCents > 0 ? (bucket.netCents / bucket.grossCents) * 100 : null;
}

// Per Tim, 2026-09-04 — "estimate a lab cost based off of the number of
// samples I entered on the invoice": sample_counts only ever gets
// populated by parsing an actual uploaded lab report, so a job still
// waiting on results (like 26-0014 — 3 mold samples typed onto its
// invoice by hand, no lab report yet) had no sample count to estimate
// from at all. Falls back to summing the invoice's own "Sample"
// line-item quantities — the real number the admin already entered when
// building the invoice, not a new field to keep in sync. sample_counts
// (from a real lab report) still wins whenever it exists; sample_count is
// the older single-field fallback for jobs from before per-type tracking.
function totalSampleCount(job: JobWithCustomer): number {
  const fromCounts = Object.values(job.sample_counts ?? {}).reduce((sum, n) => sum + (n || 0), 0);
  if (fromCounts > 0) return fromCounts;
  if (job.sample_count) return job.sample_count;
  return (job.invoice_line_items ?? [])
    .filter((li) => li.billing_unit === "Sample")
    .reduce((sum, li) => sum + (li.quantity || 0), 0);
}

// Per Tim, 2026-08-30 — "invoice and lab costs should be links to the
// PDF invoices": a job can have more than one lab_invoice document
// (partial billing across weekly reports) — links to the most recently
// uploaded one, since that's the one most likely to be what someone
// clicking "Lab Cost" from a billing summary actually wants.
function latestLabInvoiceDocId(job: JobWithCustomer): string | null {
  const labInvoices = (job.documents ?? []).filter((d) => d.kind === "lab_invoice");
  if (labInvoices.length === 0) return null;
  return labInvoices.reduce((a, b) => (a.uploaded_at > b.uploaded_at ? a : b)).id;
}

// Per Tim, 2026-08-30 — "address NEW LINE town state zip": street on its
// own line, town/state/zip on the one below, same split JobsDashboard.tsx's
// own Project Info tab already uses — not a plain line-clamp, which would
// wrap wherever the text happened to run out of room instead of at the
// actual street/town boundary.
function AddressLines({ address }: { address: string | null | undefined }) {
  if (!address) return null;
  const { street, cityStateZip } = splitAddress(address);
  return (
    <div className="mt-0.5 text-xs text-slate-500">
      <div className="truncate">{expandAddress(street)}</div>
      {cityStateZip && <div className="truncate">{expandAddress(cityStateZip)}</div>}
    </div>
  );
}

// Per Tim, 2026-08-30 — the badge/company/address block is the exact
// thing that needed the same fixes three separate times across the old
// Invoices/Lab Costs/Margins pages this session; now there's exactly one
// place to fix. `right` is whatever financial content sits beside the
// address; `below` is whatever status/date content sits on its own row.
function JobRow({
  job, onOpen, right, below,
}: {
  job: JobWithCustomer; onOpen: () => void; right: React.ReactNode; below?: React.ReactNode;
}) {
  return (
    <button
      onClick={onOpen}
      // Per Tim, 2026-08-30 — "the text should all start in the same
      // point, the I, the L, and the M, but just move it far right":
      // Invoice/Lab Cost/Margin's own label column stays left-aligned to
      // a common edge (see MoneyGrid), but the whole block now sits at
      // the card's far right edge instead of hugging the address.
      className="flex w-full flex-col items-start gap-1.5 rounded-lg border border-slate-200 bg-white p-3 text-left hover:border-brand-400"
    >
      {/* Per Tim, 2026-08-30 — "make sure project number and company
          name in the preview cards are directly in line on top": the
          badge's own padding made items-start (aligning box tops) read
          as misaligned against the plain company-name text next to it —
          items-center lines them up regardless of the font-size/padding
          difference between the two. */}
      <div className="flex items-center gap-2">
        <span className="shrink-0 whitespace-nowrap rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-600">
          {job.project_number}
        </span>
        <span className="whitespace-nowrap text-sm font-medium text-slate-800">
          {job.customers?.company || job.customers?.name}
        </span>
      </div>
      <div className="flex w-full flex-wrap items-start justify-between gap-x-4 gap-y-1.5">
        <div>
          <AddressLines address={job.service_address} />
          {/* Per Tim, 2026-09-02 — "these need to show when the invoice
              was sent... directly below address... add time in that sent
              line... make it all italics". */}
          {job.invoice_sent_at && <div className="mt-0.5 text-xs italic text-slate-500">Sent {formatDateTime(job.invoice_sent_at)}</div>}
        </div>
        {right}
      </div>
      {below && <div className="w-full text-left">{below}</div>}
    </button>
  );
}

// Per Tim, 2026-08-30 — "this should be clearer, maybe a table style of
// what's the invoice price and what's the lab cost": a labeled grid
// instead of a "$X − $Y = $Z" formula. labCostCents/marginCents null
// means not billed by the lab yet, shown as "—" rather than a misleading
// $0. Same size/format for every row per Tim's follow-up — Margin isn't
// visually singled out, just colored red if it's negative.
function MoneyGrid({
  revenueCents, labCostCents, estimatedLabCostCents, stripeFeeCents, marginCents, invoiceHref, labInvoiceHref,
}: {
  revenueCents: number; labCostCents: number | null;
  /** Per Tim, 2026-09-04 — shown (with "≈") in place of "—" when the lab
      hasn't invoiced this job yet (labCostCents null) but there's enough
      to estimate from (see avgLabCostPerSampleCents), so a job card
      matches the same "≈" figure feeding Weekly/Monthly Lab Costs above. */
  estimatedLabCostCents?: number;
  stripeFeeCents: number; marginCents: number | null;
  invoiceHref?: string | null; labInvoiceHref?: string | null;
}) {
  // Per Tim, 2026-08-30 — "the text should all start in the same point,
  // the I, the L, and the M, but just move it far right": labels
  // (Invoice/Lab Cost/Margin) left-align to a common edge; values
  // right-align in their own column. The block itself is what moves far
  // right now (see JobRow's justify-between), not each line of text.
  //
  // Per Tim, 2026-08-30 (follow-up) — "invoice and lab costs should be
  // links to the PDF invoices... I should easily be able to click on my
  // invoice and the lab invoice from each job": the label itself becomes
  // a link when a PDF is available. stopPropagation keeps the click from
  // also firing JobRow's own onClick (which opens the job detail dialog)
  // — same pattern this file already used for the old weekly report's
  // "PDF ↗" link.
  const invoiceLabel = invoiceHref ? (
    <a href={invoiceHref} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-left text-slate-400 underline hover:text-brand-600">
      Invoice
    </a>
  ) : (
    <span className="text-left text-slate-400">Invoice</span>
  );
  const labCostLabel = labInvoiceHref ? (
    <a href={labInvoiceHref} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-left text-slate-400 underline hover:text-brand-600">
      Lab Cost
    </a>
  ) : (
    <span className="text-left text-slate-400">Lab Cost</span>
  );
  return (
    <div className="grid shrink-0 grid-cols-[auto_auto] items-baseline gap-x-2 gap-y-0.5 text-xs">
      {invoiceLabel}
      <span className="whitespace-nowrap text-right italic text-slate-700">{formatCents(revenueCents)}</span>
      {labCostLabel}
      <span className="whitespace-nowrap text-right italic text-slate-700">
        {labCostCents != null
          ? formatCents(labCostCents)
          : estimatedLabCostCents
            ? <><span className="text-slate-400">≈ </span>{formatCents(estimatedLabCostCents)}</>
            : "—"}
      </span>
      {stripeFeeCents !== 0 && (
        <>
          <span className="text-left text-slate-400">Stripe Fee</span>
          <span className="whitespace-nowrap text-right italic text-slate-700">{formatCents(stripeFeeCents)}</span>
        </>
      )}
      <span className="text-left text-slate-400">Margin</span>
      <span className={`whitespace-nowrap text-right italic ${marginCents != null && marginCents < 0 ? "text-red-600" : "text-slate-700"}`}>
        {(() => {
          if (marginCents != null) return formatCents(marginCents);
          // Per Tim, 2026-09-04 — same estimate as Lab Cost above, carried
          // through to Margin too rather than leaving it blank just
          // because the real lab invoice hasn't come in yet.
          if (estimatedLabCostCents) return <><span className="text-slate-400">≈ </span>{formatCents(revenueCents - estimatedLabCostCents - stripeFeeCents)}</>;
          return "—";
        })()}
      </span>
    </div>
  );
}

// Per Tim, 2026-08-30 — "a simple way to keep track of net and gross for
// weeks and months over time": one plain list of period rows, gross and
// net right-aligned, no borders per row, no click targets — a glance-able
// table, not another browsable view.
function PeriodHistoryTable({
  title, rows, isSelected, onSelectRow,
}: {
  title: string;
  rows: {
    label: string;
    grossCents: number;
    netCents: number;
    /** Per Tim, 2026-09-04 — Weekly/Monthly Lab Costs: true when this row's
        figure includes an estimate for a job the lab hasn't invoiced yet
        (see avgLabCostPerSampleCents), so it reads as a rough number, not
        a confirmed one. */
    estimated?: boolean;
  }[];
  // Per Tim, 2026-09-02 — "I want to be able to break down jobs week by
  // week, month by month": clicking a row filters the job list below to
  // that period instead of the current status filter (see periodFilter's
  // own comment). isSelected/onSelectRow are undefined for the rare caller
  // that doesn't want rows clickable at all.
  isSelected?: (label: string) => boolean;
  onSelectRow?: (label: string) => void;
}) {
  // Per Tim, 2026-09-02 — "take out the net number": just the gross
  // dollar figure per period now, no more "net $X" second column. A
  // 2-column grid (label / gross) still keeps the gross figures aligned
  // down every row, same reasoning as the 3-column version this replaced.
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
      <div className="flex items-baseline gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</span>
        {/* Per Tim, 2026-09-04 — "in small subtext... can just say based
            off invoice date": so the date basis is visible right on the
            page, not just in a code comment, next time the question
            comes up. */}
        <span className="text-xs italic text-slate-400">(by invoice date)</span>
      </div>
      <div className="mt-2 grid grid-cols-[1fr_auto] items-baseline gap-x-3 gap-y-1">
        {rows.map((r) => {
          const selected = isSelected?.(r.label) ?? false;
          const content = (
            <>
              {/* Per Tim, 2026-09-02 — "all of the text in weekly revenue
                  should be made to be the size of the dollar amounts":
                  text-sm at every width now, matching the gross figure
                  (which has always just inherited text-sm from the
                  container) — was text-xs on mobile only, to guarantee a
                  full date range like "August 31st - September 6th" never
                  wrapped to two lines; whitespace-nowrap alone still
                  covers that at the larger size. */}
              <span className={`whitespace-nowrap text-sm ${selected ? "font-semibold text-brand-700" : "text-slate-500"}`}>{r.label}</span>
              <span className="whitespace-nowrap text-right italic text-slate-800">
                {r.estimated && <span className="text-slate-400">≈ </span>}
                {formatCents(r.grossCents)}
              </span>
            </>
          );
          return onSelectRow ? (
            <button key={r.label} onClick={() => onSelectRow(r.label)} className="contents text-left">
              {content}
            </button>
          ) : (
            <Fragment key={r.label}>{content}</Fragment>
          );
        })}
      </div>
    </div>
  );
}

// Per Tim, 2026-09-04 — its own card pair (not a third column on Revenue/
// Lab Costs, which got added and then pulled back out) so an exact,
// unrounded percentage has room without crowding the dollar figures.
function MarginHistoryTable({
  title, rows, isSelected, onSelectRow,
}: {
  title: string;
  rows: {
    label: string;
    marginPercent: number | null;
    /** True when this row's margin includes an estimate for a job the lab
        hasn't invoiced yet (see avgLabCostPerSampleCents) — an actual
        dollar figure is never estimated here, only the % itself. */
    estimated?: boolean;
  }[];
  isSelected?: (label: string) => boolean;
  onSelectRow?: (label: string) => void;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
      <div className="flex items-baseline gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</span>
        <span className="text-xs italic text-slate-400">(by invoice date)</span>
      </div>
      <div className="mt-2 grid grid-cols-[1fr_auto] items-baseline gap-x-3 gap-y-1">
        {rows.map((r) => {
          const selected = isSelected?.(r.label) ?? false;
          const content = (
            <>
              <span className={`whitespace-nowrap text-sm ${selected ? "font-semibold text-brand-700" : "text-slate-500"}`}>{r.label}</span>
              <span className={`whitespace-nowrap text-right italic ${r.marginPercent != null && r.marginPercent < 0 ? "text-red-600" : "text-slate-800"}`}>
                {r.marginPercent != null ? <>{r.estimated && <span className="text-slate-400">≈ </span>}{r.marginPercent.toFixed(1)}%</> : "—"}
              </span>
            </>
          );
          return onSelectRow ? (
            <button key={r.label} onClick={() => onSelectRow(r.label)} className="contents text-left">
              {content}
            </button>
          ) : (
            <Fragment key={r.label}>{content}</Fragment>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// By Job (Invoices' old filter/sort/search list)
// ---------------------------------------------------------------------

// Per Tim, 2026-08-30 — "delete the All button... always default to
// being on Payment Pending": dropped "all" entirely rather than just
// hiding the button, so there's no lingering state nothing points to.
type FilterKey = "sent" | "overdue" | "paid";
const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "sent", label: "Payment Pending" },
  { key: "overdue", label: "Overdue" },
  { key: "paid", label: "Paid" },
];

function matchesAnyWord(target: string, query: string): boolean {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const t = target.toLowerCase();
  return words.every((w) => t.includes(w));
}

type SortField = "project_number" | "due_date" | "sent_date";
const SORT_FIELDS: { key: SortField; label: string }[] = [
  { key: "sent_date", label: "Sent date" },
  { key: "project_number", label: "Project #" },
  { key: "due_date", label: "Due date" },
];

export default function BillingView() {
  const [jobs, setJobs] = useState<JobWithCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [editingJobId, setEditingJobId] = useState<string | null>(null);
  // Per Tim, 2026-09-04 — "make all this hidden by a dropdown": the
  // Revenue/Lab Costs/Margin summary (6 cards + 3 All-Time lines) got long
  // once Lab Costs and Margin joined the original Revenue pair — starts
  // collapsed so the job list is what's actually visible on load.
  const [showSummary, setShowSummary] = useState(false);

  const [filter, setFilter] = useState<FilterKey>("sent");
  // Per Tim, 2026-09-02 — "they should be organized based off of when they
  // were sent out at by default": most-recently-sent first.
  const [sortBy, setSortBy] = useState<SortField>("sent_date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  // Per Tim, 2026-09-02 — "I want to be able to break down jobs week by
  // week, month by month": clicking a row in the Weekly/Monthly Revenue
  // table below narrows the list to just that period's jobs, replacing
  // (not adding to) the Payment Pending/Overdue/Paid status filter — still
  // one flat list at a time, never multiple period sections stacked at
  // once (see the top-of-file comment on why a standing "group by" was
  // tried and explicitly rejected before). Cleared by picking a status
  // filter pill, or its own Clear control.
  const [periodFilter, setPeriodFilter] = useState<
    { type: "week"; label: string; startStr: string; endStr: string } | { type: "month"; label: string; key: string } | null
  >(null);
  const [projectNumberQuery, setProjectNumberQuery] = useState("");
  const [companyQuery, setCompanyQuery] = useState("");
  const [addressQuery, setAddressQuery] = useState("");
  const [mobileSearch, setMobileSearch] = useState("");

  function loadJobs() {
    setLoading(true);
    setError(null);
    return fetch("/api/admin/jobs")
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error ?? "Failed to load billing");
        setJobs(data.jobs);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load billing"))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadJobs();
  }, []);

  // Per Tim, 2026-08-28 — this page is only for invoices that have
  // actually gone out (or been paid), not ones merely ready to send.
  const invoicedJobs = useMemo(
    () =>
      jobs.filter(
        (j) => j.source !== "subcontractor" && j.invoice_total_cents != null && (j.invoice_sent_at || j.paid_date)
      ),
    [jobs]
  );

  // invoice_sent_at only ever gets set as a side effect of hitting
  // draft-status — fire it once per job that's drafted but not yet
  // confirmed sent or paid, so this list reflects Gmail's real state
  // without requiring a visit to every project individually.
  useEffect(() => {
    const needsCheck = invoicedJobs.filter((j) => j.invoice_drafted_at && !j.invoice_sent_at && !j.paid_date);
    if (needsCheck.length === 0) return;
    let cancelled = false;
    Promise.all(
      needsCheck.map((j) =>
        fetch(`/api/admin/jobs/${j.id}/draft-status?kind=invoice`)
          .then((r) => r.json())
          .then((data) => ({ id: j.id, data }))
          .catch(() => null)
      )
    ).then((results) => {
      if (cancelled) return;
      const sentById = new Map(
        results
          .filter((r): r is { id: string; data: { status: string; sentAt?: string } } => Boolean(r) && r!.data.status === "sent")
          .map((r) => [r!.id, r!.data.sentAt as string])
      );
      if (sentById.size === 0) return;
      setJobs((prev) => prev.map((j) => (sentById.has(j.id) ? { ...j, invoice_sent_at: sentById.get(j.id)! } : j)));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs.length]);

  const rows = useMemo(() => {
    let result = invoicedJobs.map((job) => ({ job, status: invoiceStatus(job) }));
    if (periodFilter) {
      result = result.filter(({ job }) => {
        const bucketDate = billingDateFor(job);
        if (!bucketDate) return false;
        return periodFilter.type === "week"
          ? bucketDate >= periodFilter.startStr && bucketDate <= periodFilter.endStr
          : bucketDate.slice(0, 7) === periodFilter.key;
      });
    } else {
      result = result.filter(({ status }) => status === filter);
    }

    if (projectNumberQuery.trim()) {
      result = result.filter(({ job }) => matchesAnyWord(job.project_number ?? "", projectNumberQuery));
    }
    if (companyQuery.trim()) {
      result = result.filter(({ job }) => matchesAnyWord(job.customers?.company || job.customers?.name || "", companyQuery));
    }
    if (addressQuery.trim()) {
      result = result.filter(({ job }) => matchesAnyWord(job.service_address ?? "", addressQuery));
    }
    if (mobileSearch.trim()) {
      result = result.filter(
        ({ job }) =>
          matchesAnyWord(job.project_number ?? "", mobileSearch) ||
          matchesAnyWord(job.customers?.company || job.customers?.name || "", mobileSearch) ||
          matchesAnyWord(job.service_address ?? "", mobileSearch)
      );
    }

    const dir = sortDir === "asc" ? 1 : -1;
    return result.sort((a, b) => {
      if (sortBy === "project_number") {
        return dir * (a.job.project_number ?? "").localeCompare(b.job.project_number ?? "");
      }
      if (sortBy === "sent_date") {
        const aSent = a.job.invoice_sent_at ?? "";
        const bSent = b.job.invoice_sent_at ?? "";
        return dir * aSent.localeCompare(bSent);
      }
      const aDue = dueDateFor(a.job) ?? "9999-99-99";
      const bDue = dueDateFor(b.job) ?? "9999-99-99";
      return dir * aDue.localeCompare(bDue);
    });
  }, [invoicedJobs, filter, periodFilter, projectNumberQuery, companyQuery, addressQuery, mobileSearch, sortBy, sortDir]);

  const listSummary = useMemo(() => {
    let awaitingPaymentCents = 0;
    for (const job of invoicedJobs) {
      const status = invoiceStatus(job);
      if (status === "sent" || status === "overdue") awaitingPaymentCents += job.invoice_total_cents ?? 0;
    }
    return { awaitingPaymentCents };
  }, [invoicedJobs]);

  // Per Tim, 2026-08-30 — "I just want a simple way to keep track of net
  // and gross for weeks and months over time": a plain, non-interactive
  // table of the last few weeks and last few months — not the browsable
  // grouped view he'd already had removed once for being too much.
  // Bucketed by billingDateFor (see its own comment — invoice date,
  // shared with Lab Costs below).
  //
  // Per Tim, 2026-08-30 (follow-up) — "I don't want the weekly and
  // monthly at the top to get too crowded": capped at 4 rows each
  // (rather than the original 6) so the table stays a fixed, small size
  // at the top of the page no matter how long the company's been
  // running, instead of growing every week/month.
  //
  // Per Tim, 2026-08-30 (follow-up) — "it should only just start at
  // August 24th 2026, that's when my company started": buckets entirely
  // before that date are dropped rather than shown empty — there's no
  // real "last month" or "the week before" when the company didn't exist
  // yet, so the table just grows one row at a time as real weeks/months
  // pass.
  // Per Tim, 2026-09-04 — the lab only sends its own invoice once a week
  // (Fridays), so a job billed to the customer this week almost always
  // still shows $0 real lab cost even though the lab work already
  // happened and will get billed eventually. Estimate what a
  // still-unbilled job's lab cost will likely be from the average
  // $/sample across every job that DOES have a real lab invoice in —
  // rough (one blended rate across every service type, not broken out by
  // asbestos/mold/lead), but enough to avoid a nasty Friday surprise.
  // Shared by periodHistory and allTimeTotal below so both apply the
  // exact same rate.
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

    // Per Tim, 2026-08-30 — "we should start on Monday and go through
    // Sunday": weeks run Mon–Sun, not the Sun–Sat weeks used before.
    // getDay() is 0=Sun..6=Sat; (day + 6) % 7 gives days since Monday
    // for every day including Sunday itself.
    const currentWeekStart = new Date(today);
    currentWeekStart.setHours(0, 0, 0, 0);
    currentWeekStart.setDate(currentWeekStart.getDate() - ((currentWeekStart.getDay() + 6) % 7));

    // Per Tim, 2026-08-30 — "instead of This Week and Last Week, it
    // should list out the actual weeks": same treatment as the Monthly
    // table's "August 2026" change — always the literal date range, no
    // This Week/Last Week special-casing.
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

    // Per Tim, 2026-08-30 — "instead of This Month, it should say August
    // 2026": always the literal month name and year, no relative
    // This Month/Last Month special-casing.
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
      // Only estimate for a job with no real lab invoice yet — once the
      // real one comes in, labCostCents above already has it and this
      // stays 0 so it's never added on top of the real figure.
      const estimatedCents = job.lab_cost_cents == null ? totalSampleCount(job) * avgLabCostPerSampleCents : 0;
      // Per Tim, 2026-09-04 — feeds Weekly/Monthly Margin below; includes
      // the same lab cost estimate Lab Costs itself shows, not just real
      // dollars — otherwise a week full of still-unbilled jobs would show
      // an inflated, misleading margin.
      const netCents = computeMarginCents(grossCents, labCostCents + estimatedCents, job.stripe_fee_cents ?? 0);

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

  // Per Tim, 2026-09-02 — all-time total, not just what the capped
  // weekly/monthly tables above happen to show (periodHistory only ever
  // covers the last few weeks/months). Every invoiced job counts, same
  // gross computation as each period bucket above.
  const allTimeTotal = useMemo(() => {
    let grossCents = 0;
    let labCostCents = 0;
    let estimatedLabCostCents = 0;
    let stripeFeeCents = 0;
    for (const job of invoicedJobs) {
      grossCents += job.invoice_total_cents ?? 0;
      labCostCents += job.lab_cost_cents ?? 0;
      stripeFeeCents += job.stripe_fee_cents ?? 0;
      if (job.lab_cost_cents == null) estimatedLabCostCents += totalSampleCount(job) * avgLabCostPerSampleCents;
    }
    return { grossCents, labCostCents, estimatedLabCostCents, stripeFeeCents };
  }, [invoicedJobs, avgLabCostPerSampleCents]);

  async function patchJob(job: JobWithCustomer, patch: Record<string, unknown>) {
    const res = await fetch(`/api/admin/jobs/${job.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (res.ok) loadJobs();
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <button
        onClick={() => setShowSummary((v) => !v)}
        className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
      >
        Revenue &amp; Margin Summary
        <span className={`text-slate-400 transition-transform ${showSummary ? "rotate-180" : ""}`}>▾</span>
      </button>
      {showSummary && (
      <>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <PeriodHistoryTable
          title="Weekly Revenue"
          rows={periodHistory.weekly}
          isSelected={(label) => periodFilter?.type === "week" && periodFilter.label === label}
          onSelectRow={(label) => {
            setPeriodFilter((prev) => {
              if (prev?.type === "week" && prev.label === label) return null;
              const row = periodHistory.weekly.find((w) => w.label === label);
              return row ? { type: "week", label: row.label, startStr: row.startStr, endStr: row.endStr } : prev;
            });
          }}
        />
        <PeriodHistoryTable
          title="Monthly Revenue"
          rows={periodHistory.monthly}
          isSelected={(label) => periodFilter?.type === "month" && periodFilter.label === label}
          onSelectRow={(label) => {
            setPeriodFilter((prev) => {
              if (prev?.type === "month" && prev.label === label) return null;
              const row = periodHistory.monthly.find((m) => m.label === label);
              return row ? { type: "month", label: row.label, key: row.key } : prev;
            });
          }}
        />
        {/* Per Tim, 2026-09-02 — plain text, sitting right below Weekly
            Revenue rather than in its own bordered card like the two
            tables above. sm:col-span-2 spans both grid columns so the
            "All-Time " label doesn't wrap on desktop. */}
        <div className="grid w-full grid-cols-[auto_auto] justify-start gap-x-1.5 gap-y-0.5 text-sm text-slate-500 sm:hidden">
          <span>All-Time Gross Revenue:</span>
          <span className="italic">{formatCents(allTimeTotal.grossCents)}</span>
        </div>
        <div className="hidden w-full items-baseline justify-between gap-2 text-sm text-slate-500 sm:col-span-2 sm:flex">
          <span className="whitespace-nowrap">All-Time Gross Revenue: <span className="italic">{formatCents(allTimeTotal.grossCents)}</span></span>
        </div>
      </div>

      {/* Per Tim, 2026-09-04 — same layout as Weekly/Monthly Revenue above,
          copied exactly, for lab costs instead of revenue. Clickable the
          same way too — "we need to break it down per job per week" — so
          a figure that looks off can be checked against the actual job
          list below (each job card's own Lab Cost line shows the same
          "≈" estimate feeding this total, via MoneyGrid). Shares the same
          periodFilter state as Weekly/Monthly Revenue, not a second one —
          only one period is ever filtered at a time regardless of which
          table it was clicked from. */}
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <PeriodHistoryTable
          title="Weekly Lab Costs"
          rows={periodHistory.weekly.map((w) => ({
            label: w.label,
            grossCents: w.labCostCents + w.estimatedLabCostCents,
            netCents: 0,
            estimated: w.estimatedLabCostCents > 0,
          }))}
          isSelected={(label) => periodFilter?.type === "week" && periodFilter.label === label}
          onSelectRow={(label) => {
            setPeriodFilter((prev) => {
              if (prev?.type === "week" && prev.label === label) return null;
              const row = periodHistory.weekly.find((w) => w.label === label);
              return row ? { type: "week", label: row.label, startStr: row.startStr, endStr: row.endStr } : prev;
            });
          }}
        />
        <PeriodHistoryTable
          title="Monthly Lab Costs"
          rows={periodHistory.monthly.map((m) => ({
            label: m.label,
            grossCents: m.labCostCents + m.estimatedLabCostCents,
            netCents: 0,
            estimated: m.estimatedLabCostCents > 0,
          }))}
          isSelected={(label) => periodFilter?.type === "month" && periodFilter.label === label}
          onSelectRow={(label) => {
            setPeriodFilter((prev) => {
              if (prev?.type === "month" && prev.label === label) return null;
              const row = periodHistory.monthly.find((m) => m.label === label);
              return row ? { type: "month", label: row.label, key: row.key } : prev;
            });
          }}
        />
        {/* Per Tim, 2026-09-04 — the lab only invoices weekly (Fridays), so
            a job billed to the customer this week likely has no real lab
            cost posted yet; "≈" marks a figure that includes an estimate
            for that gap rather than a confirmed one. */}
        <div className="grid w-full grid-cols-[auto_auto] justify-start gap-x-1.5 gap-y-0.5 text-sm text-slate-500 sm:hidden">
          <span>All-Time Lab Costs:</span>
          <span className="italic">
            {allTimeTotal.estimatedLabCostCents > 0 && "≈ "}{formatCents(allTimeTotal.labCostCents + allTimeTotal.estimatedLabCostCents)}
          </span>
        </div>
        <div className="hidden w-full items-baseline justify-between gap-2 text-sm text-slate-500 sm:col-span-2 sm:flex">
          <span className="whitespace-nowrap">
            All-Time Lab Costs:{" "}
            <span className="italic">
              {allTimeTotal.estimatedLabCostCents > 0 && "≈ "}{formatCents(allTimeTotal.labCostCents + allTimeTotal.estimatedLabCostCents)}
            </span>
          </span>
        </div>
      </div>

      {/* Per Tim, 2026-09-04 — "one more set of cells for weekly and
          monthly margins... an exact %": its own card pair, not a column
          on Revenue/Lab Costs above (tried that, pulled it back out —
          crowded the dollar figures). Same periodFilter, same click-to-
          filter behavior as the other two pairs. */}
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <MarginHistoryTable
          title="Weekly Margin"
          rows={periodHistory.weekly.map((w) => ({ label: w.label, marginPercent: marginPercentOf(w), estimated: w.estimatedLabCostCents > 0 }))}
          isSelected={(label) => periodFilter?.type === "week" && periodFilter.label === label}
          onSelectRow={(label) => {
            setPeriodFilter((prev) => {
              if (prev?.type === "week" && prev.label === label) return null;
              const row = periodHistory.weekly.find((w) => w.label === label);
              return row ? { type: "week", label: row.label, startStr: row.startStr, endStr: row.endStr } : prev;
            });
          }}
        />
        <MarginHistoryTable
          title="Monthly Margin"
          rows={periodHistory.monthly.map((m) => ({ label: m.label, marginPercent: marginPercentOf(m), estimated: m.estimatedLabCostCents > 0 }))}
          isSelected={(label) => periodFilter?.type === "month" && periodFilter.label === label}
          onSelectRow={(label) => {
            setPeriodFilter((prev) => {
              if (prev?.type === "month" && prev.label === label) return null;
              const row = periodHistory.monthly.find((m) => m.label === label);
              return row ? { type: "month", label: row.label, key: row.key } : prev;
            });
          }}
        />
        {(() => {
          const allTimeMarginPercent = allTimeTotal.grossCents > 0
            ? ((allTimeTotal.grossCents - allTimeTotal.labCostCents - allTimeTotal.estimatedLabCostCents - allTimeTotal.stripeFeeCents) / allTimeTotal.grossCents) * 100
            : null;
          const prefix = allTimeTotal.estimatedLabCostCents > 0 ? "≈ " : "";
          const text = allTimeMarginPercent != null ? `${prefix}${allTimeMarginPercent.toFixed(1)}%` : "—";
          const valueClass = "italic";
          return (
            <>
              <div className="grid w-full grid-cols-[auto_auto] justify-start gap-x-1.5 gap-y-0.5 text-sm text-slate-500 sm:hidden">
                <span>All-Time Margin:</span>
                <span className={valueClass}>{text}</span>
              </div>
              <div className="hidden w-full items-baseline justify-between gap-2 text-sm text-slate-500 sm:col-span-2 sm:flex">
                <span className="whitespace-nowrap">All-Time Margin: <span className={valueClass}>{text}</span></span>
              </div>
            </>
          );
        })()}
      </div>
      </>
      )}

      {error && <div className="mt-3 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}
      {loading && <p className="mt-6 text-sm text-slate-500">Loading…</p>}

      {!loading && !error && (
        <>
          {/* Mobile: a dropdown, same pattern as the Directory's tab
              selector and the Projects page's status filter. Per Tim —
              "the sort by, search by, and the rest of the cells should
              have some space above it to show that the weekly, monthly,
              and payment pending parts are separate", then "drop
              everything below sort by and payment pending button lower
              so that there's more space above it": mt-10 here (and on
              the desktop row below), pushed further than the original
              mt-6. */}
          <div className="relative mt-10 sm:hidden">
            <select
              value={filter}
              onChange={(e) => { setFilter(e.target.value as FilterKey); setPeriodFilter(null); }}
              className="w-full appearance-none rounded-lg border border-slate-300 bg-white py-2 pl-3 pr-10 text-sm font-medium text-slate-700"
            >
              {FILTERS.map((f) => (
                <option key={f.key} value={f.key}>{f.label}</option>
              ))}
            </select>
            <span className="pointer-events-none absolute inset-y-0 right-0 flex w-9 items-center justify-center text-slate-500">▾</span>
          </div>

          {/* Per Tim, 2026-08-30 — "swap payment pending in the three
              buttons, the positions of those. The three buttons should be
              aligned right so that it's not confused with the sort by
              buttons": filter pills sit at the right edge, Sort by on the
              left — putting real distance between the two pill groups
              instead of them sitting shoulder to shoulder. Payment
              Pending moved out of this row entirely (see above, its own
              line under Weekly/Monthly) and mt-3 became mt-6, then mt-10
              per "drop everything below sort by and payment pending
              button lower so that there's more space above it" — see the
              mobile dropdown's comment above. */}
          <div className="mt-10 hidden items-center justify-between gap-x-4 gap-y-2 sm:flex sm:flex-wrap">
            <div className="flex flex-wrap items-center gap-2">
              <span className="shrink-0 text-sm font-medium text-slate-500">Sort by:</span>
              {SORT_FIELDS.map((f) => (
                <button
                  key={f.key}
                  onClick={() => {
                    if (sortBy === f.key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
                    else {
                      setSortBy(f.key);
                      setSortDir("asc");
                    }
                  }}
                  // Per Tim, 2026-08-30 — "make both the color of the
                  // Payment Pending button": the active Sort pill was
                  // bg-slate-700 while the active filter pill (Payment
                  // Pending) is bg-brand-600 — matched to the same blue.
                  className={`shrink-0 rounded-lg px-2.5 py-1 text-sm font-medium ${sortBy === f.key ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"}`}
                >
                  {f.label}{sortBy === f.key ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  onClick={() => { setFilter(f.key); setPeriodFilter(null); }}
                  className={`shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium ${!periodFilter && filter === f.key ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"}`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-3 flex gap-2 sm:hidden">
            <div className="relative min-w-0 flex-1">
              <select
                value={`${sortBy}:${sortDir}`}
                onChange={(e) => {
                  const [field, dir] = e.target.value.split(":");
                  setSortBy(field as SortField);
                  setSortDir(dir as "asc" | "desc");
                }}
                className="w-full appearance-none rounded-lg border border-slate-300 bg-white py-2 pl-3 pr-8 text-sm text-slate-700"
              >
                {SORT_FIELDS.map((f) => (
                  <optgroup key={f.key} label={f.label}>
                    <option value={`${f.key}:asc`}>{f.label} ↑</option>
                    <option value={`${f.key}:desc`}>{f.label} ↓</option>
                  </optgroup>
                ))}
              </select>
              <span className="pointer-events-none absolute inset-y-0 right-0 flex w-7 items-center justify-center text-slate-500">▾</span>
            </div>
            <input
              value={mobileSearch}
              onChange={(e) => setMobileSearch(e.target.value)}
              placeholder="Search…"
              className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 placeholder:text-slate-700"
            />
          </div>

          <div className="mt-3 hidden gap-2 sm:flex sm:flex-row sm:flex-nowrap sm:items-center">
            <span className="shrink-0 text-sm font-medium text-slate-500">Search by:</span>
            <input
              value={projectNumberQuery}
              onChange={(e) => setProjectNumberQuery(e.target.value)}
              placeholder="Project #"
              className="w-full min-w-0 rounded-lg border border-slate-300 px-2.5 py-1 text-sm sm:w-0 sm:flex-1"
            />
            <input
              value={companyQuery}
              onChange={(e) => setCompanyQuery(e.target.value)}
              placeholder="Company"
              className="w-full min-w-0 rounded-lg border border-slate-300 px-2.5 py-1 text-sm sm:w-0 sm:flex-1"
            />
            <input
              value={addressQuery}
              onChange={(e) => setAddressQuery(e.target.value)}
              placeholder="Address"
              className="w-full min-w-0 rounded-lg border border-slate-300 px-2.5 py-1 text-sm sm:w-0 sm:flex-1"
            />
          </div>

          {/* Per Tim, 2026-08-30 — "Total amount pending should be
              directly in between search by and 26-0009, and it should
              only be there when the Payment Pending button on the top
              right is selected": moved down from under Weekly/Monthly,
              renamed from "Payment Pending" (too easy to confuse with
              the filter pill/status pill of the same name), and now only
              shows for the sent/Payment Pending filter. */}
          {/* Per Tim, 2026-09-02 — "I want to be able to break down jobs
              week by week, month by month": while a period's selected
              (see periodFilter's own comment), this replaces Total Amount
              Pending with that period's own total and a way back to the
              normal status-filtered view. */}
          {periodFilter ? (
            // Per Tim, 2026-09-02 (follow-up) — "delete this part [Showing
            // invoices from] and just show the date and the price on one
            // line across... it seems like all this text can be a little
            // bit bigger, it should all be the same size as... these
            // numbers [the Weekly/Monthly Revenue rows' own text-sm]" and
            // "clear can be on same line as date and $ amount for mobile":
            // one plain row at every width now — period label + total on
            // the left (same text-sm as the rest of the page, no more
            // mobile-only shrinking), Clear on the right.
            <div className="mt-3 flex items-baseline justify-between gap-2 text-sm text-slate-500">
              <span className="whitespace-nowrap">
                <span className="font-semibold text-slate-800">{periodFilter.label}</span>
                {"  "}
                {formatCents(rows.reduce((sum, { job }) => sum + (job.invoice_total_cents ?? 0), 0))}
              </span>
              <button onClick={() => setPeriodFilter(null)} className="-m-1.5 shrink-0 p-1.5 text-brand-600 underline">
                Clear
              </button>
            </div>
          ) : (
            filter === "sent" && (
              <div className="mt-3 text-sm text-slate-500">
                Total Amount Pending <span className="font-semibold text-slate-800">{formatCents(listSummary.awaitingPaymentCents)}</span>
              </div>
            )
          )}

          {rows.length > 0 && (
            <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {rows.map(({ job, status }) => {
                const isNewtonAutoCharge = status === "sent" && job.customers?.company_id === NEWTON_FIRE_FLOOD_COMPANY_ID;
                const labInvoiceDocId = latestLabInvoiceDocId(job);
                return (
                  <JobRow
                    key={job.id}
                    job={job}
                    onOpen={() => setSelectedJobId(job.id)}
                    right={
                      <MoneyGrid
                        revenueCents={job.invoice_total_cents ?? 0}
                        labCostCents={job.lab_cost_cents}
                        estimatedLabCostCents={job.lab_cost_cents == null ? totalSampleCount(job) * avgLabCostPerSampleCents : undefined}
                        stripeFeeCents={job.stripe_fee_cents ?? 0}
                        marginCents={job.lab_cost_cents != null ? computeMarginCents(job.invoice_total_cents ?? 0, job.lab_cost_cents, job.stripe_fee_cents ?? 0) : null}
                        invoiceHref={job.invoice_total_cents != null ? `/api/admin/jobs/${job.id}/invoice` : null}
                        labInvoiceHref={labInvoiceDocId ? `/api/admin/jobs/${job.id}/documents/${labInvoiceDocId}` : null}
                      />
                    }
                    below={
                      // Per Tim, 2026-08-30 — "all of this text should be
                      // the exact same size": every string in this card
                      // was already 12px (text-xs) — font-medium on the
                      // status pill was the one thing making it read as
                      // bigger than the rest at the same point size.
                      <div className="mt-0.5 flex w-full items-center justify-between gap-2">
                        <span className={`shrink-0 whitespace-nowrap rounded px-1.5 py-0.5 text-xs ${STATUS_PILL_CLASS}`}>
                          {STATUS_LABEL[status]}
                        </span>
                        <div className="text-right text-xs text-slate-500">
                          {status === "paid" ? (
                            <>Paid {formatDate(job.paid_date)}</>
                          ) : (
                            <>
                              {isNewtonAutoCharge ? "To be charged on " : "Due by "}{formatDate(dueDateFor(job))}
                            </>
                          )}
                        </div>
                      </div>
                    }
                  />
                );
              })}
            </div>
          )}
        </>
      )}

      {(() => {
        const detailJob = selectedJobId ? jobs.find((j) => j.id === selectedJobId) : null;
        if (!detailJob) return null;
        return (
          <ProjectDetailDialog
            job={detailJob}
            onClose={() => setSelectedJobId(null)}
            onChanged={() => loadJobs()}
            onEdit={() => setEditingJobId(detailJob.id)}
            onStatusChange={(status) => patchJob(detailJob, { status })}
            initialTab="invoice"
          />
        );
      })()}

      {(() => {
        const editJob = editingJobId ? jobs.find((j) => j.id === editingJobId) : null;
        if (!editJob) return null;
        return <EditProjectDialog job={editJob} onClose={() => setEditingJobId(null)} onSaved={() => loadJobs()} />;
      })()}
    </div>
  );
}
