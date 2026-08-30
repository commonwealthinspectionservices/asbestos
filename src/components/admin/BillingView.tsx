"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import type { JobWithCustomer } from "@/lib/types";
import { formatCents, computeMarginCents } from "@/lib/pricing";
import { ProjectDetailDialog, EditProjectDialog } from "@/components/admin/JobsDashboard";
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
// STATUS_LABEL: ready_to_send → "Report and Invoice Ready", report_invoice_sent
// → "Payment Pending") rather than this view's own separate phrasing, so a
// job reads the same status whichever page you're looking at it from.
const STATUS_LABEL: Record<InvoiceStatus, string> = {
  ready_to_send: "Report and Invoice Ready",
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
// week/month a job's gross/net counts toward is the week/month its
// invoice actually went out (invoice_sent_at), not the day it was
// sampled — a Friday job invoiced the following Monday lands in the
// Monday week. This is what "which week is this revenue in" means for a
// billing page. paid_date/confirmed_date/requested_date are only
// fallbacks for the rare job missing invoice_sent_at.
function billingDateFor(job: JobWithCustomer): string | null {
  if (job.invoice_sent_at) return ymd(new Date(job.invoice_sent_at));
  return job.paid_date ?? job.confirmed_date ?? job.requested_date ?? null;
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
      <div className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0 whitespace-nowrap rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-600">
          {job.project_number}
        </span>
        <span className="whitespace-nowrap text-sm font-medium text-slate-800">
          {job.customers?.company || job.customers?.name}
        </span>
      </div>
      <div className="flex w-full flex-wrap items-start justify-between gap-x-4 gap-y-1.5">
        <AddressLines address={job.service_address} />
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
  revenueCents, labCostCents, stripeFeeCents, marginCents,
}: {
  revenueCents: number; labCostCents: number | null; stripeFeeCents: number; marginCents: number | null;
}) {
  // Per Tim, 2026-08-30 — "the text should all start in the same point,
  // the I, the L, and the M, but just move it far right": labels
  // (Invoice/Lab Cost/Margin) left-align to a common edge; values
  // right-align in their own column. The block itself is what moves far
  // right now (see JobRow's justify-between), not each line of text.
  return (
    <div className="grid shrink-0 grid-cols-[auto_auto] items-baseline gap-x-2 gap-y-0.5 text-xs">
      <span className="text-left text-slate-400">Invoice</span>
      <span className="whitespace-nowrap text-right text-slate-700">{formatCents(revenueCents)}</span>
      <span className="text-left text-slate-400">Lab Cost</span>
      <span className="whitespace-nowrap text-right text-slate-700">{labCostCents != null ? formatCents(labCostCents) : "—"}</span>
      {stripeFeeCents !== 0 && (
        <>
          <span className="text-left text-slate-400">Stripe Fee</span>
          <span className="whitespace-nowrap text-right text-slate-700">{formatCents(stripeFeeCents)}</span>
        </>
      )}
      <span className="text-left text-slate-400">Margin</span>
      <span className={`whitespace-nowrap text-right ${marginCents != null && marginCents < 0 ? "text-red-600" : "text-slate-700"}`}>
        {marginCents != null ? formatCents(marginCents) : "—"}
      </span>
    </div>
  );
}

