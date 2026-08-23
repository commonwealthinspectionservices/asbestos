"use client";

import { useState } from "react";
import type { Customer, Job } from "@/lib/types";
import { googleMapsUrl } from "@/lib/address";
import PdfPreview from "@/components/shared/PdfPreview";
import JobRecipients from "@/components/portal/JobRecipients";
import JobChat from "@/components/shared/JobChat";
import PendingRequestEditor from "@/components/portal/PendingRequestEditor";
import { jobReportDomains } from "@/lib/report-findings";
import { formatDateMDY } from "@/lib/date-format";
import { formatPhoneNumber } from "@/lib/phone";

const REPORT_DOMAIN_LABEL: Record<string, string> = { asbestos: "Asbestos", lead: "Lead", mold: "Mold" };

type Tab = "info" | "report" | "invoice" | "chat";

const PORTAL_ACTION_BUTTON =
  "inline-flex h-[22px] items-center border-[3px] border-brand-700 bg-brand-50 px-4 pt-0.5 text-sm font-extrabold uppercase leading-none text-brand-700 hover:bg-yellow-100 disabled:opacity-50 sm:h-[29px]";

const REPORT_READY_STATUSES = new Set(["completed", "invoiced", "ready_to_send", "paid"]);

// Mirrors the admin dashboard's tracker (JobsDashboard.tsx's TRACKER_STATUSES/
// TRACKER_SEGMENTS) — same steps and labels, kept as a separate read-only
// copy since the portal can't click a segment to change status the way the
// admin can, and for the same client-bundle-size reason as the format
// helpers above. One real difference: "ready_to_send" is deliberately
// omitted — it means the report/invoice are drafted but still awaiting the
// admin's own approval to actually send, which isn't something a client
// needs (or should) see as a distinct step. A job at that status reads as
// still "Pending Lab Results" until it's actually sent.
const TRACKER_STATUSES = ["needs_scheduling", "scheduled", "pending_lab_results", "paid"] as const;
function clientTrackerStatus(status: string): string {
  return status === "ready_to_send" ? "pending_lab_results" : status;
}
type TrackerSegment = {
  key: string;
  label: React.ReactNode;
  done: (job: Job, currentIndex: number) => boolean;
};
// The first step reads "Pending Approval" only for a real unreviewed
// request still awaiting the owner's review (source === "portal_booking" or
// "email_intake" — the same condition AcceptScheduleControl.tsx uses on the
// admin side to show its own accept/decline notification). An admin-entered
// job left at "needs_scheduling" on purpose has nothing pending the owner's
// approval, so it reads "To Be Scheduled" instead, matching the admin
// dashboard's own label for that same status.
function firstTrackerSegment(source: Job["source"]): TrackerSegment {
  return {
    key: "needs_scheduling",
    label: source === "portal_booking" || source === "email_intake" ? <>Pending<br />Approval</> : <>To Be<br />Scheduled</>,
    done: (_job, i) => i >= 0,
  };
}
const REST_TRACKER_SEGMENTS: TrackerSegment[] = [
  { key: "scheduled", label: "Scheduled", done: (_job, i) => i >= 1 },
  { key: "pending_lab_results", label: <>Pending<br />Lab Results</>, done: (_job, i) => i >= 2 },
];
const PAID_SEGMENT: TrackerSegment = { key: "paid", label: "Paid", done: (_job, i) => i >= 3 };

// An individual-billed job holds its report back until it's marked Paid (see
// autoDraftReportIfJustPaid / lib/lab-email.ts) — the opposite order from a
// company-billed job, where the report and invoice go out immediately and
// payment follows later. The tracker's step order (and the "sent" segment's
// done check) flips to match: no "already sent, just waiting on payment"
// fallback for an individual, since here paid can genuinely happen first.
function trackerSegmentsFor(isIndividual: boolean, source: Job["source"]): TrackerSegment[] {
  const base = [firstTrackerSegment(source), ...REST_TRACKER_SEGMENTS];
  const sentSegment: TrackerSegment = {
    key: "sent",
    label: <>Report and<br />Invoice Sent</>,
    done: (job, i) => (Boolean(job.invoice_sent_at) && Boolean(job.report_sent_at)) || (!isIndividual && i >= 3),
  };
  return isIndividual
    ? [...base, PAID_SEGMENT, sentSegment]
    : [...base, sentSegment, PAID_SEGMENT];
}

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
  return formatDateMDY(date) ?? "";
}

