export type JobWindow = "AM" | "PM" | "ANY";

export type JobStatus =
  | "needs_scheduling"
  | "scheduled"
  | "fieldwork_in_progress"
  | "awaiting_lab_results"
  | "needs_report"
  | "pending_lab_results"
  | "completed"
  | "invoiced"
  | "ready_to_send"
  | "paid"
  | "cancelled"
  | "waitlist_out_of_area";

export interface ServiceType {
  key: string;
  label: string;
  base_fee_cents: number;
  per_sample_cents: number;
  duration_minutes: number;
  typical_samples_min: number;
  typical_samples_max: number;
}

/**
 * Overrides a service type's base_fee_cents by region. Matched against a
 * geocoded address by checking `towns` (case-insensitive substring), first
 * match in the array wins. See src/lib/pricing-zones.ts.
 */
export interface PricingZone {
  name: string;
  base_fee_cents: number;
  towns: string[];
}

/** A saved lab profile — picking one in "Enter lab results" auto-fills name + cert #s. */
export interface LabProfile {
  name: string;
  nist_cert: string;
  massdls_cert: string;
}

export interface Settings {
  id: number;
  /** The actual booking-acceptance gate — state abbreviations (e.g. ["MA"]) the owner is currently licensed to work in. */
  service_states: string[];
  service_area_center_lat: number;
  service_area_center_lng: number;
  service_radius_miles: number;
  base_address: string;
  timezone: string;
  workday_start: string;
  workday_end: string;
  max_jobs_per_day: number;
  default_service_minutes: number;
  route_email_time_local: string;
  alert_interstop_minutes: number;
  alert_avg_distance_miles: number;
  alert_nearmiss_count: number;
  alert_centroid_offset_miles: number;
  last_area_alert_sent_at: string | null;
  business_name: string;
  /** Printed in the report letterhead's top-right contact block, alongside base_address. */
  business_phone: string;
  owner_name: string;
  owner_title: string;
  disclaimer_text: string;
  service_types: ServiceType[];
  pricing_zones: PricingZone[];
  labs: LabProfile[];
  /** Options for the Job Classification dropdown on each project — editable here, not hardcoded. */
  job_classifications: string[];
  /** Options for the Payment Method dropdown on each project. */
  payment_methods: string[];
  /** MA asbestos inspector license # (or equivalent), printed on the COC and report footer. */
  license_number: string;
  /** Storage path (job-documents bucket) of a single PDF combining the owner's license + state certificate — merged into every report packet. */
  credentials_document_path: string | null;
  updated_at: string;
}

export interface Customer {
  id: string;
  name: string;
  company: string | null;
  company_id: string | null;
  email: string;
  phone: string;
  billing_address: string | null;
  stripe_customer_id: string | null;
  auth_user_id: string | null;
  created_at: string;
}

/** The payer entity (e.g. a restoration company) — customers are individual contacts at one. */
export interface Company {
  id: string;
  name: string;
  billing_address: string | null;
  phone: string | null;
  email: string | null;
  /** A specific contact at this company (e.g. an AP person) who invoices go to instead of whichever contact a given job happens to be tied to. Null falls back to the job's own contact. */
  billing_contact_id: string | null;
  /** Contacts at this company who always get Cc'd on every invoice, on top of billing_contact_id/the per-job Also Cc list — set once at the company level instead of re-added job by job. */
  invoice_cc_contact_ids: string[];
  created_at: string;
}

export interface SavedAddress {
  id: string;
  customer_id: string;
  label: string | null;
  address: string;
  lat: number | null;
  lng: number | null;
  created_at: string;
}

/**
 * One physical sample, one row per the paper chain-of-custody form — sample
 * number, material, and location entered one at a time as samples are
 * taken. The Samples tab (src/components/admin/JobsDashboard.tsx) is
 * either filled in manually or (in future) auto-populated by importing the
 * lab's results PDF; either way, its row count is the job's sample_count.
 */
export interface SampleItem {
  sample_number: string;
  material: string;
  location: string;
}

export interface JobDocument {
  id: string;
  /** "report" = a finished report packet (his own, possibly retroactively archived from before this system existed). */
  kind: "coc" | "lab_report" | "lab_invoice" | "report" | "other";
  /** Which service type on the job this belongs to (e.g. "Mold Air Sampling") — each service type gets its own set of upload stations. Empty for documents predating this (or not tied to one). */
  service_type: string;
  file_name: string;
  storage_path: string;
  uploaded_at: string;
  /** Set when this lab report's own project number (read off its "Project:" line) doesn't match the job it was uploaded to — likely uploaded to the wrong project by mistake. Holds the report's actual project number for display; null/absent when it matched or couldn't be determined. */
  project_number_mismatch?: string | null;
}

/** A manually-entered invoice line — total is quantity * unit_cost_cents, not stored separately. */
export interface InvoiceLineItem {
  description: string;
  quantity: number;
  billing_unit: string;
  unit_cost_cents: number;
}

