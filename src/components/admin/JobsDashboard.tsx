"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import type { Company, Customer, InvoiceLineItem, JobDocument, JobWithCustomer, LabProfile, PricingZone, SampleItem, ServiceType } from "@/lib/types";
import { defaultInvoiceLineItems, sampleDescriptionForServiceType } from "@/lib/invoice-defaults";
import { ASBESTOS_NEGATIVE_REMARK, ASBESTOS_POSITIVE_REMARK, LEAD_NEGATIVE_REMARK, LEAD_POSITIVE_REMARK } from "@/lib/report-findings";
import { splitAddress, parseAddressToFields, buildBillingAddress, googleMapsUrl } from "@/lib/address";
import { joinName, splitFullName } from "@/lib/name";
import type { AddressFields } from "@/lib/address";
import AddressAutocompleteInput from "@/components/shared/AddressAutocompleteInput";
import PdfPreview from "@/components/shared/PdfPreview";
import JobChat from "@/components/shared/JobChat";
import JobPhotos from "@/components/shared/JobPhotos";
import { AcceptScheduleControl } from "@/components/admin/AcceptScheduleControl";

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
// options) but kept in STATUS_LABEL/STATUS_COLOR so any old row still
// renders correctly.
const PIPELINE_STATUSES = [
  "needs_scheduling",
  "scheduled",
  "pending_lab_results",
  "ready_to_send",
  "paid",
  "cancelled",
] as const;

// The linear progression shown as a horizontal tracker on a project's detail
// dialog — "cancelled" is excluded since it's an exception path, not a step.
const TRACKER_STATUSES = ["needs_scheduling", "scheduled", "pending_lab_results", "ready_to_send", "paid"] as const;

// The tracker's own segment list — same real, clickable job.status steps as
// TRACKER_STATUSES, with one extra "sent" segment spliced in between
// ready_to_send and paid. "Sent" isn't a real job.status (there's no manual
// "mark as sent" — invoice_sent_at is only ever set automatically, inferred
// from Gmail itself, see draft-status/route.ts), so it's rendered as a
// non-clickable, informational segment rather than a status button.
type TrackerSegment = {
  key: string;
  label: React.ReactNode;
  status?: (typeof TRACKER_STATUSES)[number];
  done: (job: JobWithCustomer, currentIndex: number) => boolean;
};
const TRACKER_SEGMENTS: TrackerSegment[] = [
  { key: "needs_scheduling", label: <>To Be<br />Scheduled</>, status: "needs_scheduling", done: (_job, i) => i >= 0 },
  { key: "scheduled", label: "Scheduled", status: "scheduled", done: (_job, i) => i >= 1 },
  { key: "pending_lab_results", label: <>Pending<br />Lab Results</>, status: "pending_lab_results", done: (_job, i) => i >= 2 },
  { key: "ready_to_send", label: <>Report and<br />Invoice Ready</>, status: "ready_to_send", done: (_job, i) => i >= 3 },
  { key: "sent", label: <>Report and<br />Invoice Sent</>, done: (job, i) => (Boolean(job.invoice_sent_at) && Boolean(job.report_sent_at)) || i >= 4 },
  { key: "paid", label: "Paid", status: "paid", done: (_job, i) => i >= 4 },
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
  paid: "Paid",
  cancelled: "Cancelled",
};

const STATUS_COLOR: Record<string, string> = {
  needs_scheduling: "bg-slate-200 text-slate-700",
  scheduled: "bg-blue-100 text-blue-700",
  fieldwork_in_progress: "bg-indigo-100 text-indigo-700",
  awaiting_lab_results: "bg-purple-100 text-purple-700",
  needs_report: "bg-orange-100 text-orange-700",
  pending_lab_results: "bg-purple-100 text-purple-700",
  completed: "bg-teal-100 text-teal-700",
  invoiced: "bg-amber-100 text-amber-700",
  ready_to_send: "bg-amber-100 text-amber-700",
  paid: "bg-emerald-100 text-emerald-700",
  cancelled: "bg-red-100 text-red-700",
};

// Solid dot color matching each STATUS_COLOR's hue, for the status filter
// checklist — reinforces the same color coding used on the pills.
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

// Shared by the Final Report tab's invoice and report status lines (see
// useDraftTracking) — rawDraftedAt/rawSentAt are the job's own stored
// columns, `live` is the draft-status route's fresh Gmail check.
function draftStatusText(
  rawDraftedAt: string | null,
  rawSentAt: string | null,
  live: { status: "drafted" | "sent" | "none"; sentAt?: string } | null,
  notCreatedLabel: string,
  notInGmailLabel: string
): string {
  if (rawSentAt) return `Sent ${formatDateTime(rawSentAt)}`;
  if (!rawDraftedAt) return notCreatedLabel;
  if (live === null) return "Checking Gmail…";
  if (live.status === "sent") return `Sent ${formatDateTime(live.sentAt ?? new Date().toISOString())}`;
  if (live.status === "drafted") return `Draft created ${formatDateTime(rawDraftedAt)} — not yet sent`;
  return notInGmailLabel;
}

