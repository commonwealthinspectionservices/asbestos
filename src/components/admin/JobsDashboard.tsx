"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import type { Company, Customer, FullInspectionMaterial, InvoiceLineItem, JobDocument, JobWithCustomer, LabProfile, PricingZone, SampleItem, ServiceType } from "@/lib/types";
import { defaultInvoiceLineItems, sampleDescriptionForServiceType } from "@/lib/invoice-defaults";
import { ASBESTOS_NEGATIVE_REMARK, ASBESTOS_POSITIVE_REMARK, LEAD_NEGATIVE_REMARK, LEAD_POSITIVE_REMARK, jobReportDomains, domainForServiceTypeLabel, isFullInspectionAsbestosJob, NEWTON_FIRE_FLOOD_COMPANY_ID, BOSTON_HARBOR_WATER_RESTORATION_COMPANY_ID, type ReportDomain } from "@/lib/report-findings";
import { splitAddress, parseAddressToFields, buildBillingAddress, googleMapsUrl, wazeUrl, expandAddress } from "@/lib/address";
import { joinName, splitFullName, toTitleCase } from "@/lib/name";
import { telHref } from "@/lib/phone";
import type { AddressFields } from "@/lib/address";
import AddressAutocompleteInput from "@/components/shared/AddressAutocompleteInput";
import JobChat from "@/components/shared/JobChat";
import JobPhotos from "@/components/shared/JobPhotos";
import { AcceptScheduleControl, extractTimeRange, parseWindowStartTime24h } from "@/components/admin/AcceptScheduleControl";
import { ContactForm } from "@/components/admin/ContactDetailDialog";
import { formatDateMDY } from "@/lib/date-format";
import { subcontractorSenderForJob } from "@/lib/subcontractor-senders";
import { timeSelectOptions } from "@/lib/time-options";

