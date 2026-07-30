"use client";

import { useState } from "react";
import type { Customer, Job } from "@/lib/types";
import PdfPreview from "@/components/shared/PdfPreview";
import JobRecipients from "@/components/portal/JobRecipients";

type Tab = "info" | "report" | "invoice";

const REPORT_READY_STATUSES = new Set(["completed", "invoiced", "ready_to_send", "paid"]);

// Invoice pricing gets auto-computed the moment lab results land, but that's
// an unreviewed draft — the admin dashboard's own "Ready to Send" station is
// the actual signal that both the report and invoice are done and confirmed,
// so that's the earliest point the client is shown a total cost at all.
const INVOICE_FINALIZED_STATUSES = new Set(["ready_to_send", "paid"]);

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

// Same formatting as admin/JobsDashboard.tsx's formatDate/formatTime — kept
// as separate copies (not imported) so the portal's client bundle doesn't
// pull in the whole admin dashboard module for two small helpers.
function formatDate(date: string | null | undefined): string {
  if (!date) return "";
  const [y, m, d] = date.split("-");
  if (!y || !m || !d) return date;
  return `${m}/${d}/${y}`;
}

function formatTime(time: string | null | undefined): string {
  if (!time) return "";
  const [h, m] = time.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 || 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

function DetailField({ label, value, nowrap }: { label: string; value: React.ReactNode; nowrap?: boolean }) {
  if (value == null || value === "" || (typeof value === "string" && !value.trim())) return null;
  return (
    <div className="flex gap-2 text-sm">
      <span className="w-32 shrink-0 text-slate-500">{label}</span>
      <span className={`text-slate-800 ${nowrap ? "whitespace-nowrap" : ""}`}>{value}</span>
    </div>
  );
}

export default function ProjectDetailModal({
  job, customer, onClose, onChanged,
}: {
  job: Job;
  customer: Customer;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [tab, setTab] = useState<Tab>("info");
  const [payLoading, setPayLoading] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [showInvoicePreview, setShowInvoicePreview] = useState(false);

  async function payNow() {
    setPayLoading(true);
    setPayError(null);
    try {
      const res = await fetch(`/api/portal/projects/${job.id}/pay`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Something went wrong");
      window.open(data.url, "_blank", "noreferrer");
    } catch (e) {
      setPayError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setPayLoading(false);
    }
  }

  const reportReady = REPORT_READY_STATUSES.has(job.status);
  const invoiced = job.invoice_total_cents != null && INVOICE_FINALIZED_STATUSES.has(job.status);
  const paid = job.status === "paid";
  // Cache-busting key for PdfPreview — re-fetches/re-renders whenever
  // anything that would change the invoice's actual content changes.
  const invoiceRevision = JSON.stringify({
    invoice_line_items: job.invoice_line_items,
    invoice_total_cents: job.invoice_total_cents,
    project_number: job.project_number,
    confirmed_date: job.confirmed_date,
    service_address: job.service_address,
    service_type: job.service_type,
  });

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-8">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Project {job.project_number ?? ""}
            </div>
            <div className="text-sm text-slate-600">{job.service_address}</div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="Close">
            ✕
          </button>
        </div>

        <div className="flex border-b border-slate-200 px-5">
          {([
            ["info", "Project Information"],
            ["report", "Final Report"],
            ["invoice", "Invoice"],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`border-b-2 px-3 py-2.5 text-sm font-medium ${
                tab === key ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="max-h-[60vh] overflow-y-auto px-5 py-4">
          {tab === "info" && (
            <div className="grid grid-cols-1 gap-y-4">
              <div className="space-y-1">
                <DetailField label="Project #" value={job.project_number} />
                <DetailField label="Job site address" value={job.service_address} nowrap />
                <DetailField label="Scope of Work" value={job.scope_of_work} />
                <DetailField label="Service type" value={job.service_type} nowrap />
                <DetailField label="Time" value={formatTime(job.confirmed_time)} />
                <DetailField label="Date" value={formatDate(job.confirmed_date)} />
              </div>

              <div className="space-y-1">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Customer contact</h4>
                <DetailField label="Name" value={customer.name} nowrap />
                <DetailField label="Phone" value={customer.phone} />
                <DetailField label="Email" value={customer.email} nowrap />
                {job.report_emails && job.report_emails.trim() && (
                  <div className="flex gap-2 text-sm">
                    <span className="w-32 shrink-0 text-slate-500">Email results to</span>
                    <span className="text-slate-800">
                      {job.report_emails.split(",").map((e) => e.trim()).filter(Boolean).map((addr, i) => (
                        <div key={i} className="whitespace-nowrap">{addr}</div>
                      ))}
                    </span>
                  </div>
                )}
                <DetailField label="Billing address" value={customer.billing_address} nowrap />
              </div>

              {(job.site_contact_name || job.site_contact_phone) && (
                <div className="space-y-1">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">On-site contact</h4>
                  <DetailField label="Name" value={job.site_contact_name} />
                  <DetailField label="Phone" value={job.site_contact_phone} />
                </div>
              )}

              <JobRecipients job={job} onChanged={onChanged} />

              {job.notes && job.notes.trim() && (
                <div className="space-y-1">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Notes</h4>
                  <p className="text-sm text-slate-800">{job.notes}</p>
                </div>
              )}

              {(job.job_classification || job.payment_method || job.po_number || job.invoice_number || job.paid_date) && (
                <div className="space-y-1">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Job details</h4>
                  <DetailField label="Classification" value={job.job_classification} />
                  <DetailField label="Payment method" value={job.payment_method} />
                  <DetailField label="PO #" value={job.po_number} />
                  <DetailField label="Invoice #" value={job.invoice_number} />
                  <DetailField label="Paid date" value={formatDate(job.paid_date)} />
                </div>
              )}

              {job.report_summary && (
                <div className="space-y-1">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Report</h4>
                  <p className="text-sm text-slate-800">{job.report_summary}</p>
                  {job.report_notes && <p className="text-sm text-slate-600">{job.report_notes}</p>}
                </div>
              )}
            </div>
          )}

          {tab === "report" && (
            <div className="text-sm">
              {reportReady ? (
                <a
                  href={`/api/portal/projects/${job.id}/report`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-block rounded-lg bg-brand-600 px-4 py-2 font-medium text-white"
                >
                  View report
                </a>
              ) : (
                <p className="text-slate-500">The final report isn&apos;t available yet — we&apos;ll email you once it&apos;s in.</p>
              )}
            </div>
          )}

          {tab === "invoice" && (
            <div className="space-y-4 text-sm">
              {invoiced ? (
                <>
                  <div className="rounded-lg border border-slate-200 px-4 py-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Total</div>
                    <div className="text-lg font-semibold text-slate-800">{formatCents(job.invoice_total_cents!)}</div>
                  </div>

                  {payError && <div className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{payError}</div>}

                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => setShowInvoicePreview((v) => !v)}
                      className="rounded-lg border border-slate-300 px-4 py-2 font-medium text-slate-700"
                    >
                      {showInvoicePreview ? "Hide invoice" : "View invoice"}
                    </button>
                    <a
                      href={`/api/portal/projects/${job.id}/invoice?download=1`}
                      download={`invoice-${job.project_number ?? job.id}.pdf`}
                      className="rounded-lg border border-slate-300 px-4 py-2 font-medium text-slate-700"
                    >
                      Download invoice
                    </a>
                    {!paid && (
                      <button
                        onClick={payNow}
                        disabled={payLoading}
                        className="rounded-lg bg-brand-600 px-4 py-2 font-medium text-white disabled:opacity-50"
                      >
                        {payLoading ? "Loading…" : "Pay now"}
                      </button>
                    )}
                  </div>

                  {showInvoicePreview && (
                    <PdfPreview
                      url={`/api/portal/projects/${job.id}/invoice?v=${encodeURIComponent(invoiceRevision)}`}
                      revision={invoiceRevision}
                    />
                  )}
                </>
              ) : (
                <p className="text-slate-500">An invoice hasn&apos;t been created for this project yet.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
