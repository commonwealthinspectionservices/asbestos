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
  | "report_invoice_sent"
  | "paid"
  | "cancelled"
  | "waitlist_out_of_area";

export interface ServiceType {
  key: string;
  label: string;
  base_fee_cents: number;
  per_sample_cents: number;
  /** Added on top of base_fee_cents for a rush job. 0 means no rush fee is charged for this service type. */
  rush_fee_cents: number;
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
  /** e.g. "Woburn, Massachusetts" — printed after the lab's name in mold report prose ("...speciated by EMSL located in Woburn, Massachusetts."). */
  city: string;
}

/** A licensed inspector who may perform jobs. The first entry prints on every report, invoice, and Chain of Custody form's signature block — see primaryInspector() in settings.ts. */
export interface Inspector {
  name: string;
  title: string;
  license_number: string;
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
  /** Printed in the report letterhead's top-right contact block. */
  business_phone: string;
  /** Printed in the report letterhead's top-right contact block, next to business_phone. */
  business_email: string;
  service_types: ServiceType[];
  pricing_zones: PricingZone[];
  labs: LabProfile[];
  /** The first entry's name/title/license # print on every report, invoice, and Chain of Custody form's signature block — see primaryInspector() in settings.ts. */
  inspectors: Inspector[];
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
  is_individual: boolean;
  created_at: string;
  /** Set only by a successful POST /api/portal/profile — the real "this account finished onboarding, including setting a password" signal. See /portal/onboarding's redirect gate. */
  onboarding_completed_at: string | null;
  /** The linked company's own record (phone, billing address, etc.), distinct from this contact's own — only populated by endpoints that join it in (e.g. GET /api/admin/jobs). */
  companies?: Company | null;
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
  created_at: string;
  /** The resolved billing_contact_id record — only populated by endpoints that join it in (e.g. GET /api/admin/jobs). */
  billing_contact?: { id: string; name: string; email: string; phone: string } | null;
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

/**
 * One homogeneous material logged on a full-inspection (Pre-Renovation/
 * Pre-Demolition) asbestos job — a different concept from SampleItem above
 * (one row per physical sample for the paper COC log): this is one row per
 * distinct material the inspector identified and grouped, which is what the
 * report's Appendix A/B tables are actually keyed on. is_acm decides which
 * appendix a row renders in; estimated_quantity only applies to Appendix A
 * (ACM) rows. See jobReportDomains/isFullInspectionAsbestosJob in
 * report-findings.ts and FullInspectionAsbestosReportDocument in
 * report-pdf.tsx.
 */
export interface FullInspectionMaterial {
  material: string;
  is_acm: boolean;
  locations: string[];
  sample_numbers: string;
  estimated_quantity: string | null;
}

/** One entry in "Ray's Library" — a reference-only catalog, see supabase/schema.sql's rays_library table comment. */
export interface RaysLibraryEntry {
  id: string;
  material: string;
  locations: string[];
  is_acm: boolean | null;
  source_project_number: string | null;
  source_address: string | null;
  notes: string | null;
  created_at: string;
}

/** One reference site photo for a Ray's Library material, see supabase/schema.sql's rays_library_photos table comment. */
export interface RaysLibraryPhoto {
  id: string;
  material: string;
  source_project_number: string | null;
  source_address: string | null;
  created_at: string;
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
  /** Set true when this lab_report's own content doesn't look like the domain (mold vs. asbestos/lead) implied by service_type — e.g. a mold report's "fungal" language showing up on a document filed as asbestos, or vice versa. Same mislabeling class that hit 26-0007/26-0008; null/absent when they agreed or it couldn't be determined. */
  domain_mismatch?: boolean | null;
  /** Set true when a document filed as kind "lab_invoice" doesn't actually look like an invoice (see isLabInvoiceText/extractLabInvoiceTotalCents in lib/parse-lab-invoice.ts) — e.g. a finished report dragged into the wrong upload station by mistake, or an automated match that found a project number but no real invoice signal. Null/absent when it looked right or couldn't be determined. */
  invoice_mismatch?: boolean | null;
  /** SHA-256 of the file's own bytes, lab_invoice only. Crystal Analytical bills per lab order, one PDF often covering several jobs at once (see processMultiJobLabInvoiceEmail in lib/lab-email.ts) — that same PDF gets uploaded as its own copy under every job it covers (a different storage_path each time) plus once per service-type label on a mixed job, so without this a single real invoice email shows up as several unrelated-looking documents. Two documents sharing this hash are byte-identical copies of the same source file, however many jobs/labels they're filed under. Absent on documents uploaded before this field existed — see /api/admin/backfill-lab-invoice-hashes for retroactively filling it in. */
  content_hash?: string | null;
  /** Crystal Analytical's own invoice number ("Invoice no.: 6491" on the PDF itself — see extractInvoiceNumber in lib/parse-lab-invoice.ts), lab_invoice only. Shown as the invoice's title in BillingView instead of a generic "Lab invoice" label. Absent on documents uploaded before this field existed — see /api/admin/backfill-lab-invoice-numbers for retroactively filling it in. */
  lab_invoice_number?: string | null;
  /** This job's own dollar share of this real invoice/receipt/refund, in cents (negative for a Refund) — lab_invoice only. See computeLabCostCentsFromDocuments in lib/lab-cost.ts: Job's own lab_cost_cents is now always derived from these rather than written directly, so a job billed across more than one invoice number (a real weekly report showed one job split across three separate Sales Receipts) sums correctly instead of the writers racing to overwrite/add to one shared scalar. Absent on documents uploaded before this field existed — see /api/admin/backfill-lab-invoice-amounts for retroactively filling it in. */
  amount_cents?: number | null;
  /** The WHOLE weekly report's own printed grand total, in cents — not this job's own share (see amount_cents for that). Set identically on every lab_invoice document that came from the same real QuickBooks weekly-summary email (see processWeeklyLabSummaryEmail in lib/lab-email.ts), grouped back together via content_hash — BillingView reads it off any one document in that group to show the real per-report total Tim actually sees in his inbox, rather than a total this system reconstructed itself. Null/absent on a document not from a weekly summary, or one whose report total couldn't be read off the page. */
  report_total_cents?: number | null;
  /** The weekly report's own printed billing period ("August 23-29, 2026"), verbatim — same content_hash-grouping and weekly-summary-only scope as report_total_cents above. */
  report_date_range?: string | null;
}

/** A photo uploaded to a project's Photos tab (job-photos storage bucket) — either side can add these, unlike `documents` which is admin-only lab paperwork. */
export interface JobPhoto {
  id: string;
  file_name: string;
  storage_path: string;
  uploaded_at: string;
  uploaded_by: "admin" | "customer";
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
  /** The on-site contact (e.g. whoever is present during the inspection) — distinct from customer_id, which is who pays. */
  site_contact_name: string | null;
  site_contact_phone: string | null;
  site_contact_email: string | null;
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
  /** Full-inspection (Pre-Renovation/Pre-Demolition) asbestos jobs only — see FullInspectionMaterial. Empty for Limited/mold/lead jobs. */
  full_inspection_materials: FullInspectionMaterial[];
  lab_name: string | null;
  lab_cost_cents: number | null;
  lab_nist_cert: string | null;
  lab_massdls_cert: string | null;
  lab_turnaround: string | null;
  lab_date_needed: string | null;
  /** Asbestos's own Overall Findings sentence/additional remarks — lead has its own lead_report_summary/lead_report_notes below, mold its own mold_report_summary/mold_report_notes, so a job combining domains never shares this between their separate report PDFs. */
  report_summary: string | null;
  report_notes: string | null;
  /** Mold's own Discussion of Results findings, one field per sample type since each has its own numbered subsection and its own distinct findings (confirmed against a real air+bulk+swab combo report, "MOLD GOLD.pdf" — a single shared field misattributes one type's findings under another's heading on a combo job). Separate from asbestos's report_summary/report_notes and lead's lead_report_summary/lead_report_notes for the same cross-domain reason those are split out. */
  mold_air_discussion: string | null;
  mold_bulk_discussion: string | null;
  mold_swab_discussion: string | null;
  /** Mold's own Conclusions & Recommendations content — not split per sample type like the discussion fields above, since real reports give one shared conclusion/recommendation regardless of which sample types are on the job. */
  mold_report_notes: string | null;
  /** Mold's own lab name, separate from lab_name (asbestos's) and lead_lab_name (lead's) — a mixed job can use a different lab per service type. */
  mold_lab_name: string | null;
  /** Lead's own Overall Findings sentence/additional remarks — see report_summary/report_notes above for why this isn't shared with asbestos. */
  lead_report_summary: string | null;
  lead_report_notes: string | null;
  /** Lead's own lab name/cert — separate from lab_name/lab_nist_cert (asbestos's). A single field, not split nist/massdls like asbestos's: lead labs carry an AIHA cert, not NIST, and MassDLS doesn't apply to lead at all. */
  lead_lab_name: string | null;
  lead_lab_cert: string | null;
  /** The report's own "Date of Sampling" — the actual collection date the lab prints on its report (Crystal's "Date(s) Sampled:"/"Collected:" line), not requested_date (the scheduled/booked date, which can differ). One column per domain, same reasoning as mold_lab_name/lead_lab_name above. */
  lab_date_sampled: string | null;
  mold_date_sampled: string | null;
  lead_date_sampled: string | null;
  /** Manual line-item invoicing (Quantity/Billing Unit/Description/Unit Cost), entered at "Enter lab results" time. */
  invoice_line_items: InvoiceLineItem[];
  /** True until the admin manually edits a line item — while true, invoice_line_items keeps recomputing fresh from current sample_counts/base fee on every save rather than freezing at whatever was last auto-generated. */
  invoice_auto: boolean;
  invoice_total_cents: number | null;
  /** The actual card-processing fee Stripe charged, pulled from the paid invoice's own balance transaction (see the stripe webhook's invoice.paid handler) — not an estimate. Null until the invoice is actually paid through Stripe; stays null forever for a job marked paid by hand (check/cash), which is what keeps the Profit calculation from deducting a fee that was never charged. */
  stripe_fee_cents: number | null;
  /** Purchase order / invoice numbers some referring companies require for their own AP tracking. */
  po_number: string | null;
  invoice_number: string | null;
  /** A short human label distinct from service_address (e.g. "Smith Residence — Attic Renovation"). */
  project_name: string | null;
  job_classification: string | null;
  payment_method: string | null;
  requested_date: string | null;
  /** Mirrors requested_date/requested_time whenever schedule_visible_to_customer is on, and null when it's off — this, not requested_date/requested_time, is what the portal shows the contractor. */
  confirmed_date: string | null;
  confirmed_time: string | null;
  /** Admin-controlled visibility gate for the schedule — defaults off, so a date/time is never shown to the client until the admin explicitly flips it on. While on, confirmed_date/confirmed_time stay live-synced to requested_date/requested_time as the admin keeps editing. */
  schedule_visible_to_customer: boolean;
  end_date: string | null;
  paid_date: string | null;
  /** Set when a payment already marked "paid" is later refunded/disputed/voided — see markJobPaymentReversed in lib/lab-email.ts. Status is deliberately left as "paid", not auto-reverted; this is just the admin-visible flag. */
  payment_reversed_at: string | null;
  /** Set when a client clicks "Request cancellation" in the portal — the real record of the request, independent of whether the owner-alert email actually sends. Doesn't touch status itself; the admin decides. */
  cancellation_requested_at: string | null;
  /** Real Message-IDs (oldest first), read back from Gmail after each send — see lib/email-thread.ts. Lets the next email in this job's thread carry correct In-Reply-To/References. Empty for any email that fell back to Resend (no way to know what Message-ID that used). */
  email_thread_message_ids: string[];
  /** Gmail's own thread id for this job's email chain, set the first time an email sends through Gmail — passed to createDraft so the final report/invoice draft joins the same thread. */
  email_gmail_thread_id: string | null;
  /** Set once, the first time confirmed_date goes from empty to set — see sendJobConfirmedEmailIfDue in lib/booking-notify.ts. Shown as small tracking text in the admin dashboard. */
  confirmation_sent_at: string | null;
  /** Set once the day-before reminder email sends — see lib/job-reminders.ts. Shown as small tracking text in the admin dashboard. */
  reminder_sent_at: string | null;
  /** Editable, defaults to 30 days after requested_date but can be overridden per job. */
  payment_due_date: string | null;
  /** Who the finished report gets emailed to — comma-joined, first address is always the customer contact's own email. */
  report_emails: string | null;
  /** Same idea as report_emails, but for the invoice email — kept separate since who's cc'd on billing often isn't who's cc'd on results. */
  invoice_emails: string | null;
  /** Per-job override of who the invoice goes to (references a customers row sharing this job's customer's company_id) — falls back to companies.billing_contact_id when null. Set from the portal's "Billing contact for this project" selector. */
  billing_contact_id: string | null;
  /** Auto-detected from the uploaded EMSL lab report; manually overridable in case detection gets it wrong. Null until a lab report's been parsed. */
  asbestos_result: "positive" | "negative" | null;
  /** Set by hand on the Final Report tab's Positive/Negative toggle (no auto-detection — lead labs aren't EMSL-format). Null until set. */
  lead_result: "positive" | "negative" | null;
  /** Per-sample field code + result text, pulled from the same uploaded lab report — plain-text reference for the admin, not billing data. material is Crystal-Analytical-only (see extractCrystalAnalyticalMaterialDescriptions) and freshly overwritten on every re-parse, unlike sample_findings' own hand-editable material copy for positive samples. */
  sample_results: { fieldCode: string; result: string; material?: string }[];
  /** Mold's own version of sample_results, separate so an asbestos+mold job's two lab uploads don't clobber each other's per-sample list. serviceType (e.g. "Mold Air Sampling") tags which label a row belongs to, so the admin UI can show each label only its own samples — optional since rows recorded before this field existed don't have it. */
  mold_sample_results: { fieldCode: string; result: string; serviceType?: string }[];
  /** Per Tim, 2026-08-31 — "list out the approximate linear or square footage of each positive material identified," for Limited Inspection jobs (Full Inspection jobs already have this via full_inspection_materials/estimated_quantity). One row per positive sample, hand-typed material + approximate footage, matched to sample_results by fieldCode for display — kept as its own field rather than added directly onto sample_results, since that array gets fully overwritten every time a lab report is (re)parsed (see lab-email.ts/documents route) and would silently wipe out anything typed in here. */
  sample_findings: { fieldCode: string; material: string; estimated_quantity: string; unit: "sq_ft" | "linear_ft" }[];
  requested_time: string | null;
  window: JobWindow;
  status: JobStatus;
  notes: string | null;
  disclaimer_ack: boolean;
  distance_miles: number | null;
  stripe_invoice_id: string | null;
  documents: JobDocument[];
  photos: JobPhoto[];
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
  /** Same idea as report_drafted_at, but for the "your report is ready, pay to receive it" notice sent to an individual-billed customer instead of the real report — kept separate so this notice is never mistaken for the actual report having been drafted. */
  payment_reminder_drafted_at: string | null;
  /** Same idea as report_draft_gmail_id, but for the payment-reminder draft. */
  payment_reminder_draft_gmail_id: string | null;
  /** Same idea as report_draft_gmail_message_id, but for the payment-reminder draft. */
  payment_reminder_draft_gmail_message_id: string | null;
  /** Same idea as report_sent_at, but for the payment-reminder draft. */
  payment_reminder_sent_at: string | null;
  /** Checked on the Invoice tab for jobs billed directly to an individual (most are company-billed) — holds the report back until the job is marked Paid instead of drafting it immediately alongside the invoice. */
  is_individual: boolean;
  /** Manual admin escape hatch for the payment gate above — off by default; once on, the portal treats this job's report as released exactly like a paid one, regardless of actual payment status. Persists on the job (not a one-time action) until the admin turns it back off. */
  report_release_override: boolean;
  /** Per Tim, 2026-08-27 — a job going back to sample more at a site he's already inspected (his own convention: "26-0002.1" for a revisit to 26-0002), not a fresh inspection with its own base fee. resolveBaseFeeCents checks this first and returns 0 immediately, ahead of the usual zone/service-type lookup. Off by default; set from the Edit Project dialog. */
  is_revisit: boolean;
  /** How this job was created — "portal_booking" for a real customer request, "email_intake" for one parsed from a known repeat company's job-request email (see lib/job-intake.ts), "admin" for one the owner entered directly via Add Project. AcceptScheduleControl/ProjectsList's "awaiting review" treatment applies to both "portal_booking" and "email_intake" — both are real unreviewed requests, just from a different intake channel. Existing rows predating this column default to "portal_booking". */
  source: "portal_booking" | "email_intake" | "admin" | "subcontractor";
  /** Only ever set for source === "subcontractor" jobs — parsed from the subcontracting company's "New Assignment" email (see parse-subcontractor-assignment.ts). Null means the email didn't include a shipping section, not that nothing ships. */
  subcontractor_shipping: { provider: string | null; speed: string | null; trackingNumber: string | null; labelUrl: string | null } | null;
  /** Same idea as subcontractor_shipping — Fast Mold Testing's own estimate, not tracked/billed by this app. */
  subcontractor_compensation: { base: string | null; labFees: string | null; net: string | null } | null;
  /** Human-readable time range as the subcontracting company sent it (e.g. "8:00 AM - 4:00 PM") — requested_date/window can't represent a range like this. Overwritten (not appended) on a reschedule email so it's always current. */
  subcontractor_preferred_window: string | null;
  /** From an "Includes: (x1 A) + (x1 B) + ..." line in the subcontracting company's job notes — see splitJobNotes in parse-subcontractor-assignment.ts. Empty means no such line was present, not "no samples." */
  subcontractor_sample_types: string[];
  /** Per Tim, 2026-08-30 — the end client the subcontracting company is doing the work for (e.g. "Restore1", distinct from FLI Environmental/Fast Mold Testing themselves) — a freeform note, not always known at intake. Per Tim, 2026-08-31 — this client's own business contact (e.g. an office admin at RestoreNOW LLC) is a genuinely different person from site_contact_name/phone (whoever's literally at the job site) — see subcontractor_client_contact_name's own comment for that distinction. */
  subcontractor_client_company: string | null;
  /** Per Tim, 2026-08-31 — the end client's own mailing address (e.g. Restore1's own address, not the job site address) — an FLI-subcontracted report is addressed to this client, not to Dave MacDonald, so this is what the FLI report template's recipient block reads instead of customer.billing_address (which is unreliable for FLI's own contact, e.g. just "MA"). Hand-typed by Tim; freeform, split the same way customer.billing_address is. */
  subcontractor_client_address: string | null;
  /** Per Tim, 2026-08-31 — an FLI job can have three distinct contacts: whoever's physically at the job site (site_contact_name/phone, same meaning as on every other job), Dave MacDonald (FLI's own internal contact, not stored per-job), and this — the end client's own business contact (e.g. an office admin at RestoreNOW LLC, from their own billing-info sheet: name/phone/email, alongside subcontractor_client_company/address and the job's own po_number for their PO#). FLI-only; distinct from site_contact_name/phone, which used to double as this before the distinction was drawn. */
  subcontractor_client_contact_name: string | null;
  subcontractor_client_contact_phone: string | null;
  subcontractor_client_contact_email: string | null;
  /** Per Tim, 2026-08-31 — FLI Environmental assigns their own project number to a subcontracted job, separate from this app's own project_number; tracked here so both are on file. Hand-typed by Tim once FLI gives it out (often written on the paper chain-of-custody form), not auto-generated. Shown on the FLI-branded report's own "FLI Project #:" line (see FliAsbestosReportDocument in report-pdf.tsx) instead of this app's project_number, which stays the job's own internal identifier everywhere else. */
  fli_project_number: string | null;
  /** Distinct from the free-text `payment_method` field above (informational, import-only). This one drives real behavior: "online" auto-creates a Stripe hosted invoice and includes its pay-now link on drafted invoice emails, and shows the portal's Pay now button. "check" skips Stripe entirely on those automatic paths — the admin's own on-demand "Get payment link" button still works regardless. */
  payment_type: "online" | "check";
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
