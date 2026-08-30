"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
// difference... it feels like too much on one page": two different page
// layouts behind one toggle just traded three pages for two. Collapsed
// into ONE list (filter/search always available, same as the old Invoices
// page) with an optional "Group by" control (None/Week/Month/Year) that
// reorganizes that same list into sections instead of swapping to a
// different layout. One JobRow component renders every row everywhere.

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

// Per Tim, 2026-08-28 — invoice_sent_at/document uploaded_at are full UTC
// timestamps, not plain dates. Naively slicing the first 10 characters
// grabs the UTC calendar date, which disagrees with local (Eastern) time
// once something happens late evening. new Date(iso)'s local getters give
// the calendar date this browser's timezone actually saw it on.
function localDateOnly(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function isPastDue(dueIso: string | null): boolean {
  if (!dueIso) return false;
  const due = new Date(`${dueIso}T00:00:00`);
  if (Number.isNaN(due.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return due.getTime() < today.getTime();
}

function invoiceStatus(job: JobWithCustomer): InvoiceStatus {
  if (job.paid_date) return "paid";
  if (job.invoice_sent_at) return isPastDue(dueDateFor(job)) ? "overdue" : "sent";
  return "ready_to_send";
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

// Per Tim, 2026-08-30 — one row component for every list in this page
// (By Job and every period group in By Period) — the badge/company/
// address block is the exact thing that needed the same fixes three
// separate times across the old Invoices/Lab Costs/Margins pages this
// session; now there's exactly one place to fix. `right` is whatever
// financial/status content that particular view needs next to it.
function JobRow({ job, onOpen, right }: { job: JobWithCustomer; onOpen: () => void; right: React.ReactNode }) {
  return (
    <button
      onClick={onOpen}
      // Per Tim, 2026-08-30 — "these cells shouldn't have so much blank
      // space" (round 1): justify-between stretched `right` all the way to
      // the card's own far edge, leaving a big dead gap in the middle on a
      // wide row with a short company name — fixed by left-aligning
      // instead. Then cards moved to a two-per-row grid, which made every
      // card narrow enough that `right` almost always wraps onto its own
      // line below the address block anyway — and on that line, an
      // unstretched flex item just hugs the left edge, leaving blank space
      // on the right (round 3: "make it so the text fills out those cells
      // entirely"). Rather than rely on flex-wrap's per-line behavior,
      // this now always stacks top block / bottom block and stretches the
      // bottom block's own row to the card's full width so its content can
      // right-align flush to the actual right edge every time.
      className="flex w-full flex-col gap-1.5 rounded-lg border border-slate-200 bg-white p-3 text-left hover:border-brand-400"
    >
      <div>
        <div className="flex items-start gap-2">
          <span className="mt-0.5 shrink-0 whitespace-nowrap rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-600">
            {job.project_number}
          </span>
          <span className="whitespace-nowrap text-sm font-medium text-slate-800">
            {job.customers?.company || job.customers?.name}
          </span>
        </div>
        <AddressLines address={job.service_address} />
      </div>
      <div className="flex w-full justify-end">{right}</div>
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
  return (
    <div className="grid shrink-0 grid-cols-[auto_auto] items-baseline justify-end gap-x-2 gap-y-0.5 text-xs">
      <span className="text-right text-slate-400">Invoice</span>
      <span className="whitespace-nowrap text-right text-slate-700">{formatCents(revenueCents)}</span>
      <span className="text-right text-slate-400">Lab Cost</span>
      <span className="whitespace-nowrap text-right text-slate-700">{labCostCents != null ? formatCents(labCostCents) : "—"}</span>
      {stripeFeeCents !== 0 && (
        <>
          <span className="text-right text-slate-400">Stripe Fee</span>
          <span className="whitespace-nowrap text-right text-slate-700">{formatCents(stripeFeeCents)}</span>
        </>
      )}
      <span className="text-right text-slate-400">Margin</span>
      <span className={`whitespace-nowrap text-right ${marginCents != null && marginCents < 0 ? "text-red-600" : "text-slate-700"}`}>
        {marginCents != null ? formatCents(marginCents) : "—"}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------
// By Job (Invoices' old filter/sort/search list)
// ---------------------------------------------------------------------

type FilterKey = "all" | "sent" | "overdue" | "paid";
const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "All" },
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

// ---------------------------------------------------------------------
// By Period (Lab Costs' real weekly reports + Margins' weekly/monthly/
// yearly rollups)
// ---------------------------------------------------------------------

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// Per Tim, 2026-08-30 — "none" replaces the old By Job/By Period toggle:
// the flat, ungrouped list is just one more "Group by" option now (the
// default one) instead of a separate page layout.
type GroupByKey = "none" | "weekly" | "monthly" | "yearly";
const GROUP_BY_OPTIONS: { key: GroupByKey; label: string }[] = [
  { key: "none", label: "None" },
  { key: "weekly", label: "Week" },
  { key: "monthly", label: "Month" },
  { key: "yearly", label: "Year" },
];

interface PeriodJobEntry {
  job: JobWithCustomer;
  revenueCents: number;
  labCostCents: number;
  stripeFeeCents: number;
  marginCents: number;
}

interface PeriodGroup {
  key: string;
  label: string;
  sortKey: string;
  jobEntries: PeriodJobEntry[];
  revenueCents: number;
  labCostCents: number;
  stripeFeeCents: number;
  marginCents: number;
  // Only set for real weekly reports (a real email Crystal/QuickBooks
  // sent) — monthly/yearly are synthetic buckets with no such document.
  totalCents?: number | null;
  pdfLink?: { jobId: string; docId: string } | null;
  unlinkedCents?: number | null;
}

// Per Tim, 2026-08-29 — marginCents comes from computeMarginCents
// (lib/pricing.ts), the same function the per-job Profit line on the
// Invoice tab uses, rather than a second, independently computed margin
// figure for the same job — those two drifted out of sync once already.
function summarizeGroup(
  key: string, label: string, sortKey: string,
  jobsInGroup: { job: JobWithCustomer; labCostCents: number }[],
  extra?: { totalCents: number | null; pdfLink: { jobId: string; docId: string } | null }
): PeriodGroup {
  const jobEntries = jobsInGroup
    .map(({ job, labCostCents }) => {
      const revenueCents = job.invoice_total_cents ?? 0;
      const stripeFeeCents = job.stripe_fee_cents ?? 0;
      return { job, revenueCents, labCostCents, stripeFeeCents, marginCents: computeMarginCents(revenueCents, labCostCents, stripeFeeCents) };
    })
    .sort((a, b) => (a.job.project_number ?? "").localeCompare(b.job.project_number ?? ""));
  const revenueCents = jobEntries.reduce((sum, e) => sum + e.revenueCents, 0);
  const labCostCents = jobEntries.reduce((sum, e) => sum + e.labCostCents, 0);
  const stripeFeeCents = jobEntries.reduce((sum, e) => sum + e.stripeFeeCents, 0);
  const unlinkedCents = extra && extra.totalCents != null ? extra.totalCents - labCostCents : null;
  return {
    key, label, sortKey, jobEntries, revenueCents, labCostCents, stripeFeeCents,
    marginCents: computeMarginCents(revenueCents, labCostCents, stripeFeeCents),
    ...(extra ? { totalCents: extra.totalCents, pdfLink: extra.pdfLink, unlinkedCents } : {}),
  };
}

export default function BillingView() {
  const [jobs, setJobs] = useState<JobWithCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [editingJobId, setEditingJobId] = useState<string | null>(null);

  // Per Tim, 2026-08-30 — filter/sort/search apply everywhere now, not
  // just in an ungrouped view — one consistent set of controls regardless
  // of how the list below is grouped.
  const [filter, setFilter] = useState<FilterKey>("all");
  const [sortBy, setSortBy] = useState<SortField>("project_number");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [projectNumberQuery, setProjectNumberQuery] = useState("");
  const [companyQuery, setCompanyQuery] = useState("");
  const [addressQuery, setAddressQuery] = useState("");
  const [mobileSearch, setMobileSearch] = useState("");

  // "Group by" replaces the old By Job/By Period toggle — see this file's
  // own top comment.
  const [groupBy, setGroupBy] = useState<GroupByKey>("none");
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());

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

  // ---- By Job ----

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
    if (filter !== "all") result = result.filter(({ status }) => status === filter);

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
    let overdueCents = 0;
    let overdueCount = 0;
    let awaitingPaymentCents = 0;
    for (const job of invoicedJobs) {
      const status = invoiceStatus(job);
      if (status === "paid") continue;
      if (status === "sent" || status === "overdue") awaitingPaymentCents += job.invoice_total_cents ?? 0;
      if (status === "overdue") {
        overdueCents += job.invoice_total_cents ?? 0;
        overdueCount++;
      }
    }
    return { overdueCents, overdueCount, awaitingPaymentCents };
  }, [invoicedJobs]);

  // ---- By Period ----

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
      }
    >();
    for (const job of jobs) {
      for (const doc of job.documents ?? []) {
        if (doc.kind !== "lab_invoice" || doc.report_total_cents == null) continue;
        const key = doc.report_date_range ?? doc.content_hash ?? "unknown";
        let g = groups.get(key);
        if (!g) {
          g = { dateRange: doc.report_date_range ?? null, totalCents: doc.report_total_cents, receivedAt: doc.uploaded_at, jobAmounts: new Map(), seenNumsByJob: new Map(), pdfLink: null };
          groups.set(key, g);
        }
        if (!g.pdfLink && doc.file_name.startsWith("weekly-lab-summary")) {
          g.pdfLink = { jobId: job.id, docId: doc.id };
        }
        if (doc.uploaded_at > g.receivedAt) g.receivedAt = doc.uploaded_at;

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
        const jobsInGroup = Array.from(g.jobAmounts.entries()).map(([jobId, labCostCents]) => ({
          job: jobs.find((j) => j.id === jobId)!,
          labCostCents,
        }));
        const label = g.dateRange ?? formatDate(localDateOnly(g.receivedAt));
        return { ...summarizeGroup(key, label, g.receivedAt, jobsInGroup, { totalCents: g.totalCents, pdfLink: g.pdfLink }), receivedAt: g.receivedAt };
      })
      .sort((a, b) => (a.sortKey < b.sortKey ? 1 : -1));
  }, [jobs]);

  const monthlyGroups = useMemo(() => {
    const groups = new Map<string, JobWithCustomer[]>();
    for (const job of jobs) {
      if (!(job.documents ?? []).some((d) => d.kind === "lab_invoice")) continue;
      const bucketDate = job.confirmed_date ?? job.requested_date;
      if (!bucketDate) continue;
      const key = bucketDate.slice(0, 7);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(job);
    }
    return Array.from(groups.entries())
      .map(([key, jobsInGroup]) => {
        const [y, m] = key.split("-");
        const label = `${MONTH_NAMES[Number(m) - 1]} ${y}`;
        return summarizeGroup(key, label, key, jobsInGroup.map((job) => ({ job, labCostCents: job.lab_cost_cents ?? 0 })));
      })
      .sort((a, b) => (a.sortKey < b.sortKey ? 1 : -1));
  }, [jobs]);

  const yearlyGroups = useMemo(() => {
    const groups = new Map<string, JobWithCustomer[]>();
    for (const job of jobs) {
      if (!(job.documents ?? []).some((d) => d.kind === "lab_invoice")) continue;
      const bucketDate = job.confirmed_date ?? job.requested_date;
      if (!bucketDate) continue;
      const key = bucketDate.slice(0, 4);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(job);
    }
    return Array.from(groups.entries())
      .map(([key, jobsInGroup]) => summarizeGroup(key, key, key, jobsInGroup.map((job) => ({ job, labCostCents: job.lab_cost_cents ?? 0 }))))
      .sort((a, b) => (a.sortKey < b.sortKey ? 1 : -1));
  }, [jobs]);

  const hasAutoExpandedYearly = useRef(false);
  useEffect(() => {
    if (hasAutoExpandedYearly.current || yearlyGroups.length === 0) return;
    const currentYear = String(new Date().getFullYear());
    if (yearlyGroups.some((g) => g.key === currentYear)) {
      setExpandedKeys((prev) => new Set(prev).add(`yearly:${currentYear}`));
    }
    hasAutoExpandedYearly.current = true;
  }, [yearlyGroups]);

  const hasAutoExpandedThisWeek = useRef(false);
  useEffect(() => {
    if (hasAutoExpandedThisWeek.current || weeklyReports.length === 0) return;
    setExpandedKeys((prev) => new Set(prev).add(`weekly:${weeklyReports[0].key}`));
    hasAutoExpandedThisWeek.current = true;
  }, [weeklyReports]);

  // Per Tim, 2026-08-30 — "every single job should go on this page
  // regardless of whether or not we have a lab invoice so that we can
  // keep track of which ones we have and which ones we don't."
  const jobsWithoutLabInvoice = useMemo(() => {
    const todayStr = ymd(new Date());
    return jobs
      .filter((j) => j.confirmed_date && j.confirmed_date <= todayStr)
      .filter((j) => !(j.documents ?? []).some((d) => d.kind === "lab_invoice"))
      .sort((a, b) => (b.confirmed_date ?? "").localeCompare(a.confirmed_date ?? ""));
  }, [jobs]);

  const groups = groupBy === "weekly" ? weeklyReports : groupBy === "monthly" ? monthlyGroups : yearlyGroups;
  const emptyMessage = groupBy === "weekly" ? "No weekly reports received yet." : "No jobs with a confirmed date yet.";

  // Per Tim, 2026-08-30 — the filter pills/search boxes below apply
  // whether or not the list is grouped, so this needs to work against a
  // plain job the same way rows' own filtering does. Status filter (All/
  // Payment Pending/Overdue/Paid) is checked separately in each branch
  // below since a period jobEntry doesn't carry its own precomputed status.
  function matchesSearch(job: JobWithCustomer): boolean {
    if (projectNumberQuery.trim() && !matchesAnyWord(job.project_number ?? "", projectNumberQuery)) return false;
    if (companyQuery.trim() && !matchesAnyWord(job.customers?.company || job.customers?.name || "", companyQuery)) return false;
    if (addressQuery.trim() && !matchesAnyWord(job.service_address ?? "", addressQuery)) return false;
    if (mobileSearch.trim()) {
      const hit =
        matchesAnyWord(job.project_number ?? "", mobileSearch) ||
        matchesAnyWord(job.customers?.company || job.customers?.name || "", mobileSearch) ||
        matchesAnyWord(job.service_address ?? "", mobileSearch);
      if (!hit) return false;
    }
    return true;
  }

  // Per Tim, 2026-08-30 — same filter pills/search apply to a grouped
  // view too, not just the flat list — one consistent set of controls
  // regardless of grouping. Recomputes each group's own totals from just
  // the jobs that still match, so "Total"/"margin" in a filtered group
  // reflects what's actually shown below it; totalCents/pdfLink/
  // unlinkedCents stay the real report's own numbers either way, since
  // those describe the actual weekly email, not the current UI filter.
  const filteredGroups = useMemo(() => {
    return groups
      .map((g) => {
        const jobEntries = g.jobEntries.filter(
          (e) => (filter === "all" || invoiceStatus(e.job) === filter) && matchesSearch(e.job)
        );
        const revenueCents = jobEntries.reduce((s, e) => s + e.revenueCents, 0);
        const labCostCents = jobEntries.reduce((s, e) => s + e.labCostCents, 0);
        const stripeFeeCents = jobEntries.reduce((s, e) => s + e.stripeFeeCents, 0);
        return { ...g, jobEntries, revenueCents, labCostCents, stripeFeeCents, marginCents: computeMarginCents(revenueCents, labCostCents, stripeFeeCents) };
      })
      .filter((g) => g.jobEntries.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, filter, projectNumberQuery, companyQuery, addressQuery, mobileSearch]);

  // Stat tiles stay off the ORIGINAL (unfiltered) groups — same idea as
  // Pending Payment/Overdue below, which are also business-wide totals,
  // not a number that shifts as you type into a search box.
  const periodSummary = useMemo(() => {
    return groups.reduce(
      (acc, g) => ({ revenueCents: acc.revenueCents + g.revenueCents, marginCents: acc.marginCents + g.marginCents }),
      { revenueCents: 0, marginCents: 0 }
    );
  }, [groups]);

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
      <h1 className="text-lg font-semibold text-slate-800">Billing</h1>

      {/* Per Tim, 2026-08-30 — "don't understand the difference" between
          By Job / By Period: replaced that page-level toggle with a single
          "Group by" control that reorganizes one list instead of swapping
          to a different layout. */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="shrink-0 text-sm font-medium text-slate-500">Group by:</span>
        <div className="flex gap-1.5">
          {GROUP_BY_OPTIONS.map((g) => (
            <button
              key={g.key}
              onClick={() => setGroupBy(g.key)}
              className={`shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium ${groupBy === g.key ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"}`}
            >
              {g.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-4 rounded-lg border border-slate-200 bg-white p-3 text-sm">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Pending Payment</div>
          <div className="text-base font-semibold text-slate-800">{formatCents(listSummary.awaitingPaymentCents)}</div>
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Overdue</div>
          <div className="text-base font-semibold text-slate-800">
            {formatCents(listSummary.overdueCents)}
            {listSummary.overdueCount > 0 && <span className="ml-1 text-xs font-normal text-slate-500">({listSummary.overdueCount})</span>}
          </div>
        </div>
        {groupBy !== "none" && (
          <>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Revenue ({GROUP_BY_OPTIONS.find((g) => g.key === groupBy)!.label})</div>
              <div className="text-base font-semibold text-slate-800">{formatCents(periodSummary.revenueCents)}</div>
            </div>
            <div>
              {/* Per Tim, 2026-08-30 — "Margin should have a cell in the
                  title at the top of billing page to outline all that":
                  same clarifying formula the old standalone Margins page's
                  own title carried ("Margins (Invoice − Lab Costs)"),
                  moved onto this stat tile's own label since that page no
                  longer exists on its own. */}
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Margin ({GROUP_BY_OPTIONS.find((g) => g.key === groupBy)!.label}) — Invoice − Lab Cost
              </div>
              <div className={`text-base font-semibold ${periodSummary.marginCents < 0 ? "text-red-600" : "text-slate-800"}`}>
                {formatCents(periodSummary.marginCents)}
              </div>
            </div>
          </>
        )}
      </div>

      {error && <div className="mt-3 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}
      {loading && <p className="mt-6 text-sm text-slate-500">Loading…</p>}

      {!loading && !error && (
        <>
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

          <div className="mt-3 hidden gap-1.5 sm:flex sm:flex-wrap">
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

          {/* Sort doesn't apply to a grouped display — only shown for the
              flat, ungrouped list. */}
          {groupBy === "none" && (
            <>
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

              <div className="mt-3 hidden flex-wrap items-center gap-2 sm:flex">
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
                    className={`shrink-0 rounded-lg px-2.5 py-1 text-sm font-medium ${sortBy === f.key ? "bg-slate-700 text-white" : "bg-slate-100 text-slate-600"}`}
                  >
                    {f.label}{sortBy === f.key ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                  </button>
                ))}
              </div>
            </>
          )}

          {/* Mobile search-by-field only makes sense next to the flat
              list; a grouped display just uses the single mobile search
              box above (folded into the Sort row when groupBy === "none",
              standalone here otherwise). */}
          {groupBy !== "none" && (
            <div className="mt-3 sm:hidden">
              <input
                value={mobileSearch}
                onChange={(e) => setMobileSearch(e.target.value)}
                placeholder="Search…"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          )}

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

          {groupBy === "none" && rows.length > 0 && (
            <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {rows.map(({ job, status }) => {
                const isNewtonAutoCharge = status === "sent" && job.customers?.company_id === NEWTON_FIRE_FLOOD_COMPANY_ID;
                return (
                  <JobRow
                    key={job.id}
                    job={job}
                    onOpen={() => setSelectedJobId(job.id)}
                    right={
                      // Per Tim, 2026-08-30 — "too much empty space in
                      // these cells": gap-1.5 between MoneyGrid/due-date/
                      // status pill read loose next to MoneyGrid's own
                      // tight internal gap-y-0.5 — tightened to match.
                      <div className="flex shrink-0 flex-col items-end gap-0.5">
                        <MoneyGrid
                          revenueCents={job.invoice_total_cents ?? 0}
                          labCostCents={job.lab_cost_cents}
                          stripeFeeCents={job.stripe_fee_cents ?? 0}
                          marginCents={job.lab_cost_cents != null ? computeMarginCents(job.invoice_total_cents ?? 0, job.lab_cost_cents, job.stripe_fee_cents ?? 0) : null}
                        />
                        <div className="text-right text-xs text-slate-500">
                          {status === "paid" ? (
                            <>Paid {formatDate(job.paid_date)}</>
                          ) : (
                            <>
                              {isNewtonAutoCharge ? "To be charged on " : "Due by "}{formatDate(dueDateFor(job))}
                            </>
                          )}
                        </div>
                        <span className={`shrink-0 whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_PILL_CLASS}`}>
                          {STATUS_LABEL[status]}
                        </span>
                      </div>
                    }
                  />
                );
              })}
            </div>
          )}

          {groupBy !== "none" && (
            <>
              <div className="mt-3">
                {filteredGroups.length === 0 ? (
                  <p className="rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-500">{emptyMessage}</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {filteredGroups.map((g) => {
                      const expanded = expandedKeys.has(`${groupBy}:${g.key}`);
                      return (
                        <div key={g.key} className="rounded-lg border border-slate-200 bg-white text-sm">
                          <button
                            onClick={() =>
                              setExpandedKeys((prev) => {
                                const next = new Set(prev);
                                const k = `${groupBy}:${g.key}`;
                                if (next.has(k)) next.delete(k);
                                else next.add(k);
                                return next;
                              })
                            }
                            className="flex w-full flex-wrap items-baseline justify-between gap-x-4 p-3 text-left"
                          >
                            <span className="flex items-baseline gap-2 text-sm font-medium text-brand-600">
                              <span className="mr-1 inline-block w-3 text-slate-400">{expanded ? "▾" : "▸"}</span>
                              {g.label}
                              {g.pdfLink && (
                                <a
                                  href={`/api/admin/jobs/${g.pdfLink.jobId}/documents/${g.pdfLink.docId}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="whitespace-nowrap text-sm text-slate-400 hover:text-brand-600 hover:underline"
                                >
                                  PDF ↗
                                </a>
                              )}
                            </span>
                            {/* Per Tim, 2026-08-30 — "the formatting of my
                                billing page should be more consistent": this
                                was the one place margin still got the old
                                always-colored-green-if-positive treatment —
                                every per-job Margin cell right below it (and
                                everywhere else on this page) only colors
                                red-if-negative, otherwise plain. Matched, and
                                bumped to text-sm to actually read as this
                                row's own headline number instead of smaller
                                than its own date label. */}
                            <span className={`whitespace-nowrap text-sm font-semibold ${g.marginCents < 0 ? "text-red-600" : "text-slate-800"}`}>
                              {formatCents(g.marginCents)} margin
                            </span>
                          </button>
                          {expanded && (
                            <div className="flex flex-col gap-2.5 border-t border-slate-100 p-3 pt-2">
                              <div className="text-xs text-slate-500">
                                {formatCents(g.revenueCents)} revenue − {formatCents(g.labCostCents)} lab cost
                                {g.stripeFeeCents !== 0 && <> − {formatCents(g.stripeFeeCents)} Stripe fees</>}
                              </div>
                              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                {g.jobEntries.map((e) => (
                                  <JobRow
                                    key={e.job.id}
                                    job={e.job}
                                    onOpen={() => setSelectedJobId(e.job.id)}
                                    right={
                                      <MoneyGrid
                                        revenueCents={e.revenueCents}
                                        labCostCents={e.labCostCents}
                                        stripeFeeCents={e.stripeFeeCents}
                                        marginCents={e.marginCents}
                                      />
                                    }
                                  />
                                ))}
                              </div>
                              {g.unlinkedCents != null && g.unlinkedCents !== 0 && (
                                <div className="text-xs text-slate-400">+ {formatCents(g.unlinkedCents)} not linked to a job on file</div>
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
                  we don't" — this only applies to the weekly-report grouping,
                  since that's the one tied to the real lab invoice document. */}
              {groupBy === "weekly" && (
                <div className="mt-3">
                  {jobsWithoutLabInvoice.length === 0 ? (
                    <p className="rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-500">Everything&apos;s been billed.</p>
                  ) : (
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {jobsWithoutLabInvoice.map((job) => (
                        <JobRow
                          key={job.id}
                          job={job}
                          onOpen={() => setSelectedJobId(job.id)}
                          right={<span className="shrink-0 whitespace-nowrap text-xs text-slate-400">No lab invoice yet</span>}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
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