// Splits on (captured) bare URLs so odd-indexed segments are the URLs
// themselves — used for job.notes, which can contain a real link (e.g. a
// subcontractor's shipping label) that's otherwise just inert text.
function Linkify({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="break-all text-brand-700 underline">
            {part}
          </a>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

// The full job-flow pipeline, in order — every open project is tracked
// somewhere along this list from intake to close-out. Admin-controlled via a
// plain status dropdown (JobRow and ProjectDetailDialog); "scheduled" is
// also set by AcceptScheduleControl (see JobRow/ProjectDetailDialog), which
// bundles it with confirmed_date/confirmed_time and visibility in one action.
// "fieldwork_in_progress"/"awaiting_lab_results"/"needs_report"/"completed"/
// "invoiced" predate this six-step pipeline and are no longer assigned by
// new code — "completed" ("Report Ready") and "invoiced" collapsed into the
// single "ready_to_send" step below (lab results in, report/invoice
// generatable, just waiting on payment before the report itself can go
// out). All of them are omitted from PIPELINE_STATUSES (the dropdown
// options) but kept in STATUS_LABEL so any old row still renders correctly.
const PIPELINE_STATUSES = [
  "needs_scheduling",
  "scheduled",
  "pending_lab_results",
  "ready_to_send",
  "report_invoice_sent",
  "paid",
  "cancelled",
] as const;

// A subcontracted job (source === "subcontractor") has no report, invoice,
// or lab relationship of its own — Tim's involvement ends once he's done
// the site visit and shipped the samples/data off to the company that
// subcontracted him. "pending_lab_results"/"ready_to_send" would never
// apply, so they're skipped entirely rather than showing steps that don't
// mean anything for this job type. "paid" is reused as the terminal
// "closed out" state (see CLOSED_STATUSES) and relabeled "Done" — see
// statusLabelForJob — purely a UI label, no separate status value needed.
const SUBCONTRACTOR_PIPELINE_STATUSES = ["needs_scheduling", "scheduled", "paid", "cancelled"] as const;

function pipelineStatusesForJob(job: JobWithCustomer): readonly string[] {
  if (job.source !== "subcontractor") return PIPELINE_STATUSES;
  return SUBCONTRACTOR_PIPELINE_STATUSES;
}

function statusLabelForJob(job: JobWithCustomer, status: string): string {
  if (job.source === "subcontractor" && status === "paid") return "Done";
  return STATUS_LABEL[status];
}

// The linear progression shown as a horizontal tracker on a project's detail
// dialog — "cancelled" is excluded since it's an exception path, not a step.
const TRACKER_STATUSES = ["needs_scheduling", "scheduled", "pending_lab_results", "ready_to_send", "report_invoice_sent", "paid"] as const;
const SUBCONTRACTOR_TRACKER_STATUSES = ["needs_scheduling", "scheduled", "paid"] as const;

// The tracker's own segment list — same real, clickable job.status steps as
// TRACKER_STATUSES. "report_invoice_sent" used to be a synthetic,
// non-clickable segment inferred purely from invoice_sent_at/report_sent_at
// (no manual "mark as sent" existed) — per Tim, 2026-08-26, it's now a real
// status of its own so it's distinguishable from "ready_to_send" (drafted,
// not yet sent) in the status field itself, not just in this tracker.
// draft-status/route.ts auto-advances a job here the moment both timestamps
// land; nothing sets it by hand in the normal flow.
type TrackerSegment = {
  key: string;
  label: React.ReactNode;
  // Desktop's label forces a line break (via <br/>) to sit neatly under a
  // narrow segment bar — the mobile vertical list has a full-width row per
  // step instead, so it uses this plain single-line string rather than
  // inheriting that hard break.
  plainLabel: string;
  status?: (typeof TRACKER_STATUSES)[number];
  done: (job: JobWithCustomer, currentIndex: number) => boolean;
};
const TRACKER_SEGMENTS: TrackerSegment[] = [
  { key: "needs_scheduling", label: <>To Be<br />Scheduled</>, plainLabel: "To Be Scheduled", status: "needs_scheduling", done: (_job, i) => i >= 0 },
  { key: "scheduled", label: "Scheduled", plainLabel: "Scheduled", status: "scheduled", done: (_job, i) => i >= 1 },
  { key: "pending_lab_results", label: <>Pending<br />Lab Results</>, plainLabel: "Pending Lab Results", status: "pending_lab_results", done: (_job, i) => i >= 2 },
  { key: "ready_to_send", label: <>Report and<br />Invoice Ready</>, plainLabel: "Report and Invoice Ready", status: "ready_to_send", done: (_job, i) => i >= 3 },
  { key: "report_invoice_sent", label: <>Payment<br />Pending</>, plainLabel: "Payment Pending", status: "report_invoice_sent", done: (_job, i) => i >= 4 },
  { key: "paid", label: "Paid", plainLabel: "Paid", status: "paid", done: (_job, i) => i >= 5 },
];

// Subcontracted jobs skip straight from Scheduled to Done — see
// SUBCONTRACTOR_PIPELINE_STATUSES above for why the report/invoice steps
// don't apply.
const SUBCONTRACTOR_TRACKER_SEGMENTS: TrackerSegment[] = [
  { key: "needs_scheduling", label: <>To Be<br />Scheduled</>, plainLabel: "To Be Scheduled", status: "needs_scheduling", done: (_job, i) => i >= 0 },
  { key: "scheduled", label: "Scheduled", plainLabel: "Scheduled", status: "scheduled", done: (_job, i) => i >= 1 },
  { key: "paid", label: "Done", plainLabel: "Done", status: "paid", done: (_job, i) => i >= 2 },
];

export const STATUS_LABEL: Record<string, string> = {
  needs_scheduling: "To Be Scheduled",
  scheduled: "Scheduled",
  fieldwork_in_progress: "Fieldwork In Progress",
  awaiting_lab_results: "Awaiting Lab Results",
  needs_report: "Fieldwork Complete Needs Report",
  pending_lab_results: "Pending Lab Results",
  completed: "Report Ready",
  invoiced: "Invoiced",
  ready_to_send: "Report and Invoice Ready",
  report_invoice_sent: "Payment Pending",
  paid: "Paid",
  cancelled: "Cancelled",
};

// Solid dot color for the status filter checklist's legend.
const STATUS_DOT_COLOR: Record<string, string> = {
  needs_scheduling: "bg-slate-400",
  scheduled: "bg-blue-500",
  fieldwork_in_progress: "bg-indigo-500",
  awaiting_lab_results: "bg-purple-500",
  needs_report: "bg-orange-500",
  pending_lab_results: "bg-purple-500",
  completed: "bg-teal-500",
  invoiced: "bg-amber-500",
  ready_to_send: "bg-amber-500",
  report_invoice_sent: "bg-cyan-500",
  paid: "bg-emerald-500",
  cancelled: "bg-red-500",
};

const SERVICE_TYPE_LABEL: Record<string, string> = {
  asbestos: "Asbestos Inspection",
  mold: "Mold Inspection",
  lead: "Lead Paint Sampling",
};
function serviceTypeLabel(value: string | null): string {
  if (!value) return "—";
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => SERVICE_TYPE_LABEL[part.toLowerCase()] ?? part)
    .join(", ");
}

// Matches if the target contains every word of the query as a substring,
// in any order — so "boston restoration" finds "Restore To New Boston" and
// a single partial word/letters still works like a plain substring search.
function matchesAnyWord(target: string, query: string): boolean {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const t = target.toLowerCase();
  return words.every((w) => t.includes(w));
}

// Shared by the billing address and job site address fields — once a
// full street, town, and state are typed in, looks up the ZIP so the
// admin doesn't have to hunt for it. A bare town with no street yet is
// handled separately by useTownZipOptions below — geocoding "Newton, MA"
// alone would just silently pick one of its 16 ZIPs.
function useAutoZip(street: string, city: string, state: string, setZip: (v: string) => void) {
  useEffect(() => {
    if (!street.trim() || !city.trim() || !state.trim()) return;
    const address = `${street}, ${city}, ${state}`;
    const timer = setTimeout(() => {
      fetch(`/api/admin/geocode-zip?address=${encodeURIComponent(address)}`)
        .then((r) => r.json())
        .then((data) => {
          if (data.zip) setZip(data.zip);
        })
        .catch(() => {});
    }, 600);
    return () => clearTimeout(timer);
  }, [street, city, state, setZip]);
}

// Every ZIP a town maps to — empty until a town+state are known and no
// street has been typed yet. The caller auto-fills when there's exactly
// one and offers a pick-list when there are several, rather than
// silently guessing wrong for a multi-ZIP town.
function useTownZipOptions(street: string, city: string, state: string): string[] {
  const [options, setOptions] = useState<string[]>([]);
  useEffect(() => {
    if (street.trim() || !city.trim() || !state.trim()) {
      setOptions([]);
      return;
    }
    const timer = setTimeout(() => {
      fetch(`/api/admin/zips-for-town?town=${encodeURIComponent(city)}&state=${encodeURIComponent(state)}`)
        .then((r) => r.json())
        .then((data) => setOptions(data.zips ?? []))
        .catch(() => setOptions([]));
    }, 400);
    return () => clearTimeout(timer);
  }, [street, city, state]);
  return options;
}

// ZIP input that auto-fills itself when its town resolves to exactly one
// ZIP, and offers a one-click pick-list instead of leaving the admin to
// type one when the town has several.
function ZipInput({
  street, city, state, zip, setZip,
}: {
  street: string;
  city: string;
  state: string;
  zip: string;
  setZip: (v: string) => void;
}) {
  const options = useTownZipOptions(street, city, state);
  const [open, setOpen] = useState(false);
  const lastAutoFilledRef = useRef<string | null>(null);

  useEffect(() => {
    if (options.length !== 1) return;
    // Only overwrite an empty field or one we auto-filled ourselves last
    // time — never clobber a value the admin actually typed in.
    if (!zip.trim() || zip === lastAutoFilledRef.current) {
      setZip(options[0]);
      lastAutoFilledRef.current = options[0];
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options]);

  return (
    <div className="relative">
      <div className="flex gap-1">
        <input
          className="w-full rounded-lg border border-slate-300 px-2 py-2 text-sm"
          placeholder="ZIP"
          value={zip}
          onChange={(e) => setZip(e.target.value)}
        />
        {options.length > 1 && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="shrink-0 rounded-lg border border-slate-300 px-2 py-2 text-xs text-slate-500"
          >
            ▾
          </button>
        )}
      </div>
      {open && options.length > 1 && (
        <div className="absolute right-0 z-10 mt-1 max-h-48 w-28 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
          {options.map((z) => (
            <button
              key={z}
              type="button"
              onClick={() => {
                setZip(z);
                setOpen(false);
              }}
              className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-slate-50"
            >
              {z}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Formats digits into XXX-XXX-XXXX as they're typed, matching the
// dash-separated format already used for real contact phone numbers.
function formatPhoneInput(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

// report_drafted_at/report_sent_at are full timestamptz values (unlike the
// plain "date" columns formatDate handles) — shown with a time so the admin
// can tell two same-day drafts apart, not just the date.
function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const datePart = `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
  const timePart = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${datePart} ${timePart}`;
}

// Deep-links straight to this exact draft/message in the Gmail web UI
// instead of just the inbox — /u/0/ assumes the connected account is the
// browser's first signed-in Google account, true for the common single-
// account case this is built for. Opens in a new tab; Gmail can't be
// embedded (Google blocks framing mail.google.com).
function gmailMessageUrl(messageId: string, sent: boolean): string {
  return `https://mail.google.com/mail/u/0/#${sent ? "sent" : "drafts"}/${messageId}`;
}

// The job-header draft control — one instance for the common case (a
// single combined report+invoice draft, `label` omitted, "Create Draft ↗")
// and two side by side for Boston Harbor's separately-sent report and
// invoice (`label` set, "Create Report Draft ↗" / "Create Invoice Draft
// ↗"). Says "Create," not "View" — per Tim, "View" undersold what this
// actually does: every click rebuilds from what's on the job right now
// and replaces whatever draft was already sitting there before opening
// it, not a passive peek at an existing one. Once actually sent, the
// label switches to "View sent ... ↗" — that one really is just a link,
// nothing gets rebuilt once it's out the door.
function DraftLinkControl({
  label, hook, messageId, draftedAt, sentAt, fullWidth,
}: {
  label?: string;
  hook: {
    creating: boolean;
    message: string | null;
    status: { status: "drafted" | "sent" | "none"; sentAt?: string } | null;
    viewDraft: () => void;
  };
  messageId: string | null;
  draftedAt: string | null;
  sentAt: string | null;
  /** Per Tim, 2026-08-27 — the mobile-only header row (below the tab
      dropdown) wants this button the exact same size as that dropdown
      above it: full width, same height, instead of the compact pill this
      control renders everywhere else (inline with the desktop tab row, or
      the mobile row's other slot when Boston Harbor's two side by side
      don't need the full width each). An explicit h-9 on both (rather than
      matching padding and hoping) — confirmed live 2026-08-27, a <button>
      and the dropdown's <select> render 5px apart at identical padding/
      font-size, same native-UA-metrics quirk as input[type=date] vs
      <select> documented elsewhere in this file. flex/items-center/
      justify-center (not block+text-center) centers the label within that
      fixed height instead of relying on padding to do it. */
  fullWidth?: boolean;
}) {
  if (!messageId) return <p className="text-xs text-slate-400">Creating draft…</p>;
  const isSent = Boolean(sentAt) || hook.status?.status === "sent";
  const sizeClasses = fullWidth ? "flex h-9 w-full items-center justify-center px-2 text-center text-sm" : "px-3 py-1 text-xs";
  if (isSent) {
    // Per Tim — the "Sent {date}" line used to sit right here, next to the
    // header button; now that Project Info has its own dedicated "Report
    // sent .../Invoice not yet sent" lines (see below), it's redundant
    // clutter in the header specifically.
    return (
      <a
        href={gmailMessageUrl(messageId, true)}
        target="_blank"
        rel="noreferrer"
        className={`rounded-lg border border-red-600 bg-white font-bold uppercase text-red-600 hover:underline ${sizeClasses}`}
      >
        {label ? `View sent ${label.toLowerCase()} ↗` : "View sent email in Gmail ↗"}
      </a>
    );
  }
  return (
    <>
      <button
        type="button"
        onClick={() => hook.viewDraft()}
        disabled={hook.creating}
        className={`rounded-lg border border-red-600 bg-white font-bold uppercase text-red-600 hover:underline disabled:opacity-50 ${sizeClasses}`}
      >
        {hook.creating ? "Preparing draft…" : label ? `Create ${label} Draft ↗` : "Create Draft ↗"}
      </button>
      {hook.message && <p className="text-xs text-slate-500">{hook.message}</p>}
    </>
  );
}

// Shared by Conclusions & Recommendations and every Discussion of Results
// cell (air/bulk/swab) — Per Tim, 2026-08-27, these two buttons belong on
// all of them, not just Conclusions & Recommendations.
function ListFormatButtons({ onBullet, onNumbered }: { onBullet: () => void; onNumbered: () => void }) {
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={onBullet}
        title="Bullet list"
        className="rounded border border-slate-300 p-1.5 text-slate-600 hover:bg-slate-50"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="2" cy="3.5" r="1.25" fill="currentColor" />
          <circle cx="2" cy="8" r="1.25" fill="currentColor" />
          <circle cx="2" cy="12.5" r="1.25" fill="currentColor" />
          <rect x="5.5" y="2.75" width="9" height="1.5" rx="0.5" fill="currentColor" />
          <rect x="5.5" y="7.25" width="9" height="1.5" rx="0.5" fill="currentColor" />
          <rect x="5.5" y="11.75" width="9" height="1.5" rx="0.5" fill="currentColor" />
        </svg>
      </button>
      <button
        type="button"
        onClick={onNumbered}
        title="Numbered list"
        className="rounded border border-slate-300 p-1.5 text-slate-600 hover:bg-slate-50"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <text x="0.5" y="4.6" fontSize="4" fontWeight="700" fill="currentColor">1</text>
          <text x="0.5" y="9.1" fontSize="4" fontWeight="700" fill="currentColor">2</text>
          <text x="0.5" y="13.6" fontSize="4" fontWeight="700" fill="currentColor">3</text>
          <rect x="5.5" y="2.75" width="9" height="1.5" rx="0.5" fill="currentColor" />
          <rect x="5.5" y="7.25" width="9" height="1.5" rx="0.5" fill="currentColor" />
          <rect x="5.5" y="11.75" width="9" height="1.5" rx="0.5" fill="currentColor" />
        </svg>
      </button>
    </div>
  );
}

function formatTime(time: string | null | undefined): string {
  if (!time) return "";
  const [h, m] = time.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 || 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

// Postgres `date` columns round-trip as "YYYY-MM-DD" — displayed as-is that
// reads ambiguously, so every plain-text date in this file goes through
// this to show it the standard MM/DD/YYYY way the rest of the app does.
export function formatDate(date: string | null | undefined): string {
  return formatDateMDY(date) ?? "";
}

const DOCUMENT_KIND_LABEL: Record<JobDocument["kind"], string> = {
  coc: "Chain of Custody",
  lab_report: "Laboratory Results",
  lab_invoice: "Laboratory Invoice",
  report: "Finished report",
  other: "Other",
};

const TURNAROUND_OPTIONS = ["Rush", "24-Hr", "48-Hr", "3-Day", "4-Day", "5-Day"];
type SortField = "date" | "project_number";
const SORT_FIELDS: { key: SortField; label: string }[] = [
  { key: "date", label: "Date" },
  { key: "project_number", label: "Project #" },
];

// "What needs attention" — open until paid (or cancelled). Per Tim,
// 2026-08-27 — "report_invoice_sent" (Payment Pending) has its own
// dedicated filter now and no longer shows under Open Projects too; it's
// not in CLOSED_STATUSES either, so it only surfaces via that dedicated
// filter or All Projects, not Open or Closed.
const OPEN_STATUSES = new Set(["needs_scheduling", "scheduled", "fieldwork_in_progress", "awaiting_lab_results", "needs_report", "pending_lab_results", "completed", "invoiced", "ready_to_send"]);
const CLOSED_STATUSES = new Set(["paid", "cancelled"]);
// Schedule/notes stay editable for any job that isn't closed out yet.
const EDITABLE_STATUSES = OPEN_STATUSES;

function lineItemsTotalCents(items: InvoiceLineItem[]): number {
  return items.reduce((total, item) => total + Math.round(item.quantity * item.unit_cost_cents), 0);
}

// Default due date shown/used until the admin explicitly overrides it via
// the Invoice section's own date field (job.payment_due_date) — 30 days
// after the project date.
function paymentDueDate(projectDate: string): string | null {
  if (!projectDate) return null;
  const d = new Date(`${projectDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + 30);
  return d.toISOString().slice(0, 10);
}

// Per Tim, 2026-08-28 — always exactly 30 days after the invoice was
// actually emailed (not requested_date, which can differ from when the
// report really went out, and no longer a manually-set payment_due_date
// override either — Tim wants this unconditional) — this is what Stripe's
// own auto-charge (lib/net30-autocharge.ts) goes by too, see stripe.ts's
// tagInvoiceEmailed. requested_date+30 stays only as a rough pre-send
// estimate, before invoice_sent_at exists yet. Same precedence as
// InvoicesView.tsx's own copy of this.
function dueDateFor(job: JobWithCustomer): string | null {
  if (job.invoice_sent_at) return paymentDueDate(job.invoice_sent_at.slice(0, 10));
  return paymentDueDate(job.requested_date ?? "");
}

// Positive only once money is actually owed and sitting past its due date —
// "ready_to_send" and "report_invoice_sent" are the two statuses that mean
// "billed, not yet paid" (paid/cancelled/anything earlier in the pipeline
// never counts, no matter how old the due date is).
function daysOverdue(job: JobWithCustomer): number | null {
  if (job.status !== "ready_to_send" && job.status !== "report_invoice_sent") return null;
  const due = dueDateFor(job);
  if (!due) return null;
  const dueDate = new Date(`${due}T00:00:00`);
  if (Number.isNaN(dueDate.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.floor((today.getTime() - dueDate.getTime()) / 86400000);
  return diffDays > 0 ? diffDays : null;
}

// Every field the final report letter would otherwise show as a blank
// underline for (see ValueOrBlank in report-pdf.tsx) — true once lab results
// are actually in hand and the report has everything it needs to go out,
// regardless of what pipeline status the job happens to be sitting at.
// Every field the final report letter would otherwise show as a blank
// underline for (see ValueOrBlank in report-pdf.tsx) — itemized so the
// Final Report tab can show admins exactly what's still missing, not just
// a plain "not ready yet".
// Final Report tile labels — only shown once a job has more than one
// domain's report to distinguish (see jobReportDomains); a single-type job
// still just sees the plain "Final Report" tile it always has.
const REPORT_DOMAIN_LABEL: Record<ReportDomain, string> = { asbestos: "Asbestos", lead: "Lead", mold: "Mold" };

// Once a job reaches Pending Lab Results or later, the confirmed date/time
// describe a completed appointment, not a future one — label it that way
// instead of "Scheduled".
function hasCompletedFieldwork(status: string): boolean {
  return status === "pending_lab_results" || status === "ready_to_send" || status === "report_invoice_sent" || status === "paid";
}

// Fields shared by every domain's own report — same job, so these don't
// vary by which report is being checked.
function commonReportChecklist(job: JobWithCustomer): { label: string; done: boolean }[] {
  return [
    { label: "Customer", done: Boolean(job.customers?.name && job.customers.name !== "Unknown contact") },
    { label: "Billing address", done: Boolean(job.customers?.billing_address) },
    { label: "Job site address", done: Boolean(job.service_address) },
    { label: "Project #", done: Boolean(job.project_number) },
    { label: "Date", done: Boolean(job.requested_date) },
  ];
}

// One checklist per domain — a job combining service types from more than
// one domain (e.g. asbestos + mold) produces a separate final report per
// domain, each with its own lab info/sample count/results, so "is the
// report ready" has to be asked per domain rather than once for the job.
function reportChecklist(job: JobWithCustomer, domain: ReportDomain): { label: string; done: boolean }[] {
  const totalSamples = Object.entries(job.sample_counts ?? {})
    .filter(([label]) => domainForServiceTypeLabel(label) === domain)
    .reduce((sum, [, n]) => sum + (n || 0), 0) || job.sample_count || 0;

  if (domain === "mold") {
    return [
      ...commonReportChecklist(job),
      { label: "Sample count", done: totalSamples > 0 },
      { label: "Lab info", done: Boolean(job.mold_lab_name) },
      // Air, bulk, and swab each have their own fixed, auto-generated
      // sample-count sentence for Discussion of Results — the admin's own
      // per-type findings fields are optional additions on top of that, not
      // required for this checklist item to be considered done.
      { label: "Results", done: totalSamples > 0 },
    ];
  }
  if (domain === "lead") {
    return [
      ...commonReportChecklist(job),
      { label: "Sample count", done: totalSamples > 0 },
      { label: "Lab info", done: Boolean(job.lead_lab_name && job.lead_lab_cert) },
      { label: "Results", done: Boolean(job.lead_result) },
    ];
  }
  // Pre-Renovation/Pre-Demolition ("full inspection") jobs log one row per
  // homogeneous material instead of picking a single Overall Findings
  // remark — asbestos_result is auto-derived from that list server-side
  // (see api/admin/jobs/[id]/route.ts), so "Results" here means "at least
  // one material's been logged," not the field itself.
  const isFull = isFullInspectionAsbestosJob(job.service_type);
  return [
    ...commonReportChecklist(job),
    { label: "Sample count", done: isFull ? job.full_inspection_materials.length > 0 : totalSamples > 0 },
    { label: "Lab info", done: Boolean(job.lab_name && job.lab_nist_cert && job.lab_massdls_cert) },
    { label: "Results", done: isFull ? job.full_inspection_materials.length > 0 : Boolean(job.asbestos_result) },
  ];
}

function reportIsCompleteForDomain(job: JobWithCustomer, domain: ReportDomain): boolean {
  return reportChecklist(job, domain).every((item) => item.done);
}

export function reportIsComplete(job: JobWithCustomer): boolean {
  return jobReportDomains(job.service_type).every((domain) => reportIsCompleteForDomain(job, domain));
}


export default function JobsDashboard() {
  const [jobs, setJobs] = useState<JobWithCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [selectedJobInitialTab, setSelectedJobInitialTab] = useState<"info" | "chat">("info");
  const [editingJobId, setEditingJobId] = useState<string | null>(null);
  const [statusView, setStatusView] = useState<"open" | "closed" | "all">("open");
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set());
  const [statusFilterOpen, setStatusFilterOpen] = useState(false);
  const statusFilterCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [serviceTypeFilter, setServiceTypeFilter] = useState<Set<string>>(new Set());
  const [serviceTypeFilterOpen, setServiceTypeFilterOpen] = useState(false);
  const serviceTypeFilterCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [availableServiceTypes, setAvailableServiceTypes] = useState<ServiceType[]>([]);
  const [addingProject, setAddingProject] = useState(false);
  // Default view: newest project number first, so a job just added shows up
  // at the top without the admin having to sort for it.
  const [sortBy, setSortBy] = useState<SortField>("project_number");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [sortEnabled, setSortEnabled] = useState(true);
  // The card order to fall back to while sorting is off — snapshotted the
  // moment it's turned off, so status/date edits afterward can't reshuffle
  // cards out from under the admin's eyes.
  const frozenOrderRef = useRef<string[]>([]);
  // Guards against out-of-order responses: several fields on the Final
  // Report tab each save-then-reload independently, so editing more than
  // one in quick succession can fire overlapping GETs. Without this, an
  // older response resolving after a newer one could silently overwrite
  // the just-saved field, leaving the report looking incomplete until an
  // unrelated edit happened to trigger yet another reload.
  const loadJobsRequestIdRef = useRef(0);
  const [projectNumberQuery, setProjectNumberQuery] = useState("");
  const [companyQuery, setCompanyQuery] = useState("");
  const [addressQuery, setAddressQuery] = useState("");
  const [dateQuery, setDateQuery] = useState("");
  // Mobile only — one search box standing in for the desktop's four
  // separate fields (project #/company/address/date), matched with OR
  // against project #, company, and address (see filteredJobs below).
  const [mobileSearch, setMobileSearch] = useState("");

  function selectStatusView(view: "open" | "closed" | "all") {
    setStatusView(view);
    setStatusFilter(new Set());
  }

  // A brief delay before actually closing tolerates the small visual gap
  // between the "Status" button and the menu below it, so moving the mouse
  // from one to the other doesn't get treated as leaving.
  function openStatusFilter() {
    if (statusFilterCloseTimer.current) clearTimeout(statusFilterCloseTimer.current);
    setStatusFilterOpen(true);
  }

  function closeStatusFilter() {
    statusFilterCloseTimer.current = setTimeout(() => setStatusFilterOpen(false), 200);
  }

  function openServiceTypeFilter() {
    if (serviceTypeFilterCloseTimer.current) clearTimeout(serviceTypeFilterCloseTimer.current);
    setServiceTypeFilterOpen(true);
  }

  function closeServiceTypeFilter() {
    serviceTypeFilterCloseTimer.current = setTimeout(() => setServiceTypeFilterOpen(false), 200);
  }

  function toggleServiceTypeFilter(label: string) {
    setServiceTypeFilter((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  function clearAllFilters() {
    setStatusFilter(new Set());
    setServiceTypeFilter(new Set());
  }

  // A job only ever has one status, so selecting a status here replaces
  // whatever was previously picked rather than adding to a multi-select set.
  function selectStatusFilter(status: string) {
    setStatusFilter(new Set([status]));
  }

  // Each field button cycles through three states on repeated clicks:
  // ascending -> descending -> off (frozen order, indicated by no arrow).
  // Clicking a field that isn't the active one (including while off) always
  // starts it fresh at ascending.
  function toggleSort(field: SortField) {
    if (sortEnabled && sortBy === field) {
      if (sortDir === "asc") {
        setSortDir("desc");
      } else {
        frozenOrderRef.current = liveSortedJobs.map((j) => j.id);
        setSortEnabled(false);
      }
      return;
    }
    setSortEnabled(true);
    setSortBy(field);
    setSortDir("asc");
  }

  function disableSort() {
    if (sortEnabled) {
      frozenOrderRef.current = liveSortedJobs.map((j) => j.id);
      setSortEnabled(false);
    }
  }

  // Mobile's single consolidated dropdown — one active choice at a time
  // (sort by a field, or filter by one status, or filter by one service
  // type), encoded as "sort:date" / "status:<key>" / "service:<label>".
  // Desktop keeps the separate sort buttons + multi-select filter menus
  // below, unchanged.
  const mobileSortFilterValue = sortEnabled
    ? `sort:${sortBy}`
    : statusFilter.size > 0
    ? `status:${[...statusFilter][0]}`
    : serviceTypeFilter.size > 0
    ? `service:${[...serviceTypeFilter][0]}`
    : "";

  function handleMobileSortFilterChange(value: string) {
    if (!value) {
      disableSort();
      clearAllFilters();
      return;
    }
    const sep = value.indexOf(":");
    const kind = value.slice(0, sep);
    const key = value.slice(sep + 1);
    if (kind === "sort") {
      clearAllFilters();
      setSortEnabled(true);
      setSortBy(key as SortField);
      setSortDir("asc");
    } else if (kind === "status") {
      disableSort();
      setServiceTypeFilter(new Set());
      setStatusFilter(new Set([key]));
    } else if (kind === "service") {
      disableSort();
      setStatusFilter(new Set());
      setServiceTypeFilter(new Set([key]));
    }
  }

  async function loadJobs() {
    const requestId = ++loadJobsRequestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/jobs");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load projects");
      if (requestId !== loadJobsRequestIdRef.current) return;
      setJobs(data.jobs);
    } catch (e) {
      if (requestId !== loadJobsRequestIdRef.current) return;
      setError(e instanceof Error ? e.message : "Failed to load projects");
    } finally {
      if (requestId === loadJobsRequestIdRef.current) setLoading(false);
    }
  }

  useEffect(() => {
    loadJobs();
    fetch("/api/admin/settings")
      .then((res) => res.json())
      .then((data) => setAvailableServiceTypes(data.settings?.service_types ?? []));
  }, []);

  // Lets another page deep-link straight to one project (e.g. a contact's
  // own project list) via /admin/dashboard?jobId=<id>. Read in an effect,
  // not a useState initializer — the initializer also runs during SSR (no
  // window there), so reading location from it would make the client's
  // first render diverge from the server's and trip a hydration mismatch.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("jobId");
    if (id) setSelectedJobId(id);
  }, []);

  const overdueJobs = useMemo(() => jobs.filter((j) => daysOverdue(j) !== null), [jobs]);

  const filteredJobs = useMemo(() => {
    let result = jobs;
    if (statusFilter.has("overdue")) result = result.filter((j) => daysOverdue(j) !== null);
    else if (statusFilter.size > 0) result = result.filter((j) => statusFilter.has(j.status));
    else if (statusView === "open") result = result.filter((j) => OPEN_STATUSES.has(j.status));
    else if (statusView === "closed") result = result.filter((j) => CLOSED_STATUSES.has(j.status));

    if (serviceTypeFilter.size > 0) {
      result = result.filter((j) => {
        const labels = (j.service_type ?? "").split(",").map((s) => s.trim());
        return labels.some((label) => serviceTypeFilter.has(label));
      });
    }

    if (projectNumberQuery.trim()) {
      result = result.filter((j) => matchesAnyWord(j.project_number ?? "", projectNumberQuery));
    }
    if (companyQuery.trim()) {
      result = result.filter((j) => matchesAnyWord(j.customers?.company || j.customers?.name || "", companyQuery));
    }
    if (addressQuery.trim()) {
      result = result.filter((j) => matchesAnyWord(j.service_address ?? "", addressQuery));
    }
    if (dateQuery) {
      result = result.filter((j) => j.requested_date === dateQuery);
    }
    if (mobileSearch.trim()) {
      result = result.filter(
        (j) =>
          matchesAnyWord(j.project_number ?? "", mobileSearch) ||
          matchesAnyWord(j.customers?.company || j.customers?.name || "", mobileSearch) ||
          matchesAnyWord(j.service_address ?? "", mobileSearch)
      );
    }
    return result;
  }, [jobs, statusView, statusFilter, serviceTypeFilter, projectNumberQuery, companyQuery, addressQuery, dateQuery, mobileSearch]);

  const liveSortedJobs = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filteredJobs].sort((a, b) => {
      if (sortBy === "project_number") {
        return dir * (a.project_number ?? "").localeCompare(b.project_number ?? "");
      }
      return dir * (a.requested_date ?? "").localeCompare(b.requested_date ?? "");
    });
  }, [filteredJobs, sortBy, sortDir]);

  // While sorting is off, cards hold the position they were in when it was
  // turned off — status/date edits patch the card in place instead of
  // reshuffling the list. Jobs that weren't visible at freeze time (newly
  // added, or newly matching the current filters) land at the end.
  const sortedJobs = useMemo(() => {
    if (sortEnabled) return liveSortedJobs;
    const remaining = new Map(filteredJobs.map((j) => [j.id, j]));
    const frozen: JobWithCustomer[] = [];
    for (const id of frozenOrderRef.current) {
      const job = remaining.get(id);
      if (job) {
        frozen.push(job);
        remaining.delete(id);
      }
    }
    return [...frozen, ...remaining.values()];
  }, [filteredJobs, sortEnabled, liveSortedJobs]);

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
      {/* Mobile: a dropdown (same pattern as the Directory's tab selector)
          instead of three separate buttons, with Add Project directly
          across on the same line. Desktop: unchanged row of four buttons. */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-4 sm:hidden">
        <div className="relative min-w-0 flex-1">
          <select
            value={statusFilter.has("report_invoice_sent") ? "payment_pending" : statusFilter.size === 0 ? statusView : ""}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "payment_pending") selectStatusFilter("report_invoice_sent");
              else selectStatusView(v as "open" | "closed" | "all");
            }}
            className="w-full appearance-none rounded-lg border border-slate-300 bg-white py-2 pl-3 pr-10 text-sm font-bold text-slate-700"
          >
            <option value="open">Open Projects</option>
            <option value="payment_pending">Payment Pending</option>
            <option value="closed">Closed Projects</option>
            <option value="all">All Projects</option>
          </select>
          <span className="pointer-events-none absolute inset-y-0 right-0 flex w-9 items-center justify-center text-slate-500">▾</span>
        </div>
        <button
          onClick={() => setAddingProject(true)}
          className="shrink-0 whitespace-nowrap rounded-lg bg-emerald-600 px-3 py-2 text-sm font-bold text-white"
        >
          Add Project
        </button>
      </div>

      <div className="hidden items-center gap-2 border-b border-slate-200 pb-4 sm:flex sm:flex-wrap">
        <button
          onClick={() => selectStatusView("open")}
          className={`whitespace-nowrap rounded-lg px-2.5 py-1 text-sm font-bold shrink-0 ${statusFilter.size === 0 && statusView === "open" ? "bg-slate-700 text-white" : "bg-slate-100 text-slate-600"}`}
        >
          Open Projects
        </button>
        {/* Per Tim, 2026-08-27 — quick filter straight to the one specific
            status, same mechanism the Status ▾ menu's own radio options
            use (selectStatusFilter), not a fourth statusView. */}
        <button
          onClick={() => selectStatusFilter("report_invoice_sent")}
          className={`whitespace-nowrap rounded-lg px-2.5 py-1 text-sm font-bold shrink-0 ${statusFilter.has("report_invoice_sent") ? "bg-slate-700 text-white" : "bg-slate-100 text-slate-600"}`}
        >
          Payment Pending
        </button>
        <button
          onClick={() => selectStatusView("closed")}
          className={`whitespace-nowrap rounded-lg px-2.5 py-1 text-sm font-bold shrink-0 ${statusFilter.size === 0 && statusView === "closed" ? "bg-slate-700 text-white" : "bg-slate-100 text-slate-600"}`}
        >
          Closed Projects
        </button>
        <button
          onClick={() => selectStatusView("all")}
          className={`whitespace-nowrap rounded-lg px-2.5 py-1 text-sm font-bold shrink-0 ${statusFilter.size === 0 && statusView === "all" ? "bg-slate-700 text-white" : "bg-slate-100 text-slate-600"}`}
        >
          All Projects
        </button>
        <button
          onClick={() => setAddingProject(true)}
          className="shrink-0 whitespace-nowrap rounded-lg bg-emerald-600 px-3 py-1 text-sm font-bold text-white hover:underline"
        >
          Add Project
        </button>
      </div>

      {overdueJobs.length > 0 && (
        <button
          onClick={() => selectStatusFilter("overdue")}
          className="mt-3 flex w-full items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-left text-sm font-medium text-red-700"
        >
          ⚠ {overdueJobs.length} invoice{overdueJobs.length === 1 ? "" : "s"} overdue on payment
        </button>
      )}

      {/* Mobile: one dropdown (sort fields + every status/service filter,
          single choice at a time) and one search box, half the row each,
          replacing the whole sort/filter/search row below. Desktop:
          unchanged — that row stays exactly as it's always been. */}
      <div className="mt-4 flex gap-2 sm:hidden">
        <div className="relative min-w-0 flex-1">
          <select
            value={mobileSortFilterValue}
            onChange={(e) => handleMobileSortFilterChange(e.target.value)}
            className={`w-full appearance-none rounded-lg border border-slate-300 bg-white py-2 pl-3 pr-8 text-sm ${mobileSortFilterValue === "" ? "text-gray-400" : "text-slate-700"}`}
          >
            <option value="">Sort by</option>
            {SORT_FIELDS.map((f) => (
              <option key={f.key} value={`sort:${f.key}`}>{f.label}</option>
            ))}
            <optgroup label="Status">
              {overdueJobs.length > 0 && <option value="status:overdue">Overdue ({overdueJobs.length})</option>}
              {PIPELINE_STATUSES.map((s) => (
                <option key={s} value={`status:${s}`}>{STATUS_LABEL[s]}</option>
              ))}
            </optgroup>
            <optgroup label="Service type">
              {availableServiceTypes.map((t) => (
                <option key={t.key} value={`service:${t.label}`}>{t.label}</option>
              ))}
            </optgroup>
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

      <div className="mt-4 hidden flex-wrap items-center gap-2 sm:flex">
        <span className="shrink-0 text-sm font-medium text-gray-400">Sort by:</span>
        {SORT_FIELDS.map((f) => (
          <button
            key={f.key}
            onClick={() => toggleSort(f.key)}
            className={`shrink-0 rounded-lg px-1.5 py-0.5 text-xs font-medium sm:px-2.5 sm:py-1 sm:text-sm ${sortEnabled && sortBy === f.key ? "bg-slate-700 text-white" : "bg-slate-100 text-slate-600"}`}
          >
            {f.label}{sortEnabled && sortBy === f.key ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
          </button>
        ))}
        <div
          className="relative shrink-0"
          onMouseEnter={openStatusFilter}
          onMouseLeave={closeStatusFilter}
        >
          <button
            className={`shrink-0 rounded-lg px-1.5 py-0.5 text-xs font-medium sm:px-2.5 sm:py-1 sm:text-sm ${statusFilter.size > 0 ? "bg-slate-700 text-white" : "bg-slate-100 text-slate-600"}`}
          >
            Status{statusFilter.size > 0 ? ` (${statusFilter.size})` : ""} ▾
          </button>
          {statusFilterOpen && (
            <div className="absolute z-10 mt-1 w-64 rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
              {overdueJobs.length > 0 && (
                <label className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-slate-50">
                  <input
                    type="radio"
                    name="statusFilter"
                    checked={statusFilter.has("overdue")}
                    onChange={() => selectStatusFilter("overdue")}
                    className="h-3.5 w-3.5 shrink-0 appearance-none rounded-none border border-slate-400 checked:border-brand-600 checked:bg-brand-600"
                  />
                  <span className="h-2.5 w-2.5 rounded-full bg-red-600" />
                  Overdue ({overdueJobs.length})
                </label>
              )}
              {PIPELINE_STATUSES.map((s) => (
                <label key={s} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-slate-50">
                  <input
                    type="radio"
                    name="statusFilter"
                    checked={statusFilter.has(s)}
                    onChange={() => selectStatusFilter(s)}
                    className="h-3.5 w-3.5 shrink-0 appearance-none rounded-none border border-slate-400 checked:border-brand-600 checked:bg-brand-600"
                  />
                  <span className={`h-2.5 w-2.5 rounded-full ${STATUS_DOT_COLOR[s]}`} />
                  {STATUS_LABEL[s]}
                </label>
              ))}
              {statusFilter.size > 0 && (
                <button onClick={() => setStatusFilter(new Set())} className="mt-1 w-full rounded px-2 py-1 text-left text-xs text-brand-600 underline">
                  Clear
                </button>
              )}
            </div>
          )}
        </div>
        <div
          className="relative shrink-0"
          onMouseEnter={openServiceTypeFilter}
          onMouseLeave={closeServiceTypeFilter}
        >
          <button
            className={`shrink-0 rounded-lg px-1.5 py-0.5 text-xs font-medium sm:px-2.5 sm:py-1 sm:text-sm ${serviceTypeFilter.size > 0 ? "bg-slate-700 text-white" : "bg-slate-100 text-slate-600"}`}
          >
            <span className="sm:hidden">Service</span>
            <span className="hidden sm:inline">Service Type</span>
            {serviceTypeFilter.size > 0 ? ` (${serviceTypeFilter.size})` : ""} ▾
          </button>
          {serviceTypeFilterOpen && (
            <div className="absolute z-10 mt-1 w-max max-w-xs rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
              {availableServiceTypes.map((t) => (
                <label key={t.key} className="flex items-center gap-2 whitespace-nowrap rounded px-2 py-1.5 text-sm hover:bg-slate-50">
                  <input
                    type="checkbox"
                    checked={serviceTypeFilter.has(t.label)}
                    onChange={() => toggleServiceTypeFilter(t.label)}
                    className="h-3.5 w-3.5 shrink-0 appearance-none rounded-none border border-slate-400 checked:border-brand-600 checked:bg-brand-600"
                  />
                  {t.label}
                </label>
              ))}
              {serviceTypeFilter.size > 0 && (
                <button onClick={() => setServiceTypeFilter(new Set())} className="mt-1 w-full rounded px-2 py-1 text-left text-xs text-brand-600 underline">
                  Clear
                </button>
              )}
            </div>
          )}
        </div>
        {(statusFilter.size > 0 || serviceTypeFilter.size > 0) && (
          <button onClick={clearAllFilters} className="shrink-0 rounded-lg px-2.5 py-1 text-xs font-normal text-brand-600 underline">
            Clear filters
          </button>
        )}
      </div>

      {/* Desktop only now — mobile uses the single search box above instead. */}
      <div className="mt-4 hidden gap-2 sm:flex sm:flex-row sm:flex-nowrap sm:items-center">
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
            {/* Per Tim — the browser's own "mm/dd/yyyy" for an empty date
                input isn't a real placeholder (date inputs don't support
                :placeholder-shown the way text inputs do), so it renders in
                the input's own text color by default — same dark color as
                a real picked date, unlike the lighter placeholder gray the
                three text inputs beside it show. dateQuery (already
                tracked in state) stands in for "is it actually empty". */}
            <input
              type="date"
              value={dateQuery}
              onChange={(e) => setDateQuery(e.target.value)}
              className={`w-full shrink-0 rounded-lg border border-slate-300 px-2.5 py-1 text-sm sm:w-36 ${dateQuery ? "text-slate-900" : "text-slate-400"}`}
            />
            {dateQuery && (
              <button onClick={() => setDateQuery("")} className="shrink-0 text-xs text-brand-600 underline">
                Clear date
              </button>
            )}
      </div>

      {error && <div className="mt-3 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

      {(() => {
        if (loading) return <p className="mt-4 text-sm text-slate-500">Loading…</p>;

        if (sortedJobs.length === 0) {
          return (
            <p className="mt-4 text-sm text-slate-500">
              {statusView === "open" ? "No open projects." : statusView === "closed" ? "No closed projects." : "No projects found."}
            </p>
          );
        }

        return (
          <div className="mt-4 space-y-2">
            {sortedJobs.map((job) => (
              <JobRow
                key={job.id}
                job={job}
                onOpen={() => { setSelectedJobInitialTab("info"); setSelectedJobId(job.id); }}
                onOpenChat={() => { setSelectedJobInitialTab("chat"); setSelectedJobId(job.id); }}
                onEdit={() => setEditingJobId(job.id)}
                onFieldChange={(patch) => patchJob(job, patch)}
              />
            ))}
          </div>
        );
      })()}

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
            initialTab={selectedJobInitialTab}
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

      {addingProject && (
        <AddProjectDialog
          onClose={() => setAddingProject(false)}
          onDone={() => {
            setAddingProject(false);
            loadJobs();
          }}
        />
      )}
    </div>
  );
}

function JobRow({
  job, onOpen, onOpenChat, onEdit, onFieldChange,
}: {
  job: JobWithCustomer;
  onOpen: () => void;
  onOpenChat: () => void;
  onEdit: () => void;
  onFieldChange: (patch: Record<string, unknown>) => void;
}) {
  const addressParts = splitAddress(job.service_address);
  const locationName = addressParts.locationName;
  const street = expandAddress(addressParts.street);
  const cityStateZip = expandAddress(addressParts.cityStateZip);
  // Per Tim, 2026-08-27 — Invoice status sits on the street line, Report
  // status on the town/state/zip line right below it (mobile only), both
  // pushed to that line's own far right. Ready to Send (and Report and
  // Invoice Sent) both cover a report/invoice pair that could be sent,
  // partially sent, or fully sent, which otherwise looks identical on this
  // card regardless of which — always both, not just when they'd disagree.
  // The warning icon shows for either field, not just Report — an unsent
  // invoice is just as much "not actually out the door yet" as an unsent
  // report.
  // Per Tim, 2026-08-27 — status is the authoritative signal for "this job
  // is at the report/invoice stage," not just a same-instant side effect of
  // reportIsComplete/invoice_total_cents. Those two are still checked too
  // (a job can reach this point before its status label formally catches
  // up), but "ready_to_send" or later on its own must always be enough —
  // confirmed live: a job manually set to Report and Invoice Ready didn't
  // reliably show these lines when only the older two-flag check ran.
  const showReportInvoice = job.source !== "subcontractor" && (
    job.status === "ready_to_send" || job.status === "report_invoice_sent"
    || (reportIsComplete(job) && job.invoice_total_cents != null)
  );
  const invoiceStatus = showReportInvoice && (
    <span className="flex shrink-0 items-center gap-1 text-sm text-slate-500">
      {job.invoice_sent_at ? `Invoice: Sent ${formatDateTime(job.invoice_sent_at)}` : "Invoice: Not sent"}
      {!job.invoice_sent_at && <HazardIcon />}
    </span>
  );
  const reportStatus = showReportInvoice && (
    <span className="flex shrink-0 items-center gap-1 text-sm text-slate-500">
      {job.report_sent_at ? `Report: Sent ${formatDateTime(job.report_sent_at)}` : "Report: Not sent"}
      {!job.report_sent_at && <HazardIcon />}
    </span>
  );
  // Mobile only — see the address block below. Desktop already opens
  // straight to Google Maps in the detail dialog, and a driver picking a
  // nav app is a phone-in-hand, on-the-way-there thing, not a desktop one.
  const [showMapMenu, setShowMapMenu] = useState(false);
  const subcontractorSender = job.source === "subcontractor" ? subcontractorSenderForJob(job.customers?.email) : null;
  const customerLabel = subcontractorSender?.companyName ?? (job.customers?.company || (job.customers?.name ? toTitleCase(job.customers.name) : undefined));
  // Subcontractor jobs: the company name is replaced entirely by the same
  // portal-link badge shown in the detail dialog — a quick way straight to
  // their own portal, no need to open the dialog just to jump over there.
  const customerLabelNode = subcontractorSender ? (
    <a
      href={subcontractorSender.portalUrl}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="inline-flex h-7 shrink-0 items-center whitespace-nowrap rounded border border-indigo-300 px-2 py-0.5 text-sm font-bold text-indigo-700 hover:bg-indigo-50 sm:h-auto"
    >
      {customerLabel}
    </a>
  ) : (
    customerLabel
  );
  // Blank while unscheduled rather than showing whatever placeholder date
  // came in with the job — the empty calendar/clock is the visual cue that
  // nothing's booked yet. Editing these just updates what was requested;
  // AcceptScheduleControl (below) is the only thing that promotes status.
  const isUnscheduled = job.status === "needs_scheduling";
  // Per Tim, 2026-08-28 — while a job is still To Be Scheduled, this moves
  // out of its usual spot (the right-hand schedule column, right-aligned)
  // and up onto the address column's own first line instead, left-aligned,
  // pushing street/cityStateZip down one line each — the homeowner's own
  // name/number is the thing the admin needs front and center to actually
  // get the job scheduled.
  // Per Tim, 2026-08-28 — name and phone fall back independently to "No
  // name"/"No phone number" rather than the whole line just disappearing
  // when a job (commonly a subcontractor referral, like PuroClean of
  // Wakefield) never had a homeowner/site contact entered at all — a
  // blank card gave no hint anything was missing.
  const siteContactNode = (
    <span className="block min-w-0 truncate whitespace-nowrap text-sm text-slate-500" onClick={(e) => e.stopPropagation()}>
      {job.site_contact_name ? toTitleCase(job.site_contact_name) : <span className="italic text-slate-400">no name</span>}
      {" "}
      {job.site_contact_phone ? (
        <a href={telHref(job.site_contact_phone)} className="text-brand-700 hover:underline">
          {formatPhoneInput(job.site_contact_phone)}
        </a>
      ) : <span className="italic text-slate-400">no phone number</span>}
    </span>
  );
  const overdueDays = daysOverdue(job);
  const isEmailIntake = job.source === "email_intake";
  const isSubcontractor = job.source === "subcontractor";
  // Boston Harbor Water's email-intake jobs never carry a real requested
  // time — there's no accept step for them, just blank date/time cells the
  // admin fills in directly after calling the homeowner, then an explicit
  // Schedule click (not a submit-on-change the moment both happen to be
  // filled — a half-picked date on mobile could otherwise fire that before
  // the admin ever got to the time field).
  const [manualDate, setManualDate] = useState("");
  const [manualTime, setManualTime] = useState("");
  const dateInputRef = useRef<HTMLInputElement>(null);
  function trySubmitManual(nextDate: string, nextTime: string) {
    if (nextDate && nextTime) {
      onFieldChange({ status: "scheduled", confirmed_date: nextDate, confirmed_time: nextTime, schedule_visible_to_customer: true });
      setManualDate("");
      setManualTime("");
    }
  }
  return (
    <div
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onOpen()}
      className="flex w-full cursor-pointer flex-col gap-2 rounded-lg border border-slate-200 bg-white p-3 hover:border-brand-400 sm:gap-0"
    >
      {/* items-start, not items-center — the status cell's own column can
          run taller than this row now (the Report:/Invoice: sent-status
          lines sit right underneath it), which used to pull Project #/
          company down to the middle of that taller combined height instead
          of lining up with the status pill's own top edge. */}
      <div className="flex w-full items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {job.project_number && (
            // Per Tim, 2026-08-27 — fixed width so every project # badge is
            // the exact same size regardless of digit count, instead of a
            // longer number (e.g. a ".1" revisit) growing wide enough to
            // overlap the status pill next to it. justify-center so a
            // shorter number still centers instead of hugging the left edge
            // of a now-wider-than-it-needs box. Same text-xs as the status
            // pill beside it on mobile — every piece of text on this row
            // matches, not just the pill. Desktop keeps its original auto
            // width and text-sm, unchanged.
            // border-2 border-transparent (not borderless) — Per Tim,
            // 2026-08-28: the status pill beside this on desktop needs a
            // real border for its own ready-to-send highlight, and at
            // h-auto a bordered box computes a few px taller than a
            // borderless one at the same padding — reserving the same
            // invisible border here keeps both boxes' text sitting at the
            // exact same height instead of just their tops lining up.
            <span className="inline-flex h-7 w-24 shrink-0 items-center justify-center whitespace-nowrap rounded border-2 border-transparent bg-slate-200 px-2 py-0.5 text-xs font-mono font-bold text-slate-800 hover:underline sm:inline sm:h-auto sm:w-auto sm:justify-start sm:text-sm">{job.project_number}</span>
          )}
          <div className="hidden truncate whitespace-nowrap font-medium text-slate-800 sm:block">
            {customerLabelNode}
          </div>
        </div>

        {/* min-w-0 + flex-1 (mobile only) — stretches to fill whatever
            width the fixed-size badge on the left didn't use, so the
            status pill's own smaller mobile text (below) has the most
            room possible to fit the longest label ("Report and Invoice
            Ready") on one line without truncating. */}
        <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5 sm:w-auto sm:flex-none sm:shrink-0">
          {overdueDays !== null && (
            <span className="shrink-0 whitespace-nowrap rounded-full bg-red-600 px-2 py-1 text-xs font-bold text-white">
              {overdueDays} day{overdueDays === 1 ? "" : "s"} overdue
            </span>
          )}
          {CLOSED_STATUSES.has(job.status) ? (
            // Per Tim, 2026-08-27 — min-w-0 so this actually holds w-60
            // regardless of label length: inline-flex items default to
            // min-width:auto, which otherwise lets a long label ("Report
            // and Invoice Ready") force the box wider than a short one
            // ("Payment Pending") despite both specifying the same w-60.
            // Smaller text on mobile (text-xs, sm:text-sm restores the
            // original size) is what actually makes the longest label fit
            // the remaining space next to the fixed-width badge on one
            // line — overflow-hidden/text-ellipsis stay only as an inert
            // safety net, never actually meant to trigger. h-7 on mobile
            // and border-2 border-transparent (not h-auto/border-0) match
            // the open-status <select> below exactly — Per Tim,
            // 2026-08-27, this cell must render the same size no matter
            // which status it's showing; h-auto let a <span> and a
            // <select> (and a bordered vs. unbordered select) each
            // compute a slightly different height at the same font-size/
            // padding. Desktop per Tim, 2026-08-28: sm:h-auto/sm:w-auto
            // (not a forced sm:h-9/fixed sm:w-60) so this matches the
            // project # badge's own box exactly — same height and style,
            // free to run wider for a longer status instead of being
            // padded out to a fixed width regardless of status.
            <span className="inline-flex h-7 w-full min-w-0 shrink-0 items-center justify-center overflow-hidden text-ellipsis whitespace-nowrap rounded border-2 border-transparent bg-slate-200 px-2 py-0.5 text-center text-xs font-bold text-slate-700 sm:inline sm:h-auto sm:w-auto sm:justify-start sm:text-left sm:text-sm">
              {statusLabelForJob(job, job.status)}
            </span>
          ) : (
            <div className="flex w-full flex-col items-end gap-4 sm:w-auto">
              <select
                value={job.status}
                onChange={(e) => {
                  const nextStatus = e.target.value;
                  if (isSubcontractor && job.status === "needs_scheduling" && nextStatus === "scheduled") {
                    // Right 90% of the time, so it defaults straight to the
                    // window's own date/start time (e.g. "1:00 PM" out of
                    // "1:00 PM - 4:00 PM") the moment this flips to Scheduled
                    // — the other 10%, it's still just a normal edit away via
                    // the Edit tab's Scheduled date/time fields.
                    onFieldChange({
                      status: "scheduled",
                      confirmed_date: job.requested_date,
                      confirmed_time: parseWindowStartTime24h(job.subcontractor_preferred_window),
                      schedule_visible_to_customer: false,
                    });
                  } else {
                    onFieldChange({ status: nextStatus });
                  }
                }}
                onClick={(e) => e.stopPropagation()}
                // border-2 always (only the color toggles) — Per Tim,
                // 2026-08-27: this cell must be the exact same size
                // regardless of status, and a border that appears only for
                // ready_to_send while every other status has none changes
                // the box's rendered height at h-auto (2px border vs 0).
                // h-7 on mobile locks the height outright, same fixed
                // height as the closed-status <span> above so every status
                // — open, ready-to-send, or closed — renders pixel
                // identical. Desktop per Tim, 2026-08-28: sm:h-7 (not
                // sm:h-auto) — confirmed live a <select> still renders a
                // few px shorter than the project # <span> badge even at
                // identical padding/border/font (same native-UA-metrics
                // quirk as input[type=date] vs select elsewhere in this
                // file), so h-auto alone wasn't actually enough; pinning
                // to the badge's own measured 28px (h-7) is. sm:w-auto
                // (not a fixed sm:w-60) still lets it run wider for a
                // longer status label instead of padding to a fixed width.
                className={`inline-flex h-7 w-full min-w-0 shrink-0 items-center justify-center overflow-hidden text-ellipsis whitespace-nowrap rounded border-2 bg-slate-200 px-2 py-0.5 text-center text-xs font-bold text-slate-700 sm:inline-block sm:h-7 sm:w-auto sm:text-left sm:text-sm ${job.status === "ready_to_send" ? "border-amber-500" : "border-transparent"}`}
              >
                {pipelineStatusesForJob(job).map((s) => (
                  <option key={s} value={s}>{statusLabelForJob(job, s)}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Per Tim, 2026-08-28 — payment due date on the same line as the
          company name, right-aligned opposite it — applies once a job is
          actually in Payment Pending, any company, not just Newton Fire &
          Flood. */}
      <div className="flex items-center justify-between gap-2 sm:hidden">
        <div className="min-w-0 truncate whitespace-nowrap text-sm font-medium text-slate-800">{customerLabelNode}</div>
        {job.status === "report_invoice_sent" && (
          <span className="shrink-0 whitespace-nowrap text-sm text-slate-500">
            Due {formatDate(dueDateFor(job))}
          </span>
        )}
      </div>

      <div className="hidden text-sm text-slate-500 sm:block">&nbsp;</div>

      {/* Per Tim, 2026-08-27 — Invoice sits on the street line, Report on
          the town/state/zip line right below it, both pushed to the row's
          own far right (mobile only — desktop shows the company name
          inline with Project # up in the top row, with no equivalent
          per-line spot for these). Ready to Send (and Report and Invoice
          Sent) both cover a report/invoice pair that could be sent,
          partially sent, or fully sent, which otherwise looks identical on
          this card regardless of which — always both lines, not just when
          they'd disagree. The warning icon shows for either field, not
          just Report — an unsent invoice is just as much "not actually out
          the door yet" as an unsent report. */}
      <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-start">
        <div className="min-w-0 w-full sm:w-auto sm:flex-[0.9]">
          {locationName && <div className="truncate whitespace-nowrap text-sm text-slate-500">{locationName}</div>}
          {/* Mobile: tapping the address text itself (street through zip)
              opens a Google Maps/Waze picker instead of the job detail
              dialog — a driver on the way there wants directions, not to
              reopen the card they just tapped from. inline-block (not
              block w-full) so the tappable area hugs the text itself
              instead of spanning the whole row — confirmed live 2026-08-27,
              a full-width button meant tapping empty space well to the
              right of a short address still opened the map picker instead
              of the card. Desktop: unchanged plain text (no picker; the
              detail dialog's own address link already goes to Maps). */}
          <div className="relative">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setShowMapMenu((v) => !v); }}
              className={`inline-block max-w-full text-left sm:hidden ${showMapMenu ? "underline" : ""}`}
            >
              <span className="block truncate whitespace-nowrap text-sm text-slate-500">{street}</span>
              {cityStateZip && <span className="block truncate whitespace-nowrap text-sm text-slate-500">{cityStateZip}</span>}
            </button>
            {/* Per Tim, 2026-08-27 — Invoice directly above Report, both
                left-aligned, sitting right after the address block instead
                of interrupting it. */}
            {showReportInvoice && (
              <div className="mt-1 flex flex-col items-start sm:hidden">
                {invoiceStatus}
                {reportStatus}
              </div>
            )}
            <div className="hidden sm:block">
              <div className="truncate whitespace-nowrap text-sm text-slate-500">{street}</div>
              {cityStateZip && <div className="truncate whitespace-nowrap text-sm text-slate-500">{cityStateZip}</div>}
            </div>
            {showMapMenu && (
              <div
                className="absolute z-10 mt-1 w-48 rounded-lg border border-slate-200 bg-white p-1 shadow-lg sm:hidden"
                onClick={(e) => e.stopPropagation()}
              >
                <a
                  href={googleMapsUrl(job.service_address)}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => setShowMapMenu(false)}
                  className="block rounded px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                >
                  Open in Google Maps
                </a>
                <a
                  href={wazeUrl(job.service_address)}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => setShowMapMenu(false)}
                  className="block rounded px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                >
                  Open in Waze
                </a>
              </div>
            )}
          </div>
        </div>

        <div className="min-w-0 w-full sm:w-auto sm:flex-[1.2]">
          {(() => {
            const labels = (job.service_type ?? "").split(",").map((s) => s.trim()).filter(Boolean);
            return labels.map((label, i) => (
              <div key={i} className="whitespace-nowrap text-sm text-slate-500">
                {serviceTypeLabel(label)}{i < labels.length - 1 ? "," : ""}
              </div>
            ));
          })()}
        </div>

        <div
          className={`flex min-w-0 w-full flex-col items-start gap-1.5 sm:w-auto sm:flex-[0.9] sm:items-end${
            isEmailIntake && isUnscheduled ? " sm:self-stretch sm:justify-end" : ""
          }`}
        >
          {/* Site contact (usually the homeowner) — shown regardless of
              status, including To Be Scheduled, so the admin can always
              find this number in the same spot on the card. Per Tim,
              2026-08-28: except once a job is actually in Payment
              Pending — the homeowner's long done with fieldwork by then,
              not worth the space next to the payment due date instead —
              or Pending Lab Results, same reasoning: fieldwork's already
              done, nothing left to call the homeowner about. */}
          {job.status !== "report_invoice_sent" && job.status !== "pending_lab_results" && siteContactNode}
          {CLOSED_STATUSES.has(job.status) ? (
            <div className="flex flex-col items-start gap-0.5 px-1.5 py-1 text-xs text-slate-500 sm:items-end">
              <span>Date of Project: {formatDate(job.requested_date) || "—"}</span>
              <span>Date of Payment: {formatDate(job.paid_date) || "—"}</span>
              <span>Date Sent: {formatDateTime(job.report_sent_at) || "—"}</span>
            </div>
          ) : isEmailIntake && isUnscheduled ? (
            // Boston Harbor Water's own order never carries a real
            // appointment — there's no "requested time" to reference, only
            // the homeowner to call and negotiate one with directly — so
            // this gets blank editable cells right away instead of the
            // plain requested-date/time text every other source shows. An
            // explicit Schedule click is what schedules the job, not just
            // filling both cells (see trySubmitManual) — that used to fire
            // from onChange the moment the second field got a value, which
            // on mobile could trigger off a half-picked date before the
            // admin ever reached the time field.
            <div className="flex w-full shrink-0 flex-col items-start gap-1.5 sm:w-auto sm:items-end" onClick={(e) => e.stopPropagation()}>
              {/* items-stretch (not items-center) so Date and Time share the
                  row's own height exactly, rather than each sizing itself
                  off its own padding/line-height math — that left Date 3px
                  taller than Time's actual rendered height, being a <div>
                  standing in for a <select>'s slightly different UA metrics. */}
              <div className="flex w-full items-stretch gap-2 sm:w-auto">
                {/* Real iOS Safari won't hold a fixed width on input[type=date]
                    no matter how it's constrained — not via a direct width,
                    not via appearance-none (which just broke it worse), not
                    via a clipping wrapper. Giving up on making the native
                    control itself look right: what's visible now is a
                    plain, fully custom div sized exactly like Time, and the
                    real date input sits on top of it at opacity-0 — still
                    genuinely there and tappable (opacity doesn't disable
                    interaction), so tapping anywhere in the box still opens
                    the OS's native date picker exactly as before. Its own
                    layout quirks no longer matter since nothing about it is
                    ever seen. */}
                <div
                  className="relative w-28 shrink-0 rounded-lg border border-slate-300 bg-white"
                  // Tapping anywhere opens the native picker on mobile, but
                  // desktop Chrome/Edge only do that for a real click on the
                  // tiny calendar-icon glyph — invisible here since the
                  // input itself is opacity-0, so a desktop click anywhere
                  // else in the box just silently focused it. showPicker()
                  // forces it open regardless of where in the box was
                  // clicked; harmless where it's unsupported (Safari) or
                  // already open (mobile's own tap-to-open already fired).
                  onClick={() => dateInputRef.current?.showPicker?.()}
                >
                  <div className="flex h-full items-center px-1.5 text-xs text-slate-600">
                    {manualDate ? formatDateMDY(manualDate) : "Date"}
                  </div>
                  <input
                    ref={dateInputRef}
                    type="date"
                    value={manualDate}
                    onChange={(e) => setManualDate(e.target.value)}
                    className="absolute inset-0 h-full w-full opacity-0"
                  />
                </div>
                {/* appearance-none + bg-white — same pattern used by every
                    other <select> in this app (e.g. the status dropdown
                    above) — strips iOS's own gray select fill, which is
                    what made Time visibly shaded next to Date's plain
                    white box. The stripped native arrow is replaced with
                    the same manual chevron those other selects use. */}
                <div className="relative w-28 shrink-0">
                  <select
                    value={manualTime}
                    onChange={(e) => setManualTime(e.target.value)}
                    className="w-full min-w-0 appearance-none rounded-lg border border-slate-300 bg-white py-1 pl-1.5 pr-5 text-xs text-slate-600"
                  >
                    <option value="">Time</option>
                    {timeSelectOptions().map((t) => (
                      <option key={t} value={t}>{formatTime(t)}</option>
                    ))}
                  </select>
                  <span className="pointer-events-none absolute inset-y-0 right-1.5 flex items-center text-slate-500">▾</span>
                </div>
                <button
                  type="button"
                  disabled={!manualDate || !manualTime}
                  onClick={() => trySubmitManual(manualDate, manualTime)}
                  className="shrink-0 rounded-lg bg-emerald-600 px-2 py-1 text-xs font-bold text-white disabled:opacity-50"
                >
                  Schedule
                </button>
              </div>
            </div>
          ) : (
            // No editable date/time cells for any other job source — just
            // plain reference text, in the same label/value format either
            // way: "Requested date/time" while still unscheduled,
            // "Scheduled date/time" once it's not. Editing happens in the
            // Edit dialog now, not inline here.
            <div className="flex w-full shrink-0 flex-col items-start gap-1.5 sm:w-60 sm:items-end" onClick={(e) => e.stopPropagation()}>
              {/* Per Tim, 2026-08-27 — this column always showed
                  Completed/Scheduled date instead — stale info once the
                  job's actually at the report/invoice stage. Once both
                  matter, show sent-status here instead of the date: on
                  desktop that's this same column (invoiceStatus/
                  reportStatus below); on mobile it's the Invoice:/Report:
                  lines shown next to the address, so the date block below
                  must disappear entirely there too — confirmed live
                  2026-08-27, sm:hidden only hid it on desktop, leaving it
                  redundantly visible on mobile alongside those lines. */}
              {showReportInvoice && (
                <div className="hidden w-full flex-col items-end gap-0.5 text-sm text-slate-500 sm:flex">
                  {invoiceStatus}
                  {reportStatus}
                </div>
              )}
              <div className={`w-full text-sm text-slate-500 ${showReportInvoice ? "hidden" : ""}`}>
                {!isUnscheduled ? (
                  <>
                    <div>{hasCompletedFieldwork(job.status) ? "Completed" : "Scheduled"} date: {formatDate(job.confirmed_date ?? job.requested_date) || "—"}</div>
                    <div>
                      {hasCompletedFieldwork(job.status) ? "Completed" : "Scheduled"} time:{" "}
                      {isSubcontractor && job.confirmed_time && job.confirmed_time === parseWindowStartTime24h(job.subcontractor_preferred_window)
                        ? extractTimeRange(job.subcontractor_preferred_window) ?? formatTime(job.confirmed_time)
                        : formatTime(job.confirmed_time ?? job.requested_time) || "—"}
                    </div>
                  </>
                ) : (
                  <>
                    <div>Requested date: {formatDate(job.requested_date) || "—"}</div>
                    <div>
                      Requested time:{" "}
                      {isSubcontractor
                        ? extractTimeRange(job.subcontractor_preferred_window) ?? "—"
                        : formatTime(job.requested_time) || "—"}
                    </div>
                  </>
                )}
              </div>
              {!isUnscheduled && job.status === "scheduled" && job.confirmed_date && !isSubcontractor && (job.confirmation_sent_at || job.reminder_sent_at) && (
                <div className="flex flex-col items-end gap-0.5">
                  {job.confirmation_sent_at && (
                    <span className="whitespace-nowrap text-[10px] text-slate-400">
                      Confirmation sent {formatDateTime(job.confirmation_sent_at)}
                    </span>
                  )}
                  {job.reminder_sent_at && (
                    <span className="whitespace-nowrap text-[10px] text-slate-400">
                      Reminder sent {formatDateTime(job.reminder_sent_at)}
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Per Tim — flags the "report and invoice both still sitting unsent"
// state next to the Report:/Invoice: sent-status lines (project card and
// Project Info tab), small since it's a nudge, not an error.
function HazardIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" className="shrink-0" aria-label="Neither has been sent yet">
      <path d="M10 2.5L18.5 17H1.5L10 2.5Z" fill="#F59E0B" stroke="#F59E0B" strokeLinejoin="round" />
      <rect x="9.25" y="8" width="1.5" height="4.5" rx="0.75" fill="white" />
      <rect x="9.25" y="13.25" width="1.5" height="1.5" rx="0.75" fill="white" />
    </svg>
  );
}

function DetailField({ label, value, nowrap, trailing }: { label: string; value: React.ReactNode; nowrap?: boolean; trailing?: React.ReactNode }) {
  if (value == null || value === "" || (typeof value === "string" && !value.trim())) return null;
  return (
    <div className="flex items-start gap-2 text-sm">
      <span className="w-48 shrink-0 whitespace-nowrap font-bold text-black">{label}</span>
      <span className={`min-w-0 flex-1 text-black ${nowrap ? "sm:whitespace-nowrap" : ""}`}>{value}</span>
      {trailing}
    </div>
  );
}

// Shared by the Final Report tab's invoice and report rows — same
// create-draft / confirm-before-duplicate / live Gmail-status pattern,
// just pointed at a different pair of *_drafted_at/*_sent_at fields and a
// different `kind` query param (see draft-status/create-draft routes).
// `active` gates the live-status effect to only run while its own tab
// section is actually visible, matching the previous single-draft
// behavior of only checking while the Final Report tab was open.
function useDraftTracking(params: {
  kind: "invoice" | "report";
  /** What create() actually asks create-draft to build — defaults to `kind`. The combined draft writes both invoice_* and report_* columns identically, so either `kind` works for status-checking it; only create-draft's own kind param decides which draft it builds. */
  createKind?: "invoice" | "report" | "combined";
  active: boolean;
  jobId: string;
  draftedAt: string | null;
  sentAt: string | null;
  onChanged: () => void;
}) {
  const { kind, createKind = kind, active, jobId, draftedAt, sentAt, onChanged } = params;
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // null = not checked yet / checking. draftedAt only means "a draft was
  // created at some point" — this is the live truth from Gmail itself of
  // whether it's still sitting in Drafts, was actually sent (SENT label on
  // its message), or is just gone (deleted without sending). There is no
  // manual "mark as sent" — "sent" only ever comes from this check.
  const [status, setStatus] = useState<{ status: "drafted" | "sent" | "none"; sentAt?: string } | null>(null);

  useEffect(() => {
    if (!active || !draftedAt || sentAt) {
      setStatus(null);
      return;
    }
    let cancelled = false;
    setStatus(null);
    fetch(`/api/admin/jobs/${jobId}/draft-status?kind=${kind}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setStatus({ status: data.status, sentAt: data.sentAt });
        if (data.status === "sent") onChanged();
      })
      .catch(() => {
        if (!cancelled) setStatus(null);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, jobId, draftedAt, sentAt, kind]);

  // Always rebuilds from scratch with the current attachments and deletes
  // whatever was there before (see draftCombinedEmailForJob's own
  // stale-draft cleanup) — per Tim, viewing the draft should always mean
  // the freshest one, not a possibly-stale copy from before a later edit,
  // so there's no separate "regenerate" step or confirmation to skip past.
  // Split from viewDraft below so the auto-fire-on-completion effect can
  // create the first draft silently, without popping open a Gmail tab the
  // admin never clicked for.
  async function createDraft(): Promise<{ messageId?: string } | null> {
    setCreating(true);
    setMessage(null);
    try {
      const res = await fetch(
        `/api/admin/jobs/${jobId}/create-draft?kind=${createKind}`,
        { method: "POST" }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create draft");
      onChanged();
      return data;
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Failed to create draft");
      return null;
    } finally {
      setCreating(false);
    }
  }

  // The "View Draft" button's own action — creates (or recreates) the
  // draft, then jumps straight to it using the message id the create call
  // itself returns, rather than waiting on a job refetch to pick it up.
  // Opens the tab synchronously, in the same tick as the click, and only
  // navigates it once the new draft exists — most browsers block a
  // window.open() that happens after an intervening await, since by then
  // it's no longer considered a direct result of the user's click.
  async function viewDraft() {
    // Deliberately no noopener here (unlike other external links in this
    // file) — that flag makes window.open() return null, and this needs
    // the handle back so it can navigate the tab once the draft exists.
    const tab = window.open("", "_blank");
    const data = await createDraft();
    if (data?.messageId && tab) {
      tab.location.href = gmailMessageUrl(data.messageId, false);
    } else {
      tab?.close();
    }
  }

  return { creating, message, status, createDraft, viewDraft };
}

export function ProjectDetailDialog({
  job, onClose, onChanged, onEdit, onStatusChange, initialTab,
}: {
  job: JobWithCustomer;
  onClose: () => void;
  onChanged: () => void;
  onEdit: () => void;
  onStatusChange: (status: string) => void;
  initialTab?: "info" | "report" | "invoice" | "chat" | "photos";
}) {
  const [tab, setTab] = useState<"info" | "report" | "invoice" | "chat" | "photos" | "shipping" | "compensation">(initialTab ?? "info");
  // Just for labeling "Email results to" below — report_emails is only ever
  // stored as bare addresses (see lib/lab-email.ts's own recipient-building,
  // which needs plain emails to send to), so names for display are looked
  // up separately against the job's company contacts rather than stored
  // alongside the emails themselves.
  const [companyContactsForDisplay, setCompanyContactsForDisplay] = useState<Customer[]>([]);
  useEffect(() => {
    const companyId = job.customers?.company_id;
    if (!companyId) { setCompanyContactsForDisplay([]); return; }
    fetch(`/api/admin/customers?companyId=${companyId}`)
      .then((res) => res.json())
      .then((data) => setCompanyContactsForDisplay(data.customers ?? []));
  }, [job.customers?.company_id]);
  const [confirmingReleaseOverride, setConfirmingReleaseOverride] = useState(false);
  const [submittingReleaseOverride, setSubmittingReleaseOverride] = useState(false);
  const [releaseOverrideError, setReleaseOverrideError] = useState<string | null>(null);
  const [serviceTypeSettings, setServiceTypeSettings] = useState<ServiceType[]>([]);
  const [pricingZones, setPricingZones] = useState<PricingZone[]>([]);
  const [labs, setLabs] = useState<LabProfile[]>([]);
  const [reportSummaryInput, setReportSummaryInput] = useState(job.report_summary ?? "");
  const [reportNotesInput, setReportNotesInput] = useState(job.report_notes ?? "");
  // Lead's own Overall Findings sentence — separate from asbestos's
  // report_summary above, since a job combining asbestos and lead produces
  // two separate final reports and can't share one field between them.
  const [leadReportSummaryInput, setLeadReportSummaryInput] = useState(job.lead_report_summary ?? "");
  // Mold's own Discussion of Results/Conclusions & Recommendations — same
  // reasoning, separate from asbestos's report_summary/report_notes and
  // lead's lead_report_summary above. Discussion of Results is further
  // split one field per sample type (see mold_air_discussion's own comment
  // in types.ts for why), so this needs three inputs, not one.
  const [moldAirDiscussionInput, setMoldAirDiscussionInput] = useState(job.mold_air_discussion ?? "");
  const [moldBulkDiscussionInput, setMoldBulkDiscussionInput] = useState(job.mold_bulk_discussion ?? "");
  const [moldSwabDiscussionInput, setMoldSwabDiscussionInput] = useState(job.mold_swab_discussion ?? "");
  const [moldReportNotesInput, setMoldReportNotesInput] = useState(job.mold_report_notes ?? "");
  const moldAirDiscussionRef = useRef<HTMLTextAreaElement>(null);
  const moldBulkDiscussionRef = useRef<HTMLTextAreaElement>(null);
  const moldSwabDiscussionRef = useRef<HTMLTextAreaElement>(null);
  const moldReportNotesRef = useRef<HTMLTextAreaElement>(null);
  // Which domain's report is showing on the Report tab — a job combining
  // service types from more than one domain (e.g. asbestos + mold) gets
  // one tab button per domain (see the tab bar below) instead of every
  // domain's upload stations stacked into one long scroll. Reset whenever
  // the job's own domains change out from under the current selection
  // (an edit dropped the domain currently selected) rather than pointing
  // at a group that no longer exists.
  const [reportDomainTab, setReportDomainTab] = useState<ReportDomain>(() => jobReportDomains(job.service_type)[0] ?? "asbestos");
  useEffect(() => {
    const domains = jobReportDomains(job.service_type);
    if (!domains.includes(reportDomainTab)) setReportDomainTab(domains[0] ?? "asbestos");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.service_type]);
  // Active whenever the header's own draft control (always visible now,
  // not tied to which inner tab is open) would actually render — see its
  // render site below. reportIsComplete(job) recomputed here rather than
  // reusing the `reportComplete` local further down, since these hooks
  // have to be declared before it (rules of hooks — no conditional/late
  // declarations) and it's a cheap pure function of `job` either way.
  const draftControlActive = reportIsComplete(job) && job.invoice_total_cents != null;
  const combinedDraft = useDraftTracking({
    kind: "invoice",
    createKind: "combined",
    active: draftControlActive,
    jobId: job.id,
    draftedAt: job.invoice_drafted_at,
    sentAt: job.invoice_sent_at,
    onChanged,
  });
  // Boston Harbor Water Restoration's report and invoice are two
  // genuinely separate Gmail drafts (see create-draft/route.ts's own
  // BOSTON_HARBOR_WATER_RESTORATION_COMPANY_ID branch), each sent on its
  // own schedule — job.report_draft_gmail_message_id and
  // job.invoice_draft_gmail_message_id differ once that's happened. These
  // two hooks track/create each independently (createKind matches kind,
  // not "combined") so the header control below can show — and act on —
  // each one on its own, rather than one "create" click risking a
  // duplicate re-draft of whichever half was already sent. Unused (and
  // harmless) for every other company, where the two message ids are
  // always identical and the single combinedDraft control above still
  // covers it exactly as before.
  const reportOnlyDraft = useDraftTracking({
    kind: "report",
    createKind: "report",
    active: draftControlActive,
    jobId: job.id,
    draftedAt: job.report_drafted_at,
    sentAt: job.report_sent_at,
    onChanged,
  });
  const invoiceOnlyDraft = useDraftTracking({
    kind: "invoice",
    createKind: "invoice",
    active: draftControlActive,
    jobId: job.id,
    draftedAt: job.invoice_drafted_at,
    sentAt: job.invoice_sent_at,
    onChanged,
  });
  const [invoiceLineItems, setInvoiceLineItems] = useState<LineItemRowState[]>(() => defaultLineItems(job, serviceTypeSettings, pricingZones));
  const [savingInvoice, setSavingInvoice] = useState(false);
  // Full-inspection (Pre-Renovation/Pre-Demolition) asbestos jobs only —
  // see MaterialsEditor.
  const [fullInspectionMaterials, setFullInspectionMaterials] = useState<FullInspectionMaterial[]>(job.full_inspection_materials ?? []);
  const [savingMaterials, setSavingMaterials] = useState(false);
  const materialsHasMountedRef = useRef(false);
  const materialsDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [payLinkLoading, setPayLinkLoading] = useState(false);
  const [payLinkError, setPayLinkError] = useState<string | null>(null);
  async function getPaymentLink() {
    setPayLinkLoading(true);
    setPayLinkError(null);
    try {
      const res = await fetch(`/api/admin/jobs/${job.id}/pay-link`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Something went wrong");
      window.open(data.url, "_blank", "noreferrer");
    } catch (e) {
      setPayLinkError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setPayLinkLoading(false);
    }
  }
  const [copyLinkLoading, setCopyLinkLoading] = useState(false);
  const [copyLinkDone, setCopyLinkDone] = useState(false);
  async function copyPaymentLink() {
    setCopyLinkLoading(true);
    setPayLinkError(null);
    try {
      const res = await fetch(`/api/admin/jobs/${job.id}/pay-link`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Something went wrong");
      await navigator.clipboard.writeText(data.url);
      setCopyLinkDone(true);
      setTimeout(() => setCopyLinkDone(false), 2000);
    } catch (e) {
      setPayLinkError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setCopyLinkLoading(false);
    }
  }
  const lastAppliedInvoiceDefaultRef = useRef<string>(JSON.stringify(defaultLineItems(job, serviceTypeSettings, pricingZones)));
  const invoiceHasMountedRef = useRef(false);
  const invoiceDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Set only by real admin edits (typing a field, +Custom Line Item,
  // +Samples, Delete) — never by the auto-recompute effect below — so
  // saveInvoice() can tell the two apart and persist invoice_auto correctly.
  const userEditedInvoiceRef = useRef(false);
  const setInvoiceLineItemsFromUser: Dispatch<SetStateAction<LineItemRowState[]>> = (update) => {
    userEditedInvoiceRef.current = true;
    setInvoiceLineItems(update);
  };

  useEffect(() => {
    fetch("/api/admin/settings")
      .then((r) => r.json())
      .then((data) => {
        setServiceTypeSettings(data.settings?.service_types ?? []);
        setPricingZones(data.settings?.pricing_zones ?? []);
        setLabs(data.settings?.labs ?? []);
      });
  }, []);

  // Re-derives the invoice's default line items whenever the job's own
  // data changes (a sample count entered on the Lab Paperwork tab, an
  // address edit, etc.) — not just once when settings first load. Only
  // overwrites if the invoice still matches the last default we applied,
  // so it never clobbers line items the admin has actually typed over.
  useEffect(() => {
    const nextDefault = defaultLineItems(job, serviceTypeSettings, pricingZones);
    const nextDefaultJson = JSON.stringify(nextDefault);
    const lastDefaultJson = lastAppliedInvoiceDefaultRef.current;
    // Skip entirely when the computed default hasn't actually changed —
    // `job` gets a fresh object reference every time the invoice autosave's
    // onChanged() reloads the list, even though nothing relevant to the
    // invoice changed. Without this check, defaultLineItems() would hand
    // back a new (but content-identical) array each reload, which the
    // autosave effect below sees as a real edit and saves again — reload,
    // recompute, save, reload — forever.
    if (nextDefaultJson === lastDefaultJson) return;
    // The updater must stay pure — React can invoke it more than once per
    // commit (Strict Mode's dev-only double-invoke check), and mutating
    // the ref inside it meant the second call compared against a ref the
    // first call had already advanced, silently discarding the update.
    setInvoiceLineItems((current) => (JSON.stringify(current) === lastDefaultJson ? nextDefault : current));
    lastAppliedInvoiceDefaultRef.current = nextDefaultJson;
  }, [job, serviceTypeSettings, pricingZones]);
  // One sample-count cell per service type on the job (e.g. "Mold Air
  // Sampling", "Asbestos Inspection"), settable straight from the lab's
  // results — independent of the legacy sample_items row log below.
  const serviceTypeLabels = useMemo(
    () => (job.service_type ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    [job.service_type]
  );
  // Same-domain labels (e.g. "Mold Air Sampling" + "Mold Bulk Sampling")
  // grouped under one section instead of two separate ones — otherwise
  // shared, domain-level things (Turnaround, the Lab pick, mold's own
  // Discussion of Results/Conclusions & Recommendations) end up visually
  // attached to whichever label happens to render first or last, reading
  // as if they only applied to that one specific service type.
  const serviceTypeGroups = useMemo(() => {
    const groups: { domain: ReportDomain; labels: string[] }[] = [];
    for (const label of serviceTypeLabels) {
      const domain = domainForServiceTypeLabel(label);
      const existing = groups.find((g) => g.domain === domain);
      if (existing) existing.labels.push(label);
      else groups.push({ domain, labels: [label] });
    }
    return groups;
  }, [serviceTypeLabels]);
  const turnaroundControl = (
    <div className="flex items-center gap-2 text-sm">
      {/* Per Tim — matches Standard/Rush's own inactive-state pill exactly
          (rounded/px-2/py-0.5/text-xs/font-bold/text-slate-600/bg-slate-100),
          not plain unboxed text. */}
      <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-bold uppercase text-slate-600">Turnaround</span>
      <button
        onClick={() => setRush(false)}
        className={`rounded px-2 py-0.5 text-xs font-bold uppercase ${job.lab_turnaround !== "Rush" ? "bg-slate-700 text-white" : "bg-slate-100 text-slate-600"}`}
      >
        Standard
      </button>
      {/* Per Tim — light yellow highlight (bg-yellow-100, the same shade
          used elsewhere in the app) instead of solid amber, with text
          staying the same slate-600 as Standard/Turnaround in both states
          rather than switching to white when active. */}
      <button
        onClick={() => setRush(true)}
        className={`rounded px-2 py-0.5 text-xs font-bold uppercase text-slate-600 ${job.lab_turnaround === "Rush" ? "bg-yellow-100" : "bg-slate-100"}`}
      >
        Rush
      </button>
    </div>
  );
  const labDropdown = (domain: ReportDomain) => (
    <div className="flex w-full items-center gap-2 text-sm">
      <span className="shrink-0 text-xs font-semibold uppercase text-slate-400">Lab</span>
      <select
        className="h-9 w-full min-w-0 flex-1 truncate rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
        value={(domain === "mold" ? job.mold_lab_name : domain === "lead" ? job.lead_lab_name : job.lab_name) ?? ""}
        onChange={(e) => selectLab(e.target.value, domain)}
      >
        <option value="">— Not set —</option>
        {labs.map((l) => (
          <option key={l.name} value={l.name}>{l.name}</option>
        ))}
      </select>
    </div>
  );
  // Auto-extracted from the lab report's own "Date(s) Sampled:"/"Collected:"
  // line (see documents/route.ts's extractSampledDate) — this is the only
  // way to correct it when the lab itself gets that line wrong, confirmed
  // live on 26-0002 (Crystal Analytical printed 08/24/26, the actual
  // asbestos sampling date was 08/20/26). Every date in the final report
  // reads from this field, so a wrong lab-entered date otherwise has no fix
  // short of editing the database directly.
  const dateSampledInput = (domain: ReportDomain) => (
    <div className="flex w-full items-center gap-2 text-sm">
      <span className="shrink-0 text-xs font-semibold uppercase text-slate-400">Date Sampled</span>
      <input
        type="date"
        className="h-9 w-full min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
        value={(domain === "mold" ? job.mold_date_sampled : domain === "lead" ? job.lead_date_sampled : job.lab_date_sampled) ?? ""}
        onChange={(e) => saveDateSampled(e.target.value, domain)}
      />
    </div>
  );
  // report_summary is one shared field for the whole job's asbestos/lead
  // report (mold has its own separate discussion fields now, so no more
  // cross-domain field sharing) — the Result dropdown only ever needs to
  // render once, but has to anchor to whichever label is actually asbestos
  // or lead. A mixed job (e.g. asbestos + mold air sampling) can order its
  // labels either way, so anchoring to the first non-mold label rather
  // than a bare labelIndex === 0 gets it right regardless of order.
  async function saveReportSummary(value: string) {
    await fetch(`/api/admin/jobs/${job.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ report_summary: value.trim() || null }),
    });
    onChanged();
  }

  async function saveReportNotes(value: string) {
    await fetch(`/api/admin/jobs/${job.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ report_notes: value.trim() || null }),
    });
    onChanged();
  }

  async function saveLeadReportSummary(value: string) {
    await fetch(`/api/admin/jobs/${job.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lead_report_summary: value.trim() || null }),
    });
    onChanged();
  }

  async function saveMoldAirDiscussion(value: string) {
    await fetch(`/api/admin/jobs/${job.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mold_air_discussion: value.trim() || null }),
    });
    onChanged();
  }

  async function saveMoldBulkDiscussion(value: string) {
    await fetch(`/api/admin/jobs/${job.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mold_bulk_discussion: value.trim() || null }),
    });
    onChanged();
  }

  async function saveMoldSwabDiscussion(value: string) {
    await fetch(`/api/admin/jobs/${job.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mold_swab_discussion: value.trim() || null }),
    });
    onChanged();
  }

  async function saveReportReleaseOverride(value: boolean): Promise<boolean> {
    const res = await fetch(`/api/admin/jobs/${job.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ report_release_override: value }),
    });
    if (!res.ok) return false;
    onChanged();
    return true;
  }

  async function saveMoldReportNotes(value: string) {
    await fetch(`/api/admin/jobs/${job.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mold_report_notes: value.trim() || null }),
    });
    onChanged();
  }

  // Turns the selected line(s) — or just the current line, with no
  // selection — into a "• " bullet or "N. " numbered item, stripping
  // whichever marker (if any) was already there first so re-clicking the
  // other button swaps the style instead of stacking markers. The PDF
  // renderer (report-pdf.tsx's blocksFromText) recognizes these same
  // markers and renders them as an actual bulleted/numbered list, not a
  // literal "•"/digit in the paragraph text. Generic over which textarea —
  // Per Tim, 2026-08-27, the same two buttons belong on every Discussion
  // of Results cell (air/bulk/swab), not just Conclusions & Recommendations.
  function applyListFormat(
    textareaRef: React.RefObject<HTMLTextAreaElement | null>,
    setValue: (v: string) => void,
    saveValue: (v: string) => void,
    ordered: boolean,
  ) {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const { selectionStart, selectionEnd, value } = textarea;
    const lineStart = value.lastIndexOf("\n", selectionStart - 1) + 1;
    const nextBreak = value.indexOf("\n", selectionEnd);
    const lineEnd = nextBreak === -1 ? value.length : nextBreak;
    const lines = value.slice(lineStart, lineEnd).split("\n");
    const formatted = lines
      .map((line, i) => {
        const bare = line.replace(/^([-*•]\s+|\d+[.)]\s+)/, "");
        return ordered ? `${i + 1}. ${bare}` : `• ${bare}`;
      })
      .join("\n");
    const newValue = value.slice(0, lineStart) + formatted + value.slice(lineEnd);
    setValue(newValue);
    saveValue(newValue);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(lineStart + formatted.length, lineStart + formatted.length);
    });
  }

  async function saveJobField(patch: Record<string, unknown>) {
    await fetch(`/api/admin/jobs/${job.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    onChanged();
  }

  // Manual overrides for whenever an emailed-in lab report doesn't get
  // auto-recognized (a new lab format, an unusual page layout) — the admin
  // can just pick the lab and type the count directly rather than being
  // stuck waiting on the parser to catch up.
  async function selectLab(labName: string, domain: ReportDomain) {
    const lab = labs.find((l) => l.name === labName);
    // Each domain has its own lab field(s) so a mixed job can use two
    // different labs without one domain's pick overwriting the other's.
    // Mold's report shows no cert at all; lead shows one AIHA cert (reusing
    // the same Settings "cert" field asbestos calls NIST — the Settings UI
    // only has one generic cert field per lab, not a separate one per
    // domain); asbestos shows both NIST and MassDLS.
    const patch = domain === "mold"
      ? { mold_lab_name: labName || null }
      : domain === "lead"
      ? { lead_lab_name: labName || null, lead_lab_cert: lab?.nist_cert || null }
      : { lab_name: labName || null, lab_nist_cert: lab?.nist_cert || null, lab_massdls_cert: lab?.massdls_cert || null };
    await fetch(`/api/admin/jobs/${job.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    onChanged();
  }

  // Manual correction for whenever the lab's own "Date(s) Sampled:"/
  // "Collected:" line is just wrong (confirmed live on 26-0002 — Crystal
  // Analytical printed the wrong date) — every date on the final report
  // reads from this field, so this is the only fix short of the database.
  async function saveDateSampled(value: string, domain: ReportDomain) {
    const patch = domain === "mold"
      ? { mold_date_sampled: value || null }
      : domain === "lead"
      ? { lead_date_sampled: value || null }
      : { lab_date_sampled: value || null };
    await fetch(`/api/admin/jobs/${job.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    onChanged();
  }

  async function setRush(value: boolean) {
    await fetch(`/api/admin/jobs/${job.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lab_turnaround: value ? "Rush" : null }),
    });
    onChanged();
  }

  async function acceptSchedule(patch: Record<string, unknown>) {
    await fetch(`/api/admin/jobs/${job.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    onChanged();
  }

  async function saveInvoice() {
    setSavingInvoice(true);
    // Captured before the request goes out, not after — this save might be
    // a real edit (invoice_auto should flip to false and stay there) or
    // just the auto-recompute effect persisting a still-live default
    // (invoice_auto stays true, so it keeps recomputing on the next change).
    const isUserEdit = userEditedInvoiceRef.current;
    try {
      const payloadItems = invoiceLineItems
        .filter((r) => r.description.trim())
        .map((r) => ({
          description: r.description.trim(),
          quantity: Number(r.quantity),
          billing_unit: r.billingUnit.trim() || "Each",
          unit_cost_cents: Math.round(Number(r.unitCost || "0") * 100),
        }));
      const res = await fetch(`/api/admin/jobs/${job.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoice_line_items: payloadItems, invoice_auto: !isUserEdit }),
      });
      if (res.ok) {
        if (isUserEdit) userEditedInvoiceRef.current = false;
        onChanged();
      }
    } finally {
      setSavingInvoice(false);
    }
  }

  // Auto-saves ~1s after the admin stops editing a line item — the Invoice
  // tab is meant to stay "live" the same way Edit Project does, rather than
  // requiring a separate explicit save step. Skips the very first render so
  // loading the tab's own default line items doesn't immediately PATCH.
  // Also skipped entirely for a subcontracted job — it has no Invoice tab
  // to begin with (see the "report" tab's own subcontractor branch below),
  // but invoiceLineItems still gets a computed default like any other job,
  // and without this guard that default would silently get auto-saved as a
  // real invoice nobody ever asked for.
  useEffect(() => {
    if (job.source === "subcontractor") return;
    if (!invoiceHasMountedRef.current) {
      invoiceHasMountedRef.current = true;
      return;
    }
    if (invoiceDebounceRef.current) clearTimeout(invoiceDebounceRef.current);
    invoiceDebounceRef.current = setTimeout(() => {
      saveInvoice();
    }, 1000);
    return () => {
      if (invoiceDebounceRef.current) clearTimeout(invoiceDebounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceLineItems]);

  async function saveMaterials() {
    setSavingMaterials(true);
    try {
      const res = await fetch(`/api/admin/jobs/${job.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ full_inspection_materials: fullInspectionMaterials }),
      });
      if (res.ok) onChanged();
    } finally {
      setSavingMaterials(false);
    }
  }

  // Same always-save-on-change, 1s-debounced pattern as the invoice line
  // items above — simpler here since there's no auto-recompute default to
  // distinguish from a real edit, just save whatever's in the list.
  useEffect(() => {
    if (!isFullInspectionAsbestosJob(job.service_type)) return;
    if (!materialsHasMountedRef.current) {
      materialsHasMountedRef.current = true;
      return;
    }
    if (materialsDebounceRef.current) clearTimeout(materialsDebounceRef.current);
    materialsDebounceRef.current = setTimeout(() => {
      saveMaterials();
    }, 1000);
    return () => {
      if (materialsDebounceRef.current) clearTimeout(materialsDebounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullInspectionMaterials]);


  // Fingerprints of exactly the fields each PDF actually renders, passed to
  // PdfPreview so it only re-fetches (and re-renders every page to canvas —
  // not cheap) when something the letter/invoice would show has actually
  // changed, not on every unrelated job edit.
  const reportRevision = JSON.stringify({
    documents: job.documents,
    asbestos_result: job.asbestos_result,
    lead_result: job.lead_result,
    service_address: job.service_address,
    service_type: job.service_type,
    scope_of_work: job.scope_of_work,
    requested_date: job.requested_date,
    project_number: job.project_number,
    report_summary: job.report_summary,
    report_notes: job.report_notes,
    mold_air_discussion: job.mold_air_discussion,
    mold_bulk_discussion: job.mold_bulk_discussion,
    mold_swab_discussion: job.mold_swab_discussion,
    mold_report_notes: job.mold_report_notes,
    mold_lab_name: job.mold_lab_name,
    lead_report_summary: job.lead_report_summary,
    lead_report_notes: job.lead_report_notes,
    lead_lab_name: job.lead_lab_name,
    lead_lab_cert: job.lead_lab_cert,
    full_inspection_materials: job.full_inspection_materials,
    customer_id: job.customer_id,
  });
  // Simpler to just not render a report preview at all until every field
  // it needs is actually filled in, rather than showing a part-blank letter.
  const reportComplete = reportIsComplete(job);
  // Per Tim — the report/invoice sent-status lines. Two renderings, not one
  // responsive one: on desktop an absolute overlay across from Job site
  // address (see the Project Info tab body below), on mobile a plain block
  // right under the Project #/Edit row instead — nesting it in that same
  // flex row and just switching position:static there forced a third flex
  // item into a row with no space for it, overflowing the modal
  // horizontally. Both lines always show, sent-or-not, rather than only
  // appearing once something's actually gone out.
  // Per Tim, 2026-08-27 — same reasoning as JobRow's own showReportInvoice:
  // status is the authoritative signal for "this job is at the report/
  // invoice stage," not just a same-instant side effect of reportComplete/
  // invoice_total_cents — those can lag behind a status the admin already
  // set to Report and Invoice Ready by hand.
  const showSentStatus = job.source !== "subcontractor" && (
    job.status === "ready_to_send" || job.status === "report_invoice_sent"
    || (reportComplete && job.invoice_total_cents != null)
  );
  // Per Tim — exactly the project card's own format (see JobRow), not the
  // earlier longer-sentence version: "Report: Sent/Not sent" with the
  // hazard flag specifically for "the report is ready but hasn't gone out,"
  // never the invoice.
  // Per Tim, 2026-08-27 — the warning icon sits directly next to "Not
  // sent" itself (inline with the value), not off at the row's far right
  // edge via DetailField's own trailing slot — and shows for either field,
  // not just Report.
  const sentStatusLines = (
    <>
      <DetailField
        label="Report"
        value={
          job.report_sent_at ? (
            `Sent ${formatDateTime(job.report_sent_at)}`
          ) : (
            <span className="inline-flex items-center gap-1">Not sent <HazardIcon /></span>
          )
        }
      />
      <DetailField
        label="Invoice"
        value={
          job.invoice_sent_at ? (
            `Sent ${formatDateTime(job.invoice_sent_at)}`
          ) : (
            <span className="inline-flex items-center gap-1">Not sent <HazardIcon /></span>
          )
        }
      />
    </>
  );
  // No manual "Create Draft" step — the moment both the report and invoice
  // are actually ready (and nothing's been drafted yet), fire it off on its
  // own. combinedDraft.creating guards against double-firing while the
  // request is in flight; once it lands, job.invoice_draft_gmail_message_id
  // flips true via onChanged() and this condition goes false for good.
  // Boston Harbor gets its own branch here — confirmed live 2026-08-26:
  // this used to always call combinedDraft.createDraft() (kind=combined),
  // which create-draft/route.ts's own Boston Harbor branch turns into
  // creating BOTH the report and invoice regardless of which one was
  // actually missing, so clicking "Create Report Draft" a moment later
  // looked like it had also created the invoice — it hadn't; this effect
  // had already done it, silently, before the click. Each half now
  // auto-creates independently and only when that specific half is
  // actually missing, matching what the two header buttons themselves do.
  const isSeparateDraftsCompany = job.customers?.company_id === BOSTON_HARBOR_WATER_RESTORATION_COMPANY_ID;
  useEffect(() => {
    if (!reportComplete || job.invoice_total_cents == null) return;
    if (isSeparateDraftsCompany) {
      if (!job.report_draft_gmail_message_id && !reportOnlyDraft.creating) reportOnlyDraft.createDraft();
      if (!job.invoice_draft_gmail_message_id && !invoiceOnlyDraft.creating) invoiceOnlyDraft.createDraft();
    } else if (!job.invoice_draft_gmail_message_id && !combinedDraft.creating) {
      combinedDraft.createDraft();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportComplete, job.invoice_total_cents, job.invoice_draft_gmail_message_id, job.report_draft_gmail_message_id, isSeparateDraftsCompany]);
  // Same idea, one step earlier in the pipeline: once both are actually
  // ready, the status itself should already say so — only moves it forward
  // from one of the three earlier steps, never backward and never past
  // "paid"/"cancelled", so this can't undo a status the admin (or a later
  // step like markJobPaid) already advanced past this point.
  useEffect(() => {
    if (
      reportComplete &&
      job.invoice_total_cents != null &&
      (job.status === "needs_scheduling" || job.status === "scheduled" || job.status === "pending_lab_results")
    ) {
      onStatusChange("ready_to_send");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportComplete, job.invoice_total_cents, job.status]);
  const invoiceRevision = JSON.stringify({
    invoice_line_items: job.invoice_line_items,
    invoice_total_cents: job.invoice_total_cents,
    project_number: job.project_number,
    requested_date: job.requested_date,
    service_address: job.service_address,
    service_type: job.service_type,
    customer_id: job.customer_id,
  });

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/40 px-4">
      {/* max-h (not a fixed h-[90vh]) — per Tim, 2026-08-28: a short job's
          Project Info tab (desktop's now-two-column layout, see below)
          left a slab of dead white space at the bottom when the dialog
          was always exactly 90vh tall regardless of content. Shrinks to
          fit shorter content, still caps at 90vh and scrolls past that —
          same pattern Add/Edit Project already use. The header still
          never scrolls either way, since it lives outside the scrollable
          body entirely rather than relying on `sticky` (which, combined
          with padding + rounded corners on the same scrolling element,
          let content bleed above the header during momentum scroll on
          mobile Safari). */}
      <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white">
        {(() => {
          // One dropdown option per tab the button row below would otherwise
          // render — a report tab is keyed "report:<domain>" since a job
          // combining domains has more than one, each needing its own
          // selectable entry. Kept in sync with the button row by hand
          // rather than generating the buttons from this list too, since
          // the buttons' own layout/active-state styling per tab is already
          // established and works fine on its own screen size (sm+).
          const tabOptions = job.source === "subcontractor"
            ? [
                { value: "info", label: "Project Info", onSelect: () => setTab("info") },
                { value: "shipping", label: "Shipping", onSelect: () => setTab("shipping") },
                { value: "compensation", label: "Compensation", onSelect: () => setTab("compensation") },
              ]
            : [
                { value: "info", label: "Project Info", onSelect: () => setTab("info") },
                ...jobReportDomains(job.service_type).map((domain) => ({
                  value: `report:${domain}`,
                  label: `${REPORT_DOMAIN_LABEL[domain]} Report`,
                  onSelect: () => { setTab("report"); setReportDomainTab(domain); },
                })),
                { value: "invoice", label: "Invoice", onSelect: () => setTab("invoice") },
                { value: "chat", label: "Chat", onSelect: () => setTab("chat") },
                { value: "photos", label: "Photos", onSelect: () => setTab("photos") },
              ];
          const selectedValue = tab === "report" ? `report:${reportDomainTab}` : tab;
          // Per Tim, 2026-08-27 — no border-b here on mobile when the
          // "Create Final Report and Invoice Draft" row follows right
          // below (same condition that row itself renders under) — its
          // own border-b takes over instead, so the two read as one
          // continuous block with no line between them. Desktop is
          // unaffected (sm:border-b always applies there — that button
          // sits inline in the tab row on desktop, not its own row).
          return (
            <div className={`flex shrink-0 items-center gap-2 bg-white px-3 pt-3 pb-2 sm:gap-1 sm:border-b sm:border-slate-200 sm:px-5 sm:pt-5 sm:pb-1 ${job.source !== "subcontractor" && reportComplete && job.invoice_total_cents != null ? "" : "border-b border-slate-200"}`}>
              {/* Mobile: a single dropdown instead of the tab row below —
                  the row wrapped/overflowed illegibly on a narrow screen
                  (e.g. "Photos" clipped to "PHOT"), and a select is much
                  easier to use one-handed than a cramped multi-row tab bar. */}
              <select
                value={selectedValue}
                onChange={(e) => tabOptions.find((o) => o.value === e.target.value)?.onSelect()}
                className="h-9 min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm font-bold uppercase text-slate-700 sm:hidden"
              >
                {tabOptions.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <div className="hidden flex-nowrap items-center gap-0 sm:flex sm:flex-1 sm:gap-1">
                <button
                  onClick={() => setTab("info")}
                  className={`flex-1 whitespace-nowrap px-0.5 py-1.5 text-center text-[11px] font-bold uppercase sm:flex-none sm:px-3 sm:text-sm ${tab === "info" ? "border-b-2 border-brand-600 text-brand-700" : "text-slate-500 hover:text-slate-700"}`}
                >
                  Project Info
                </button>
                {job.source !== "subcontractor" && (
                  <>
                    {/* One tab per domain actually on the job (asbestos/mold/lead)
                        — a job combining service types from more than one domain
                        used to stack every domain's upload stations into one long
                        Report & Invoice tab; each domain now gets its own tab,
                        same at every screen width. */}
                    {jobReportDomains(job.service_type).map((domain) => (
                      <button
                        key={domain}
                        onClick={() => { setTab("report"); setReportDomainTab(domain); }}
                        className={`flex-1 whitespace-nowrap px-0.5 py-1.5 text-center text-[11px] font-bold uppercase sm:flex-none sm:px-3 sm:text-sm ${tab === "report" && reportDomainTab === domain ? "border-b-2 border-brand-600 text-brand-700" : "text-slate-500 hover:text-slate-700"}`}
                      >
                        {REPORT_DOMAIN_LABEL[domain]} Report
                      </button>
                    ))}
                    <button
                      onClick={() => setTab("invoice")}
                      className={`flex-1 whitespace-nowrap px-0.5 py-1.5 text-center text-[11px] font-bold uppercase sm:flex-none sm:px-3 sm:text-sm ${tab === "invoice" ? "border-b-2 border-brand-600 text-brand-700" : "text-slate-500 hover:text-slate-700"}`}
                    >
                      Invoice
                    </button>
                    <button
                      onClick={() => setTab("chat")}
                      className={`flex-1 whitespace-nowrap px-0.5 py-1.5 text-center text-[11px] font-bold uppercase sm:flex-none sm:px-3 sm:text-sm ${tab === "chat" ? "border-b-2 border-brand-600 text-brand-700" : "text-slate-500 hover:text-slate-700"}`}
                    >
                      Chat
                    </button>
                    <button
                      onClick={() => setTab("photos")}
                      className={`flex-1 whitespace-nowrap px-0.5 py-1.5 text-center text-[11px] font-bold uppercase sm:flex-none sm:px-3 sm:text-sm ${tab === "photos" ? "border-b-2 border-brand-600 text-brand-700" : "text-slate-500 hover:text-slate-700"}`}
                    >
                      Photos
                    </button>
                  </>
                )}
                {job.source === "subcontractor" && (
                  <>
                    <button
                      onClick={() => setTab("shipping")}
                      className={`flex-1 whitespace-nowrap px-0.5 py-1.5 text-center text-[11px] font-bold uppercase sm:flex-none sm:px-3 sm:text-sm ${tab === "shipping" ? "border-b-2 border-brand-600 text-brand-700" : "text-slate-500 hover:text-slate-700"}`}
                    >
                      Shipping
                    </button>
                    <button
                      onClick={() => setTab("compensation")}
                      className={`flex-1 whitespace-nowrap px-0.5 py-1.5 text-center text-[11px] font-bold uppercase sm:flex-none sm:px-3 sm:text-sm ${tab === "compensation" ? "border-b-2 border-brand-600 text-brand-700" : "text-slate-500 hover:text-slate-700"}`}
                    >
                      Compensation
                    </button>
                  </>
                )}
              </div>
              {/* Per Tim: belongs right here in the tab row, aligned with
                  the other header buttons, not on a line of its own —
                  desktop only, the tab row itself is select-dropdown-only
                  on mobile (see above) with no room to also fit this
                  inline, so mobile keeps the wrapped-row version below.
                  Same control either way — see its own comment there. */}
              {job.source !== "subcontractor" && reportComplete && job.invoice_total_cents != null && (
                <div className="hidden shrink-0 items-center gap-3 sm:flex">
                  {isSeparateDraftsCompany ? (
                    <>
                      <div className="flex items-center gap-2">
                        <DraftLinkControl label="Asbestos Inspection Report" hook={reportOnlyDraft} messageId={job.report_draft_gmail_message_id} draftedAt={job.report_drafted_at} sentAt={job.report_sent_at} />
                      </div>
                      <div className="flex items-center gap-2">
                        <DraftLinkControl label="Invoice" hook={invoiceOnlyDraft} messageId={job.invoice_draft_gmail_message_id} draftedAt={job.invoice_drafted_at} sentAt={job.invoice_sent_at} />
                      </div>
                    </>
                  ) : (
                    <DraftLinkControl
                      label={job.customers?.company_id === NEWTON_FIRE_FLOOD_COMPANY_ID ? "Final Report and Invoice" : undefined}
                      hook={combinedDraft}
                      messageId={job.invoice_draft_gmail_message_id}
                      draftedAt={job.invoice_drafted_at}
                      sentAt={job.invoice_sent_at}
                    />
                  )}
                </div>
              )}
              {/* p-2 -m-2 (mobile only) grows the tap target without
                  shifting the glyph, and ml-1 adds real visual separation
                  from the tab dropdown right next to it — per Tim, this X
                  sat close enough to the dropdown to catch accidental taps
                  meant for it. */}
              <button onClick={onClose} className="ml-1 shrink-0 -m-2 p-2 text-2xl leading-none text-slate-400 hover:text-slate-600 sm:m-0 sm:ml-auto sm:p-0 sm:pl-2 sm:text-base">✕</button>
            </div>
          );
        })()}

        {/* Mobile-only duplicate of the header control above — the tab row
            is a select dropdown on mobile with no room to fit this inline,
            so it wraps to its own row here instead. Per Tim: "View Draft"
            belongs up here, next to the tabs, not buried inside the
            Report/Invoice tab content — it's the same one Gmail draft
            regardless of which tab is open, so it shouldn't require
            switching tabs (or scrolling) to reach. Boston Harbor's report
            and invoice are two separate drafts sent on their own
            schedules, so it splits into two independent controls here —
            every other company still has one link, exactly as before.
            isSeparateDraftsCompany (company-based, not "do the two
            message ids happen to differ") so a brand-new job with
            neither drafted yet still gets the right two-button layout
            from the start, not just after one exists. */}
        {/* Per Tim, 2026-08-27 — no divider between the tab dropdown above
            and this button: same border-b border-slate-200 bg-white px-3
            styling as that header row, just without its own pb/pt, so the
            two visually read as one continuous block instead of two boxes
            stacked with a line between them. Boston Harbor's two separate
            controls stack full-width too, each the same size as the
            dropdown, rather than sitting side by side at half width. */}
        {job.source !== "subcontractor" && reportComplete && job.invoice_total_cents != null && (
          <div className="flex shrink-0 flex-col gap-1.5 border-b border-slate-200 bg-white px-3 pb-2 sm:hidden">
            {isSeparateDraftsCompany ? (
              <>
                <DraftLinkControl label="Asbestos Inspection Report" hook={reportOnlyDraft} messageId={job.report_draft_gmail_message_id} draftedAt={job.report_drafted_at} sentAt={job.report_sent_at} fullWidth />
                <DraftLinkControl label="Invoice" hook={invoiceOnlyDraft} messageId={job.invoice_draft_gmail_message_id} draftedAt={job.invoice_drafted_at} sentAt={job.invoice_sent_at} fullWidth />
              </>
            ) : (
              <DraftLinkControl
                label={job.customers?.company_id === NEWTON_FIRE_FLOOD_COMPANY_ID ? "Final Report and Invoice" : undefined}
                hook={combinedDraft}
                messageId={job.invoice_draft_gmail_message_id}
                draftedAt={job.invoice_drafted_at}
                sentAt={job.invoice_sent_at}
                fullWidth
              />
            )}
          </div>
        )}

        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-3 pb-3 sm:px-5 sm:pb-5">

        {tab === "info" && (
        <>
        <div className="mt-6 grid grid-cols-1 gap-y-6 sm:relative sm:gap-y-8">
          {/* Per Tim, 2026-08-28 — Edit moved back out of the Project #
              row: on desktop it now sits pinned to the very top-right
              corner of this whole tab (anchored to this sm:relative
              wrapper), not inline with any particular field. Mobile is
              unaffected — its own copy stays inline with Project #, same
              as before. */}
          <button
            onClick={onEdit}
            className="hidden shrink-0 rounded-lg border border-slate-300 px-3.5 py-1.5 text-sm font-bold uppercase hover:underline sm:absolute sm:right-0 sm:top-0 sm:block"
          >
            Edit
          </button>
          {/* Per Tim, 2026-08-28 — back to two columns on desktop (a narrow
              3fr right column was tried and reverted here before, but that
              was interleaving individual fields into a cramped sidebar;
              this instead groups whole sections — identity/schedule stays
              left, the three contact-info sections move right as one
              tall block — specifically so nothing needs scrolling to see
              on a normal desktop viewport, per Tim: "all the project info
              stuff... should be viewable without having to scroll at
              all." Mobile stays exactly the same single stacked column,
              same order as before (grid-cols-1 default). */}
          <div className="grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2 sm:items-start">
          <div className="space-y-6 sm:space-y-8">
          <div className="space-y-3 sm:space-y-2">
            {(() => {
              const portalBadge = job.source === "subcontractor" && (() => {
                const sender = subcontractorSenderForJob(job.customers?.email);
                return sender ? (
                  <a
                    href={sender.portalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 whitespace-nowrap rounded-full border border-indigo-300 px-2 py-0.5 text-xs font-bold uppercase text-indigo-700 hover:bg-indigo-50"
                    title={`Open ${sender.companyName}'s own portal — useful for anything not included in their assignment email, like a shipment added afterward`}
                  >
                    {sender.companyName} Portal ↗
                  </a>
                ) : null;
              })();
              return (
                <>
                  {/* Edit stays inline next to Project # on mobile only now (see the absolutely-positioned desktop copy above); the portal badge (subcontractor jobs only) sits beside it there too, same as always. sm:pr-20 (desktop only) keeps this row's own right-aligned content — namely the Gmail-thread icon below, which has no reason to hide on desktop — from rendering underneath the pinned Edit button, which shares this same top-right corner. */}
                  <div className="relative flex items-center justify-between gap-2 sm:pr-20">
                    <DetailField label="Project #" value={job.project_number} />
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="hidden sm:inline-flex">{portalBadge}</span>
                      {/* Per Tim — a quick way to jump to this job's whole
                          email conversation in Gmail (the same thread every
                          automated + drafted email for this job lands in,
                          see lib/email-thread.ts) without digging through
                          the Chat tab or searching Gmail by hand. Only shown
                          once a thread actually exists — a brand-new job
                          with no emails yet has nothing to link to. */}
                      {job.email_gmail_thread_id && (
                        <a
                          href={`https://mail.google.com/mail/u/0/#all/${job.email_gmail_thread_id}`}
                          target="_blank"
                          rel="noreferrer"
                          title="Open this job's email conversation in Gmail"
                          className="shrink-0 rounded-lg border border-slate-300 p-2 text-slate-600 hover:bg-slate-50"
                        >
                          <svg width="16" height="16" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <rect x="2" y="4" width="16" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" />
                            <path d="M3 5.5L10 11L17 5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </a>
                      )}
                      <button onClick={onEdit} className="shrink-0 rounded-lg border border-slate-300 px-3.5 py-1.5 text-sm font-bold uppercase hover:underline sm:hidden">
                        Edit
                      </button>
                    </div>
                  </div>
                  <DetailField label="Status" value={statusLabelForJob(job, job.status)} />
                  {/* Per Tim, 2026-08-27 — listed as plain fields here,
                      between Status and Company, left-aligned like
                      everything else on this tab — not floated in a
                      corner (desktop) or split into its own separate
                      mobile-only block (mobile) like before. */}
                  {showSentStatus && sentStatusLines}
                  <DetailField
                    label="Company"
                    nowrap
                    value={
                      portalBadge ? (
                        <>
                          <span className="hidden sm:inline">{job.customers?.company}</span>
                          <span className="sm:hidden">{portalBadge}</span>
                        </>
                      ) : (
                        job.customers?.company
                      )
                    }
                  />
                </>
              );
            })()}
            {(job.cancellation_requested_at || job.payment_reversed_at) && (
              <div className="flex flex-wrap gap-1.5">
                {job.cancellation_requested_at && (
                  <span className="shrink-0 whitespace-nowrap rounded-full bg-red-600 px-2 py-1 text-xs font-bold text-white">
                    Cancellation requested {formatDateTime(job.cancellation_requested_at)}
                  </span>
                )}
                {job.payment_reversed_at && (
                  <span className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full bg-amber-500 px-2 py-1 text-xs font-bold text-white">
                    Payment reversed {formatDateTime(job.payment_reversed_at)} — review needed
                    {/* Per Tim, 2026-08-28 — once reviewed, this needs a way
                        to actually go away; there was none before this. */}
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); saveJobField({ payment_reversed_at: null }); }}
                      title="Dismiss — I've reviewed this"
                      className="shrink-0 text-white hover:text-amber-100"
                    >
                      ✕
                    </button>
                  </span>
                )}
              </div>
            )}
            <DetailField
              label="Job site address"
              value={job.service_address ? (() => {
                const { street, cityStateZip } = splitAddress(job.service_address);
                return (
                  <a href={googleMapsUrl(job.service_address)} target="_blank" rel="noreferrer" className="hover:underline">
                    {/* Per Tim, 2026-08-28 — street, then town/state/zip on
                        its own line below it, same on desktop as mobile
                        now (used to be one line on desktop). */}
                    <span className="block">{expandAddress(street)}</span>
                    {cityStateZip && <span className="block">{expandAddress(cityStateZip)}</span>}
                  </a>
                );
              })() : null}
              nowrap
            />
          </div>
          <div className="space-y-3 sm:space-y-2">
            {job.source === "subcontractor" ? (
              job.status === "needs_scheduling" ? (
                <>
                  <DetailField label="Requested date" value={formatDate(job.requested_date)} />
                  {/* Accept/deny lives only on the list card (JobRow) now — not duplicated here. */}
                  <DetailField
                    label="Requested time"
                    value={extractTimeRange(job.subcontractor_preferred_window) ?? job.subcontractor_preferred_window}
                    nowrap
                  />
                </>
              ) : (
                <>
                  <DetailField label={hasCompletedFieldwork(job.status) ? "Completed date" : "Scheduled date"} value={formatDate(job.confirmed_date)} />
                  <DetailField
                    label={hasCompletedFieldwork(job.status) ? "Completed time" : "Scheduled time"}
                    value={
                      job.confirmed_time && job.confirmed_time === parseWindowStartTime24h(job.subcontractor_preferred_window)
                        ? extractTimeRange(job.subcontractor_preferred_window) ?? formatTime(job.confirmed_time)
                        : formatTime(job.confirmed_time) || "Not set yet"
                    }
                  />
                </>
              )
            ) : job.source === "email_intake" && job.status === "needs_scheduling" ? (
              // Boston Harbor Water's order never carries a real requested
              // time, so there's nothing to show yet — this stays plain text
              // here too. Actually setting the date/time (and with it,
              // scheduling the job) happens in the Edit dialog, not inline
              // in this read-only tab.
              <>
                <DetailField label="Scheduled date" value="—" />
                <DetailField label="Scheduled time" value="—" />
              </>
            ) : (
              <>
                <DetailField label="Requested date" value={job.requested_date ? formatDate(job.requested_date) : "—"} />
                <DetailField label="Requested time" value={job.requested_date ? formatTime(job.requested_time) || "—" : "—"} />
                <DetailField
                  label={hasCompletedFieldwork(job.status) ? "Completed date" : "Scheduled date"}
                  value={
                    job.status === "needs_scheduling"
                      ? formatDate(job.confirmed_date) || "—"
                      : formatDate(job.confirmed_date ?? job.requested_date) || "—"
                  }
                />
                <DetailField
                  label={hasCompletedFieldwork(job.status) ? "Completed time" : "Scheduled time"}
                  value={
                    job.status === "needs_scheduling"
                      ? formatTime(job.confirmed_time) || "—"
                      : formatTime(job.confirmed_time ?? job.requested_time) || "—"
                  }
                />
                {/* Per Tim, 2026-08-27 — listed as a plain field here like
                    everything else on this tab, not the Standard/Rush
                    button pair (still used as-is on the Invoice tab). */}
                <DetailField label="Turnaround" value={job.lab_turnaround === "Rush" ? "Rush" : "Standard"} />
              </>
            )}
            {job.confirmation_sent_at && (
              <div className="flex items-start gap-2 text-xs text-slate-400">
                <span className="w-32 shrink-0 uppercase font-bold">Confirmation Sent</span>
                <span className="min-w-0 flex-1">{formatDateTime(job.confirmation_sent_at)}</span>
              </div>
            )}
            {job.reminder_sent_at && (
              <div className="flex items-start gap-2 text-xs text-slate-400">
                <span className="w-32 shrink-0 uppercase font-bold">Reminder Sent</span>
                <span className="min-w-0 flex-1">{formatDateTime(job.reminder_sent_at)}</span>
              </div>
            )}
            {job.status === "needs_scheduling" && job.source !== "subcontractor" && job.source !== "email_intake" && (
              <AcceptScheduleControl job={job} variant="panel" onAccept={acceptSchedule} onEditManually={onEdit} />
            )}
            <DetailField
              label="Service type"
              value={
                (job.service_type ?? "").split(",").map((s) => s.trim()).filter(Boolean).length > 0 ? (
                  <div className="space-y-0.5">
                    {(job.service_type ?? "").split(",").map((s) => s.trim()).filter(Boolean).map((label, i) => (
                      <div key={i}>{SERVICE_TYPE_LABEL[label.toLowerCase()] ?? label}</div>
                    ))}
                  </div>
                ) : null
              }
            />
            <div className="flex items-start gap-2 text-sm">
              <span className="w-32 shrink-0 font-bold text-black">Scope of Work</span>
              <span className="min-w-0 flex-1 text-black">{job.scope_of_work || "—"}</span>
            </div>
            {job.subcontractor_sample_types.length > 0 && (
              <div className="flex items-start gap-2 text-sm">
                <span className="w-32 shrink-0 font-bold text-black">Samples</span>
                <ul className="min-w-0 flex-1 list-disc space-y-0.5 pl-4 text-black">
                  {job.subcontractor_sample_types.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              </div>
            )}
          </div>
          </div>
          {/* Per Tim, 2026-08-28 — Job site contact / Email results to /
              Company contact / Company info together make up the right
              column now (see the grid opened above) — Job site contact
              stays right above Customer contact within that column. */}
          <div className="space-y-6 sm:space-y-8">
          <div className="space-y-3 sm:space-y-2">
            <h4 className="text-sm font-bold tracking-wide text-black underline">Job site contact</h4>
            <DetailField label="Name" value={job.site_contact_name ? toTitleCase(job.site_contact_name) : "—"} />
            <DetailField
              label="Phone"
              value={
                job.site_contact_phone ? (
                  <a href={telHref(job.site_contact_phone)} className="text-brand-700 hover:underline">
                    {formatPhoneInput(job.site_contact_phone)}
                  </a>
                ) : "—"
              }
            />
            <DetailField label="Email" value={job.site_contact_email} nowrap />
          </div>
          {job.report_emails && job.report_emails.trim() && (
            <div className="space-y-3 sm:space-y-2">
              <h4 className="text-sm font-bold tracking-wide text-black underline">Email results to</h4>
              {job.report_emails.split(",").map((e) => e.trim()).filter(Boolean).map((addr, i) => {
                const contact = companyContactsForDisplay.find((c) => c.email?.toLowerCase() === addr.toLowerCase());
                return (
                  <div key={i} className="text-sm text-black">
                    {contact ? `${contact.name} — ${addr}` : addr}
                  </div>
                );
              })}
            </div>
          )}
          {/* Per Tim, 2026-08-28 — dropped the 2-column grid here too, same
              single evenly-spaced left-aligned list at every width. */}
          <div className="space-y-6">
            <div className="space-y-3 sm:space-y-2">
              {/* Per Tim, 2026-08-28 — "Company contact" once this job's
                  customer actually belongs to a company, matching the
                  naming style everywhere else on this tab (Job site
                  contact, Company info) — an individual homeowner has no
                  company to be a contact for, so that case keeps the
                  generic "Customer contact" label. */}
              <h4 className="text-sm font-bold tracking-wide text-black underline">
                {job.customers?.is_individual ? "Customer contact" : "Company contact"}
              </h4>
              <DetailField
                label="Name"
                value={job.customer_id && job.customers?.name ? (
                  // A plain <a> (not next/link) — Next's client-side router
                  // doesn't always remount CustomersDirectory on a
                  // searchParams-only navigation to the same pathname, which
                  // left the Directory reading stale ?tab=/?contactId=
                  // values from before the click. A full navigation always
                  // mounts fresh and reads the real URL.
                  <a href={`/admin/customers?tab=contacts&contactId=${job.customer_id}`} className="hover:underline">
                    {toTitleCase(job.customers.name)}
                  </a>
                ) : job.customers?.name ? toTitleCase(job.customers.name) : undefined}
                nowrap
              />
              <DetailField
                label="Phone"
                value={job.customers?.phone ? <a href={telHref(job.customers.phone)} className="text-brand-700 hover:underline">{formatPhoneInput(job.customers.phone)}</a> : undefined}
              />
              <DetailField label="Email" value={job.customers?.email} nowrap />
            </div>
            {!job.customers?.is_individual && job.customers?.companies && (
              job.customers.companies.billing_contact || job.customers.companies.phone || job.customers.companies.billing_address
            ) && (
              <div className="space-y-3 sm:space-y-2">
                <h4 className="text-sm font-bold tracking-wide text-black underline">Company info</h4>
                {job.customers.companies.billing_contact && (
                  <DetailField
                    label="Billing contact"
                    value={
                      <a
                        href={`/admin/customers?tab=contacts&contactId=${job.customers.companies.billing_contact.id}`}
                        className="hover:underline"
                      >
                        {toTitleCase(job.customers.companies.billing_contact.name)}
                      </a>
                    }
                    nowrap
                  />
                )}
                <DetailField
                  label="Phone"
                  value={job.customers.companies.phone ? <a href={telHref(job.customers.companies.phone)} className="text-brand-700 hover:underline">{formatPhoneInput(job.customers.companies.phone)}</a> : undefined}
                />
                <DetailField label="Billing address" value={expandAddress(job.customers.companies.billing_address)} nowrap />
              </div>
            )}
          </div>
          </div>
          </div>
          {job.notes && job.notes.trim() && (
            <div className="space-y-3 sm:space-y-2">
              <h4 className="text-sm font-bold tracking-wide text-black underline">Notes</h4>
              <ul className="list-disc space-y-1 pl-5 text-sm text-black">
                {job.notes.split("\n").map((line) => line.trim()).filter(Boolean).map((line, i) => (
                  <li key={i}><Linkify text={line} /></li>
                ))}
              </ul>
            </div>
          )}
          {(job.job_classification || job.payment_method || job.po_number || job.invoice_number) && (
            <div className="space-y-2">
              <h4 className="text-sm font-bold tracking-wide text-black underline">Job details</h4>
              <DetailField label="Classification" value={job.job_classification} />
              <DetailField label="Payment method" value={job.payment_method} />
              <DetailField label="PO #" value={job.po_number} />
              <DetailField label="Invoice #" value={job.invoice_number} />
            </div>
          )}
        </div>

        </>
        )}

        {(tab === "report" || tab === "invoice") && (
          job.source === "subcontractor" ? (
            // No lab/report/invoice pipeline applies here at all — this job
            // was subcontracted TO Tim by another company (see
            // subcontractor-intake.ts), who handle their own final report
            // and billing. Without this branch, jobReportDomains() would
            // default this job's non-standard service_type to "needs an
            // asbestos report" (see its own comment) and show a
            // permanently-incomplete checklist for a report that's never
            // coming from this app.
            <div className="mt-4 rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
              This is a subcontracted job — {job.customers?.company || job.customers?.name || "the company that sent it"} handles the final report and invoice. Nothing to fill in here.
            </div>
          ) : (
          <div className="mt-4 space-y-6">
            {/* Lab Paperwork — Report tab only, scoped to the one domain
                (reportDomainTab) whose tab button is currently active. */}
            {tab === "report" && (
            <div>
              <div>
                {(() => {
                  const group = serviceTypeGroups.find((g) => g.domain === reportDomainTab);
                  return group ? (
                    <div className="space-y-5">
                      {[group].map((group) => (
                      <div key={group.domain}>
                        {group.labels.map((label, labelIdx) => (
                          <div key={label} className={labelIdx > 0 ? "mt-5" : ""}>
                            {/* Turnaround/Lab are domain-level (one mold lab
                                pick covers every mold label on the job) so
                                they sit once, under the group's first title,
                                ahead of every service type's own
                                separately-uploaded section below. On desktop,
                                Turnaround shares the title's row, pinned to
                                the far right. */}
                            <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                              <p className="text-base font-bold uppercase text-slate-700">{label}</p>
                              {labelIdx === 0 && turnaroundControl}
                            </div>
                            {labelIdx === 0 && (
                              <div className="mb-4 space-y-2">
                                {labDropdown(group.domain)}
                                {dateSampledInput(group.domain)}
                              </div>
                            )}
                            <div className="grid grid-cols-2 gap-3">
                              <DocumentStation
                                job={job}
                                onChanged={onChanged}
                                kind="lab_report"
                                label="Laboratory Results"
                                serviceType={label}
                              />
                              <div>
                                <div className="flex flex-nowrap items-center gap-2">
                                  <h4 className="whitespace-nowrap text-xs font-semibold uppercase tracking-wide text-slate-400">Sample Results</h4>
                                </div>
                                {(() => {
                                  // Mold's sample results live in their own
                                  // field, separate from asbestos/lead's.
                                  // Within mold, further filtered to this
                                  // label's own serviceType tag — Crystal
                                  // Analytical bundles every mold method
                                  // (Air-O-Cell, Direct Analysis/bulk) into
                                  // one PDF, so without this the Bulk
                                  // Sampling box showed the Air Sampling
                                  // box's own samples too (confirmed live on
                                  // 26-0002). An untagged row (recorded
                                  // before this field existed) still shows
                                  // on every label's box, same as before.
                                  const results = group.domain === "mold"
                                    ? job.mold_sample_results?.filter((r) => !r.serviceType || r.serviceType === label)
                                    : job.sample_results;
                                  return results && results.length > 0 ? (
                                    <div className="mt-1.5 h-40 w-full overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-2 font-mono text-xs">
                                      {results.map((s, i) => (
                                        <div key={i} className={/%/.test(s.result) ? "text-red-600" : "text-slate-900"}>{s.fieldCode}: {s.result}</div>
                                      ))}
                                      <div className="mt-1.5 border-t border-slate-200 pt-1.5 font-sans font-semibold text-slate-500">
                                        Total: {results.length} sample{results.length === 1 ? "" : "s"}
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="mt-1.5 flex h-40 w-full flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-300 px-3 text-center text-sm text-slate-500">
                                      Populates once Laboratory Results are uploaded
                                    </div>
                                  );
                                })()}
                              </div>
                              <DocumentStation job={job} onChanged={onChanged} kind="coc" label="Chain of Custody" serviceType={label} />
                            </div>
                            {/* Discussion of Results lives right under this
                                specific label's own upload station, not
                                grouped separately at the bottom — each sample
                                type's findings sit with that type's own lab
                                results/CoC/invoice, matching the PDF where
                                each type gets its own numbered subsection
                                (confirmed against a real air+bulk+swab combo
                                report, "MOLD GOLD.pdf"). Matched by substring
                                the same way moldServiceTypeFlags parses
                                service_type, since a label is always exactly
                                one of "Mold Air/Bulk/Swab Sampling". */}
                            {group.domain === "mold" && label.toLowerCase().includes("air") && (
                              <div className="mt-3 rounded-lg border border-slate-200 p-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">
                                    {label} Discussion of Results
                                  </label>
                                  <ListFormatButtons
                                    onBullet={() => applyListFormat(moldAirDiscussionRef, setMoldAirDiscussionInput, saveMoldAirDiscussion, false)}
                                    onNumbered={() => applyListFormat(moldAirDiscussionRef, setMoldAirDiscussionInput, saveMoldAirDiscussion, true)}
                                  />
                                </div>
                                <textarea
                                  ref={moldAirDiscussionRef}
                                  className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                                  rows={4}
                                  value={moldAirDiscussionInput}
                                  onChange={(e) => setMoldAirDiscussionInput(e.target.value)}
                                  onBlur={(e) => saveMoldAirDiscussion(e.target.value)}
                                  placeholder="Notable air sampling findings for this job — sample count and date are added automatically."
                                />
                              </div>
                            )}
                            {group.domain === "mold" && label.toLowerCase().includes("bulk") && (
                              <div className="mt-3 rounded-lg border border-slate-200 p-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">
                                    {label} Discussion of Results
                                  </label>
                                  <ListFormatButtons
                                    onBullet={() => applyListFormat(moldBulkDiscussionRef, setMoldBulkDiscussionInput, saveMoldBulkDiscussion, false)}
                                    onNumbered={() => applyListFormat(moldBulkDiscussionRef, setMoldBulkDiscussionInput, saveMoldBulkDiscussion, true)}
                                  />
                                </div>
                                <textarea
                                  ref={moldBulkDiscussionRef}
                                  className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                                  rows={4}
                                  value={moldBulkDiscussionInput}
                                  onChange={(e) => setMoldBulkDiscussionInput(e.target.value)}
                                  onBlur={(e) => saveMoldBulkDiscussion(e.target.value)}
                                  placeholder="Notable bulk sampling findings for this job — sample count and date are added automatically."
                                />
                              </div>
                            )}
                            {group.domain === "mold" && label.toLowerCase().includes("swab") && (
                              <div className="mt-3 rounded-lg border border-slate-200 p-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">
                                    {label} Discussion of Results
                                  </label>
                                  <ListFormatButtons
                                    onBullet={() => applyListFormat(moldSwabDiscussionRef, setMoldSwabDiscussionInput, saveMoldSwabDiscussion, false)}
                                    onNumbered={() => applyListFormat(moldSwabDiscussionRef, setMoldSwabDiscussionInput, saveMoldSwabDiscussion, true)}
                                  />
                                </div>
                                <textarea
                                  ref={moldSwabDiscussionRef}
                                  className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                                  rows={4}
                                  value={moldSwabDiscussionInput}
                                  onChange={(e) => setMoldSwabDiscussionInput(e.target.value)}
                                  onBlur={(e) => saveMoldSwabDiscussion(e.target.value)}
                                  placeholder="Notable swab sampling findings for this job — sample count and date are added automatically."
                                />
                              </div>
                            )}
                            {/* Once per non-mold domain GROUP (first label
                                within it), not once per job — a job
                                combining asbestos and lead has two of these
                                groups, each needing its own Result dropdown
                                writing to its own domain's fields. Full
                                inspection's own MaterialsEditor replaces
                                this for asbestos only; lead has no
                                "full inspection" concept of its own. */}
                            {labelIdx === 0 && group.domain !== "mold" &&
                              !(group.domain === "asbestos" && isFullInspectionAsbestosJob(job.service_type)) && (
                              <div className="mt-3">
                                <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">Result</label>
                                <ComboboxInput
                                  value={group.domain === "lead" ? leadReportSummaryInput : reportSummaryInput}
                                  onChange={group.domain === "lead" ? setLeadReportSummaryInput : setReportSummaryInput}
                                  options={group.domain === "lead" ? [LEAD_NEGATIVE_REMARK, LEAD_POSITIVE_REMARK] : [ASBESTOS_NEGATIVE_REMARK, ASBESTOS_POSITIVE_REMARK]}
                                  filterOptions={false}
                                  getLabel={(o) => o}
                                  showChevron
                                  onSelect={(o) => {
                                    if (group.domain === "lead") setLeadReportSummaryInput(o);
                                    else setReportSummaryInput(o);
                                    // Picking one of the two canned findings sentences IS
                                    // the positive/negative determination — no separate
                                    // Results button needed to duplicate that choice.
                                    // One combined PATCH (not two separate save calls,
                                    // each with its own onChanged()/loadJobs() refetch) —
                                    // two independent fetches racing could let an older
                                    // GET overwrite the newer one's field, leaving the
                                    // report looking incomplete until an unrelated edit
                                    // happened to trigger another refetch.
                                    const negativeRemark = group.domain === "lead" ? LEAD_NEGATIVE_REMARK : ASBESTOS_NEGATIVE_REMARK;
                                    const positiveRemark = group.domain === "lead" ? LEAD_POSITIVE_REMARK : ASBESTOS_POSITIVE_REMARK;
                                    const resultField = group.domain === "lead" ? "lead_result" : "asbestos_result";
                                    const summaryField = group.domain === "lead" ? "lead_report_summary" : "report_summary";
                                    const patch: Record<string, unknown> = { [summaryField]: o.trim() || null };
                                    if (o === negativeRemark) {
                                      patch[resultField] = "negative";
                                    } else if (o === positiveRemark) {
                                      patch[resultField] = "positive";
                                    }
                                    saveJobField(patch);
                                  }}
                                  onEnter={(v) => (group.domain === "lead" ? saveLeadReportSummary(v) : saveReportSummary(v))}
                                  onBlur={(v) => (group.domain === "lead" ? saveLeadReportSummary(v) : saveReportSummary(v))}
                                  placeholder={group.domain === "lead" ? "e.g. None of the paint chip samples were determined to contain lead." : "e.g. None of the suspect materials sampled were determined to have asbestos fibers present."}
                                />
                              </div>
                            )}
                          </div>
                        ))}
                        {/* Mold's Conclusions & Recommendations lives inside
                            this same group, once — it covers every mold
                            label on the job as one shared conclusion, unlike
                            Discussion of Results above which is now rendered
                            per-label, right under each sample type's own
                            upload station. */}
                        {group.domain === "mold" && (
                          <>
                            <div className="mt-5 rounded-lg border border-slate-200 p-3">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">
                                  {job.customers?.company_id === NEWTON_FIRE_FLOOD_COMPANY_ID
                                    ? "Additional Conclusions & Recommendations"
                                    : "Conclusions & Recommendations"}
                                </label>
                                <ListFormatButtons
                                  onBullet={() => applyListFormat(moldReportNotesRef, setMoldReportNotesInput, saveMoldReportNotes, false)}
                                  onNumbered={() => applyListFormat(moldReportNotesRef, setMoldReportNotesInput, saveMoldReportNotes, true)}
                                />
                              </div>
                              {/* The two fixed generic-IAQ paragraphs (air-inclusive
                                  jobs only) render unconditionally in the PDF — see
                                  MoldReportDocument — so this cell is purely for the
                                  admin's own case-specific recommendations. Lines
                                  starting with "• " or "1. " render as an actual
                                  bulleted/numbered list in the PDF (see report-pdf.tsx's
                                  blocksFromText), not literal dashes/digits. */}
                              <textarea
                                ref={moldReportNotesRef}
                                className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                                rows={6}
                                value={moldReportNotesInput}
                                onChange={(e) => setMoldReportNotesInput(e.target.value)}
                                onBlur={(e) => saveMoldReportNotes(e.target.value)}
                                placeholder="Case-specific recommendations for this job."
                              />
                            </div>
                          </>
                        )}
                      </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500">Pick a service type on the Project Information tab to set up its upload stations.</p>
                  );
                })()}

                {reportDomainTab === "asbestos" && job.sample_items.length > 0 && (
                  <table className="mt-4 w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-slate-400">
                        <th className="pb-1 font-medium">Sample #</th>
                        <th className="pb-1 font-medium">Material</th>
                        <th className="pb-1 font-medium">Location</th>
                      </tr>
                    </thead>
                    <tbody>
                      {job.sample_items.map((s, i) => (
                        <tr key={i} className="border-t border-slate-100">
                          <td className="py-1 text-slate-800">{s.sample_number}</td>
                          <td className="py-1 text-slate-600">{s.material}</td>
                          <td className="py-1 text-slate-600">{s.location}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {reportDomainTab === "asbestos" && isFullInspectionAsbestosJob(job.service_type) && (
                  <div className="mt-5 rounded-lg border border-slate-200 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">
                        Materials Sampled
                      </label>
                      {savingMaterials && <p className="text-xs text-slate-400">Saving…</p>}
                    </div>
                    <MaterialsEditor items={fullInspectionMaterials} setItems={setFullInspectionMaterials} />
                    <label className="mt-5 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Additional Remarks
                    </label>
                    <p className="mt-1 text-xs text-slate-500">
                      One line per remark — continues the Remarks and Limitations numbering after the fixed items.
                    </p>
                    <textarea
                      className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                      rows={4}
                      value={reportNotesInput}
                      onChange={(e) => setReportNotesInput(e.target.value)}
                      onBlur={(e) => saveReportNotes(e.target.value)}
                      placeholder="Any per-finding notes specific to this job (e.g. contamination, supplemental sampling)."
                    />
                  </div>
                )}
              </div>
            </div>
            )}

            {/* Final Report preview — Report tab only, scoped to
                reportDomainTab same as the lab paperwork above. The blank
                CoC templates that used to sit here too (per Tim, they
                don't belong on this tab) were removed 2026-08-25. */}
            {tab === "report" && (
            <div className="border-t-4 border-slate-300 pt-6">
              <p className="text-base font-bold uppercase text-slate-700">Final {REPORT_DOMAIN_LABEL[reportDomainTab]} Report</p>
              <div className="mt-3 flex flex-wrap gap-4 sm:flex-nowrap sm:gap-5 sm:overflow-x-auto sm:pb-1">
                {(() => {
                  const domain = reportDomainTab;
                  const domainReady = reportIsCompleteForDomain(job, domain);
                  const tileLabel = `Final ${REPORT_DOMAIN_LABEL[domain]} Report`;
                  const reportUrl = `/api/admin/jobs/${job.id}/report?type=${domain}&v=${encodeURIComponent(reportRevision)}`;
                  const downloadUrl = `/api/admin/jobs/${job.id}/report?type=${domain}&download=1`;
                  return domainReady ? (
                    <div className="w-full overflow-hidden rounded-lg border border-slate-200 sm:w-60">
                      <a href={reportUrl} target="_blank" rel="noreferrer" className="block">
                        <PdfThumbnail url={reportUrl} alt={`${tileLabel} preview`} />
                        <p className="border-t border-slate-200 bg-white px-2 py-1 text-center text-xs font-bold uppercase text-slate-700">{tileLabel}</p>
                      </a>
                      <div className="border-t border-slate-200 px-2 py-1 text-center text-xs">
                        <a href={reportUrl} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">
                          View
                        </a>
                        {" · "}
                        <a href={downloadUrl} download={`report-${domain}-${job.project_number ?? job.id}.pdf`} className="text-brand-600 hover:underline">
                          Download
                        </a>
                      </div>
                    </div>
                  ) : (
                    <div className="block w-full overflow-hidden rounded-lg border border-dashed border-slate-300 sm:w-60">
                      <div className="flex h-40 w-full items-center justify-center bg-slate-50 px-2 text-center text-xs text-slate-400">Not ready yet</div>
                      <p className="border-t border-dashed border-slate-300 px-2 py-1 text-center text-xs font-bold uppercase text-slate-400">{tileLabel}</p>
                    </div>
                  );
                })()}
              </div>
            </div>
            )}

            {/* Invoice + Stripe Payment Link — Invoice tab only. */}
            {tab === "invoice" && (
            <>
            <div className="pt-6">
              {/* Per Tim — same Turnaround toggle as Project Info and the
                  Report tabs, top-right under the header's "Create Final
                  Report and Invoice Draft" button (which lives in the modal
                  header, not this scrollable body). */}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <h3 className="text-lg font-bold uppercase tracking-wide text-black underline">Invoice</h3>
                {turnaroundControl}
              </div>
              <div className="mt-3">
                <div className="mb-4 space-y-1">
                  {job.po_number && <DetailField label="PO #" value={job.po_number} />}
                  {job.invoice_number && <DetailField label="Invoice #" value={job.invoice_number} />}
                </div>

                <LineItemsEditor
                  items={invoiceLineItems}
                  setItems={setInvoiceLineItemsFromUser}
                  serviceTypeSettings={serviceTypeSettings}
                  paymentDueDate={dueDateFor(job) || ""}
                  onPaymentDueDateChange={(v) => saveJobField({ payment_due_date: v || null })}
                  labCostCents={job.lab_cost_cents}
                  stripeFeeCents={job.stripe_fee_cents}
                />
                {savingInvoice && <p className="mt-1 text-xs text-slate-400">Saving…</p>}
              </div>
            </div>

            {job.invoice_total_cents != null && (
              <div className="border-t-4 border-slate-300 pt-6">
                <div className="flex flex-nowrap items-center justify-between gap-1.5">
                  <h3 className="whitespace-nowrap text-base font-bold uppercase tracking-wide text-black underline sm:text-lg">Stripe Payment Link</h3>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      onClick={getPaymentLink}
                      disabled={payLinkLoading}
                      className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold uppercase text-slate-700 hover:underline disabled:opacity-50 sm:px-4"
                    >
                      {payLinkLoading ? "Loading…" : "View"}
                    </button>
                    <button
                      onClick={copyPaymentLink}
                      disabled={copyLinkLoading}
                      className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold uppercase text-slate-700 hover:underline disabled:opacity-50 sm:px-4"
                    >
                      {copyLinkLoading ? "Loading…" : copyLinkDone ? "Copied!" : "Copy"}
                    </button>
                  </div>
                </div>
                <div className="mt-3">
                  {/* Per Tim, 2026-08-28 — Newton Fire & Flood is the one
                      company with a card on file (see ContactDetailDialog's
                      "Automatic Payment" section and lib/net30-autocharge.ts),
                      so their invoices don't just sit waiting on someone to
                      click "Pay" — this is here so that's obvious from the
                      job itself, not just known from memory. Due date
                      mirrors the same days_until_due:30 the invoice was
                      actually created with (see createStripeInvoiceForJob),
                      same value LineItemsEditor's own Payment due date
                      field shows above. */}
                  {job.customers?.company_id === NEWTON_FIRE_FLOOD_COMPANY_ID && job.status !== "paid" && (
                    <div className="mb-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                      <span className="font-bold uppercase">Automatic payment on file</span> — Stripe will charge Newton Fire &amp; Flood&apos;s card on file on{" "}
                      {formatDate(dueDateFor(job)) || "the invoice due date"} (30 days after the report was sent) if this isn&apos;t paid before then.
                    </div>
                  )}
                  {payLinkError && <p className="mt-2 text-sm text-red-600">{payLinkError}</p>}
                </div>
              </div>
            )}

            <div className="border-t-4 border-slate-300 pt-6">
              <div className="space-y-3">
                <div className="flex flex-wrap gap-4 sm:flex-nowrap sm:gap-5 sm:overflow-x-auto sm:pb-1">
                  {reportComplete && job.invoice_total_cents != null ? (
                    <div className="w-full shrink-0 overflow-hidden rounded-lg border border-slate-200 sm:w-60">
                      <a href={`/api/admin/jobs/${job.id}/invoice?v=${encodeURIComponent(invoiceRevision)}`} target="_blank" rel="noreferrer" className="block">
                        <PdfThumbnail url={`/api/admin/jobs/${job.id}/invoice?v=${encodeURIComponent(invoiceRevision)}`} alt="Invoice preview" />
                        <p className="border-t border-slate-200 bg-white px-2 py-1 text-center text-xs font-bold uppercase text-slate-700">Invoice</p>
                      </a>
                      <div className="border-t border-slate-200 px-2 py-1 text-center text-xs">
                        <a href={`/api/admin/jobs/${job.id}/invoice?v=${encodeURIComponent(invoiceRevision)}`} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">
                          View
                        </a>
                        {" · "}
                        <a href={`/api/admin/jobs/${job.id}/invoice?download=1`} download={`invoice-${job.project_number ?? job.id}.pdf`} className="text-brand-600 hover:underline">
                          Download
                        </a>
                      </div>
                    </div>
                  ) : (
                    <div className="block w-full shrink-0 overflow-hidden rounded-lg border border-dashed border-slate-300 sm:w-60">
                      <div className="flex h-40 w-full items-center justify-center bg-slate-50 px-2 text-center text-xs text-slate-400">Not ready yet</div>
                      <p className="border-t border-dashed border-slate-300 px-2 py-1 text-center text-xs font-bold uppercase text-slate-400">Invoice</p>
                    </div>
                  )}
                  {/* Per Tim, 2026-08-27 — the lab's own invoice for the job
                      belongs here next to the invoice we send, not back on
                      the Report tab with the lab results/CoC paperwork.
                      Per Tim, 2026-08-28 — one station for the whole job,
                      not one per service type: there's usually just a
                      single invoice from the lab covering everything.
                      Filed under the job's first service-type label — the
                      lab-email auto-filing (see processMatchedLabInvoiceEmail
                      in lib/lab-email.ts) always writes a copy under every
                      label, so the first one always has it. shrink-0
                      (matching the Invoice card above) — without it
                      DocumentStation's own nowrap label forces the browser
                      to crush the Invoice card down to a sliver instead of
                      just letting this row scroll horizontally. */}
                  {(() => {
                    const firstLabel = serviceTypeGroups.flatMap((group) => group.labels)[0];
                    return firstLabel ? (
                      <div className="w-full shrink-0 sm:w-60">
                        <DocumentStation job={job} onChanged={onChanged} kind="lab_invoice" label="Lab Invoice" serviceType={firstLabel} titlePosition="bottom" />
                      </div>
                    ) : null;
                  })()}
                </div>
                {job.is_individual && job.status !== "paid" && (
                  job.report_release_override ? (
                    <div className="flex items-center gap-2 text-xs text-slate-600">
                      <span className="uppercase text-emerald-700">Visible without payment</span>
                      <button
                        type="button"
                        onClick={() => saveReportReleaseOverride(false)}
                        className="uppercase text-slate-500 underline hover:text-slate-700"
                      >
                        Require payment again
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setReleaseOverrideError(null);
                        setConfirmingReleaseOverride(true);
                      }}
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold uppercase text-slate-700 hover:bg-slate-50"
                    >
                      Make visible without payment
                    </button>
                  )
                )}
                {confirmingReleaseOverride && (
                  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
                    <div className="w-full max-w-sm rounded-xl bg-white p-5">
                      <h3 className="font-semibold text-slate-800">Release this report without payment?</h3>
                      <p className="mt-2 text-sm text-slate-600">
                        The customer will be able to view and download their report in the portal even though this job isn&apos;t marked Paid. You can undo this later.
                      </p>
                      {releaseOverrideError && <p className="mt-2 text-sm text-red-600">{releaseOverrideError}</p>}
                      <div className="mt-4 flex gap-2">
                        <button
                          disabled={submittingReleaseOverride}
                          onClick={async () => {
                            setSubmittingReleaseOverride(true);
                            setReleaseOverrideError(null);
                            const ok = await saveReportReleaseOverride(true);
                            setSubmittingReleaseOverride(false);
                            if (ok) {
                              setConfirmingReleaseOverride(false);
                            } else {
                              setReleaseOverrideError("Couldn't save — try again.");
                            }
                          }}
                          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                        >
                          {submittingReleaseOverride ? "Saving…" : "Yes, make it visible"}
                        </button>
                        <button
                          disabled={submittingReleaseOverride}
                          onClick={() => setConfirmingReleaseOverride(false)}
                          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold disabled:opacity-50"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
            </>
            )}
          </div>
          )
        )}

        {tab === "chat" && job.source !== "subcontractor" && (
          <div className="mt-4">
            <JobChat
              endpoint={`/api/admin/jobs/${job.id}/messages`}
              photoUploadEndpoint={`/api/admin/jobs/${job.id}/photos`}
              photoViewEndpointBase={`/api/admin/jobs/${job.id}/photos`}
              onPhotoSent={onChanged}
              senderRole="admin"
              sendButtonClassName="rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
            />
          </div>
        )}

        {tab === "photos" && job.source !== "subcontractor" && (
          <div className="mt-4">
            <JobPhotos
              photos={job.photos ?? []}
              uploadEndpoint={`/api/admin/jobs/${job.id}/photos`}
              viewEndpointBase={`/api/admin/jobs/${job.id}/photos`}
              deleteEndpointBase={`/api/admin/jobs/${job.id}/photos`}
              onChanged={onChanged}
              uploadButtonClassName="rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
            />
          </div>
        )}

        {tab === "shipping" && job.source === "subcontractor" && (() => {
          const shipping = job.subcontractor_shipping;
          // Only ever seen FedEx so far — a carrier we don't recognize just
          // shows its raw tracking number rather than guessing a URL.
          const trackingUrl = shipping?.trackingNumber && shipping.provider?.toLowerCase().includes("fedex")
            ? `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(shipping.trackingNumber)}`
            : null;
          return (
            <div className="mt-4 space-y-3">
              {shipping ? (
                <>
                  <DetailField label="Provider" value={shipping.provider ?? "—"} />
                  <DetailField label="Speed" value={shipping.speed ?? "—"} />
                  <DetailField
                    label="Tracking #"
                    value={shipping.trackingNumber ? (trackingUrl ? <a href={trackingUrl} target="_blank" rel="noopener noreferrer" className="text-brand-700 underline">{shipping.trackingNumber}</a> : shipping.trackingNumber) : "—"}
                  />
                  {shipping.labelUrl && (
                    <a
                      href={shipping.labelUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-block rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white"
                    >
                      Open Shipping Label ↗
                    </a>
                  )}
                </>
              ) : (
                <p className="text-sm text-slate-500">No shipping information was included in the assignment email.</p>
              )}
            </div>
          );
        })()}

        {tab === "compensation" && job.source === "subcontractor" && (
          <div className="mt-4 space-y-3">
            {job.subcontractor_compensation ? (
              <>
                <DetailField label="Base" value={job.subcontractor_compensation.base ?? "—"} />
                <DetailField label="Est. lab fees" value={job.subcontractor_compensation.labFees ?? "—"} />
                <DetailField label="Est. net" value={job.subcontractor_compensation.net ?? "—"} />
              </>
            ) : (
              <p className="text-sm text-slate-500">No compensation estimate was included in the assignment email.</p>
            )}
          </div>
        )}

        {tab === "info" && (
        <div className="mt-5 border-t border-slate-100 pt-4">
          {(() => {
            const segments = job.source === "subcontractor" ? SUBCONTRACTOR_TRACKER_SEGMENTS : TRACKER_SEGMENTS;
            const trackerStatuses = job.source === "subcontractor" ? SUBCONTRACTOR_TRACKER_STATUSES : TRACKER_STATUSES;
            const currentIndex = (trackerStatuses as readonly string[]).indexOf(job.status);
            return (
              <>
                {/* Desktop: horizontal bar of segments with a label row underneath — unchanged. */}
                <div className="hidden sm:block">
                  {job.status === "cancelled" ? (
                    <div className="flex h-2.5 items-center rounded-full bg-red-500">
                      <span className="w-full text-center text-xs font-bold text-white">&nbsp;</span>
                    </div>
                  ) : (
                    <div className="flex gap-1">
                      {segments.map((seg) => {
                        const done = seg.done(job, currentIndex);
                        return seg.status ? (
                          <button
                            key={seg.key}
                            onClick={() => onStatusChange(seg.status!)}
                            title={`Set status to ${statusLabelForJob(job, seg.status)}`}
                            className={`h-2.5 flex-1 rounded-full ${done ? "bg-emerald-500" : "bg-slate-200"}`}
                          />
                        ) : (
                          <div
                            key={seg.key}
                            title="Set automatically once both the report and invoice are sent — there's no manual toggle for this one"
                            className={`h-2.5 flex-1 rounded-full ${done ? "bg-emerald-500" : "bg-slate-200"}`}
                          />
                        );
                      })}
                    </div>
                  )}
                  <div className="mt-1.5 flex gap-1">
                    {job.status === "cancelled" ? (
                      <span className="flex-1 text-center text-sm font-bold text-red-600">Cancelled</span>
                    ) : (
                      segments.map((seg) => {
                        const done = seg.done(job, currentIndex);
                        return (
                          <span key={seg.key} className={`flex-1 text-center text-sm font-bold ${done ? "text-emerald-700" : "text-slate-400"}`}>
                            {seg.label}
                          </span>
                        );
                      })
                    )}
                  </div>
                </div>
                {/* Mobile: a vertical step list — each status gets its own row instead of a cramped horizontal strip with wrapped labels. */}
                <div className="flex flex-col gap-2 sm:hidden">
                  {job.status === "cancelled" ? (
                    <span className="text-sm font-bold text-red-600">Cancelled</span>
                  ) : (
                    segments.map((seg) => {
                      const done = seg.done(job, currentIndex);
                      const cellClass = `w-full overflow-hidden text-ellipsis whitespace-nowrap rounded px-3 py-2 text-sm font-bold ${done ? "bg-emerald-500 text-white" : "bg-slate-200 text-slate-400"}`;
                      return seg.status ? (
                        <button
                          key={seg.key}
                          onClick={() => onStatusChange(seg.status!)}
                          title={`Set status to ${statusLabelForJob(job, seg.status)}`}
                          className={`text-left ${cellClass}`}
                        >
                          {seg.plainLabel}
                        </button>
                      ) : (
                        <div
                          key={seg.key}
                          title="Set automatically once both the report and invoice are sent — there's no manual toggle for this one"
                          className={cellClass}
                        >
                          {seg.plainLabel}
                        </div>
                      );
                    })
                  )}
                </div>
              </>
            );
          })()}
        </div>
        )}
        </div>
      </div>
    </div>
  );
}

// Renders a PDF's first page onto a canvas client-side rather than relying
// on the browser's native PDF viewer inside an iframe — that plugin turned
// out to render solid black for this admin (likely a Chrome/PDFium quirk
// with nested-iframe PDF viewers), so this sidesteps it entirely by doing
// the rasterizing ourselves with pdf.js.
function PdfThumbnail({ url, alt }: { url: string; alt: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pdfjsLib = await import("pdfjs-dist");
        // Served as a plain static file (see the postinstall script in
        // package.json) rather than bundled via a `new URL(...)` import —
        // Next's production build runs Terser over anything webpack bundles,
        // and Terser chokes on the worker's top-level ESM import/export
        // syntax. A static asset skips that pipeline entirely.
        pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        const pdf = await pdfjsLib.getDocument(url).promise;
        const page = await pdf.getPage(1);
        const unscaled = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: 300 / unscaled.width });
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d");
        if (!canvas || !ctx || cancelled) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: ctx, viewport }).promise;
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (failed) {
    return (
      <div className="flex h-40 w-full items-center justify-center bg-slate-100 text-xs text-slate-400">
        Preview unavailable
      </div>
    );
  }
  return (
    <div className="flex h-40 w-full items-center justify-center bg-slate-50">
      <canvas ref={canvasRef} aria-label={alt} className="max-h-full max-w-full" />
    </div>
  );
}

// Full-size, in-app viewer for a document thumbnail — renders every page of
// the PDF onto stacked canvases so the admin can actually read it without
// leaving the app (opening the raw file in a new tab depends on the
// browser/OS's PDF file-association, which can just as easily trigger a
// download as a preview). Images just show directly at full size.
function DocumentViewerModal({
  url, fileName, isImage, onClose,
}: {
  url: string;
  fileName: string;
  isImage: boolean;
  onClose: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(!isImage);

  useEffect(() => {
    if (isImage) return;
    let cancelled = false;
    (async () => {
      try {
        const pdfjsLib = await import("pdfjs-dist");
        pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        const pdf = await pdfjsLib.getDocument(url).promise;
        const container = containerRef.current;
        if (!container || cancelled) return;
        container.innerHTML = "";
        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
          const page = await pdf.getPage(pageNum);
          const unscaled = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: Math.min(800 / unscaled.width, 1.5) });
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.className = "mx-auto mb-3 max-w-full shadow";
          const ctx = canvas.getContext("2d");
          if (!ctx || cancelled) return;
          await page.render({ canvasContext: ctx, viewport }).promise;
          if (cancelled) return;
          container.appendChild(canvas);
        }
        if (!cancelled) setLoading(false);
      } catch {
        if (!cancelled) {
          setFailed(true);
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url, isImage]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
          <span className="truncate text-sm font-medium text-slate-700">{fileName}</span>
          <button onClick={onClose} className="shrink-0 text-slate-400 hover:text-slate-600">✕</button>
        </div>
        <div className="overflow-y-auto bg-slate-100 p-4">
          {isImage ? (
            <img src={url} alt={fileName} className="mx-auto max-w-full" />
          ) : (
            <>
              {loading && <p className="py-10 text-center text-sm text-slate-400">Loading…</p>}
              {failed && <p className="py-10 text-center text-sm text-slate-400">Preview unavailable.</p>}
              <div ref={containerRef} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Live preview of the actual generated report packet — every page, rendered
// right in the Final Report tab so the admin can see it come together as
// project info/lab results/asbestos result get filled in,
// without having to download anything first. `revision` is a plain-string
// fingerprint of everything that feeds the report; passing a new value
// forces a re-fetch and re-render even though the URL itself never changes.
// One of the six general-purpose upload slots on the Lab Paperwork tab —
// deliberately generic (no fixed meaning per station yet) until he settles
// on exactly what he needs each one for (chain of custody, lab receipt,
// lab results, etc.). Reuses the same documents route as everything else,
// just tagged with this station's own kind.
function DocumentStation({
  job, onChanged, kind, label, serviceType, headerExtra, titlePosition = "top",
}: {
  job: JobWithCustomer;
  onChanged: () => void;
  kind: JobDocument["kind"];
  label: string;
  serviceType: string;
  headerExtra?: ReactNode;
  /** Per Tim, 2026-08-28 — the Invoice tab's Lab Invoice cards need to look
      exactly like the Invoice/Final Report cards next to them: title in a
      footer bar under the thumbnail, not a header above it, and no
      whitespace-nowrap (a long service-type label there ran into the next
      card instead of wrapping). "top" (the Report tab's own look, label
      above a fixed-height box) stays the default. */
  titlePosition?: "top" | "bottom";
}) {
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [viewingDoc, setViewingDoc] = useState<JobDocument | null>(null);
  const [confirmingDeleteDoc, setConfirmingDeleteDoc] = useState<JobDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function uploadFiles(files: FileList) {
    setUploading(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("kind", kind);
        formData.append("serviceType", serviceType);
        const res = await fetch(`/api/admin/jobs/${job.id}/documents`, { method: "POST", body: formData });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to upload document");
      }
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to upload document");
    } finally {
      setUploading(false);
    }
  }

  async function deleteDoc(docId: string) {
    setConfirmingDeleteDoc(null);
    setDeletingId(docId);
    setError(null);
    try {
      const res = await fetch(`/api/admin/jobs/${job.id}/documents/${docId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to delete document");
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete document");
    } finally {
      setDeletingId(null);
    }
  }

  const docs = (job.documents ?? []).filter((d) => d.kind === kind && d.service_type === serviceType);

  return (
    <div>
      {titlePosition === "top" && (
        <div className="flex flex-nowrap items-center gap-2">
          <h4 className="whitespace-nowrap text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</h4>
          {headerExtra}
        </div>
      )}
      {docs.length === 0 && (
        <div className={titlePosition === "bottom" ? "mt-1.5 block w-full overflow-hidden rounded-lg border border-dashed border-slate-300" : undefined}>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              if (e.dataTransfer.files.length > 0) uploadFiles(e.dataTransfer.files);
            }}
            className={
              titlePosition === "bottom"
                ? `flex h-40 w-full flex-col items-center justify-center gap-2 p-3 text-center ${dragOver ? "bg-brand-50" : "bg-slate-50"}`
                : `mt-1.5 flex h-40 w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-3 text-center ${
                    dragOver ? "border-brand-600 bg-brand-50" : "border-slate-300"
                  }`
            }
          >
            <p className="text-sm text-slate-500">Drag and drop a file here, or</p>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
            >
              {uploading ? "Uploading…" : "Choose file"}
            </button>
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf,image/*"
              className="hidden"
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) uploadFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>
          {titlePosition === "bottom" && (
            <p className="truncate border-t border-dashed border-slate-300 px-2 py-1 text-center text-xs font-bold uppercase text-slate-400" title={label}>{label}</p>
          )}
        </div>
      )}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      {docs.length > 0 && (
        <div className="mt-1.5 space-y-2">
          {docs.map((doc) => {
            const url = `/api/admin/jobs/${job.id}/documents/${doc.id}`;
            const isImage = /\.(png|jpe?g|gif|webp)$/i.test(doc.file_name);
            return (
              <div key={doc.id} className="relative overflow-hidden rounded-lg border border-slate-200 bg-white">
                <button
                  type="button"
                  onClick={() => setViewingDoc(doc)}
                  title={`View ${doc.file_name}`}
                  aria-label={`View ${doc.file_name}`}
                  className="block w-full"
                >
                  {isImage ? (
                    <img src={url} alt={doc.file_name} className="h-40 w-full object-cover" />
                  ) : (
                    <PdfThumbnail url={url} alt={doc.file_name} />
                  )}
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setConfirmingDeleteDoc(doc);
                  }}
                  disabled={deletingId === doc.id}
                  title={`Delete ${doc.file_name}`}
                  aria-label={`Delete ${doc.file_name}`}
                  className="absolute right-1 top-1 rounded-full bg-white/90 px-1.5 py-0.5 text-xs font-bold text-slate-500 shadow hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                >
                  {deletingId === doc.id ? "…" : "✕"}
                </button>
                {/* Per Tim, 2026-08-28 — same footer-title spot the Invoice
                    and Final Report cards use, so a row mixing this with
                    those looks consistent instead of DocumentStation's own
                    header-above-the-box default (titlePosition "top"). */}
                {titlePosition === "bottom" && (
                  <p className="truncate border-t border-slate-200 bg-white px-2 py-1 text-center text-xs font-bold uppercase text-slate-700" title={label}>{label}</p>
                )}
                {/* Same View/Download row as the Invoice and Final Report
                    cards, for the same reason — a right-click-to-save on
                    the thumbnail isn't obvious, and the thumbnail's own
                    click already opens the in-app preview modal instead of
                    a new tab. */}
                <div className="border-t border-slate-200 px-2 py-1 text-center text-xs">
                  <a href={url} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">
                    View
                  </a>
                  {" · "}
                  <a href={`${url}?download=1`} download={doc.file_name} className="text-brand-600 hover:underline">
                    Download
                  </a>
                </div>
                {doc.project_number_mismatch && (
                  <p className="bg-red-600 px-2 py-1 text-xs font-bold text-white">
                    ⚠ Report says {doc.project_number_mismatch}. This job is {job.project_number}.
                  </p>
                )}
                {doc.domain_mismatch && (
                  <p className="bg-red-600 px-2 py-1 text-xs font-bold text-white">
                    ⚠ This report's content doesn't look like {serviceTypeLabel(doc.service_type)} — double-check it's the right file before this goes out.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
      {viewingDoc && (
        <DocumentViewerModal
          url={`/api/admin/jobs/${job.id}/documents/${viewingDoc.id}`}
          fileName={viewingDoc.file_name}
          isImage={/\.(png|jpe?g|gif|webp)$/i.test(viewingDoc.file_name)}
          onClose={() => setViewingDoc(null)}
        />
      )}
      {confirmingDeleteDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-5">
            <h3 className="font-semibold text-slate-800">Delete this document?</h3>
            <p className="mt-2 text-sm text-slate-600">
              &quot;{confirmingDeleteDoc.file_name}&quot; will be permanently deleted. This can&apos;t be undone.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => deleteDoc(confirmingDeleteDoc.id)}
                disabled={deletingId === confirmingDeleteDoc.id}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
              >
                {deletingId === confirmingDeleteDoc.id ? "Deleting…" : "Delete"}
              </button>
              <button
                onClick={() => setConfirmingDeleteDoc(null)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DocumentsPanel({ job, onChanged }: { job: JobWithCustomer; onChanged: () => void }) {
  const [kind, setKind] = useState<JobDocument["kind"]>("coc");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload() {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("kind", kind);
      const res = await fetch(`/api/admin/jobs/${job.id}/documents`, { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to upload document");
      setFile(null);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to upload document");
    } finally {
      setUploading(false);
    }
  }

  async function remove(docId: string) {
    if (!confirm("Delete this document?")) return;
    const res = await fetch(`/api/admin/jobs/${job.id}/documents/${docId}`, { method: "DELETE" });
    if (res.ok) onChanged();
  }

  return (
    <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
      {!job.documents || job.documents.length === 0 ? (
        <p className="text-xs text-slate-500">No documents on file yet.</p>
      ) : (
        <ul className="space-y-1">
          {job.documents.map((doc) => (
            <li key={doc.id} className="flex items-center justify-between gap-2 text-xs">
              <a
                href={`/api/admin/jobs/${job.id}/documents/${doc.id}`}
                target="_blank"
                rel="noreferrer"
                className="text-brand-600 underline"
              >
                {DOCUMENT_KIND_LABEL[doc.kind]}: {doc.file_name}
              </a>
              <button onClick={() => remove(doc.id)} className="text-red-600">
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && <div className="mt-2 rounded bg-red-50 px-2 py-1 text-xs text-red-700">{error}</div>}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select className="rounded border border-slate-300 px-2 py-1 text-xs" value={kind} onChange={(e) => setKind(e.target.value as JobDocument["kind"])}>
          <option value="coc">Chain of custody</option>
          <option value="lab_report">Lab report</option>
          <option value="report">Finished report</option>
          <option value="other">Other</option>
        </select>
        <input
          type="file"
          className="max-w-[180px] text-xs"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <button
          onClick={upload}
          disabled={!file || uploading}
          className="rounded bg-brand-600 px-2 py-1 text-xs font-bold text-white disabled:opacity-50"
        >
          {uploading ? "Uploading…" : "Upload"}
        </button>
      </div>
    </div>
  );
}


// Extra Cc's for one specific draft (invoice or report) — see the
// invoice_emails/report_emails column comments in lib/types.ts for why
// these are kept separate rather than one shared list.
export function ComboboxInput<T>({
  value, onChange, options, fetchOptions, getLabel, getSublabel, onSelect, placeholder, disabled, onEnter, onBlur, filterOptions = true, showChevron = false,
}: {
  value: string;
  onChange: (v: string) => void;
  options?: T[];
  fetchOptions?: (query: string) => Promise<T[]>;
  getLabel: (o: T) => string;
  getSublabel?: (o: T) => string | null | undefined;
  onSelect: (o: T) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Pressing Enter with no suggestion list open — lets a caller add whatever's typed directly (e.g. CcPicker adding a raw email not in the Directory). */
  onEnter?: (value: string) => void;
  /** Free-typed text that was never picked from the list or Entered — saved the same way a plain input's onBlur would. */
  onBlur?: (value: string) => void;
  /** Set false for a short, fixed option list meant to always be fully visible (e.g. the two canned findings sentences) — once `value` holds one option's full text, substring-filtering against it would filter every other option out. */
  filterOptions?: boolean;
  /** Shows a static dropdown-arrow indicator on the right edge, same idea as a native <select> — for a usage where the option list itself is the whole point (e.g. the canned Result findings) rather than free-text search-as-you-type. */
  showChevron?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [asyncOptions, setAsyncOptions] = useState<T[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The li's onMouseDown (which calls onSelect) always fires before the
  // input's onBlur — without this guard, onBlur would still fire with the
  // stale pre-selection value and could race/overwrite the fresh onSelect
  // save with the old text.
  const justSelectedRef = useRef(false);

  useEffect(() => {
    if (!fetchOptions) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!value.trim()) {
      setAsyncOptions([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setAsyncOptions(await fetchOptions(value.trim()));
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value, fetchOptions]);

  const query = value.trim().toLowerCase();
  const filtered = fetchOptions
    ? asyncOptions
    : query && filterOptions
    ? (options ?? []).filter((o) => getLabel(o).toLowerCase().includes(query))
    : options ?? [];

  return (
    <div className="relative">
      <input
        className={`w-full rounded-lg border border-slate-300 py-2 text-sm disabled:bg-slate-100 disabled:text-slate-500 ${showChevron ? "pl-3 pr-8" : "px-3"}`}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          if (justSelectedRef.current) {
            justSelectedRef.current = false;
          } else {
            onBlur?.(value);
          }
          setTimeout(() => setOpen(false), 150);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && onEnter) {
            e.preventDefault();
            onEnter(value);
            setOpen(false);
          }
        }}
      />
      {showChevron && (
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">▾</span>
      )}
      {!disabled && open && filtered.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white text-sm shadow-lg">
          {filtered.map((o, i) => (
            <li
              key={i}
              onMouseDown={() => {
                justSelectedRef.current = true;
                onSelect(o);
                setOpen(false);
              }}
              className="cursor-pointer px-3 py-2 hover:bg-slate-50"
            >
              <div className="font-medium text-slate-800">{getLabel(o)}</div>
              {getSublabel?.(o) && <div className="text-xs text-slate-500">{getSublabel(o)}</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AddProjectDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [serviceTypes, setServiceTypes] = useState<{ key: string; label: string }[]>([]);
  const [customerKind, setCustomerKind] = useState<"individual" | "company">("company");
  const [projectNumber, setProjectNumber] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [companyNameBlurred, setCompanyNameBlurred] = useState(false);
  const [contactName, setContactName] = useState("");
  const [contactId, setContactId] = useState("");
  const [contactNameBlurred, setContactNameBlurred] = useState(false);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [creatingContact, setCreatingContact] = useState(false);
  const [serviceStreet, setServiceStreet] = useState("");
  const [serviceUnit, setServiceUnit] = useState("");
  const [serviceCity, setServiceCity] = useState("");
  const [serviceState, setServiceState] = useState("");
  const [serviceZip, setServiceZip] = useState("");
  const [siteContactName, setSiteContactName] = useState("");
  const [siteContactPhone, setSiteContactPhone] = useState("");
  // Individual mode defaults this true (site contact assumed to be the
  // customer) when picked; Company is this form's own starting kind (most
  // projects come in through a company), where the site contact is usually
  // someone else entirely, so this starts false to match.
  const [siteContactSameAsContact, setSiteContactSameAsContact] = useState(false);
  const [selectedServiceTypeKeys, setSelectedServiceTypeKeys] = useState<string[]>([]);
  const [customServiceType, setCustomServiceType] = useState("");
  // Independent of the text itself, so checking the box first (before
  // typing anything) sticks instead of immediately reverting — typing
  // still checks it automatically either way.
  const [otherChecked, setOtherChecked] = useState(false);
  const [scopeOfWork, setScopeOfWork] = useState("");
  const [startingStatus, setStartingStatus] = useState<"needs_scheduling" | "scheduled" | "pending_lab_results">("needs_scheduling");
  const [requestedDate, setRequestedDate] = useState("");
  const [requestedTime, setRequestedTime] = useState("");
  const [notes, setNotes] = useState("");
  const [paymentType, setPaymentType] = useState<"online" | "check">("online");
  const [submitting, setSubmitting] = useState(false);
  const [fetchingNumber, setFetchingNumber] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingExit, setConfirmingExit] = useState(false);

  useEffect(() => {
    if (!siteContactSameAsContact) return;
    setSiteContactName(contactName);
    setSiteContactPhone(phone);
  }, [siteContactSameAsContact, contactName, phone]);

  async function searchCompanies(q: string): Promise<Company[]> {
    const res = await fetch(`/api/admin/companies?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    return data.companies ?? [];
  }

  // Once a company's picked, scope suggestions to that company's own
  // contacts (still live, not just the cached companyContacts list, so a
  // contact added elsewhere mid-session still shows up) — otherwise a
  // plain name/email search across every contact in the Directory.
  async function searchContacts(q: string): Promise<Customer[]> {
    const url = companyId
      ? `/api/admin/customers?companyId=${companyId}`
      : `/api/admin/customers?q=${encodeURIComponent(q)}`;
    const res = await fetch(url);
    const data = await res.json();
    return data.customers ?? [];
  }

  function selectCompany(company: Company) {
    setCompanyName(company.name);
    setCompanyId(company.id);
  }

  function selectContact(contact: Customer) {
    setContactName(contact.name);
    setEmail(contact.email);
    setPhone(contact.phone);
    setContactId(contact.id);
  }

  function toggleServiceType(key: string) {
    setSelectedServiceTypeKeys((keys) => (keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key]));
  }

  useEffect(() => {
    fetch("/api/admin/settings")
      .then((r) => r.json())
      .then((data) => {
        setServiceTypes(data.settings?.service_types ?? []);
      });
  }, []);

  // Auto-fills the ZIP once street, town, and state are all in — mirrors
  // how a Places-picked address already carries its zip, just via a plain
  // geocode lookup since these are separate typed fields rather than an
  // autocomplete suggestion.
  useAutoZip(serviceStreet, serviceCity, serviceState, setServiceZip);

  async function getNextNumber() {
    setFetchingNumber(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/jobs/next-project-number");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to get next number");
      setProjectNumber(data.projectNumber);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to get next number");
    } finally {
      setFetchingNumber(false);
    }
  }

  async function submit() {
    // Every job needs a real Directory contact behind it — the inline
    // "Create contact"/"Create company" prompt right above these fields is
    // the way out of this, not a workaround around it.
    if (customerKind === "individual" && !contactId) {
      setError("Select an existing contact, or create one, before adding this project.");
      return;
    }
    if (customerKind === "company" && !companyId) {
      setError("Select an existing company, or create one, before adding this project.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectNumber: projectNumber.trim() || undefined,
          name: contactName.trim() || undefined,
          companyId: companyId || undefined,
          company: !companyId ? companyName.trim() || undefined : undefined,
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
          reportEmails: email.trim() || undefined,
          serviceAddress: buildBillingAddress({
            street: serviceStreet, unit: serviceUnit, city: serviceCity, state: serviceState, zip: serviceZip,
          }) || undefined,
          siteContactName: siteContactName.trim() || undefined,
          siteContactPhone: siteContactPhone.trim() || undefined,
          serviceTypeKeys: selectedServiceTypeKeys,
          customServiceType: customServiceType.trim() || undefined,
          scopeOfWork: scopeOfWork.trim() || undefined,
          requestedDate: requestedDate || undefined,
          requestedTime: requestedTime || undefined,
          status: startingStatus,
          notes: notes.trim() || undefined,
          paymentType,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create project");
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create project");
    } finally {
      setSubmitting(false);
    }
  }

  // Shared Name/Phone controls bound to contactName/phone — Individual mode
  // lays these out inline with Project Number (nameField/phoneField below);
  // Company mode instead renders them as a labeled "Company contact" block
  // (contactFields) underneath the Company field.
  const nameField = (
    <ComboboxInput
      value={contactName}
      onChange={(v) => { setContactName(v); setEmail(""); setPhone(""); setContactId(""); setContactNameBlurred(false); }}
      fetchOptions={searchContacts}
      getLabel={(c) => c.name}
      getSublabel={(c) => c.email}
      onSelect={selectContact}
      onBlur={() => setContactNameBlurred(true)}
      placeholder="Name"
    />
  );
  const phoneField = (
    <input
      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
      placeholder="Phone"
      value={phone}
      onChange={(e) => setPhone(formatPhoneInput(e.target.value))}
    />
  );
  // Every job needs a real contact attached — Individual mode gates on this
  // field directly (it's the customer), so this warning only ever shows
  // there. Company mode gates on the Company field instead (see below);
  // its "Company contact" person stays freeform, same as before. Only
  // shown once the field's been left (contactNameBlurred) — not while
  // still mid-type, which would flag every real contact as "not found"
  // right up until the last keystroke.
  const noContactWarning = customerKind === "individual" && contactNameBlurred && contactName.trim() && !contactId && (
    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
      <span>No contact named &quot;{contactName.trim()}&quot; found in the Directory.</span>
      <button type="button" onClick={() => setCreatingContact(true)} className="font-bold underline">
        Create contact
      </button>
    </div>
  );
  const contactFields = (
    <>
      <label className="mt-3 block text-sm font-medium text-slate-700">Company contact</label>
      <div className="mt-1 flex gap-2">
        <div className="w-0 flex-1">{nameField}</div>
        <div className="w-0 flex-1">{phoneField}</div>
      </div>
    </>
  );

  return (
    <>
    <div className="fixed inset-0 flex items-center justify-center bg-black/40 px-4">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white">
        <div className="flex shrink-0 items-start justify-between gap-2 px-5 pt-5">
          <h3 className="font-semibold text-slate-800">Add Project</h3>
          <button onClick={() => setConfirmingExit(true)} className="shrink-0 text-slate-400 hover:text-slate-600">✕</button>
        </div>

        <div className="min-h-0 overflow-y-auto px-5 pb-5">

        {error && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => {
              setCustomerKind("company");
              setSiteContactSameAsContact(false);
            }}
            className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-medium ${customerKind === "company" ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"}`}
          >
            Company
          </button>
          <button
            type="button"
            onClick={() => {
              setCustomerKind("individual");
              setCompanyName("");
              setCompanyId("");
              setSiteContactSameAsContact(true);
            }}
            className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-medium ${customerKind === "individual" ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"}`}
          >
            Individual
          </button>
        </div>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:gap-4">
          <div className="shrink-0">
            <label className="block text-sm font-medium text-slate-700">Project Number</label>
            <div className="mt-1 flex gap-1.5">
              <button
                onClick={getNextNumber}
                disabled={fetchingNumber}
                className="shrink-0 rounded-lg border border-brand-700 bg-brand-100 px-2 py-2 text-xs font-bold text-brand-700 disabled:opacity-50"
              >
                {fetchingNumber ? "…" : "#"}
              </button>
              <input className="w-full rounded-lg border border-slate-300 px-2 py-2 text-sm sm:w-20" value={projectNumber} onChange={(e) => setProjectNumber(e.target.value)} />
            </div>
          </div>
          {customerKind === "individual" ? (
            <>
              <div className="min-w-0 sm:flex-1">
                <label className="block text-sm font-medium text-slate-700">Customer name</label>
                <div className="mt-1">{nameField}</div>
              </div>
              <div className="min-w-0 sm:flex-1">
                <label className="block text-sm font-medium text-slate-700">Phone</label>
                <div className="mt-1">{phoneField}</div>
              </div>
            </>
          ) : (
            <div className="min-w-0 sm:flex-1">
              <label className="block text-sm font-medium text-slate-700">Company</label>
              <div className="mt-1">
                <ComboboxInput
                  value={companyName}
                  onChange={(v) => { setCompanyName(v); setCompanyId(""); setCompanyNameBlurred(false); }}
                  fetchOptions={searchCompanies}
                  getLabel={(c) => c.name}
                  onSelect={selectCompany}
                  onBlur={() => setCompanyNameBlurred(true)}
                />
              </div>
            </div>
          )}
        </div>

        {noContactWarning}

        {customerKind === "company" && companyNameBlurred && companyName.trim() && !companyId && (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <span>No company named &quot;{companyName.trim()}&quot; found in the Directory.</span>
            <button type="button" onClick={() => setCreatingContact(true)} className="font-bold underline">
              Create company
            </button>
          </div>
        )}

        {customerKind === "company" && contactFields}

        <label className="mt-3 block text-sm font-medium text-slate-700">Job site address</label>
        <div className="mt-1 flex flex-col gap-1.5 sm:flex-row">
          <div className="min-w-0 sm:w-0 sm:flex-1">
            <AddressAutocompleteInput
              apiBase="/api/admin"
              value={serviceStreet}
              onChange={setServiceStreet}
              onSelectAddress={(fields) => {
                setServiceStreet(fields.street);
                setServiceUnit(fields.unit);
                setServiceCity(fields.city);
                setServiceState(fields.state);
                setServiceZip(fields.zip);
              }}
              placeholder="Street address"
              townHint={serviceCity}
            />
          </div>
          <input
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm sm:w-28 sm:shrink-0"
            placeholder="Unit #"
            value={serviceUnit}
            onChange={(e) => setServiceUnit(e.target.value)}
          />
        </div>
        <div className="mt-1.5 grid grid-cols-1 gap-1.5 sm:grid-cols-3">
          <AddressAutocompleteInput
            apiBase="/api/admin"
            value={serviceCity}
            onChange={(v) => {
              setServiceCity(v);
              if (!v.trim()) setServiceZip("");
            }}
            mode="city"
            onSelectAddress={(fields) => {
              // City-mode suggestions are towns, not streets — only fill
              // in what a town match actually has (no street/unit to set,
              // and no need to overwrite whatever street is already typed).
              setServiceCity(fields.city);
              // Job sites are always in Massachusetts — set directly
              // rather than trusting whichever state the picked place
              // happened to resolve to.
              setServiceState("MA");
              setServiceZip(fields.zip);
            }}
            placeholder="Town"
          />
          <input
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="State"
            value={serviceState}
            onChange={(e) => setServiceState(e.target.value)}
          />
          <ZipInput street={serviceStreet} city={serviceCity} state={serviceState} zip={serviceZip} setZip={setServiceZip} />
        </div>

        <label className="mt-3 block text-sm font-medium text-slate-700">Job site contact</label>
        <div className="mt-1 flex flex-col gap-2 sm:flex-row">
          <div className="min-w-0 sm:w-0 sm:flex-1">
            {/* Plain text, not ComboboxInput — the job site contact is the
                homeowner, essentially never one of the company/individual
                contacts already on file, so suggesting matches from that
                list is just noise here. */}
            <input
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={siteContactName}
              onChange={(e) => { setSiteContactName(e.target.value); setSiteContactSameAsContact(false); }}
              placeholder="Name"
            />
          </div>
          <div className="min-w-0 sm:w-0 sm:flex-1">
            <input
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="Phone"
              value={siteContactPhone}
              onChange={(e) => {
                setSiteContactPhone(formatPhoneInput(e.target.value));
                setSiteContactSameAsContact(false);
              }}
            />
          </div>
        </div>

        <label className="mt-3 block text-sm font-medium text-slate-700">Service type</label>
        <div className="mt-1 flex flex-col gap-1.5 sm:flex-row sm:gap-4">
          <div className="space-y-1.5 sm:flex-1">
            {serviceTypes.slice(3).map((s) => (
              <label key={s.key} className="flex items-center gap-1.5 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={selectedServiceTypeKeys.includes(s.key)}
                  onChange={() => toggleServiceType(s.key)}
                />
                {s.label}
              </label>
            ))}
          </div>
          <div className="space-y-1.5 sm:flex-1">
            {serviceTypes.slice(0, 3).map((s) => (
              <label key={s.key} className="flex items-center gap-1.5 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={selectedServiceTypeKeys.includes(s.key)}
                  onChange={() => toggleServiceType(s.key)}
                />
                {s.label}
              </label>
            ))}
            <label className="flex items-center gap-1.5 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={otherChecked}
                onChange={(e) => {
                  setOtherChecked(e.target.checked);
                  if (!e.target.checked) setCustomServiceType("");
                }}
              />
              <input
                type="text"
                value={customServiceType}
                onChange={(e) => {
                  setCustomServiceType(e.target.value);
                  if (e.target.value.trim() !== "") setOtherChecked(true);
                }}
                className="w-full min-w-0 border-b border-slate-300 bg-transparent text-sm focus:outline-none sm:w-40"
              />
            </label>
          </div>
        </div>

        <label className="mt-3 block text-sm font-medium text-slate-700">Starting status</label>
        <div className="relative mt-1">
          <select
            className="w-full appearance-none rounded-lg border border-slate-300 bg-white py-2 pl-3 pr-10 text-sm"
            value={startingStatus}
            onChange={(e) => {
              const next = e.target.value as "needs_scheduling" | "scheduled" | "pending_lab_results";
              setStartingStatus(next);
              if (next === "needs_scheduling") {
                setRequestedDate("");
                setRequestedTime("");
              }
            }}
          >
            <option value="needs_scheduling">To Be Scheduled</option>
            <option value="scheduled">Scheduled</option>
            {/* For a job entered after the fact — the fieldwork's already
                done and samples are already at the lab, so starting it at
                "To Be Scheduled" or "Scheduled" would be wrong; this skips
                straight to where it actually is. */}
            <option value="pending_lab_results">Pending Lab Results</option>
          </select>
          <span className="pointer-events-none absolute inset-y-0 right-0 flex w-9 items-center justify-center rounded-r-lg bg-slate-200 text-slate-500">▾</span>
        </div>

        {(startingStatus === "scheduled" || startingStatus === "pending_lab_results") && (
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <div className="sm:flex-1">
              <label className="block text-sm font-medium text-slate-700">Date</label>
              <input type="date" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" value={requestedDate} onChange={(e) => setRequestedDate(e.target.value)} />
            </div>
            <div className="sm:flex-1">
              <label className="block text-sm font-medium text-slate-700">Scheduled time</label>
              <select className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" value={requestedTime} onChange={(e) => setRequestedTime(e.target.value)}>
                <option value="">No time</option>
                {timeSelectOptions(requestedTime).map((t) => (
                  <option key={t} value={t}>{formatTime(t)}</option>
                ))}
              </select>
            </div>
          </div>
        )}

        <label className="mt-3 block text-sm font-medium text-slate-700">Scope of Work</label>
        <textarea
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          rows={4}
          value={scopeOfWork}
          onChange={(e) => setScopeOfWork(e.target.value)}
        />

        <label className="mt-3 block text-sm font-medium text-slate-700">Notes</label>
        <textarea className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} />

        <label className="mt-3 block text-sm font-medium text-slate-700">Payment type</label>
        <select
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          value={paymentType}
          onChange={(e) => setPaymentType(e.target.value as "online" | "check")}
        >
          <option value="online">Stripe</option>
          <option value="check">Check</option>
        </select>
        {paymentType === "check" && (
          <p className="mt-1 text-xs text-slate-500">No Stripe invoice or pay-now link will be created automatically for this project.</p>
        )}

        <div className="mt-4 flex gap-2">
          <button
            onClick={submit}
            disabled={submitting}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
          >
            {submitting ? "Adding…" : "Add Project"}
          </button>
          <button onClick={() => setConfirmingExit(true)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm">
            Cancel
          </button>
        </div>
        </div>
      </div>
    </div>
    {confirmingExit && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
        <div className="w-full max-w-sm rounded-xl bg-white p-5">
          <h3 className="font-semibold text-slate-800">Exit without saving?</h3>
          <p className="mt-2 text-sm text-slate-600">Are you sure you want to exit? Anything you've entered will be lost.</p>
          <div className="mt-4 flex gap-2">
            <button
              onClick={onClose}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white"
            >
              Exit
            </button>
            <button
              onClick={() => setConfirmingExit(false)}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    )}
    {creatingContact && (
      <ContactForm
        onClose={() => setCreatingContact(false)}
        prefill={{
          isCompany: customerKind === "company",
          name: customerKind === "individual" ? contactName.trim() : undefined,
          company: customerKind === "company" ? companyName.trim() : undefined,
          phone: phone.trim() || undefined,
        }}
        onDone={(customer) => {
          setCreatingContact(false);
          if (!customer) return;
          setContactName(customer.name);
          setEmail(customer.email);
          setPhone(customer.phone);
          setContactId(customer.id);
          if (customer.company_id) {
            setCompanyId(customer.company_id);
            setCompanyName(customer.company ?? companyName);
          }
        }}
      />
    )}
    </>
  );
}

// Editing an existing project reuses the same structured-field layout as
// Add Project (rather than the old in-place edit form) so both flows look
// and behave the same way.
export function EditProjectDialog({
  job, onClose, onSaved,
}: {
  job: JobWithCustomer;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [serviceTypes, setServiceTypes] = useState<{ key: string; label: string }[]>([]);
  const [projectNumber, setProjectNumber] = useState(job.project_number ?? "");
  const [status, setStatus] = useState<string>(job.status);
  const [companyName, setCompanyName] = useState(job.customers?.company || job.customers?.name || "");
  const [companyId, setCompanyId] = useState(job.customers?.company_id ?? "");
  // Which customer row this form is editing in place. Only changes when the
  // admin explicitly picks a different existing person from a dropdown —
  // typing edits the current person's own fields instead of colliding with
  // someone else's (e.g. overwriting their email).
  const [customerId, setCustomerId] = useState(job.customer_id);
  const [contactName, setContactName] = useState(job.customers?.name ?? "");
  const [email, setEmail] = useState(job.customers?.email ?? "");
  const [phone, setPhone] = useState(job.customers?.phone ?? "");
  const [additionalReportEmails, setAdditionalReportEmails] = useState<string[]>(() =>
    (job.report_emails ?? "")
      .split(",")
      .map((e) => e.trim())
      .filter((e) => e && e !== job.customers?.email)
  );
  const serviceInit = useMemo(() => parseAddressToFields(job.service_address), [job.service_address]);
  const [serviceStreet, setServiceStreet] = useState(serviceInit.street);
  const [serviceUnit, setServiceUnit] = useState(serviceInit.unit);
  const [serviceCity, setServiceCity] = useState(serviceInit.city);
  const [serviceState, setServiceState] = useState(serviceInit.state);
  const [serviceZip, setServiceZip] = useState(serviceInit.zip);
  const [siteContactName, setSiteContactName] = useState(job.site_contact_name ?? "");
  const [siteContactPhone, setSiteContactPhone] = useState(job.site_contact_phone ?? "");
  const [siteContactSameAsContact, setSiteContactSameAsContact] = useState(false);
  const [selectedServiceTypeKeys, setSelectedServiceTypeKeys] = useState<string[]>([]);
  const [customServiceType, setCustomServiceType] = useState("");
  // Independent of the text itself, so checking the box first (before
  // typing anything) sticks instead of immediately reverting — typing
  // still checks it automatically either way.
  const [otherChecked, setOtherChecked] = useState(false);
  // job.service_type can carry a legacy label that matches none of the
  // currently configured checkboxes (e.g. "Asbestos Inspection" predates the
  // more specific labels in Settings) — shown and edited via the "Other"
  // box below (populated once settings load, see the effect below) so the
  // dialog never looks like the job has no service type at all. Kept here
  // too as a save-time fallback in case that population effect hasn't run
  // yet by the time the admin saves.
  const legacyServiceTypeRef = useRef("");
  const [scopeOfWork, setScopeOfWork] = useState(job.scope_of_work ?? "");
  // The actual schedule — separate from job.requested_date/requested_time,
  // which is the customer's original ask and is never written to from this
  // dialog (shown read-only below instead, see "Original customer request").
  // Defaults to whatever's already confirmed, falling back to the request
  // as a starting point if nothing's been accepted yet — same default
  // AcceptScheduleControl uses.
  const [confirmedDate, setConfirmedDate] = useState(job.confirmed_date ?? job.requested_date ?? "");
  const [confirmedTime, setConfirmedTime] = useState(job.confirmed_time ?? job.requested_time ?? "");
  const confirmedDateInputRef = useRef<HTMLInputElement>(null);
  const [paidDate, setPaidDate] = useState(job.paid_date ?? "");
  const [dueDate, setDueDate] = useState(job.payment_due_date || paymentDueDate(confirmedDate) || "");
  // Tracks the auto-computed (confirmed date + 30) value last applied, so
  // editing the due date by hand sticks even as the confirmed date keeps
  // changing — only a due date that's still exactly the computed default
  // gets recomputed when the project date changes.
  const lastAppliedDueDateDefaultRef = useRef(paymentDueDate(confirmedDate) || "");
  useEffect(() => {
    const nextDefault = paymentDueDate(confirmedDate) || "";
    setDueDate((current) => (current === lastAppliedDueDateDefaultRef.current ? nextDefault : current));
    lastAppliedDueDateDefaultRef.current = nextDefault;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmedDate]);
  const [notes, setNotes] = useState(job.notes ?? "");
  const [paymentType, setPaymentType] = useState<"online" | "check">(job.payment_type ?? "online");
  const [isRevisit, setIsRevisit] = useState(job.is_revisit ?? false);
  const [submitting, setSubmitting] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [companyContacts, setCompanyContacts] = useState<Customer[]>([]);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const submittingRef = useRef(false);
  const hasMountedRef = useRef(false);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedBannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function deleteProject() {
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/admin/jobs/${job.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Failed to delete project");
      }
      onSaved();
      onClose();
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : "Failed to delete project");
      setDeleting(false);
    }
  }

  useEffect(() => {
    if (!companyId) {
      setCompanyContacts([]);
      return;
    }
    fetch(`/api/admin/customers?companyId=${companyId}`)
      .then((r) => r.json())
      .then((data) => setCompanyContacts(data.customers ?? []));
  }, [companyId]);

  useEffect(() => {
    if (!siteContactSameAsContact) return;
    setSiteContactName(contactName);
    setSiteContactPhone(phone);
  }, [siteContactSameAsContact, contactName, phone]);

  useEffect(() => {
    fetch("/api/admin/settings")
      .then((r) => r.json())
      .then((data) => {
        const types: { key: string; label: string }[] = data.settings?.service_types ?? [];
        setServiceTypes(types);
        // job.service_type is a comma-joined label string (e.g. "Asbestos
        // Inspection, Air Sampling") built at save time from checked known
        // types plus free text — split it back into checkboxes + remainder.
        const parts = (job.service_type ?? "").split(",").map((p) => p.trim()).filter(Boolean);
        const matchedKeys = types.filter((t) => parts.includes(t.label)).map((t) => t.key);
        const unmatched = parts.filter((p) => !types.some((t) => t.label === p));
        setSelectedServiceTypeKeys(matchedKeys);
        const legacyLabel = unmatched.join(", ");
        legacyServiceTypeRef.current = legacyLabel;
        if (legacyLabel) {
          setCustomServiceType(legacyLabel);
          setOtherChecked(true);
        }
      });
  }, [job.service_type]);

  useAutoZip(serviceStreet, serviceCity, serviceState, setServiceZip);

  async function searchCompanies(q: string): Promise<Company[]> {
    const res = await fetch(`/api/admin/companies?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    return data.companies ?? [];
  }

  // Once a company's picked, scope suggestions to that company's own
  // contacts (still live, not just the cached companyContacts list, so a
  // contact added elsewhere mid-session still shows up) — otherwise a
  // plain name/email search across every contact in the Directory.
  async function searchContacts(q: string): Promise<Customer[]> {
    const url = companyId
      ? `/api/admin/customers?companyId=${companyId}`
      : `/api/admin/customers?q=${encodeURIComponent(q)}`;
    const res = await fetch(url);
    const data = await res.json();
    return data.customers ?? [];
  }

  function selectCompany(company: Company) {
    setCompanyName(company.name);
    setCompanyId(company.id);
  }

  function selectContact(contact: Customer) {
    setCustomerId(contact.id);
    setContactName(contact.name);
    setEmail(contact.email);
    setPhone(contact.phone);
  }

  function toggleServiceType(key: string) {
    setSelectedServiceTypeKeys((keys) => (keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key]));
  }

  async function submit() {
    if (submittingRef.current) return;
    setSubmitting(true);
    submittingRef.current = true;
    setError(null);
    try {
      const matchedLabels = serviceTypes.filter((t) => selectedServiceTypeKeys.includes(t.key)).map((t) => t.label);
      const customPart = customServiceType.trim() || legacyServiceTypeRef.current;
      const serviceTypeLabel = [...matchedLabels, customPart].filter(Boolean).join(", ");
      const serviceAddress = buildBillingAddress({
        street: serviceStreet, unit: serviceUnit, city: serviceCity, state: serviceState, zip: serviceZip,
      });
      const reportEmails = [email, ...additionalReportEmails]
        .map((e) => e.trim())
        .filter((e, i, arr) => e && arr.indexOf(e) === i)
        .join(", ");

      // Typing a contact name without selecting an existing one clears
      // customerId (see the Contact name onChange below) — in that case,
      // create a new customer instead of PATCHing whatever id customerId
      // used to hold, which would silently overwrite an unrelated person.
      let targetCustomerId = customerId;
      let customerOk = true;
      if (!targetCustomerId) {
        const createRes = await fetch(`/api/admin/customers`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: contactName, email, phone,
            company: companyId ? undefined : companyName || undefined,
            companyId: companyId || undefined,
          }),
        });
        const createData = await createRes.json();
        customerOk = createRes.ok && !!createData.customer;
        if (customerOk) {
          targetCustomerId = createData.customer.id;
          // Auto-save re-runs this same function on every debounced edit —
          // without persisting the new id back into state, typing a new
          // contact name would create a fresh customer row on every single
          // tick instead of just once.
          setCustomerId(targetCustomerId);
        }
      }

      const [jobRes, customerRes] = await Promise.all([
        fetch(`/api/admin/jobs/${job.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            project_number: projectNumber.trim() || null,
            status,
            confirmed_date: confirmedDate || null,
            confirmed_time: confirmedTime || null,
            paid_date: paidDate || null,
            payment_due_date: dueDate || null,
            notes,
            site_contact_name: siteContactName.trim() || null,
            site_contact_phone: siteContactPhone || null,
            service_address: serviceAddress || null,
            service_type: serviceTypeLabel || null,
            scope_of_work: scopeOfWork.trim() || null,
            customer_id: targetCustomerId,
            report_emails: reportEmails || null,
            payment_type: paymentType,
            is_revisit: isRevisit,
          }),
        }),
        customerOk && targetCustomerId !== customerId
          ? Promise.resolve(new Response(null, { status: 200 }))
          : fetch(`/api/admin/customers/${targetCustomerId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                name: contactName, email, phone,
                company: companyId ? undefined : companyName || null, companyId: companyId || "",
              }),
            }),
      ]);
      if (!customerOk || !jobRes.ok || !customerRes.ok) {
        throw new Error("Failed to save project");
      }
      onSaved();
      setJustSaved(true);
      if (savedBannerTimerRef.current) clearTimeout(savedBannerTimerRef.current);
      savedBannerTimerRef.current = setTimeout(() => setJustSaved(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save project");
    } finally {
      setSubmitting(false);
      submittingRef.current = false;
    }
  }

  // Auto-saves ~1s after the admin stops editing, instead of requiring an
  // explicit Save click — every field below feeds the PATCH in submit().
  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      submit();
    }, 1000);
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    projectNumber, status, companyName, companyId, customerId, contactName, email, phone,
    additionalReportEmails,
    serviceStreet, serviceUnit, serviceCity, serviceState, serviceZip,
    siteContactName, siteContactPhone, selectedServiceTypeKeys, customServiceType, scopeOfWork,
    confirmedDate, confirmedTime, paidDate, dueDate, notes, paymentType, isRevisit,
  ]);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      if (savedBannerTimerRef.current) clearTimeout(savedBannerTimerRef.current);
    };
  }, []);

  return (
    <>
    <div className="fixed inset-0 flex items-center justify-center bg-black/40 px-4">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white">
        <div className="flex shrink-0 items-start justify-between gap-2 px-5 pt-5">
          <h3 className="font-semibold text-slate-800">EDIT PROJECT</h3>
          {/* Bigger tap target on mobile, same reasoning as the job card's
              own close button above it — p-2 -m-2 grows the hit area
              without shifting the glyph. */}
          <button onClick={onClose} className="shrink-0 -m-2 p-2 text-2xl leading-none text-slate-400 hover:text-slate-600 sm:m-0 sm:p-0 sm:text-base">✕</button>
        </div>

        <div className="min-h-0 overflow-y-auto px-5 pb-5">

        {error && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        {/* Per Tim, 2026-08-27 — Project # and Company each get their own
            full-width line on mobile instead of squeezing side by side;
            desktop keeps the original row layout, unchanged. */}
        <div className="mt-4 flex flex-col gap-4 sm:flex-row">
          <div className="w-full sm:w-28 sm:shrink-0">
            <label className="block text-sm font-medium text-slate-700">Project #</label>
            <input className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm" value={projectNumber} onChange={(e) => setProjectNumber(e.target.value)} />
          </div>
          <div className="min-w-0 flex-1">
            <label className="block text-sm font-medium text-slate-700">Company (leave blank for an individual)</label>
            <div className="mt-1">
              <ComboboxInput
                value={companyName}
                onChange={(v) => { setCompanyName(v); setCompanyId(""); }}
                fetchOptions={searchCompanies}
                getLabel={(c) => c.name}
                onSelect={selectCompany}
              />
            </div>
          </div>
        </div>

        <label className="mt-3 block text-sm font-medium text-slate-700">Job site address</label>
        <div className="mt-1 flex flex-col gap-1.5 sm:flex-row">
          <div className="min-w-0 sm:w-0 sm:flex-1">
            <AddressAutocompleteInput
              apiBase="/api/admin"
              value={serviceStreet}
              onChange={setServiceStreet}
              onSelectAddress={(fields) => {
                setServiceStreet(fields.street);
                setServiceUnit(fields.unit);
                setServiceCity(fields.city);
                setServiceState(fields.state);
                setServiceZip(fields.zip);
              }}
              placeholder="Street address"
              townHint={serviceCity}
            />
          </div>
          <input
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm sm:w-28 sm:shrink-0"
            placeholder="Unit #"
            value={serviceUnit}
            onChange={(e) => setServiceUnit(e.target.value)}
          />
        </div>
        <div className="mt-1.5 grid grid-cols-1 gap-1.5 sm:grid-cols-3">
          <input
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="Town"
            value={serviceCity}
            onChange={(e) => {
              const v = e.target.value;
              setServiceCity(v);
              if (!v.trim()) setServiceZip("");
            }}
          />
          <input
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="State"
            value={serviceState}
            onChange={(e) => setServiceState(e.target.value)}
          />
          <ZipInput street={serviceStreet} city={serviceCity} state={serviceState} zip={serviceZip} setZip={setServiceZip} />
        </div>

        <label className="mt-3 block text-sm font-medium text-slate-700">Status</label>
        <div className="relative mt-1">
          <select
            className="w-full appearance-none rounded-lg border border-slate-300 bg-white py-2 pl-3 pr-10 text-sm"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            {pipelineStatusesForJob(job).map((s) => (
              <option key={s} value={s}>{statusLabelForJob(job, s)}</option>
            ))}
          </select>
          <span className="pointer-events-none absolute inset-y-0 right-0 flex w-9 items-center justify-center rounded-r-lg bg-slate-200 text-slate-500">▾</span>
        </div>

        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <div className="sm:flex-1">
            <label className="block text-sm font-medium text-slate-700">Scheduled date</label>
            {/* Per Tim, 2026-08-27 — explicit h-10 alone wasn't enough: it
                matched in Chrome-based testing, but confirmed live on a
                real iPhone, Safari's own native input[type=date] chrome
                still rendered visibly taller than the Scheduled time
                <select> next to it despite identical classes (this is a
                browser rendering quirk, not something CSS height can
                override). Same fix already used for JobRow's own inline
                schedule editor below: give up on the native control's own
                look entirely — a plain div shows the formatted date and
                the real input sits on top at opacity-0, still fully
                tappable (opens the native picker), but nothing about its
                own box model is ever visible or relied on. */}
            <div
              className="relative mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white"
              onClick={() => confirmedDateInputRef.current?.showPicker?.()}
            >
              <div className="flex h-full items-center px-3 text-sm text-slate-800">
                {confirmedDate ? formatDateMDY(confirmedDate) : <span className="text-slate-400">Date</span>}
              </div>
              <input
                ref={confirmedDateInputRef}
                type="date"
                value={confirmedDate}
                onChange={(e) => setConfirmedDate(e.target.value)}
                className="absolute inset-0 h-full w-full opacity-0"
              />
            </div>
          </div>
          <div className="sm:flex-1">
            <label className="block text-sm font-medium text-slate-700">Scheduled time</label>
            <select className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" value={confirmedTime} onChange={(e) => setConfirmedTime(e.target.value)}>
              <option value="">No time</option>
              {timeSelectOptions(confirmedTime).map((t) => (
                <option key={t} value={t}>{formatTime(t)}</option>
              ))}
            </select>
          </div>
        </div>
        {job.requested_date && (
          <p className="mt-1.5 text-xs text-slate-500">
            Original customer request: {formatDate(job.requested_date)}
            {job.requested_time ? ` at ${formatTime(job.requested_time)}` : ""}
          </p>
        )}

        <label className="mt-3 block text-sm font-medium text-slate-700">Service type</label>
        <div className="mt-1 flex flex-col gap-1.5 sm:flex-row sm:gap-4">
          <div className="space-y-1.5 sm:flex-1">
            {serviceTypes.slice(3).map((s) => (
              <label key={s.key} className="flex items-center gap-1.5 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={selectedServiceTypeKeys.includes(s.key)}
                  onChange={() => toggleServiceType(s.key)}
                />
                {s.label}
              </label>
            ))}
          </div>
          <div className="space-y-1.5 sm:flex-1">
            {serviceTypes.slice(0, 3).map((s) => (
              <label key={s.key} className="flex items-center gap-1.5 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={selectedServiceTypeKeys.includes(s.key)}
                  onChange={() => toggleServiceType(s.key)}
                />
                {s.label}
              </label>
            ))}
            <label className="flex items-center gap-1.5 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={otherChecked}
                onChange={(e) => {
                  setOtherChecked(e.target.checked);
                  if (!e.target.checked) setCustomServiceType("");
                }}
              />
              <input
                type="text"
                value={customServiceType}
                onChange={(e) => {
                  setCustomServiceType(e.target.value);
                  if (e.target.value.trim() !== "") setOtherChecked(true);
                }}
                className="w-full min-w-0 border-b border-slate-300 bg-transparent text-sm focus:outline-none sm:w-40"
              />
            </label>
          </div>
        </div>

        <label className="mt-3 block text-sm font-medium text-slate-700">Scope of Work</label>
        <textarea
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          rows={2}
          value={scopeOfWork}
          onChange={(e) => setScopeOfWork(e.target.value)}
        />

        <label className="mt-3 block text-sm font-medium text-slate-700">Job site contact</label>
        <div className="mt-1 flex gap-2">
          <div className="w-0 flex-1">
            {/* Plain text, not ComboboxInput — the job site contact is the
                homeowner, essentially never one of the company/individual
                contacts already on file, so suggesting matches from that
                list is just noise here. */}
            <input
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100 disabled:text-slate-500"
              value={siteContactName}
              onChange={(e) => setSiteContactName(e.target.value)}
              placeholder="Name"
              disabled={siteContactSameAsContact}
            />
          </div>
          <div className="w-0 flex-1">
            <input
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100 disabled:text-slate-500"
              placeholder="Phone"
              value={siteContactPhone}
              disabled={siteContactSameAsContact}
              onChange={(e) => setSiteContactPhone(formatPhoneInput(e.target.value))}
            />
          </div>
        </div>
        <label className="mt-2 flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={siteContactSameAsContact}
            onChange={(e) => {
              const checked = e.target.checked;
              setSiteContactSameAsContact(checked);
              if (!checked) {
                setSiteContactName("");
                setSiteContactPhone("");
              }
            }}
          />
          {companyName.trim() ? "Company contact" : "Customer contact"} is also job site contact
        </label>

        <label className="mt-3 block text-sm font-medium text-slate-700">{companyName.trim() ? "Company contact" : "Customer contact"}</label>
        <div className="mt-1 flex gap-2">
          <div className="w-0 flex-1">
            <ComboboxInput
              value={contactName}
              onChange={(v) => { setContactName(v); setEmail(""); setPhone(""); setCustomerId(""); }}
              fetchOptions={searchContacts}
              getLabel={(c) => c.name}
              getSublabel={(c) => c.email}
              onSelect={selectContact}
              placeholder="Name"
            />
          </div>
          <div className="w-0 flex-1">
            <input
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="Phone"
              value={phone}
              onChange={(e) => setPhone(formatPhoneInput(e.target.value))}
            />
          </div>
        </div>

        <label className="mt-3 block text-sm font-medium text-slate-700">Email results to:</label>
        <div className="mt-1 space-y-1.5">
          <div className="flex gap-1.5">
            <input
              type="email"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-white disabled:text-slate-800 disabled:opacity-100"
              placeholder="Email"
              value={email}
              disabled
              title="Always the customer contact's own email — edit it above."
            />
            <button
              type="button"
              onClick={() => setAdditionalReportEmails((emails) => [...emails, ""])}
              className="w-9 shrink-0 rounded-lg border border-slate-300 text-sm text-slate-500"
            >
              +
            </button>
          </div>
          {additionalReportEmails.map((addr, i) => (
            <div key={i} className="flex gap-1.5">
              <input
                type="email"
                list="report-email-suggestions"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={addr}
                onChange={(e) => {
                  const next = e.target.value;
                  setAdditionalReportEmails((emails) => emails.map((v, j) => (j === i ? next : v)));
                }}
              />
              <button
                type="button"
                onClick={() => setAdditionalReportEmails((emails) => [...emails, ""])}
                className="w-9 shrink-0 rounded-lg border border-slate-300 text-sm text-slate-500"
              >
                +
              </button>
              <button
                type="button"
                onClick={() => setAdditionalReportEmails((emails) => emails.filter((_, j) => j !== i))}
                className="w-9 shrink-0 rounded-lg border border-slate-300 text-sm text-slate-500"
              >
                ✕
              </button>
            </div>
          ))}
          <datalist id="report-email-suggestions">
            {companyContacts.filter((c) => c.email).map((c) => (
              <option key={c.id} value={c.email}>{c.name}</option>
            ))}
          </datalist>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <label className="w-32 shrink-0 text-sm font-medium text-slate-700">Payment Due Date</label>
          <input
            type="date"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
        </div>

        <label className="mt-3 block text-sm font-medium text-slate-700">Notes</label>
        <textarea className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />

        <label className="mt-3 block text-sm font-medium text-slate-700">Payment type</label>
        <select
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          value={paymentType}
          onChange={(e) => setPaymentType(e.target.value as "online" | "check")}
        >
          <option value="online">Stripe</option>
          <option value="check">Check</option>
        </select>
        {paymentType === "check" && (
          <p className="mt-1 text-xs text-slate-500">No Stripe invoice or pay-now link will be created automatically for this project.</p>
        )}

        {/* Per Tim, 2026-08-27 — going back to sample more at a site
            already inspected (his own "26-0002.1" numbering for a revisit
            to 26-0002) never carries its own base fee. Only shown for a
            project number that's actually using that ".1" convention — a
            regular job's own Edit dialog stays exactly the size/layout it
            always was, this row never appears there at all. */}
        {projectNumber.includes(".") && (
          <label className="mt-3 flex items-center gap-2 text-sm font-medium text-slate-700">
            <input type="checkbox" checked={isRevisit} onChange={(e) => setIsRevisit(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
            Revisit — no base fee
          </label>
        )}

        <div className="mt-4 flex items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <button onClick={onClose} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white">
              Done
            </button>
            <span className="text-xs text-slate-500">
              {submitting ? "Saving…" : justSaved ? "Saved" : ""}
            </span>
          </div>
          <button
            onClick={() => setConfirmingDelete(true)}
            aria-label="Delete project"
            className="rounded-lg p-2 text-lg hover:bg-red-50"
          >
            🗑️
          </button>
        </div>
        </div>
      </div>
    </div>
    {confirmingDelete && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
        <div className="w-full max-w-sm rounded-xl bg-white p-5">
          <h3 className="font-semibold text-slate-800">Delete this project?</h3>
          <p className="mt-2 text-sm text-slate-600">
            This action is permanent. Are you sure you want to delete this project?
          </p>
          {deleteError && <p className="mt-2 text-sm text-red-600">{deleteError}</p>}
          <div className="mt-4 flex gap-2">
            <button
              onClick={deleteProject}
              disabled={deleting}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
            >
              {deleting ? "DELETING…" : "DELETE"}
            </button>
            <button
              onClick={() => setConfirmingDelete(false)}
              disabled={deleting}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}

interface LineItemRowState {
  description: string;
  quantity: string;
  billingUnit: string;
  unitCost: string;
}

// Options for the sample-row description "▾" menu. These are the actual
// lab analysis methods samples get billed under (matching
// sampleDescriptionForServiceType in @/lib/invoice-defaults) — distinct
// from the job's service types, which describe the inspection, not what
// the lab does with the samples it collects.
const SAMPLE_TYPE_OPTIONS = [
  "Bulk Samples for Asbestos Analysis by PLM",
  "Bulk Samples for Total Lead Analysis",
  "Air-O-Cell Samples for Mold Analysis",
  "Swab Samples for Mold Analysis",
  "Bulk Samples for Mold Analysis",
];

// Builds the invoice's starting point from the shared computation in
// @/lib/invoice-defaults (also used server-side by the Gmail lab-results
// pipeline, so both paths price identically), converted to this editor's
// string-based row state. Still just a starting point: every row here
// lands in the same editable LineItemsEditor as a hand-typed one.
function defaultLineItems(
  job: JobWithCustomer,
  serviceTypeSettings: ServiceType[] = [],
  pricingZones: PricingZone[] = []
): LineItemRowState[] {
  // Once the admin has actually typed over a line item (invoice_auto ===
  // false), the stored array is authoritative and must never be silently
  // recomputed out from under them. Until then — including every autosave
  // of a still-untouched default — this keeps recomputing fresh from the
  // job's current data every time, so it stays live as lab paperwork comes
  // in instead of freezing at whatever the very first save happened to be.
  if (job.invoice_auto === false && job.invoice_line_items && job.invoice_line_items.length > 0) {
    return job.invoice_line_items.map((li) => ({
      description: li.description,
      quantity: String(li.quantity),
      billingUnit: li.billing_unit,
      unitCost: (li.unit_cost_cents / 100).toFixed(2),
    }));
  }

  const rows = defaultInvoiceLineItems(job, serviceTypeSettings, pricingZones).map((li) => ({
    description: li.description,
    quantity: String(li.quantity),
    billingUnit: li.billing_unit,
    unitCost: (li.unit_cost_cents / 100).toFixed(2),
  }));

  return rows.length > 0 ? rows : [{ description: "", quantity: "1", billingUnit: "Each", unitCost: "" }];
}

// One row per homogeneous material for a full-inspection (Pre-Renovation/
// Pre-Demolition) asbestos job — drives the report's Appendix A (is_acm
// true) / Appendix B (false) tables. Same flat add/update/remove
// immutable-array pattern as LineItemsEditor below, simpler since there's
// no auto-recompute default to manage — the parent always saves whatever's
// here (see JobsDashboard's fullInspectionMaterials debounce effect).
function MaterialsEditor({
  items, setItems,
}: {
  items: FullInspectionMaterial[];
  setItems: Dispatch<SetStateAction<FullInspectionMaterial[]>>;
}) {
  function update(i: number, patch: Partial<FullInspectionMaterial>) {
    setItems((rows) => rows.map((r, idx) => (idx !== i ? r : { ...r, ...patch })));
  }
  function updateLocation(i: number, locIdx: number, value: string) {
    setItems((rows) =>
      rows.map((r, idx) => {
        if (idx !== i) return r;
        const locations = [...r.locations];
        locations[locIdx] = value;
        return { ...r, locations };
      })
    );
  }
  function add() {
    setItems((rows) => [...rows, { material: "", is_acm: false, locations: ["", "", ""], sample_numbers: "", estimated_quantity: null }]);
  }
  function remove(i: number) {
    setItems((rows) => rows.filter((_, idx) => idx !== i));
  }

  return (
    <div className="mt-2 space-y-3">
      {items.map((row, i) => (
        <div key={i} className="rounded-lg border border-slate-200 p-2">
          <div className="flex items-start gap-2">
            <input
              className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              placeholder="Material"
              value={row.material}
              onChange={(e) => update(i, { material: e.target.value })}
            />
            <label className="flex shrink-0 items-center gap-1.5 whitespace-nowrap px-1 py-1.5 text-xs font-medium text-slate-600">
              <input
                type="checkbox"
                checked={row.is_acm}
                onChange={(e) => update(i, { is_acm: e.target.checked, estimated_quantity: e.target.checked ? row.estimated_quantity : null })}
              />
              ACM
            </label>
            {items.length > 1 && (
              <button onClick={() => remove(i)} className="shrink-0 text-sm text-red-600">
                Delete
              </button>
            )}
          </div>
          <div className="mt-1.5 grid grid-cols-1 gap-1.5 sm:grid-cols-3">
            <input
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              placeholder="Location A"
              value={row.locations[0] ?? ""}
              onChange={(e) => updateLocation(i, 0, e.target.value)}
            />
            <input
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              placeholder="Location B"
              value={row.locations[1] ?? ""}
              onChange={(e) => updateLocation(i, 1, e.target.value)}
            />
            <input
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              placeholder="Location C"
              value={row.locations[2] ?? ""}
              onChange={(e) => updateLocation(i, 2, e.target.value)}
            />
          </div>
          <div className="mt-1.5 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            <input
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              placeholder="Sample #('s)"
              value={row.sample_numbers}
              onChange={(e) => update(i, { sample_numbers: e.target.value })}
            />
            {row.is_acm && (
              <input
                className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                placeholder="Estimated quantity"
                value={row.estimated_quantity ?? ""}
                onChange={(e) => update(i, { estimated_quantity: e.target.value })}
              />
            )}
          </div>
        </div>
      ))}
      <button onClick={add} className="text-sm text-brand-600 hover:underline">
        + Material
      </button>
    </div>
  );
}

function LineItemsEditor({
  items, setItems, serviceTypeSettings, paymentDueDate, onPaymentDueDateChange, labCostCents, stripeFeeCents,
}: {
  items: LineItemRowState[];
  setItems: Dispatch<SetStateAction<LineItemRowState[]>>;
  serviceTypeSettings: ServiceType[];
  /** Rendered inline on the same row as the total and the +Custom Line Item/+Samples links, rather than its own separate row — the admin wanted it directly in line with those, not stacked below. */
  paymentDueDate: string;
  onPaymentDueDateChange: (value: string) => void;
  /** Per Tim, 2026-08-27 — what the lab actually billed this job (extracted
      from the lab's own invoice, see lab_cost_cents on Job), shown right
      under the invoice total so the margin (what's charged minus what the
      lab charges) is visible at a glance without doing the math by hand. */
  labCostCents: number | null;
  /** Per Tim, 2026-08-28 — the real Stripe processing fee (see stripe_fee_cents
      on Job), factored into Profit below once the invoice is actually paid
      through Stripe. Null for a job paid by hand or not yet paid, in which
      case Profit just doesn't deduct a fee that was never charged. */
  stripeFeeCents: number | null;
}) {
  function update(i: number, patch: Partial<LineItemRowState>) {
    setItems((rows) =>
      rows.map((r, idx) => {
        if (idx !== i) return r;
        const next = { ...r, ...patch };
        // This lab's PLM bulk-asbestos rate never varies — fill it in the
        // moment the description matches, same as the auto-populated rows,
        // rather than leaving the admin to remember and type $25 by hand.
        if (patch.description === "Bulk Samples for Asbestos Analysis by PLM" && !r.unitCost.trim()) {
          next.unitCost = "25.00";
        }
        return next;
      })
    );
  }
  function add(description = "") {
    setItems((rows) => [...rows, { description, quantity: "1", billingUnit: "Each", unitCost: "" }]);
  }
  function addSample() {
    setItems((rows) => [...rows, { description: "", quantity: "1", billingUnit: "Sample", unitCost: "" }]);
  }
  function remove(i: number) {
    setItems((rows) => rows.filter((_, idx) => idx !== i));
  }

  const [descriptionMenuFor, setDescriptionMenuFor] = useState<number | null>(null);
  const [totalDraft, setTotalDraft] = useState<Record<number, string>>({});

  const rowTotal = (r: LineItemRowState) => {
    const qty = Number(r.quantity);
    const cost = Number(r.unitCost);
    return Number.isFinite(qty) && Number.isFinite(cost) ? qty * cost : 0;
  };
  const currency = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

  const total = items.reduce((sum, r) => sum + rowTotal(r), 0);

  function formatCostOnBlur(i: number, raw: string) {
    const n = Number(raw);
    if (raw.trim() && Number.isFinite(n)) update(i, { unitCost: n.toFixed(2) });
  }

  // The total is normally just quantity × unit cost, but a job's actual
  // invoice total sometimes needs to be typed in directly (a rounded quote,
  // a negotiated price) rather than back-computed from a per-sample rate.
  // Editing it here back-derives the unit cost so the stored line item
  // (quantity + unit_cost_cents) still reproduces this exact total.
  function handleTotalBlur(i: number, raw: string) {
    setTotalDraft((d) => {
      const next = { ...d };
      delete next[i];
      return next;
    });
    const totalNum = Number(raw);
    if (!raw.trim() || !Number.isFinite(totalNum)) return;
    const qty = Number(items[i].quantity) || 1;
    update(i, { unitCost: (totalNum / qty).toFixed(2) });
  }

  const baseFeeRows = items.map((r, i) => ({ r, i })).filter(({ r }) => r.billingUnit === "Base Fee");
  const sampleRows = items.map((r, i) => ({ r, i })).filter(({ r }) => r.billingUnit === "Sample");
  const otherRows = items.map((r, i) => ({ r, i })).filter(({ r }) => r.billingUnit !== "Base Fee" && r.billingUnit !== "Sample");

  return (
    <div className="mt-1 space-y-4">
      {baseFeeRows.map(({ r: row, i }) => (
        <div key={i}>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Base Fee</h4>
          <textarea
            rows={1}
            ref={(el) => {
              // Grows to fit the actual content — a long description like
              // "Licensed Asbestos Inspector (Limited Asbestos Inspection,
              // Mold Air Sampling, Mold Bulk Sampling)" wraps to more than
              // one line even with no literal newline in it, and a fixed
              // row count was clipping the wrapped line instead of showing
              // it. Re-runs every render (inline ref = new identity each
              // time), which is exactly when the content might have changed.
              if (!el) return;
              el.style.height = "auto";
              el.style.height = `${el.scrollHeight}px`;
            }}
            className="mt-0.5 w-full resize-none overflow-hidden rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            placeholder="Description"
            value={row.description}
            onChange={(e) => update(i, { description: e.target.value })}
          />
          <div className="mt-1 flex items-center gap-2">
            <div className="relative flex-1">
              <span className="pointer-events-none absolute inset-y-0 left-2 flex items-center text-sm text-slate-400">$</span>
              <input
                type="number"
                className="w-full rounded-lg border border-slate-300 py-1.5 pl-5 pr-2 text-sm"
                placeholder="0.00"
                value={row.unitCost}
                onChange={(e) => update(i, { unitCost: e.target.value })}
                onBlur={(e) => formatCostOnBlur(i, e.target.value)}
              />
            </div>
            {items.length > 1 && (
              <button onClick={() => remove(i)} className="shrink-0 text-sm text-red-600">
                Delete
              </button>
            )}
          </div>
        </div>
      ))}

      {sampleRows.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Samples</h4>
          <div className="mt-1 space-y-2">
            {sampleRows.map(({ r: row, i }) => (
              <div key={i} className="flex items-stretch gap-2">
                <div className="flex-1 space-y-1">
                  <input
                    className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                    placeholder="Description"
                    value={row.description}
                    onChange={(e) => update(i, { description: e.target.value })}
                  />
                  {descriptionMenuFor === i && (
                    <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
                      {SAMPLE_TYPE_OPTIONS.map((label) => (
                        <button
                          key={label}
                          type="button"
                          onClick={() => {
                            update(i, { description: label });
                            setDescriptionMenuFor(null);
                          }}
                          className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-slate-50"
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      className="w-16 rounded-lg border border-slate-300 px-2 py-1.5 text-center text-sm"
                      placeholder="#"
                      value={row.quantity}
                      onChange={(e) => update(i, { quantity: e.target.value })}
                    />
                    <span className="shrink-0 text-sm text-slate-600">samples at</span>
                    <div className="relative w-24 shrink-0">
                      <span className="pointer-events-none absolute inset-y-0 left-2 flex items-center text-sm text-slate-400">$</span>
                      <input
                        type="number"
                        className="w-full rounded-lg border border-slate-300 py-1.5 pl-5 pr-2 text-center text-sm"
                        placeholder="0.00"
                        value={row.unitCost}
                        onChange={(e) => update(i, { unitCost: e.target.value })}
                        onBlur={(e) => formatCostOnBlur(i, e.target.value)}
                      />
                    </div>
                    <span className="shrink-0 text-sm text-slate-600">each</span>
                    <span className="shrink-0 text-sm text-slate-500">=</span>
                    <div className="relative w-24 shrink-0">
                      <span className="pointer-events-none absolute inset-y-0 left-2 flex items-center text-sm text-slate-400">$</span>
                      <input
                        type="number"
                        className="w-full rounded-lg border border-slate-300 py-1.5 pl-5 pr-2 text-center text-sm"
                        placeholder="0.00"
                        value={totalDraft[i] !== undefined ? totalDraft[i] : rowTotal(row).toFixed(2)}
                        onChange={(e) => setTotalDraft((d) => ({ ...d, [i]: e.target.value }))}
                        onBlur={(e) => handleTotalBlur(i, e.target.value)}
                      />
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 flex-col gap-1">
                  <button
                    type="button"
                    onClick={() => setDescriptionMenuFor((cur) => (cur === i ? null : i))}
                    className="w-9 rounded-lg border border-slate-300 bg-slate-200 px-2 py-1.5 text-sm text-slate-500"
                  >
                    ▾
                  </button>
                  {items.length > 1 && (
                    <div className="flex flex-1 items-center justify-center">
                      <button onClick={() => remove(i)} className="text-sm text-red-600">
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {otherRows.map(({ r: row, i }) => (
        <div key={i}>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Custom Line Item</h4>
          <div className="mt-0.5 flex items-center gap-2">
            <input
              className="flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              placeholder="Description"
              value={row.description}
              onChange={(e) => update(i, { description: e.target.value })}
            />
            <button
              type="button"
              onClick={() => setDescriptionMenuFor((cur) => (cur === i ? null : i))}
              className="w-9 shrink-0 rounded-lg border border-slate-300 bg-slate-200 px-2 py-1.5 text-sm text-slate-500"
            >
              ▾
            </button>
          </div>
          {descriptionMenuFor === i && (
            <div className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
              {serviceTypeSettings.map((t) => (
                <button
                  key={t.label}
                  type="button"
                  onClick={() => {
                    update(i, { description: t.label });
                    setDescriptionMenuFor(null);
                  }}
                  className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-slate-50"
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}
          <div className="mt-1 flex items-center gap-2">
            <div className="relative flex-1">
              <span className="pointer-events-none absolute inset-y-0 left-2 flex items-center text-sm text-slate-400">$</span>
              <input
                type="number"
                className="w-full rounded-lg border border-slate-300 py-1.5 pl-5 pr-2 text-sm"
                placeholder="0.00"
                value={row.unitCost}
                onChange={(e) => update(i, { unitCost: e.target.value })}
                onBlur={(e) => formatCostOnBlur(i, e.target.value)}
              />
            </div>
            {items.length > 1 && (
              <button onClick={() => remove(i)} className="shrink-0 text-sm text-red-600">
                Delete
              </button>
            )}
          </div>
        </div>
      ))}

      <div className="flex gap-3">
        <button onClick={() => add()} className="text-sm text-brand-600 hover:underline">
          + Custom Line Item
        </button>
        <button onClick={() => addSample()} className="text-sm text-brand-600 hover:underline">
          + Samples
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-base font-bold uppercase text-emerald-600">Invoice total: {currency(total)}</p>
          <p className="text-base font-bold uppercase text-red-600">
            Lab fees: {labCostCents != null ? currency(labCostCents / 100) : "Not yet billed"}
          </p>
          <p className="text-base font-bold uppercase text-slate-400">
            Profit: {labCostCents != null ? currency(total - labCostCents / 100 - (stripeFeeCents ?? 0) / 100) : "—"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="whitespace-nowrap text-xs font-semibold uppercase tracking-wide text-slate-400">Payment due date</label>
          <input
            type="date"
            className="w-auto rounded border border-slate-300 px-1.5 py-0.5 text-sm"
            value={paymentDueDate}
            onChange={(e) => onPaymentDueDateChange(e.target.value)}
          />
        </div>
      </div>
    </div>
  );
}
