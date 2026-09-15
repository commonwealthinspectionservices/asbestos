"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatDateTime, formatDate } from "@/components/admin/JobsDashboard";

interface LabInvoiceDocument {
  fileName: string;
  uploadedAt: string;
  reportDateRange: string | null;
  viewHref: string;
  jobs: { id: string; projectNumber: string; address: string }[];
}

interface NotYetInvoicedJob {
  id: string;
  projectNumber: string;
  address: string;
  completedDate: string | null;
}

// Per Tim, 2026-09-15 — "one page that has one copy of every single
// daily summary or weekly summary or any invoice that I've ever been
// sent by Crystal Analytical... below each of the previews... the job
// numbers linked that are referenced in that invoice." One card per
// real, distinct document (see /api/admin/lab-invoices's own dedup-by-
// content_hash comment), newest first, each job number linking straight
// into that job on the dashboard.
export default function LabInvoicesView() {
  const [documents, setDocuments] = useState<LabInvoiceDocument[] | null>(null);
  const [notYetInvoiced, setNotYetInvoiced] = useState<NotYetInvoicedJob[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/lab-invoices")
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setDocuments(data.documents);
        setNotYetInvoiced(data.notYetInvoiced ?? []);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, []);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="text-lg font-bold text-slate-800">Lab Invoices</h1>

      {error && <div className="mt-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

      {/* Per Tim, 2026-09-15 — "show at the very top jobs that have not
          yet been invoiced": fieldwork's done, no lab_invoice document on
          file for it at all yet (see the route's own FLI exclusion —
          their lab work never bills to Commonwealth in the first place). */}
      {notYetInvoiced.length > 0 && (
        <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3">
          <div className="text-sm font-semibold text-amber-800">Not yet invoiced by Crystal</div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {notYetInvoiced.map((j) => (
              <Link
                key={j.id}
                href={`/admin/dashboard?jobId=${j.id}`}
                className="whitespace-nowrap rounded bg-white px-1.5 py-0.5 font-mono text-xs text-slate-700 shadow-sm hover:bg-amber-100"
                title={`${j.address}${j.completedDate ? ` — completed ${formatDate(j.completedDate)}` : ""}`}
              >
                {j.projectNumber}
              </Link>
            ))}
          </div>
        </div>
      )}

      {!documents && !error && <p className="mt-6 text-sm text-slate-500">Loading…</p>}

      {documents && documents.length === 0 && (
        <p className="mt-6 text-sm text-slate-500">No lab invoices on file yet.</p>
      )}

      {documents && documents.length > 0 && (
        <div className="mt-4 space-y-3">
          {documents.map((doc) => (
            <div key={doc.viewHref} className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <a
                    href={doc.viewHref}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm font-semibold text-brand-600 underline hover:text-brand-700"
                  >
                    {doc.fileName}
                  </a>
                  {doc.reportDateRange && (
                    <div className="text-xs text-slate-500">{doc.reportDateRange}</div>
                  )}
                </div>
                <div className="text-xs text-slate-400">{formatDateTime(doc.uploadedAt)}</div>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-2">
                <span className="text-xs text-slate-400">Jobs:</span>
                {doc.jobs.map((j) => (
                  <Link
                    key={j.id}
                    href={`/admin/dashboard?jobId=${j.id}`}
                    className="whitespace-nowrap rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-700 hover:bg-slate-200"
                    title={j.address}
                  >
                    {j.projectNumber}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