// Deep-links straight to this exact draft/message in the Gmail web UI
// instead of just the inbox — /u/0/ assumes the connected account is the
// browser's first signed-in Google account, true for the common single-
// account case this is built for. Opens in a new tab; Gmail can't be
// embedded (Google blocks framing mail.google.com).
function gmailMessageUrl(messageId: string, sent: boolean): string {
  return `https://mail.google.com/mail/u/0/#${sent ? "sent" : "drafts"}/${messageId}`;
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
// this to show it the way the rest of the US-facing app (native date
// inputs, PDFs) already does.
export function formatDate(date: string | null | undefined): string {
  if (!date) return "";
  const [y, m, d] = date.split("-");
  if (!y || !m || !d) return date;
  return `${m}/${d}/${y}`;
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

// "What needs attention" — open until paid (or cancelled). A job sitting at
// "ready_to_send" still needs attention (chasing payment), so it counts as open.
const OPEN_STATUSES = new Set(["needs_scheduling", "scheduled", "fieldwork_in_progress", "awaiting_lab_results", "needs_report", "pending_lab_results", "completed", "invoiced", "ready_to_send"]);
const CLOSED_STATUSES = new Set(["paid", "cancelled"]);
// Schedule/notes stay editable for any job that isn't closed out yet.
const EDITABLE_STATUSES = OPEN_STATUSES;

function formatCents(cents: number | null): string {
  if (cents == null) return "—";
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

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

// Positive only once money is actually owed and sitting past its due date —
// "ready_to_send" is the one status that means "billed, not yet paid" (paid/
// cancelled/anything earlier in the pipeline never counts, no matter how old
// the due date is).
function daysOverdue(job: JobWithCustomer): number | null {
  if (job.status !== "ready_to_send") return null;
  const due = job.payment_due_date || paymentDueDate(job.requested_date ?? "");
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
// Mold labs (e.g. EMSL's AIHA LAP/EMLAP accreditation) don't carry a MassDLS
// cert at all — that's asbestos/MA-DLS-specific — and mold results are a
// pasted Discussion of Results (report_summary), not the asbestos_result
// field. See MoldReportDocument in lib/report-pdf.tsx.
function isMoldJob(job: JobWithCustomer): boolean {
  return (job.service_type ?? "").toLowerCase().includes("mold");
}

// Lead labs (SanAir/Crystal Analytical) carry an AIHA cert, not MassDLS —
// same reasoning as mold above. Lead does have its own positive/negative
// result, just in its own field (lead_result) rather than asbestos_result.
// See LeadReportDocument in lib/report-pdf.tsx.
function isLeadJob(job: JobWithCustomer): boolean {
  return (job.service_type ?? "").toLowerCase().includes("lead");
}

function reportChecklist(job: JobWithCustomer): { label: string; done: boolean }[] {
  const totalSamples = Object.values(job.sample_counts ?? {}).reduce((sum, n) => sum + (n || 0), 0) || job.sample_count || 0;
  const mold = isMoldJob(job);
  const lead = isLeadJob(job);
  return [
    { label: "Customer", done: Boolean(job.customers?.name && job.customers.name !== "Unknown contact") },
    { label: "Billing address", done: Boolean(job.customers?.billing_address) },
    { label: "Job site address", done: Boolean(job.service_address) },
    { label: "Project #", done: Boolean(job.project_number) },
    { label: "Date", done: Boolean(job.requested_date) },
    { label: "Sample count", done: totalSamples > 0 },
    { label: "Lab info", done: Boolean(job.lab_name && job.lab_nist_cert && (mold || lead || job.lab_massdls_cert)) },
    { label: "Results", done: mold ? Boolean(job.report_summary) : lead ? Boolean(job.lead_result) : Boolean(job.asbestos_result) },
  ];
}

export function reportIsComplete(job: JobWithCustomer): boolean {
  return reportChecklist(job).every((item) => item.done);
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
  const [sortBy, setSortBy] = useState<SortField>("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [sortEnabled, setSortEnabled] = useState(false);
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
  // Not just status === "ready_to_send" — that can be set by hand without the
  // report/invoice actually being drafted yet. This banner is specifically
  // "there's a finished draft sitting here to review and send," so it also
  // requires both drafts to actually exist.
  const readyToSendJobs = useMemo(
    () => jobs.filter((j) => j.status === "ready_to_send" && j.report_drafted_at != null && j.invoice_drafted_at != null),
    [jobs]
  );

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
    return result;
  }, [jobs, statusView, statusFilter, serviceTypeFilter, projectNumberQuery, companyQuery, addressQuery, dateQuery]);

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
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold uppercase text-slate-800">Projects</h1>
        <div className="flex gap-2">
          <button
            onClick={() => setAddingProject(true)}
            className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-bold text-white"
          >
            ADD PROJECT
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          onClick={() => selectStatusView("all")}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium uppercase ${statusFilter.size === 0 && statusView === "all" ? "text-brand-700 underline" : "text-slate-600 hover:underline"}`}
        >
          All Projects
        </button>
        <button
          onClick={() => selectStatusView("open")}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium uppercase ${statusFilter.size === 0 && statusView === "open" ? "text-brand-700 underline" : "text-slate-600 hover:underline"}`}
        >
          Open Projects
        </button>
        <button
          onClick={() => selectStatusView("closed")}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium uppercase ${statusFilter.size === 0 && statusView === "closed" ? "text-brand-700 underline" : "text-slate-600 hover:underline"}`}
        >
          Closed Projects
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

      {readyToSendJobs.length > 0 && (
        <button
          onClick={() => selectStatusFilter("ready_to_send")}
          className="mt-3 flex w-full items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-left text-sm font-medium text-blue-700"
        >
          📄 {readyToSendJobs.length} report{readyToSendJobs.length === 1 ? "" : "s"} ready to send
        </button>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium uppercase text-slate-500">Sort by:</span>
        {SORT_FIELDS.map((f) => (
          <button
            key={f.key}
            onClick={() => toggleSort(f.key)}
            className={`rounded-lg px-2.5 py-1 text-sm font-medium uppercase ${sortEnabled && sortBy === f.key ? "bg-slate-700 text-white" : "bg-slate-100 text-slate-600"}`}
          >
            {f.label}{sortEnabled && sortBy === f.key ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
          </button>
        ))}
        <div
          className="relative"
          onMouseEnter={openStatusFilter}
          onMouseLeave={closeStatusFilter}
        >
          <button
            className={`rounded-lg px-2.5 py-1 text-sm font-medium uppercase ${statusFilter.size > 0 ? "bg-slate-700 text-white" : "bg-slate-100 text-slate-600"}`}
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
          className="relative"
          onMouseEnter={openServiceTypeFilter}
          onMouseLeave={closeServiceTypeFilter}
        >
          <button
            className={`rounded-lg px-2.5 py-1 text-sm font-medium uppercase ${serviceTypeFilter.size > 0 ? "bg-slate-700 text-white" : "bg-slate-100 text-slate-600"}`}
          >
            Service Type{serviceTypeFilter.size > 0 ? ` (${serviceTypeFilter.size})` : ""} ▾
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
          <button onClick={clearAllFilters} className="rounded-lg px-2.5 py-1 text-xs font-normal text-brand-600 underline">
            Clear filters
          </button>
        )}
      </div>

      <div className="mt-4 flex flex-nowrap items-center gap-2">
        <span className="shrink-0 text-sm font-medium uppercase text-slate-500">Search by:</span>
        <input
          value={projectNumberQuery}
          onChange={(e) => setProjectNumberQuery(e.target.value)}
          placeholder="Project #"
          className="w-0 min-w-0 flex-1 rounded-lg border border-slate-300 px-2.5 py-1 text-sm uppercase placeholder:uppercase"
        />
        <input
          value={companyQuery}
          onChange={(e) => setCompanyQuery(e.target.value)}
          placeholder="Company"
          className="w-0 min-w-0 flex-1 rounded-lg border border-slate-300 px-2.5 py-1 text-sm uppercase placeholder:uppercase"
        />
        <input
          value={addressQuery}
          onChange={(e) => setAddressQuery(e.target.value)}
          placeholder="Address"
          className="w-0 min-w-0 flex-1 rounded-lg border border-slate-300 px-2.5 py-1 text-sm uppercase placeholder:uppercase"
        />
        <input
          type="date"
          value={dateQuery}
          onChange={(e) => setDateQuery(e.target.value)}
          className="w-36 shrink-0 rounded-lg border border-slate-300 px-2.5 py-1 text-sm uppercase"
        />
        {dateQuery && (
          <button onClick={() => setDateQuery("")} className="text-xs text-brand-600 underline">
            Clear date
          </button>
        )}
      </div>

      {error && <div className="mt-3 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

      {(() => {
        if (loading) return <p className="mt-4 text-sm text-slate-500">Loading…</p>;

        if (sortedJobs.length === 0) {
          return (
            <p className="mt-4 text-sm uppercase text-slate-500">
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
  job, onOpen, onOpenChat, onFieldChange,
}: {
  job: JobWithCustomer;
  onOpen: () => void;
  onOpenChat: () => void;
  onFieldChange: (patch: Record<string, unknown>) => void;
}) {
  const { locationName, street, cityStateZip } = splitAddress(job.service_address);
  // Blank while unscheduled rather than showing whatever placeholder date
  // came in with the job — the empty calendar/clock is the visual cue that
  // nothing's booked yet. Editing these just updates what was requested;
  // AcceptScheduleControl (below) is the only thing that promotes status.
  const isUnscheduled = job.status === "needs_scheduling";
  const overdueDays = daysOverdue(job);
  return (
    <div
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onOpen()}
      className="flex w-full cursor-pointer flex-col rounded-lg border border-slate-200 bg-white p-3 hover:border-brand-400"
    >
      <div className="flex w-full items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {job.project_number && (
            <span className="shrink-0 whitespace-nowrap rounded bg-slate-200 px-2 py-0.5 text-sm font-mono font-bold text-slate-800 hover:underline">{job.project_number}</span>
          )}
          <div className="whitespace-nowrap font-medium text-slate-800">{job.customers?.company || job.customers?.name}</div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {overdueDays !== null && (
            <span className="shrink-0 whitespace-nowrap rounded-full bg-red-600 px-2 py-1 text-xs font-bold text-white">
              {overdueDays} day{overdueDays === 1 ? "" : "s"} overdue
            </span>
          )}
          {CLOSED_STATUSES.has(job.status) ? (
            <span className={`shrink-0 whitespace-nowrap rounded px-2 py-0.5 text-sm font-bold uppercase ${STATUS_COLOR[job.status]}`}>
              {STATUS_LABEL[job.status]}
            </span>
          ) : (
            <select
              value={job.status}
              onChange={(e) => onFieldChange({ status: e.target.value })}
              onClick={(e) => e.stopPropagation()}
              className={`shrink-0 whitespace-nowrap rounded border-0 px-2 py-0.5 text-sm font-bold uppercase ${STATUS_COLOR[job.status]}`}
            >
              {PIPELINE_STATUSES.map((s) => (
                <option key={s} value={s}>{STATUS_LABEL[s]}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      <div className="text-sm text-slate-500">&nbsp;</div>

      <div className="flex w-full items-start gap-3">
        <div className="min-w-0 flex-[0.9]">
          {locationName && <div className="truncate whitespace-nowrap text-sm text-slate-500">{locationName}</div>}
          <div className="truncate whitespace-nowrap text-sm text-slate-500">{street}</div>
          {cityStateZip && <div className="truncate whitespace-nowrap text-sm text-slate-500">{cityStateZip}</div>}
        </div>

        <div className="min-w-0 flex-[1.2]">
          {(() => {
            const labels = (job.service_type ?? "").split(",").map((s) => s.trim()).filter(Boolean);
            return labels.map((label, i) => (
              <div key={i} className="whitespace-nowrap text-sm text-slate-500">
                {serviceTypeLabel(label)}{i < labels.length - 1 ? "," : ""}
              </div>
            ));
          })()}
        </div>

        <div className="flex min-w-0 flex-[0.9] justify-end">
          {CLOSED_STATUSES.has(job.status) ? (
            <div className="flex flex-col items-end gap-0.5 px-1.5 py-1 text-xs text-slate-500">
              <span>Date of Project: {formatDate(job.requested_date) || "—"}</span>
              <span>Date of Payment: {formatDate(job.paid_date) || "—"}</span>
              <span>Date Sent: {formatDateTime(job.report_sent_at) || "—"}</span>
            </div>
          ) : (
            <div className="flex shrink-0 flex-col items-end gap-1.5" onClick={(e) => e.stopPropagation()}>
              <input
                type="date"
                value={isUnscheduled ? "" : job.requested_date ?? ""}
                onChange={(e) => onFieldChange({ requested_date: e.target.value || null })}
                className="w-32 rounded-lg border border-slate-300 px-1.5 py-1 text-xs text-slate-600"
              />
              <div className="flex shrink-0 items-center gap-2">
                {isUnscheduled ? (
                  <AcceptScheduleControl job={job} variant="button" onAccept={onFieldChange} onOpenChat={onOpenChat} stopPropagation />
                ) : job.status === "scheduled" && job.confirmed_date && (
                  <label
                    className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs uppercase text-slate-600"
                    title="Off by default — the client's portal never shows a date/time until this is on. While on, it stays live-synced to the date/time above as you edit them."
                  >
                    <span>Show customer</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={!!job.schedule_visible_to_customer}
                      onClick={() => onFieldChange({ schedule_visible_to_customer: !job.schedule_visible_to_customer })}
                      className={`relative h-5 w-9 shrink-0 rounded-full transition ${job.schedule_visible_to_customer ? "bg-emerald-600" : "bg-slate-300"}`}
                    >
                      <span
                        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition ${job.schedule_visible_to_customer ? "left-4" : "left-0.5"}`}
                      />
                    </button>
                  </label>
                )}
                <input
                  type="time"
                  value={isUnscheduled ? "" : job.requested_time ?? ""}
                  onChange={(e) => onFieldChange({ requested_time: e.target.value || null })}
                  className="w-32 rounded-lg border border-slate-300 px-1.5 py-1 text-xs text-slate-600"
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DetailField({ label, value, nowrap }: { label: string; value: React.ReactNode; nowrap?: boolean }) {
  if (value == null || value === "" || (typeof value === "string" && !value.trim())) return null;
  return (
    <div className="flex gap-2 text-sm">
      <span className="w-32 shrink-0 uppercase font-bold text-black">{label}</span>
      <span className={`text-black ${nowrap ? "whitespace-nowrap" : ""}`}>{value}</span>
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
  const [confirmingRedraft, setConfirmingRedraft] = useState(false);
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

  // A draft still actually sitting in Gmail is exactly the case this exists
  // to avoid duplicating by accident, so that specific state gets a confirm
  // step — gated on the live status check, not just the stored
  // draftedAt/sentAt columns, since those only say a draft was created at
  // some point, not whether it's still there (the owner may have deleted it
  // from Gmail without sending, which the live check already caught).
  async function create(skipConfirm = false) {
    if (!skipConfirm && status?.status === "drafted") {
      setConfirmingRedraft(true);
      return;
    }
    setConfirmingRedraft(false);
    setCreating(true);
    setMessage(null);
    try {
      const res = await fetch(
        `/api/admin/jobs/${jobId}/create-draft?kind=${createKind}`,
        { method: "POST" }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create draft");
      setMessage("Draft created — check Gmail.");
      onChanged();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Failed to create draft");
    } finally {
      setCreating(false);
    }
  }

  return { creating, message, confirmingRedraft, setConfirmingRedraft, status, create };
}

export function ProjectDetailDialog({
  job, onClose, onChanged, onEdit, onStatusChange, initialTab,
}: {
  job: JobWithCustomer;
  onClose: () => void;
  onChanged: () => void;
  onEdit: () => void;
  onStatusChange: (status: string) => void;
  initialTab?: "info" | "report" | "chat" | "photos";
}) {
  const [tab, setTab] = useState<"info" | "report" | "chat" | "photos">(initialTab ?? "info");
  const [serviceTypeSettings, setServiceTypeSettings] = useState<ServiceType[]>([]);
  const [pricingZones, setPricingZones] = useState<PricingZone[]>([]);
  const [labs, setLabs] = useState<LabProfile[]>([]);
  const [reportSummaryInput, setReportSummaryInput] = useState(job.report_summary ?? "");
  const [reportNotesInput, setReportNotesInput] = useState(job.report_notes ?? "");
  // Editable, auto-populated versions of every item on the Final Report
  // tab's own checklist (reportChecklist) — lets the admin review and fix
  // any of it (an address typo, a wrong project #) right before generating
  // the report, without leaving this tab to find the field elsewhere.
  const [customerNameInput, setCustomerNameInput] = useState(job.customers?.name ?? "");
  const [billingAddressInput, setBillingAddressInput] = useState(job.customers?.billing_address ?? "");
  const [serviceAddressInput, setServiceAddressInput] = useState(job.service_address ?? "");
  const [projectNumberInput, setProjectNumberInput] = useState(job.project_number ?? "");
  const [requestedDateInput, setRequestedDateInput] = useState(job.requested_date ?? "");
  const combinedDraft = useDraftTracking({
    kind: "invoice",
    createKind: "combined",
    active: tab === "report",
    jobId: job.id,
    draftedAt: job.invoice_drafted_at,
    sentAt: job.invoice_sent_at,
    onChanged,
  });
  const [invoiceLineItems, setInvoiceLineItems] = useState<LineItemRowState[]>(() => defaultLineItems(job, serviceTypeSettings, pricingZones));
  const [savingInvoice, setSavingInvoice] = useState(false);
  const [showInvoicePreview, setShowInvoicePreview] = useState(false);
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

  async function setAsbestosResult(value: "positive" | "negative") {
    await fetch(`/api/admin/jobs/${job.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ asbestos_result: value }),
    });
    onChanged();
  }

  async function setLeadResult(value: "positive" | "negative") {
    await fetch(`/api/admin/jobs/${job.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lead_result: value }),
    });
    onChanged();
  }

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

  async function saveJobField(patch: Record<string, unknown>) {
    await fetch(`/api/admin/jobs/${job.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    onChanged();
  }

  // Customer name/billing address live on the customers row, not the job —
  // editing them here updates the same contact record shown on the
  // Contacts tab and every other one of their projects, same as editing
  // them via Edit Project would.
  async function saveCustomerField(patch: Record<string, unknown>) {
    if (!job.customer_id) return;
    await fetch(`/api/admin/customers/${job.customer_id}`, {
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
  async function selectLab(labName: string) {
    const lab = labs.find((l) => l.name === labName);
    await fetch(`/api/admin/jobs/${job.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lab_name: labName || null,
        lab_nist_cert: lab?.nist_cert || null,
        lab_massdls_cert: lab?.massdls_cert || null,
      }),
    });
    onChanged();
  }

  async function setSampleCountForType(label: string, count: number) {
    await fetch(`/api/admin/jobs/${job.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sample_counts: { ...(job.sample_counts ?? {}), [label]: count } }),
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
  useEffect(() => {
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

  const margin =
    job.invoice_total_cents != null && job.lab_cost_cents != null
      ? job.invoice_total_cents - job.lab_cost_cents
      : null;

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
    customer_id: job.customer_id,
  });
  // Simpler to just not render a report preview at all until every field
  // it needs is actually filled in, rather than showing a part-blank letter.
  const reportComplete = reportIsComplete(job);
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
      <div className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-xl bg-white p-5">
        <div className="flex items-center gap-1 border-b border-slate-200">
          <button
            onClick={() => setTab("info")}
            className={`whitespace-nowrap px-3 py-1.5 text-sm font-bold uppercase ${tab === "info" ? "border-b-2 border-brand-600 text-brand-700" : "text-slate-500 hover:text-slate-700"}`}
          >
            Project Info
          </button>
          <button
            onClick={() => setTab("report")}
            className={`whitespace-nowrap px-3 py-1.5 text-sm font-bold uppercase ${tab === "report" ? "border-b-2 border-brand-600 text-brand-700" : "text-slate-500 hover:text-slate-700"}`}
          >
            Report &amp; Invoice
          </button>
          <button
            onClick={() => setTab("chat")}
            className={`whitespace-nowrap px-3 py-1.5 text-sm font-bold uppercase ${tab === "chat" ? "border-b-2 border-brand-600 text-brand-700" : "text-slate-500 hover:text-slate-700"}`}
          >
            Chat
          </button>
          <button
            onClick={() => setTab("photos")}
            className={`whitespace-nowrap px-3 py-1.5 text-sm font-bold uppercase ${tab === "photos" ? "border-b-2 border-brand-600 text-brand-700" : "text-slate-500 hover:text-slate-700"}`}
          >
            Photos
          </button>
          <button onClick={onClose} className="ml-auto shrink-0 pl-2 text-slate-400 hover:text-slate-600">✕</button>
        </div>

        {tab === "info" && (
        <>
        <div className="mt-6 grid grid-cols-1 gap-y-4">
          <div className="space-y-2">
            <div className="flex items-start justify-between gap-2">
              <DetailField label="Project #" value={job.project_number} />
              <button onClick={onEdit} className="shrink-0 rounded-lg border border-slate-300 px-3.5 py-1.5 text-sm font-bold">
                Edit
              </button>
            </div>
            <DetailField label="Customer" value={job.customers?.company} nowrap />
            <DetailField
              label="Job site address"
              value={job.service_address ? (
                <a href={googleMapsUrl(job.service_address)} target="_blank" rel="noreferrer" className="hover:underline">
                  {job.service_address}
                </a>
              ) : null}
              nowrap
            />
            <DetailField
              label="Date"
              value={
                job.confirmed_date
                  ? formatDate(job.confirmed_date)
                  : job.requested_date
                  ? `${formatDate(job.requested_date)} (requested — not yet accepted)`
                  : "Unscheduled"
              }
            />
            <DetailField label="Time" value={formatTime(job.confirmed_time ?? job.requested_time) || "--:--"} />
            {job.status === "needs_scheduling" && (
              <AcceptScheduleControl job={job} variant="panel" onAccept={acceptSchedule} />
            )}
            <DetailField label="Service type" value={serviceTypeLabel(job.service_type)} nowrap />
            <div className="flex gap-2 text-sm">
              <span className="w-32 shrink-0 uppercase font-bold text-black">Scope of Work</span>
              <span className="text-black">{job.scope_of_work || "—"}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="w-32 shrink-0 uppercase font-bold text-black">Turnaround</span>
              <button
                onClick={() => setRush(false)}
                className={`rounded px-2 py-0.5 text-xs font-bold uppercase ${job.lab_turnaround !== "Rush" ? "bg-slate-700 text-white" : "bg-slate-100 text-slate-600"}`}
              >
                Standard
              </button>
              <button
                onClick={() => setRush(true)}
                className={`rounded px-2 py-0.5 text-xs font-bold uppercase ${job.lab_turnaround === "Rush" ? "bg-amber-500 text-white" : "bg-slate-100 text-slate-600"}`}
              >
                Rush
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <h4 className="text-sm font-bold uppercase tracking-wide text-black underline">Customer contact</h4>
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
                    {job.customers.name}
                  </a>
                ) : job.customers?.name}
                nowrap
              />
              <DetailField label="Phone" value={job.customers?.phone} />
              <DetailField label="Email" value={job.customers?.email} nowrap />
            </div>
            {!job.customers?.is_individual && job.customers?.companies && (
              <div className="space-y-2">
                <h4 className="text-sm font-bold uppercase tracking-wide text-black underline">Company info</h4>
                {job.customers.companies.billing_contact && (
                  <DetailField
                    label="Billing contact"
                    value={
                      <a
                        href={`/admin/customers?tab=contacts&contactId=${job.customers.companies.billing_contact.id}`}
                        className="hover:underline"
                      >
                        {job.customers.companies.billing_contact.name}
                      </a>
                    }
                    nowrap
                  />
                )}
                <DetailField label="Phone" value={job.customers.companies.phone} />
                <DetailField label="Billing address" value={job.customers.companies.billing_address} nowrap />
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <h4 className="text-sm font-bold uppercase tracking-wide text-black underline">Job site contact</h4>
              <DetailField label="Name" value={job.site_contact_name ?? "—"} />
              <DetailField label="Phone" value={job.site_contact_phone ?? "—"} />
            </div>
            {job.report_emails && job.report_emails.trim() && (
              <div className="space-y-2">
                <h4 className="text-sm font-bold uppercase tracking-wide text-black underline">Email results to</h4>
                {job.report_emails.split(",").map((e) => e.trim()).filter(Boolean).map((addr, i) => (
                  <div key={i} className="text-sm text-black">{addr}</div>
                ))}
              </div>
            )}
          </div>
          {job.notes && job.notes.trim() && (
            <div className="space-y-2">
              <h4 className="text-sm font-bold uppercase tracking-wide text-black underline">Notes</h4>
              <p className="text-sm text-black">{job.notes}</p>
            </div>
          )}
          {(job.job_classification || job.payment_method || job.po_number || job.invoice_number || job.paid_date) && (
            <div className="space-y-2">
              <h4 className="text-sm font-bold uppercase tracking-wide text-black underline">Job details</h4>
              <DetailField label="Classification" value={job.job_classification} />
              <DetailField label="Payment method" value={job.payment_method} />
              <DetailField label="PO #" value={job.po_number} />
              <DetailField label="Invoice #" value={job.invoice_number} />
              <DetailField label="Paid date" value={formatDate(job.paid_date)} />
            </div>
          )}
        </div>

        </>
        )}

        {tab === "report" && (
          <div className="mt-4 space-y-6">
            <div>
              <h3 className="text-lg font-bold uppercase tracking-wide text-black underline">Laboratory Paperwork</h3>
              <div className="mt-3">
                {serviceTypeLabels.length > 0 ? (
                  <div className="space-y-5">
                    {serviceTypeLabels.map((label) => {
                      const hasLabReport = (job.documents ?? []).some((d) => d.kind === "lab_report" && d.service_type === label);
                      const labReportMismatch = (job.documents ?? []).find((d) => d.kind === "lab_report" && d.service_type === label)?.project_number_mismatch;
                      const sampleCount = job.sample_counts?.[label];
                      // Positive/Negative is a real binary for asbestos and lead
                      // (each has its own result field) but not for mold — a
                      // mold "result" is the pasted Discussion of Results
                      // narrative, not a single positive/negative call, so no
                      // toggle is shown for it at all rather than writing into a
                      // field that means something else.
                      const isAsbestosLabel = /asbestos/i.test(label);
                      const isLeadLabel = /lead/i.test(label);
                      return (
                      <div key={label}>
                        <p className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-700">
                          {label}
                          <span className="flex items-center gap-1 font-normal text-slate-400">
                            ·
                            <input
                              type="number"
                              min={0}
                              defaultValue={sampleCount ?? ""}
                              key={sampleCount}
                              onBlur={(e) => {
                                const next = Number(e.target.value);
                                if (!Number.isNaN(next) && next !== (sampleCount ?? 0)) setSampleCountForType(label, next);
                              }}
                              className="w-14 rounded border border-slate-200 px-1 py-0.5 text-xs"
                            />
                            sample{sampleCount === 1 ? "" : "s"}
                          </span>
                        </p>
                        <div className="grid grid-cols-2 gap-3">
                          <DocumentStation
                            job={job}
                            onChanged={onChanged}
                            kind="lab_report"
                            label="Laboratory Results"
                            serviceType={label}
                          />
                          <div>
                            {labReportMismatch && (
                              <div className="mb-1.5 rounded-lg border border-red-300 bg-red-50 p-2 text-xs font-bold text-red-700">
                                ⚠ Incorrect report — this PDF is for project {labReportMismatch}, not {job.project_number}.
                              </div>
                            )}
                            {job.sample_results && job.sample_results.length > 0 && (
                              <div>
                                <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Sample Results</h4>
                                <div className="mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-50 p-2 font-mono text-xs">
                                  {job.sample_results.map((s, i) => (
                                    <div key={i} className={/%/.test(s.result) ? "text-red-600" : "text-slate-900"}>{s.fieldCode}: {s.result}</div>
                                  ))}
                                </div>
                              </div>
                            )}
                            {hasLabReport && (isAsbestosLabel || isLeadLabel) && (
                              <div className="mt-2 flex gap-2">
                                <button
                                  onClick={() => (isLeadLabel ? setLeadResult("positive") : setAsbestosResult("positive"))}
                                  className={`rounded px-2 py-0.5 text-xs font-bold uppercase ${(isLeadLabel ? job.lead_result : job.asbestos_result) === "positive" ? "bg-red-600 text-white" : "bg-slate-100 text-slate-600"}`}
                                >
                                  Positive
                                </button>
                                <button
                                  onClick={() => (isLeadLabel ? setLeadResult("negative") : setAsbestosResult("negative"))}
                                  className={`rounded px-2 py-0.5 text-xs font-bold uppercase ${(isLeadLabel ? job.lead_result : job.asbestos_result) === "negative" ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600"}`}
                                >
                                  Negative
                                </button>
                              </div>
                            )}
                          </div>
                          <DocumentStation job={job} onChanged={onChanged} kind="coc" label="Chain of Custody" serviceType={label} />
                          <DocumentStation job={job} onChanged={onChanged} kind="lab_invoice" label="Laboratory Invoice" serviceType={label} />
                        </div>
                      </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">Pick a service type on the Project Information tab to set up its upload stations and sample count.</p>
                )}

                {job.sample_items.length > 0 && (
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
              </div>
            </div>

            <div className="border-t-4 border-slate-300 pt-6">
              <h3 className="text-lg font-bold uppercase tracking-wide text-black underline">Final Report</h3>
              <div className="mt-3 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <a href={`/api/admin/jobs/${job.id}/report`} target="_blank" rel="noreferrer" className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-bold text-white">
                    Download Final Report
                  </a>
                  <a href={`/api/admin/jobs/${job.id}/report-xlsm`} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-bold text-slate-700">
                    .xlsm
                  </a>
                </div>

                {isMoldJob(job) && (
                  <div className="rounded-lg border border-slate-200 p-3">
                    <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Conclusions &amp; Recommendations
                    </label>
                    <textarea
                      className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                      rows={6}
                      value={reportNotesInput}
                      onChange={(e) => setReportNotesInput(e.target.value)}
                      onBlur={(e) => saveReportNotes(e.target.value)}
                      placeholder="Paste or write the Conclusions & Recommendations section — one paragraph or bullet per line."
                    />
                  </div>
                )}

                {/* Editable, auto-populated version of every item on the checklist
                    below — lets the admin fix a typo'd address or project # right
                    here instead of hunting through the other sections first. */}
                <div className="grid grid-cols-2 gap-3 rounded-lg border border-slate-200 p-3">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">Customer</label>
                    <input
                      className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                      value={customerNameInput}
                      onChange={(e) => setCustomerNameInput(e.target.value)}
                      onBlur={(e) => saveCustomerField({ name: e.target.value.trim() })}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">Project #</label>
                    <input
                      className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                      value={projectNumberInput}
                      onChange={(e) => setProjectNumberInput(e.target.value)}
                      onBlur={(e) => saveJobField({ project_number: e.target.value.trim() || null })}
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">Job site address</label>
                    <input
                      className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                      value={serviceAddressInput}
                      onChange={(e) => setServiceAddressInput(e.target.value)}
                      onBlur={(e) => saveJobField({ service_address: e.target.value.trim() })}
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">Billing address</label>
                    <input
                      className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                      value={billingAddressInput}
                      onChange={(e) => setBillingAddressInput(e.target.value)}
                      onBlur={(e) => saveCustomerField({ billing_address: e.target.value.trim() || null })}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">Date</label>
                    <input
                      type="date"
                      className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                      value={requestedDateInput}
                      onChange={(e) => setRequestedDateInput(e.target.value)}
                      onBlur={(e) => saveJobField({ requested_date: e.target.value || null })}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">Lab info</label>
                    <select
                      className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                      value={job.lab_name ?? ""}
                      onChange={(e) => selectLab(e.target.value)}
                    >
                      <option value="">— Not set —</option>
                      {labs.map((l) => (
                        <option key={l.name} value={l.name}>{l.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">
                      {isMoldJob(job) ? "Discussion of Results" : "Result"}
                    </label>
                    {isMoldJob(job) ? (
                      <textarea
                        className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                        rows={6}
                        value={reportSummaryInput}
                        onChange={(e) => setReportSummaryInput(e.target.value)}
                        onBlur={(e) => saveReportSummary(e.target.value)}
                        placeholder="Paste or write the Discussion of Results section — one paragraph or bullet per line."
                      />
                    ) : (
                      <ComboboxInput
                        value={reportSummaryInput}
                        onChange={setReportSummaryInput}
                        options={isLeadJob(job) ? [LEAD_NEGATIVE_REMARK, LEAD_POSITIVE_REMARK] : [ASBESTOS_NEGATIVE_REMARK, ASBESTOS_POSITIVE_REMARK]}
                        filterOptions={false}
                        getLabel={(o) => o}
                        showChevron
                        onSelect={(o) => {
                          setReportSummaryInput(o);
                          // Picking one of the two canned findings sentences IS
                          // the positive/negative determination — no separate
                          // Results button needed to duplicate that choice.
                          // One combined PATCH (not two separate save calls,
                          // each with its own onChanged()/loadJobs() refetch) —
                          // two independent fetches racing could let an older
                          // GET overwrite the newer one's field, leaving the
                          // report looking incomplete until an unrelated edit
                          // happened to trigger another refetch.
                          const negativeRemark = isLeadJob(job) ? LEAD_NEGATIVE_REMARK : ASBESTOS_NEGATIVE_REMARK;
                          const positiveRemark = isLeadJob(job) ? LEAD_POSITIVE_REMARK : ASBESTOS_POSITIVE_REMARK;
                          const patch: Record<string, unknown> = { report_summary: o.trim() || null };
                          if (o === negativeRemark) {
                            patch[isLeadJob(job) ? "lead_result" : "asbestos_result"] = "negative";
                          } else if (o === positiveRemark) {
                            patch[isLeadJob(job) ? "lead_result" : "asbestos_result"] = "positive";
                          }
                          saveJobField(patch);
                        }}
                        onEnter={(v) => saveReportSummary(v)}
                        onBlur={(v) => saveReportSummary(v)}
                        placeholder="e.g. None of the suspect materials sampled were determined to have asbestos fibers present."
                      />
                    )}
                  </div>
                </div>

                {job.report_sent_at && (() => {
                  const recipients = [job.customers?.email, ...(job.report_emails?.split(",") ?? [])]
                    .map((e) => e?.trim())
                    .filter(Boolean);
                  return (
                    <p className="text-xs text-slate-500">
                      Sent {formatDateTime(job.report_sent_at)} to {recipients.join(", ")}
                    </p>
                  );
                })()}

                {reportComplete ? (
                  <PdfPreview
                    url={`/api/admin/jobs/${job.id}/report?v=${encodeURIComponent(reportRevision)}`}
                    revision={reportRevision}
                  />
                ) : (
                  <p className="text-sm text-slate-500">
                    Fill in every field above (an empty one is still missing) to generate the report preview.
                  </p>
                )}
              </div>
            </div>

            <div className="border-t-4 border-slate-300 pt-6">
              <h3 className="text-lg font-bold uppercase tracking-wide text-black underline">Invoice</h3>
              <div className="mt-3">
                <div className="mb-4 space-y-1">
                  {job.po_number && <DetailField label="PO #" value={job.po_number} />}
                  {job.invoice_number && <DetailField label="Invoice #" value={job.invoice_number} />}
                </div>

                <LineItemsEditor
                  items={invoiceLineItems}
                  setItems={setInvoiceLineItemsFromUser}
                  serviceTypeSettings={serviceTypeSettings}
                  paymentDueDate={job.payment_due_date || paymentDueDate(job.requested_date ?? "") || ""}
                  onPaymentDueDateChange={(v) => saveJobField({ payment_due_date: v || null })}
                />
                {savingInvoice && <p className="mt-1 text-xs text-slate-400">Saving…</p>}

                {job.invoice_total_cents != null && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => setShowInvoicePreview((v) => !v)}
                      className={`rounded-lg px-3 py-1.5 text-sm font-bold uppercase ${
                        reportComplete
                          ? "bg-emerald-600 text-white"
                          : "border border-slate-300 bg-white text-slate-700"
                      }`}
                    >
                      {showInvoicePreview ? "Hide invoice" : "View invoice"}
                    </button>
                    <a
                      href={`/api/admin/jobs/${job.id}/invoice?download=1`}
                      download={`invoice-${job.project_number ?? job.id}.pdf`}
                      className={`rounded-lg px-3 py-1.5 text-sm font-bold uppercase ${
                        reportComplete
                          ? "bg-emerald-600 text-white"
                          : "border border-slate-300 bg-white text-slate-700"
                      }`}
                    >
                      Download invoice
                    </a>
                  </div>
                )}
                {showInvoicePreview && job.invoice_total_cents != null && (
                  <div className="mt-3">
                    <PdfPreview
                      url={`/api/admin/jobs/${job.id}/invoice?v=${encodeURIComponent(invoiceRevision)}`}
                      revision={invoiceRevision}
                    />
                  </div>
                )}

                {(job.lab_name || job.lab_cost_cents != null) && (
                  <div className="mt-4 border-t border-slate-100 pt-4">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Lab cost &amp; margin</h4>
                    <div className="mt-1 space-y-1">
                      <DetailField label="Lab" value={job.lab_name} />
                      {job.lab_cost_cents != null && (
                        <div className="pl-4">
                          <DetailField label="Lab cost" value={<span className="text-red-600">- {formatCents(job.lab_cost_cents)}</span>} />
                        </div>
                      )}
                      <DetailField label="Margin" value={margin != null ? formatCents(margin) : null} />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {job.invoice_total_cents != null && (
              <div className="border-t-4 border-slate-300 pt-6">
                <h3 className="text-lg font-bold uppercase tracking-wide text-black underline">Stripe Payment Link</h3>
                <div className="mt-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={getPaymentLink}
                      disabled={payLinkLoading}
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-bold uppercase text-slate-700 disabled:opacity-50"
                    >
                      {payLinkLoading ? "Loading…" : "View payment link"}
                    </button>
                    <button
                      onClick={copyPaymentLink}
                      disabled={copyLinkLoading}
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-bold uppercase text-slate-700 disabled:opacity-50"
                    >
                      {copyLinkLoading ? "Loading…" : copyLinkDone ? "Copied!" : "Copy payment link"}
                    </button>
                  </div>
                  {payLinkError && <p className="mt-2 text-sm text-red-600">{payLinkError}</p>}
                </div>
              </div>
            )}

            <div className="border-t-4 border-slate-300 pt-6">
              <div className="space-y-3">
                {/* Both slots always show — each one only swaps in its real
                    preview once actually ready, otherwise it stays an empty
                    placeholder. The invoice is never considered ready until
                    the report is too, regardless of whether it's been
                    priced — an invoice for an incomplete report isn't
                    actually final. */}
                <div className="flex flex-wrap gap-3">
                  {reportComplete ? (
                    <a
                      href={`/api/admin/jobs/${job.id}/report?v=${encodeURIComponent(reportRevision)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="block w-36 overflow-hidden rounded-lg border border-slate-200"
                    >
                      <PdfThumbnail url={`/api/admin/jobs/${job.id}/report?v=${encodeURIComponent(reportRevision)}`} alt="Final Report preview" />
                      <p className="border-t border-slate-200 bg-white px-2 py-1 text-center text-xs font-bold uppercase text-slate-700">Final Report</p>
                    </a>
                  ) : (
                    <div className="block w-36 overflow-hidden rounded-lg border border-dashed border-slate-300">
                      <div className="flex h-40 w-full items-center justify-center bg-slate-50 px-2 text-center text-xs text-slate-400">Not ready yet</div>
                      <p className="border-t border-dashed border-slate-300 px-2 py-1 text-center text-xs font-bold uppercase text-slate-400">Final Report</p>
                    </div>
                  )}
                  {reportComplete && job.invoice_total_cents != null ? (
                    <a
                      href={`/api/admin/jobs/${job.id}/invoice?v=${encodeURIComponent(invoiceRevision)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="block w-36 overflow-hidden rounded-lg border border-slate-200"
                    >
                      <PdfThumbnail url={`/api/admin/jobs/${job.id}/invoice?v=${encodeURIComponent(invoiceRevision)}`} alt="Invoice preview" />
                      <p className="border-t border-slate-200 bg-white px-2 py-1 text-center text-xs font-bold uppercase text-slate-700">Invoice</p>
                    </a>
                  ) : (
                    <div className="block w-36 overflow-hidden rounded-lg border border-dashed border-slate-300">
                      <div className="flex h-40 w-full items-center justify-center bg-slate-50 px-2 text-center text-xs text-slate-400">Not ready yet</div>
                      <p className="border-t border-dashed border-slate-300 px-2 py-1 text-center text-xs font-bold uppercase text-slate-400">Invoice</p>
                    </div>
                  )}
                </div>

                {job.invoice_draft_gmail_message_id ? (
                  <div className="rounded-lg border border-slate-200 p-3">
                    <a
                      href={gmailMessageUrl(job.invoice_draft_gmail_message_id, Boolean(job.invoice_sent_at))}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-block rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-bold uppercase text-slate-700"
                    >
                      View draft in Gmail ↗
                    </a>
                    <p className="mt-1.5 text-xs text-slate-500">
                      {draftStatusText(job.invoice_drafted_at, job.invoice_sent_at, combinedDraft.status, "Drafted", "Drafted")}
                    </p>
                  </div>
                ) : reportComplete ? (
                  <div className="rounded-lg border border-slate-200 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => combinedDraft.create()}
                        disabled={combinedDraft.creating}
                        className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-bold uppercase text-slate-700 disabled:opacity-50"
                      >
                        {combinedDraft.creating ? "Creating…" : "Create Draft"}
                      </button>
                      {combinedDraft.message && <span className="text-xs text-slate-500">{combinedDraft.message}</span>}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        )}

        {tab === "chat" && (
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

        {tab === "photos" && (
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

        <div className="mt-5 border-t border-slate-100 pt-4">
          {job.status === "cancelled" ? (
            <div className="flex h-2.5 items-center rounded-full bg-red-500">
              <span className="w-full text-center text-xs font-bold text-white">&nbsp;</span>
            </div>
          ) : (
            <div className="flex gap-1">
              {TRACKER_SEGMENTS.map((seg) => {
                const currentIndex = TRACKER_STATUSES.indexOf(job.status as (typeof TRACKER_STATUSES)[number]);
                const done = seg.done(job, currentIndex);
                return seg.status ? (
                  <button
                    key={seg.key}
                    onClick={() => onStatusChange(seg.status!)}
                    title={`Set status to ${STATUS_LABEL[seg.status]}`}
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
              TRACKER_SEGMENTS.map((seg) => {
                const currentIndex = TRACKER_STATUSES.indexOf(job.status as (typeof TRACKER_STATUSES)[number]);
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
  job, onChanged, kind, label, serviceType, headerExtra,
}: {
  job: JobWithCustomer;
  onChanged: () => void;
  kind: JobDocument["kind"];
  label: string;
  serviceType: string;
  headerExtra?: ReactNode;
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
      <div className="flex flex-nowrap items-center gap-2">
        <h4 className="whitespace-nowrap text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</h4>
        {headerExtra}
      </div>
      {docs.length === 0 && (
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
          onClick={() => inputRef.current?.click()}
          className={`mt-1.5 flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-3 py-5 text-center text-xs ${
            dragOver ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-300 text-slate-500"
          }`}
        >
          {uploading ? "Uploading…" : "Drag a file here, or click to browse"}
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
                {doc.project_number_mismatch && (
                  <p className="bg-red-600 px-2 py-1 text-xs font-bold text-white">
                    ⚠ Report says {doc.project_number_mismatch}. This job is {job.project_number}.
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
  const [projectNumber, setProjectNumber] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [serviceStreet, setServiceStreet] = useState("");
  const [serviceUnit, setServiceUnit] = useState("");
  const [serviceCity, setServiceCity] = useState("");
  const [serviceState, setServiceState] = useState("");
  const [serviceZip, setServiceZip] = useState("");
  const [siteContactName, setSiteContactName] = useState("");
  const [siteContactPhone, setSiteContactPhone] = useState("");
  const [siteContactSameAsContact, setSiteContactSameAsContact] = useState(false);
  const [selectedServiceTypeKeys, setSelectedServiceTypeKeys] = useState<string[]>([]);
  const [customServiceType, setCustomServiceType] = useState("");
  // Independent of the text itself, so checking the box first (before
  // typing anything) sticks instead of immediately reverting — typing
  // still checks it automatically either way.
  const [otherChecked, setOtherChecked] = useState(false);
  const [scopeOfWork, setScopeOfWork] = useState("");
  const [startingStatus, setStartingStatus] = useState<"needs_scheduling" | "scheduled">("needs_scheduling");
  const [requestedDate, setRequestedDate] = useState("");
  const [requestedTime, setRequestedTime] = useState("");
  const [notes, setNotes] = useState("");
  const [paymentType, setPaymentType] = useState<"online" | "check">("online");
  const [submitting, setSubmitting] = useState(false);
  const [fetchingNumber, setFetchingNumber] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [companyContacts, setCompanyContacts] = useState<Customer[]>([]);
  const [confirmingExit, setConfirmingExit] = useState(false);

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

  async function searchCompanies(q: string): Promise<Company[]> {
    const res = await fetch(`/api/admin/companies?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    return data.companies ?? [];
  }

  function selectCompany(company: Company) {
    setCompanyName(company.name);
    setCompanyId(company.id);
  }

  function selectContact(contact: Customer) {
    setContactName(contact.name);
    setEmail(contact.email);
    setPhone(contact.phone);
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

  return (
    <>
    <div className="fixed inset-0 flex items-center justify-center bg-black/40 px-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-5">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold text-slate-800">ADD PROJECT</h3>
          <button onClick={() => setConfirmingExit(true)} className="shrink-0 text-slate-400 hover:text-slate-600">✕</button>
        </div>

        {error && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        <div className="mt-4 flex gap-4">
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
              <input className="w-20 rounded-lg border border-slate-300 px-2 py-2 text-sm" value={projectNumber} onChange={(e) => setProjectNumber(e.target.value)} />
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <label className="block text-sm font-medium text-slate-700">Customer</label>
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
        <div className="mt-1 flex gap-1.5">
          <div className="w-0 flex-1">
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
            className="w-28 shrink-0 rounded-lg border border-slate-300 px-2 py-2 text-sm"
            placeholder="Unit #"
            value={serviceUnit}
            onChange={(e) => setServiceUnit(e.target.value)}
          />
        </div>
        <div className="mt-1.5 grid grid-cols-3 gap-1.5">
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
            className="rounded-lg border border-slate-300 px-2 py-2 text-sm"
            placeholder="State"
            value={serviceState}
            onChange={(e) => setServiceState(e.target.value)}
          />
          <ZipInput street={serviceStreet} city={serviceCity} state={serviceState} zip={serviceZip} setZip={setServiceZip} />
        </div>

        <label className="mt-3 block text-sm font-medium text-slate-700">Starting status</label>
        <div className="relative mt-1">
          <select
            className="w-full appearance-none rounded-lg border border-slate-300 bg-white py-2 pl-3 pr-10 text-sm"
            value={startingStatus}
            onChange={(e) => {
              const next = e.target.value as "needs_scheduling" | "scheduled";
              setStartingStatus(next);
              if (next === "needs_scheduling") {
                setRequestedDate("");
                setRequestedTime("");
              }
            }}
          >
            <option value="needs_scheduling">To Be Scheduled</option>
            <option value="scheduled">Scheduled</option>
          </select>
          <span className="pointer-events-none absolute inset-y-0 right-0 flex w-9 items-center justify-center rounded-r-lg bg-slate-200 text-slate-500">▾</span>
        </div>

        {startingStatus === "scheduled" && (
          <div className="mt-3 flex gap-2">
            <div className="flex-1">
              <label className="block text-sm font-medium text-slate-700">Date</label>
              <input type="date" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" value={requestedDate} onChange={(e) => setRequestedDate(e.target.value)} />
            </div>
            <div className="flex-1">
              <label className="block text-sm font-medium text-slate-700">Scheduled time</label>
              <input type="time" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" value={requestedTime} onChange={(e) => setRequestedTime(e.target.value)} />
            </div>
          </div>
        )}

        <label className="mt-3 block text-sm font-medium text-slate-700">Service type</label>
        <div className="mt-1 flex gap-4">
          <div className="flex-1 space-y-1.5">
            {serviceTypes.slice(3).map((s) => (
              <label key={s.key} className="flex items-center gap-1.5 whitespace-nowrap text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={selectedServiceTypeKeys.includes(s.key)}
                  onChange={() => toggleServiceType(s.key)}
                />
                {s.label}
              </label>
            ))}
          </div>
          <div className="flex-1 space-y-1.5">
            {serviceTypes.slice(0, 3).map((s) => (
              <label key={s.key} className="flex items-center gap-1.5 whitespace-nowrap text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={selectedServiceTypeKeys.includes(s.key)}
                  onChange={() => toggleServiceType(s.key)}
                />
                {s.label}
              </label>
            ))}
            <label className="flex items-center gap-1.5 whitespace-nowrap text-sm text-slate-700">
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
                className="w-40 border-b border-slate-300 bg-transparent text-sm focus:outline-none"
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
            <ComboboxInput
              value={siteContactName}
              onChange={setSiteContactName}
              options={companyContacts}
              getLabel={(c) => c.name}
              getSublabel={(c) => c.email}
              onSelect={(c) => {
                setSiteContactName(c.name);
                setSiteContactPhone(c.phone);
              }}
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

        <label className="mt-3 block text-sm font-medium text-slate-700">Customer contact</label>
        <div className="mt-1 flex gap-2">
          <div className="w-0 flex-1">
            <ComboboxInput
              value={contactName}
              onChange={(v) => { setContactName(v); setEmail(""); setPhone(""); }}
              options={companyContacts}
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
          Customer contact is also job site contact
        </label>

        <label className="mt-3 block text-sm font-medium text-slate-700">Notes</label>
        <textarea className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />

        <label className="mt-3 block text-sm font-medium text-slate-700">Payment type</label>
        <div className="mt-1 flex gap-2">
          <button
            type="button"
            onClick={() => setPaymentType("online")}
            className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-medium ${paymentType === "online" ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"}`}
          >
            Online
          </button>
          <button
            type="button"
            onClick={() => setPaymentType("check")}
            className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-medium ${paymentType === "check" ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"}`}
          >
            Check
          </button>
        </div>
        {paymentType === "check" && (
          <p className="mt-1 text-xs text-slate-500">No Stripe invoice or pay-now link will be created automatically for this project.</p>
        )}

        <div className="mt-4 flex gap-2">
          <button
            onClick={submit}
            disabled={submitting}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
          >
            {submitting ? "ADDING…" : "ADD PROJECT"}
          </button>
          <button onClick={() => setConfirmingExit(true)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm">
            Cancel
          </button>
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
    confirmedDate, confirmedTime, paidDate, dueDate, notes, paymentType,
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
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-5">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold text-slate-800">EDIT PROJECT</h3>
          <button onClick={onClose} className="shrink-0 text-slate-400 hover:text-slate-600">✕</button>
        </div>

        {error && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        <div className="mt-4 flex gap-4">
          <div className="w-28 shrink-0">
            <label className="block text-sm font-medium text-slate-700">Project #</label>
            <input className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm" value={projectNumber} onChange={(e) => setProjectNumber(e.target.value)} />
          </div>
          <div className="min-w-0 flex-1">
            <label className="block text-sm font-medium text-slate-700">Customer</label>
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
        <div className="mt-1 flex gap-1.5">
          <div className="w-0 flex-1">
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
            className="w-28 shrink-0 rounded-lg border border-slate-300 px-2 py-2 text-sm"
            placeholder="Unit #"
            value={serviceUnit}
            onChange={(e) => setServiceUnit(e.target.value)}
          />
        </div>
        <div className="mt-1.5 grid grid-cols-3 gap-1.5">
          <input
            className="rounded-lg border border-slate-300 px-2 py-2 text-sm"
            placeholder="Town"
            value={serviceCity}
            onChange={(e) => {
              const v = e.target.value;
              setServiceCity(v);
              if (!v.trim()) setServiceZip("");
            }}
          />
          <input
            className="rounded-lg border border-slate-300 px-2 py-2 text-sm"
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
            {PIPELINE_STATUSES.map((s) => (
              <option key={s} value={s}>{STATUS_LABEL[s]}</option>
            ))}
          </select>
          <span className="pointer-events-none absolute inset-y-0 right-0 flex w-9 items-center justify-center rounded-r-lg bg-slate-200 text-slate-500">▾</span>
        </div>

        <div className="mt-3 flex gap-2">
          <div className="flex-1">
            <label className="block text-sm font-medium text-slate-700">Scheduled date</label>
            <input type="date" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" value={confirmedDate} onChange={(e) => setConfirmedDate(e.target.value)} />
          </div>
          <div className="flex-1">
            <label className="block text-sm font-medium text-slate-700">Scheduled time</label>
            <input type="time" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" value={confirmedTime} onChange={(e) => setConfirmedTime(e.target.value)} />
          </div>
        </div>
        {job.requested_date && (
          <p className="mt-1.5 text-xs text-slate-500">
            Original customer request: {formatDate(job.requested_date)}
            {job.requested_time ? ` at ${formatTime(job.requested_time)}` : ""}
          </p>
        )}

        <label className="mt-3 block text-sm font-medium text-slate-700">Service type</label>
        <div className="mt-1 flex gap-4">
          <div className="flex-1 space-y-1.5">
            {serviceTypes.slice(3).map((s) => (
              <label key={s.key} className="flex items-center gap-1.5 whitespace-nowrap text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={selectedServiceTypeKeys.includes(s.key)}
                  onChange={() => toggleServiceType(s.key)}
                />
                {s.label}
              </label>
            ))}
          </div>
          <div className="flex-1 space-y-1.5">
            {serviceTypes.slice(0, 3).map((s) => (
              <label key={s.key} className="flex items-center gap-1.5 whitespace-nowrap text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={selectedServiceTypeKeys.includes(s.key)}
                  onChange={() => toggleServiceType(s.key)}
                />
                {s.label}
              </label>
            ))}
            <label className="flex items-center gap-1.5 whitespace-nowrap text-sm text-slate-700">
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
                className="w-40 border-b border-slate-300 bg-transparent text-sm focus:outline-none"
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
            <ComboboxInput
              value={siteContactName}
              onChange={setSiteContactName}
              options={companyContacts}
              getLabel={(c) => c.name}
              getSublabel={(c) => c.email}
              onSelect={(c) => {
                setSiteContactName(c.name);
                setSiteContactPhone(c.phone);
              }}
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

        <label className="mt-3 block text-sm font-medium text-slate-700">Customer contact</label>
        <div className="mt-1 flex gap-2">
          <div className="w-0 flex-1">
            <ComboboxInput
              value={contactName}
              onChange={(v) => { setContactName(v); setEmail(""); setPhone(""); setCustomerId(""); }}
              options={companyContacts}
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
          Customer contact is also job site contact
        </label>

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
        <div className="mt-1 flex gap-2">
          <button
            type="button"
            onClick={() => setPaymentType("online")}
            className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-medium ${paymentType === "online" ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"}`}
          >
            Online
          </button>
          <button
            type="button"
            onClick={() => setPaymentType("check")}
            className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-medium ${paymentType === "check" ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"}`}
          >
            Check
          </button>
        </div>
        {paymentType === "check" && (
          <p className="mt-1 text-xs text-slate-500">No Stripe invoice or pay-now link will be created automatically for this project.</p>
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

function LineItemsEditor({
  items, setItems, serviceTypeSettings, paymentDueDate, onPaymentDueDateChange,
}: {
  items: LineItemRowState[];
  setItems: Dispatch<SetStateAction<LineItemRowState[]>>;
  serviceTypeSettings: ServiceType[];
  /** Rendered inline on the same row as the total and the +Custom Line Item/+Samples links, rather than its own separate row — the admin wanted it directly in line with those, not stacked below. */
  paymentDueDate: string;
  onPaymentDueDateChange: (value: string) => void;
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
            rows={row.description.includes("\n") ? 2 : 1}
            className="mt-0.5 w-full resize-none rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
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

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-base font-bold uppercase text-emerald-600">Invoice total: {currency(total)}</p>
        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">Payment due date</label>
          <input
            type="date"
            className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            value={paymentDueDate}
            onChange={(e) => onPaymentDueDateChange(e.target.value)}
          />
        </div>
        <div className="flex gap-3">
          <button onClick={() => add()} className="text-sm text-brand-600 underline">
            + Custom Line Item
          </button>
          <button onClick={() => addSample()} className="text-sm text-brand-600 underline">
            + Samples
          </button>
        </div>
      </div>
    </div>
  );
}