// Per Tim, 2026-08-30 — "a simple way to keep track of net and gross for
// weeks and months over time": one plain list of period rows, gross and
// net right-aligned, no borders per row, no click targets — a glance-able
// table, not another browsable view.
function PeriodHistoryTable({
  title, rows,
}: {
  title: string; rows: { label: string; grossCents: number; netCents: number }[];
}) {
  // Per Tim, 2026-08-30 — "make sure the net numbers are lined up
  // vertically": gross/net used to trail right after the label as one
  // inline string, so the "net" column landed at a different x per row
  // depending on that row's own gross value's width. A 3-column grid
  // (label / gross / net) gives gross and net each their own fixed
  // column, aligned down every row.
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</div>
      <div className="mt-2 grid grid-cols-[1fr_auto_auto] items-baseline gap-x-3 gap-y-1">
        {rows.map((r) => (
          <Fragment key={r.label}>
            <span className="text-slate-500">{r.label}</span>
            <span className="whitespace-nowrap text-right text-slate-800">{formatCents(r.grossCents)}</span>
            <span className="whitespace-nowrap text-right text-slate-400">net {formatCents(r.netCents)}</span>
          </Fragment>
        ))}
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

type SortField = "project_number" | "due_date";
const SORT_FIELDS: { key: SortField; label: string }[] = [
  { key: "project_number", label: "Project #" },
  { key: "due_date", label: "Due date" },
];

export default function BillingView() {
  const [jobs, setJobs] = useState<JobWithCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [editingJobId, setEditingJobId] = useState<string | null>(null);

  const [filter, setFilter] = useState<FilterKey>("sent");
  const [sortBy, setSortBy] = useState<SortField>("project_number");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
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
    let result = invoicedJobs.map((job) => ({ job, status: invoiceStatus(job) })).filter(({ status }) => status === filter);

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
      const aDue = dueDateFor(a.job) ?? "9999-99-99";
      const bDue = dueDateFor(b.job) ?? "9999-99-99";
      return dir * aDue.localeCompare(bDue);
    });
  }, [invoicedJobs, filter, projectNumberQuery, companyQuery, addressQuery, mobileSearch, sortBy, sortDir]);

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
  // Bucketed by billingDateFor (see its own comment for why that's
  // invoice_sent_at, not the sampling date).
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
      return { label, startStr: ymd(start), endStr: ymd(end), grossCents: 0, netCents: 0 };
    }).filter((b) => b.endStr >= COMPANY_START_DATE);

    // Per Tim, 2026-08-30 — "instead of This Month, it should say August
    // 2026": always the literal month name and year, no relative
    // This Month/Last Month special-casing.
    const monthly = Array.from({ length: HISTORY_PERIOD_COUNT }, (_, i) => {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const label = `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
      return { label, key, grossCents: 0, netCents: 0 };
    }).filter((b) => b.key >= COMPANY_START_DATE.slice(0, 7));

    for (const job of invoicedJobs) {
      const bucketDate = billingDateFor(job);
      if (!bucketDate) continue;
      const grossCents = job.invoice_total_cents ?? 0;
      const netCents = computeMarginCents(grossCents, job.lab_cost_cents ?? 0, job.stripe_fee_cents ?? 0);

      const w = weekly.find((b) => bucketDate >= b.startStr && bucketDate <= b.endStr);
      if (w) {
        w.grossCents += grossCents;
        w.netCents += netCents;
      }

      const monthKey = bucketDate.slice(0, 7);
      const m = monthly.find((b) => b.key === monthKey);
      if (m) {
        m.grossCents += grossCents;
        m.netCents += netCents;
      }
    }

    return { weekly, monthly };
  }, [invoicedJobs]);

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
      {/* Per Tim, 2026-08-30 — "delete billing title, move sort by tool
          left, drop payment pending down and make it all on the same
          line across": the h1 and its own header row are gone; Payment
          Pending now lives in the same row as Sort by/the filter pills
          further down instead of its own line up top. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <PeriodHistoryTable title="Weekly" rows={periodHistory.weekly} />
        <PeriodHistoryTable title="Monthly" rows={periodHistory.monthly} />
      </div>

      {error && <div className="mt-3 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}
      {loading && <p className="mt-6 text-sm text-slate-500">Loading…</p>}

      {!loading && !error && (
        <>
          {/* Mobile: Payment Pending now shows here (its own header line
              is gone), above the filter/sort dropdowns. */}
          <div className="mt-3 text-sm text-slate-500 sm:hidden">
            Payment Pending <span className="font-semibold text-slate-800">{formatCents(listSummary.awaitingPaymentCents)}</span>
          </div>

          {/* Mobile: a dropdown, same pattern as the Directory's tab
              selector and the Projects page's status filter. */}
          <div className="relative mt-3 sm:hidden">
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as FilterKey)}
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
              buttons": Payment Pending's total now sits next to Sort by
              on the left, and the filter pills moved to the right edge —
              putting real distance between the two pill groups instead of
              them sitting shoulder to shoulder. */}
          <div className="mt-3 hidden items-center justify-between gap-x-4 gap-y-2 sm:flex sm:flex-wrap">
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="shrink-0 text-sm font-medium text-gray-400">Sort by:</span>
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
              <div className="text-sm text-slate-500">
                Payment Pending <span className="font-semibold text-slate-800">{formatCents(listSummary.awaitingPaymentCents)}</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  className={`shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium ${filter === f.key ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"}`}
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
              className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
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

          {rows.length > 0 && (
            <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {rows.map(({ job, status }) => {
                const isNewtonAutoCharge = status === "sent" && job.customers?.company_id === NEWTON_FIRE_FLOOD_COMPANY_ID;
                return (
                  <JobRow
                    key={job.id}
                    job={job}
                    onOpen={() => setSelectedJobId(job.id)}
                    right={
                      <MoneyGrid
                        revenueCents={job.invoice_total_cents ?? 0}
                        labCostCents={job.lab_cost_cents}
                        stripeFeeCents={job.stripe_fee_cents ?? 0}
                        marginCents={job.lab_cost_cents != null ? computeMarginCents(job.invoice_total_cents ?? 0, job.lab_cost_cents, job.stripe_fee_cents ?? 0) : null}
                      />
                    }
                    below={
                      <div className="mt-0.5 flex w-full items-center justify-between gap-2">
                        <span className={`shrink-0 whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_PILL_CLASS}`}>
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
