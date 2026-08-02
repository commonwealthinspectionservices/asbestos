"use client";

import { useEffect, useMemo, useState } from "react";
import type { JobWithCustomer } from "@/lib/types";
import { formatCents } from "@/lib/pricing";
import { ProjectDetailDialog, EditProjectDialog, EnterLabResultsDialog, reportIsComplete } from "@/components/admin/JobsDashboard";

type InvoiceStatus = "not_ready" | "ready_to_send" | "sent" | "overdue" | "paid";

const STATUS_LABEL: Record<InvoiceStatus, string> = {
  not_ready: "Not Ready",
  ready_to_send: "Ready to Send",
  sent: "Sent",
  overdue: "Overdue",
  paid: "Paid",
};

const STATUS_COLOR: Record<InvoiceStatus, string> = {
  not_ready: "bg-amber-100 text-amber-700",
  ready_to_send: "bg-slate-200 text-slate-700",
  sent: "bg-blue-100 text-blue-700",
  overdue: "bg-red-100 text-red-700",
  paid: "bg-emerald-100 text-emerald-700",
};

function formatDate(date: string | null | undefined): string {
  if (!date) return "—";
  const [y, m, d] = date.split("-");
  if (!y || !m || !d) return date;
  return `${m}/${d}/${y}`;
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
  if (!reportIsComplete(job)) return "not_ready";
  return "ready_to_send";
}

type FilterKey = "all" | "not_ready" | "ready_to_send" | "sent" | "overdue" | "paid";
const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "ready_to_send", label: "Ready to Send" },
  { key: "sent", label: "Sent (Unpaid)" },
  { key: "overdue", label: "Overdue" },
  { key: "paid", label: "Paid" },
];

export default function InvoicesView() {
  const [jobs, setJobs] = useState<JobWithCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [editingJobId, setEditingJobId] = useState<string | null>(null);
  const [resultsJob, setResultsJob] = useState<JobWithCustomer | null>(null);

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

  const invoicedJobs = useMemo(
    () => jobs.filter((j) => j.invoice_total_cents != null),
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
    return invoicedJobs
      .map((job) => ({ job, status: invoiceStatus(job) }))
      .filter(({ status }) => filter === "all" || status === filter)
      .sort((a, b) => {
        if (a.status === "paid" && b.status !== "paid") return 1;
        if (b.status === "paid" && a.status !== "paid") return -1;
        if (a.status === "paid" && b.status === "paid") {
          return (b.job.paid_date ?? "").localeCompare(a.job.paid_date ?? "");
        }
        const aDue = dueDateFor(a.job) ?? "9999-99-99";
        const bDue = dueDateFor(b.job) ?? "9999-99-99";
        return aDue.localeCompare(bDue);
      });
  }, [invoicedJobs, filter]);

  const summary = useMemo(() => {
    let outstandingCents = 0;
    let overdueCents = 0;
    let overdueCount = 0;
    for (const job of invoicedJobs) {
      const status = invoiceStatus(job);
      if (status === "paid") continue;
      outstandingCents += job.invoice_total_cents ?? 0;
      if (status === "overdue") {
        overdueCents += job.invoice_total_cents ?? 0;
        overdueCount++;
      }
    }
    return { outstandingCents, overdueCents, overdueCount };
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

      <div className="mt-3 flex flex-wrap gap-4 rounded-lg border border-slate-200 bg-white p-3 text-sm">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Outstanding</div>
          <div className="text-base font-semibold text-slate-800">{formatCents(summary.outstandingCents)}</div>
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Overdue</div>
          <div className="text-base font-semibold text-red-600">
            {formatCents(summary.overdueCents)}
            {summary.overdueCount > 0 && <span className="ml-1 text-xs font-normal text-red-500">({summary.overdueCount})</span>}
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
              filter === f.key ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && <div className="mt-3 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

      {loading ? (
        <p className="mt-6 text-sm text-slate-500">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="mt-6 text-sm text-slate-500">No invoices in this view.</p>
      ) : (
        <div className="mt-4 space-y-2">
          {rows.map(({ job, status }) => (
            <button
              key={job.id}
              onClick={() => setSelectedJobId(job.id)}
              className="flex w-full items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3 text-left hover:border-brand-400"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {job.project_number && (
                    <span className="shrink-0 whitespace-nowrap rounded bg-slate-100 px-1.5 py-0.5 text-xs font-mono text-slate-600">{job.project_number}</span>
                  )}
                  <span className="truncate font-medium text-slate-800">
                    {job.customers?.company || job.customers?.name}
                  </span>
                </div>
                {(status === "paid" || job.invoice_sent_at) && (
                  <div className="mt-0.5 truncate text-sm text-slate-500">
                    {status === "paid"
                      ? `Paid ${formatDate(job.paid_date)}`
                      : `Sent ${formatDate(job.invoice_sent_at!.slice(0, 10))} · Due ${formatDate(dueDateFor(job))}`}
                  </div>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="text-sm font-semibold text-slate-800">{formatCents(job.invoice_total_cents ?? 0)}</span>
                <span className={`rounded-full px-2 py-1 text-xs font-medium ${STATUS_COLOR[status]}`}>{STATUS_LABEL[status]}</span>
              </div>
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
            onEnterResults={() => setResultsJob(detailJob)}
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

      {resultsJob && (
        <EnterLabResultsDialog
          job={resultsJob}
          onClose={() => setResultsJob(null)}
          onDone={() => {
            setResultsJob(null);
            loadJobs();
          }}
        />
      )}
    </div>
  );
}
