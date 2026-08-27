"use client";

import { useEffect, useMemo, useState } from "react";
import type { JobWithCustomer } from "@/lib/types";
import { formatCents } from "@/lib/pricing";
import { ProjectDetailDialog, EditProjectDialog, reportIsComplete } from "@/components/admin/JobsDashboard";
import { formatDateMDY } from "@/lib/date-format";

type InvoiceStatus = "ready_to_send" | "sent" | "overdue" | "paid";

const STATUS_LABEL: Record<InvoiceStatus, string> = {
  ready_to_send: "Ready to Send",
  sent: "Sent",
  overdue: "Overdue",
  paid: "Paid",
};

const STATUS_COLOR: Record<InvoiceStatus, string> = {
  ready_to_send: "bg-slate-200 text-slate-700",
  sent: "bg-blue-100 text-blue-700",
  overdue: "bg-red-100 text-red-700",
  paid: "bg-emerald-100 text-emerald-700",
};

function formatDate(date: string | null | undefined): string {
  return formatDateMDY(date) ?? "—";
}

// Every repeat customer/contractor invoice is due 30 days after the project
// date, no exceptions — same fixed rule as JobsDashboard.tsx's own copy of
// this (kept duplicated rather than shared, matching this codebase's
// existing convention of each view owning its small date helpers).
function paymentDueDate(projectDate: string): string | null {
  if (!projectDate) return null;
  const d = new Date(`${projectDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + 30);
  return d.toISOString().slice(0, 10);
}

function dueDateFor(job: JobWithCustomer): string | null {
  return job.payment_due_date || paymentDueDate(job.requested_date ?? "");
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

type FilterKey = "all" | "ready_to_send" | "sent" | "overdue" | "paid";
const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "ready_to_send", label: "Ready to Send" },
  { key: "sent", label: "Sent (Unpaid)" },
  { key: "overdue", label: "Overdue" },
  { key: "paid", label: "Paid" },
];

// Same field/word-matching pattern as the Projects tab's own Search by row
// (JobsDashboard.tsx) — kept duplicated rather than shared, matching this
// file's existing convention of owning its own small helpers (see
// paymentDueDate above).
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

export default function InvoicesView() {
  const [jobs, setJobs] = useState<JobWithCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [editingJobId, setEditingJobId] = useState<string | null>(null);
  // Per Tim, 2026-08-27 — same Sort by/Search by row as the Projects tab.
  // Default: newest project number first, same reasoning as Projects' own
  // default (a job just billed shows up at the top with no extra clicks).
  const [sortBy, setSortBy] = useState<SortField>("project_number");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [projectNumberQuery, setProjectNumberQuery] = useState("");
  const [companyQuery, setCompanyQuery] = useState("");
  const [addressQuery, setAddressQuery] = useState("");
  // Mobile only — one search box standing in for the desktop's three
  // separate fields, matched with OR against all three (see filteredRows).
  const [mobileSearch, setMobileSearch] = useState("");

  function toggleSort(field: SortField) {
    if (sortBy === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      return;
    }
    setSortBy(field);
    setSortDir("asc");
  }

  function loadJobs() {
    setLoading(true);
    setError(null);
    return fetch("/api/admin/jobs")
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error ?? "Failed to load invoices");
        setJobs(data.jobs);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load invoices"))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadJobs();
  }, []);

  // A job isn't a real invoice yet until its report is actually done — the
  // total often gets set automatically well before that (see invoice_auto).
  // Once sent or paid, though, the report being "complete" no longer
  // matters — this is history at that point, not a thing to hide.
  const invoicedJobs = useMemo(
    () =>
      jobs.filter(
        // A subcontracted job has no invoice of its own — the company that
        // sent it handles billing on their end — so it never belongs here
        // even if it somehow picked up an invoice_total_cents value.
        (j) => j.source !== "subcontractor" && j.invoice_total_cents != null && (j.invoice_sent_at || j.paid_date || reportIsComplete(j))
      ),
    [jobs]
  );

  // invoice_sent_at only ever gets set as a side effect of hitting
  // draft-status (see that route's own comment) — normally triggered by
  // opening a job's Email tab. Here, fire it once per job that's drafted
  // but not yet confirmed sent or paid, so this list reflects Gmail's real
  // state without requiring a visit to every project individually.
  useEffect(() => {
    const needsCheck = invoicedJobs.filter(
      (j) => j.invoice_drafted_at && !j.invoice_sent_at && !j.paid_date
    );
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
        results.filter((r): r is { id: string; data: { status: string; sentAt?: string } } => Boolean(r) && r!.data.status === "sent")
          .map((r) => [r!.id, r!.data.sentAt as string])
      );
      if (sentById.size === 0) return;
      setJobs((prev) => prev.map((j) => (sentById.has(j.id) ? { ...j, invoice_sent_at: sentById.get(j.id)! } : j)));
    });
    return () => {
      cancelled = true;
    };
    // Only re-run when the underlying job list changes, not on every
    // invoicedJobs recompute (a new array identity each render).
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

  const summary = useMemo(() => {
    let outstandingCents = 0;
    let overdueCents = 0;
    let overdueCount = 0;
    // Per Tim, 2026-08-27 — distinct from Outstanding (which also counts
    // invoices still sitting at Ready to Send, never emailed yet): this is
    // specifically money that's actually gone out to a customer and hasn't
    // come back yet, sent or overdue either one.
    let awaitingPaymentCents = 0;
    for (const job of invoicedJobs) {
      const status = invoiceStatus(job);
      if (status === "paid") continue;
      outstandingCents += job.invoice_total_cents ?? 0;
      if (status === "sent" || status === "overdue") {
        awaitingPaymentCents += job.invoice_total_cents ?? 0;
      }
      if (status === "overdue") {
        overdueCents += job.invoice_total_cents ?? 0;
        overdueCount++;
      }
    }
    return { outstandingCents, overdueCents, overdueCount, awaitingPaymentCents };
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
      <h1 className="text-lg font-semibold text-slate-800">Invoices</h1>

      {/* Mobile: a dropdown, same pattern as the Directory's tab selector
          and the Projects page's status filter — five labels (especially
          "Sent (Unpaid)") don't fit comfortably as buttons at this width.
          Sits above the Outstanding/Overdue summary on mobile; desktop's
          own button row stays below it, unchanged. */}
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

      <div className="mt-3 flex flex-wrap gap-4 rounded-lg border border-slate-200 bg-white p-3 text-sm">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Outstanding</div>
          <div className="text-base font-semibold text-slate-800">{formatCents(summary.outstandingCents)}</div>
        </div>
        <div>
          {/* Per Tim, 2026-08-27 — distinct from Outstanding: only invoices
              actually emailed to the customer already (sent or overdue),
              not ones still sitting at Ready to Send. */}
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Awaiting Payment</div>
          <div className="text-base font-semibold text-slate-800">{formatCents(summary.awaitingPaymentCents)}</div>
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Overdue</div>
          <div className="text-base font-semibold text-red-600">
            {formatCents(summary.overdueCents)}
            {summary.overdueCount > 0 && <span className="ml-1 text-xs font-normal text-red-500">({summary.overdueCount})</span>}
          </div>
        </div>
      </div>

      <div className="mt-3 hidden gap-1.5 sm:flex sm:flex-wrap">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium ${
              filter === f.key ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Per Tim, 2026-08-27 — same Sort by/Search by row the Projects tab
          has. Mobile: one sort dropdown + one search box standing in for
          the desktop's three separate search fields, same pattern as
          Projects' own mobile row. */}
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
            onClick={() => toggleSort(f.key)}
            className={`shrink-0 rounded-lg px-2.5 py-1 text-sm font-medium ${sortBy === f.key ? "bg-slate-700 text-white" : "bg-slate-100 text-slate-600"}`}
          >
            {f.label}{sortBy === f.key ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
          </button>
        ))}
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

      {error && <div className="mt-3 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

      {loading ? (
        <p className="mt-6 text-sm text-slate-500">Loading…</p>
      ) : rows.length === 0 ? null : (
        <div className="mt-4 space-y-2">
          {rows.map(({ job, status }) => (
            <button
              key={job.id}
              onClick={() => setSelectedJobId(job.id)}
              className="flex w-full flex-col gap-0.5 rounded-lg border border-slate-200 bg-white p-3 text-left hover:border-brand-400"
            >
              <div className="flex w-full items-center justify-between gap-2">
                <div className="flex min-w-0 flex-nowrap items-center gap-1.5">
                  {job.project_number && (
                    <span className="shrink-0 whitespace-nowrap rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-mono text-slate-600 sm:text-xs">{job.project_number}</span>
                  )}
                  {/* Per Tim, 2026-08-27 — company, price, and status all
                      stay on one line together (this used to wrap company
                      onto its own line below the project #). Truncates
                      only as a last resort for a name too long to fit
                      alongside everything else — a normal-length one now
                      has real room instead of being squeezed against the
                      price/pill column. */}
                  <span className="min-w-0 truncate text-sm font-medium text-slate-800 sm:text-base">
                    {job.customers?.company || job.customers?.name}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="whitespace-nowrap text-sm font-semibold text-slate-800">{formatCents(job.invoice_total_cents ?? 0)}</span>
                  {/* Per Tim, 2026-08-27 — fixed width so every status pill
                      lines up the same regardless of label length ("Ready
                      to Send" vs "Sent"). */}
                  <span className={`w-24 shrink-0 whitespace-nowrap rounded-lg px-1.5 py-1 text-center text-[11px] font-medium sm:w-28 sm:px-2 sm:text-xs ${STATUS_COLOR[status]}`}>{STATUS_LABEL[status]}</span>
                </div>
              </div>
              {status === "paid" && (
                <div className="text-xs text-slate-500 sm:text-sm">Paid {formatDate(job.paid_date)}</div>
              )}
              {/* Per Tim, 2026-08-27 — Due pushed all the way to the card's
                  own right edge (matching the price/pill column above it),
                  not just the right edge of the company/project column —
                  spans the full row instead of nesting inside that column. */}
              {status !== "paid" && (
                <div className="flex w-full items-center justify-between gap-2 text-xs text-slate-500 sm:text-sm">
                  <span className="whitespace-nowrap">{job.invoice_sent_at ? `Sent ${formatDate(job.invoice_sent_at.slice(0, 10))}` : ""}</span>
                  <span className="whitespace-nowrap">Due {formatDate(dueDateFor(job))}</span>
                </div>
              )}
            </button>
          ))}
        </div>
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
          />
        );
      })()}

      {(() => {
        const editJob = editingJobId ? jobs.find((j) => j.id === editingJobId) : null;
        if (!editJob) return null;
        return (
          <EditProjectDialog
            job={editJob}
            onClose={() => setEditingJobId(null)}
            onSaved={() => loadJobs()}
          />
        );
      })()}
    </div>
  );
}