export interface Job {
  id: string;
  /** Human-readable id (e.g. "26-1301"), auto-generated at booking time. Nullable for waitlist entries and some historical imports. */
  project_number: string | null;
  customer_id: string;
  service_address: string;
  lat: number | null;
  lng: number | null;
  /** The on-site contact (e.g. the homeowner) — distinct from customer_id, which is who pays. */
  site_contact_name: string | null;
  site_contact_phone: string | null;
  service_type: string | null;
  /** What the contractor actually wants sampled (e.g. "Sample the walls in the kitchen") — job-specific instructions, distinct from `notes`. */
  scope_of_work: string | null;
  base_fee_cents: number | null;
  per_sample_cents: number | null;
  duration_minutes: number | null;
  /** Row count of sample_items by default, but independently settable by hand once the lab's results are in. */
  sample_count: number | null;
  sample_items: SampleItem[];
  /** One count per service type label on the job (e.g. "Mold Air Sampling": 3), settable straight from the lab's results. */
  sample_counts: Record<string, number>;
  lab_name: string | null;
  lab_cost_cents: number | null;
  lab_nist_cert: string | null;
  lab_massdls_cert: string | null;
  lab_turnaround: string | null;
  lab_date_needed: string | null;
  report_summary: string | null;
  report_notes: string | null;
  /** Manual line-item invoicing (Quantity/Billing Unit/Description/Unit Cost), entered at "Enter lab results" time. */
  invoice_line_items: InvoiceLineItem[];
  /** True until the admin manually edits a line item — while true, invoice_line_items keeps recomputing fresh from current sample_counts/base fee on every save rather than freezing at whatever was last auto-generated. */
  invoice_auto: boolean;
  invoice_total_cents: number | null;
  /** Purchase order / invoice numbers some referring companies require for their own AP tracking. */
  po_number: string | null;
  invoice_number: string | null;
  /** A short human label distinct from service_address (e.g. "Smith Residence — Attic Renovation"). */
  project_name: string | null;
  job_classification: string | null;
  payment_method: string | null;
  requested_date: string | null;
  end_date: string | null;
  paid_date: string | null;
  /** Editable, defaults to 30 days after requested_date but can be overridden per job. */
  payment_due_date: string | null;
  /** Who the finished report gets emailed to — comma-joined, first address is always the customer contact's own email. */
  report_emails: string | null;
  /** Same idea as report_emails, but for the invoice email — kept separate since who's cc'd on billing often isn't who's cc'd on results. */
  invoice_emails: string | null;
  /** Auto-detected from the uploaded EMSL lab report; manually overridable in case detection gets it wrong. Null until a lab report's been parsed. */
  asbestos_result: "positive" | "negative" | null;
  /** Per-sample field code + result text, pulled from the same uploaded lab report — plain-text reference for the admin, not billing data. */
  sample_results: { fieldCode: string; result: string }[];
  requested_time: string | null;
  window: JobWindow;
  status: JobStatus;
  notes: string | null;
  disclaimer_ack: boolean;
  distance_miles: number | null;
  stripe_invoice_id: string | null;
  documents: JobDocument[];
  /** Set automatically whenever a Gmail draft gets created for this project (the automatic email-match path or the manual "Create Email Draft" button) — never cleared, so it survives a second draft being made. */
  report_drafted_at: string | null;
  /** Gmail's id for the most recently created draft — checked live via /draft-status to confirm it's still sitting in Drafts, since report_drafted_at alone can't tell a waiting draft from one already sent or deleted by hand. */
  report_draft_gmail_id: string | null;
  /** The draft's underlying Gmail message id — used by /draft-status to check for the SENT label once the draft itself is gone, so "sent" can be detected automatically rather than set by hand. */
  report_draft_gmail_message_id: string | null;
  /** Set automatically by /draft-status once it detects the draft's message now carries Gmail's SENT label — never set manually, there is no "mark as sent" button. Drives the "drafted but not sent" indicator until this lands. */
  report_sent_at: string | null;
  /** Same idea as report_drafted_at, but for the invoice email — created the moment lab results land, independent of payment status. */
  invoice_drafted_at: string | null;
  /** Same idea as report_draft_gmail_id, but for the invoice draft. */
  invoice_draft_gmail_id: string | null;
  /** Same idea as report_draft_gmail_message_id, but for the invoice draft. */
  invoice_draft_gmail_message_id: string | null;
  /** Same idea as report_sent_at, but for the invoice draft. */
  invoice_sent_at: string | null;
  /** Checked on the Invoice tab for jobs billed directly to a homeowner (most are contractor-billed) — holds the report back until the job is marked Paid instead of drafting it immediately alongside the invoice. */
  is_homeowner: boolean;
  created_at: string;
}

export interface JobWithCustomer extends Job {
  customers: Customer | null;
  /** Who "Create Report Draft"/"Create Invoice Draft" will actually address — computed server-side (see /api/admin/jobs) using the same fallback draftInvoiceEmailForJob itself uses, so the Email tab can show it before/after a draft exists. Only populated by the jobs list endpoint, not part of the core Job record. */
  report_recipient?: { name: string; email: string } | null;
  invoice_recipient?: { name: string; email: string } | null;
}

export interface DailyRoute {
  id: string;
  route_date: string;
  ordered_job_ids: string[];
  leg_seconds: number[];
  total_drive_seconds: number;
  sent_at: string | null;
}