function formatClockTime(totalMinutes: number): string {
  const normalized = ((totalMinutes % 1440) + 1440) % 1440;
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 || 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

// Clients see the admin's exact confirmed_time (e.g. "2:00 PM"). Falls back
// to the coarser AM/PM window only when the admin hasn't set a specific
// time yet; shows nothing at all for "ANY" with no time set, since there's
// genuinely nothing to tell the client until one is picked.
function formatTimeWindow(confirmedTime: string | null | undefined, window: string | null | undefined): string {
  if (confirmedTime) {
    const [h, m] = confirmedTime.split(":").map(Number);
    if (!Number.isNaN(h) && !Number.isNaN(m)) {
      return formatClockTime(h * 60 + m);
    }
  }
  if (window === "AM") return "Morning";
  if (window === "PM") return "Afternoon";
  return "";
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
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelSent, setCancelSent] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  async function requestCancellation() {
    setCancelling(true);
    setCancelError(null);
    try {
      const res = await fetch(`/api/portal/projects/${job.id}/request-cancellation`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Something went wrong");
      setShowCancelConfirm(false);
      setCancelSent(true);
    } catch (e) {
      setCancelError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setCancelling(false);
    }
  }

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

  const paid = job.status === "paid";
  // Individuals (paying out of pocket, not a company on terms) don't get
  // the report until they've actually paid — a company job has no such
  // gate, since net-30 billing means the report is often needed well
  // before payment for permits/project use. report_release_override is
  // the admin's manual escape hatch for an occasional exception — treated
  // exactly like "paid" here.
  const reportReady = REPORT_READY_STATUSES.has(job.status) && (!job.is_individual || paid || job.report_release_override);
  const invoiced = job.invoice_total_cents != null && INVOICE_FINALIZED_STATUSES.has(job.status);
  const trackerSegments = trackerSegmentsFor(job.is_individual, job.source);
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
      <div className="w-full max-w-xl rounded-xl bg-white shadow-xl">
        <div className="flex items-center gap-1 border-b border-slate-200 px-5 py-3">
          {([
            ["info", "Project Information"],
            ["report", "Final Report"],
            ["invoice", "Invoice"],
            ["chat", "Chat"],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`whitespace-nowrap px-3 py-1.5 text-sm font-bold uppercase ${
                tab === key ? "border-b-2 border-brand-600 text-brand-700" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {label}
            </button>
          ))}
          <button onClick={onClose} className="ml-auto shrink-0 pl-2 text-slate-400 hover:text-slate-600" aria-label="Close">
            ✕
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto px-5 py-4">
          {tab === "info" && (
            <div className="grid grid-cols-1 gap-y-4">
              {/* Editable only for a self-submitted portal booking — an
                  email_intake job's source of truth is the original email
                  it was parsed from, not something to let a portal user
                  edit out from under it, so that one stays read-only below
                  even while "Pending Approval" (see firstTrackerSegment). */}
              {job.status === "needs_scheduling" && job.source === "portal_booking" ? (
                <PendingRequestEditor job={job} isIndividual={job.is_individual} onSaved={onChanged} />
              ) : (
                <>
                  <div className="space-y-1">
                    <DetailField label="Project #" value={job.project_number} />
                    <DetailField
                      label="Job site address"
                      value={job.service_address ? (
                        <a href={googleMapsUrl(job.service_address)} target="_blank" rel="noreferrer" className="hover:underline">
                          {job.service_address}
                        </a>
                      ) : null}
                      nowrap
                    />
                    <DetailField label="Service type" value={job.service_type} nowrap />
                    <DetailField label="Time" value={formatTimeWindow(job.confirmed_time, job.window)} />
                    <DetailField label="Date" value={formatDate(job.confirmed_date)} />
                  </div>

                  {job.scope_of_work && job.scope_of_work.trim() && (
                    <div className="space-y-1">
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Scope of Work</h4>
                      <p className="text-sm text-slate-800">{job.scope_of_work}</p>
                    </div>
                  )}

                  {(job.site_contact_name || job.site_contact_phone) && (
                    <div className="space-y-1">
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Job site contact</h4>
                      <DetailField label="Name" value={job.site_contact_name} />
                      <DetailField label="Phone" value={job.site_contact_phone ? formatPhoneNumber(job.site_contact_phone) : undefined} />
                    </div>
                  )}

                  {job.notes && job.notes.trim() && (
                    <div className="space-y-1">
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Notes</h4>
                      <p className="text-sm text-slate-800">{job.notes}</p>
                    </div>
                  )}
                </>
              )}

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

              <JobRecipients job={job} onChanged={onChanged} />

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

              {job.status !== "cancelled" && job.status !== "paid" && (
                <div className="flex justify-end">
                  {cancelSent ? (
                    <span className="text-sm text-slate-500">Cancellation request sent.</span>
                  ) : (
                    <button
                      onClick={() => setShowCancelConfirm(true)}
                      className="text-sm text-red-600 hover:underline"
                    >
                      Request Cancellation
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {tab === "report" && (
            <div className="text-sm">
              {reportReady ? (
                // One link per service-type domain (asbestos/lead/mold) —
                // a job combining types produces a separate report for
                // each, not one that only covers whichever type this used
                // to silently pick.
                <div className="flex flex-wrap gap-2">
                  {(() => {
                    const domains = jobReportDomains(job.service_type);
                    return domains.map((domain) => (
                      <a
                        key={domain}
                        href={`/api/portal/projects/${job.id}/report?type=${domain}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-block rounded-lg bg-brand-600 px-4 py-2 font-medium uppercase text-white"
                      >
                        {domains.length > 1 ? `View ${REPORT_DOMAIN_LABEL[domain]} report` : "View report"}
                      </a>
                    ));
                  })()}
                </div>
              ) : job.is_individual && REPORT_READY_STATUSES.has(job.status) && !paid ? (
                <div>
                  <p className="text-slate-500">Your final report will be available here once payment is received.</p>
                  {payError && <div className="mt-2 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{payError}</div>}
                  {job.payment_type !== "check" && (
                    <button
                      onClick={payNow}
                      disabled={payLoading}
                      className="mt-3 rounded-lg bg-emerald-600 px-4 py-2 font-medium uppercase text-white disabled:opacity-50"
                    >
                      {payLoading ? "Loading…" : "Pay now"}
                    </button>
                  )}
                </div>
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
                    {!paid && job.payment_type !== "check" && (
                      <button
                        onClick={payNow}
                        disabled={payLoading}
                        className="rounded-lg bg-emerald-600 px-4 py-2 font-medium uppercase text-white disabled:opacity-50"
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

          {tab === "chat" && (
            <JobChat
              endpoint={`/api/portal/projects/${job.id}/messages`}
              photoUploadEndpoint={`/api/portal/projects/${job.id}/photos`}
              photoViewEndpointBase={`/api/portal/projects/${job.id}/photos`}
              senderRole="customer"
              sendButtonClassName={PORTAL_ACTION_BUTTON}
            />
          )}
        </div>

        {tab !== "chat" && (
        <div className="border-t border-slate-200 px-5 py-4">
          {job.status === "cancelled" ? (
            <div className="flex h-2.5 items-center rounded-full bg-red-500">
              <span className="w-full text-center text-xs font-bold text-white">&nbsp;</span>
            </div>
          ) : (
            <div className="flex gap-1">
              {trackerSegments.map((seg) => {
                const currentIndex = TRACKER_STATUSES.indexOf(clientTrackerStatus(job.status) as (typeof TRACKER_STATUSES)[number]);
                const done = seg.done(job, currentIndex);
                return (
                  <div key={seg.key} className={`h-2.5 flex-1 rounded-full ${done ? "bg-emerald-500" : "bg-slate-200"}`} />
                );
              })}
            </div>
          )}
          <div className="mt-1.5 flex gap-1">
            {job.status === "cancelled" ? (
              <span className="flex-1 text-center text-xs font-bold text-red-600">Cancelled</span>
            ) : (
              trackerSegments.map((seg) => (
                <span key={seg.key} className="flex-1 text-center text-[11px] font-bold leading-tight text-slate-500">
                  {seg.label}
                </span>
              ))
            )}
          </div>
        </div>
        )}
      </div>

      {showCancelConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl">
            <h3 className="font-semibold text-slate-800">Are you sure?</h3>
            <p className="mt-2 text-sm text-slate-600">
              This will let us know you&apos;d like to cancel this project. We&apos;ll follow up to confirm.
            </p>
            {cancelError && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{cancelError}</div>}
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setShowCancelConfirm(false)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700"
              >
                Never mind
              </button>
              <button
                onClick={requestCancellation}
                disabled={cancelling}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
              >
                {cancelling ? "Sending…" : "Request Cancellation"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
