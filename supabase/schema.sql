-- Commonwealth Inspection Services — schema
-- Run this in the Supabase SQL editor (or via `supabase db push`).

create extension if not exists "pgcrypto";

-- ─────────────────────────────────────────────────────────────────────────
-- customers
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  company text,
  email text not null,
  phone text not null,
  billing_address text,
  stripe_customer_id text,
  -- set once a contractor creates a portal account (src/app/portal/signup);
  -- nullable because most rows are still created by the anonymous booking flow
  auth_user_id uuid unique references auth.users (id),
  created_at timestamptz not null default now()
);

-- Emails are always lowercased by the application before insert/upsert,
-- so a plain unique index works with Supabase's upsert(onConflict: "email").
create unique index if not exists customers_email_idx on customers (email);
create index if not exists customers_auth_user_id_idx on customers (auth_user_id);

-- ─────────────────────────────────────────────────────────────────────────
-- jobs
-- ─────────────────────────────────────────────────────────────────────────
create type job_window as enum ('AM', 'PM', 'ANY');

-- Full job-flow pipeline, tracked from intake to invoice so every open
-- project can be filtered/sorted by exactly where it sits in the process.
-- 'needs_scheduling' is where every admin-created project starts (see
-- POST /api/admin/jobs); 'scheduled' is set automatically once both a date
-- and time are on the job (or manually), same as every other transition,
-- via a plain admin-controlled status dropdown
-- (src/components/admin/JobsDashboard.tsx), not otherwise auto-derived.
-- 'pending_lab_results' covers everything from "sampled on-site" through
-- "waiting on the lab" — a single wait state, since the admin does no
-- itemized data entry during it (the physical chain-of-custody form is the
-- real record of what/where was sampled; a future automation will land lab
-- PDFs as documents on jobs in this status). 'fieldwork_in_progress',
-- 'awaiting_lab_results', and 'needs_report' predate this collapse and are
-- no longer written by new code, kept only so old rows still deserialize;
-- 'completed' likewise predates the whole pipeline.
create type job_status as enum (
  'needs_scheduling',
  'scheduled',
  'fieldwork_in_progress',
  'awaiting_lab_results',
  'needs_report',
  'pending_lab_results',
  'completed',
  'invoiced',
  'paid',
  'cancelled',
  'waitlist_out_of_area'
);

-- Human-readable project numbers (e.g. "26-0001"), matching the numbering
-- the owner already uses. A Postgres sequence + wrapper function (rather
-- than `select max(...)+1`) so concurrent bookings can never collide.
-- Zero-padded to 4 digits so early-year numbers still sort/read consistently
-- with later ones (e.g. "26-0001" not "26-1").
create sequence if not exists project_number_seq start 1;

create or replace function next_project_number() returns text as $$
  select to_char(now(), 'YY') || '-' || lpad(nextval('project_number_seq')::text, 4, '0');
$$ language sql;

-- Non-consuming counterpart for the "GET NEXT #" preview button — reads
-- what nextval() would return without actually advancing the sequence, so
-- looking at the number (without creating a project) never burns it.
create or replace function peek_next_project_number() returns text as $$
  select to_char(now(), 'YY') || '-' || lpad(
    (case when is_called then last_value + 1 else last_value end)::text, 4, '0'
  )
  from project_number_seq;
$$ language sql;

create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),
  -- human-readable id shown throughout the app and on reports; nullable because
  -- waitlist_out_of_area rows and historical imports may not have one
  project_number text unique,
  customer_id uuid references customers (id) on delete cascade,
  service_address text not null,
  lat double precision,
  lng double precision,
  -- the on-site contact (e.g. the homeowner) the owner actually coordinates
  -- scheduling with — distinct from customer_id, which is who pays (99% of
  -- the time a referring company, not the person on site)
  site_contact_name text,
  site_contact_phone text,
  -- nullable: waitlist_out_of_area rows are captured before a service type is chosen
  service_type text,
  -- job-specific sampling instructions from the referring contractor (e.g.
  -- "sample the walls in the kitchen") — distinct from `notes`, which is
  -- internal scheduling info (gate codes, etc.)
  scope_of_work text,
  base_fee_cents integer,
  per_sample_cents integer,
  duration_minutes integer,
  sample_count integer,
  -- homogeneous areas, per the paper chain-of-custody form: [{area_number,
  -- material, location, samples: [{letter, analysis_types, result?}]}, ...].
  -- Material/location entered once per area at "Mark sampled" time (matching
  -- how the COC is actually filled out); `result` added per sample once the
  -- lab reports back at "Enter lab results" time. sample_count is derived
  -- from the flattened sample count across all areas; kept as its own
  -- column so the existing invoice math (base_fee_cents + sample_count *
  -- per_sample_cents) doesn't change. Column name predates this shape.
  sample_items jsonb not null default '[]'::jsonb,
  -- one sample count per service type label on the job (e.g. "Mold Air
  -- Sampling": 3, "Asbestos Inspection": 5) — settable by hand from the
  -- lab's results, independent of sample_count/sample_items above
  sample_counts jsonb not null default '{}'::jsonb,
  -- who analyzed the samples, and what it cost — a real business expense,
  -- entered alongside lab results
  lab_name text,
  lab_cost_cents integer,
  -- lab accreditation numbers printed in the report's Sampling Summary block
  lab_nist_cert text,
  lab_massdls_cert text,
  -- turnaround requested on the COC (e.g. "24-Hr", "3-Day") and the date needed by
  lab_turnaround text,
  lab_date_needed date,
  -- scanned COC / lab report PDFs kept on file forever: [{id, kind, file_name, storage_path, uploaded_at}, ...]
  documents jsonb not null default '[]'::jsonb,
  -- the owner's own one-line overall-findings statement for the report
  -- (e.g. "No ACM identified") — deliberately hand-entered rather than
  -- inferred from free-text lab result strings
  report_summary text,
  -- technician's field-report narrative for the formal PDF report — deliberately
  -- separate from `notes`, which is internal scheduling info (gate codes, etc.)
  -- that shouldn't leak into a client-facing document.
  report_notes text,
  -- manual line-item invoicing: [{description, quantity, billing_unit, unit_cost_cents}, ...]
  -- entered at "Enter lab results" time; invoice_total_cents is their sum
  -- (or a manual override), kept as its own column for quick margin math.
  invoice_line_items jsonb not null default '[]'::jsonb,
  -- true until the admin manually edits a line item — while true, the
  -- Invoice tab keeps recomputing invoice_line_items fresh from the job's
  -- current sample_counts/base fee on every save, so it stays live as lab
  -- paperwork comes in; flips to false (and stays put) the moment the admin
  -- actually types over a row, so their edit is never clobbered afterward.
  invoice_auto boolean not null default true,
  invoice_total_cents integer,
  -- purchase order and invoice numbers some referring companies require for
  -- their own AP tracking — free text, set manually, never generated
  po_number text,
  invoice_number text,
  -- a short human label distinct from service_address (e.g. "Smith Residence
  -- — Attic Renovation"), and the classification/payment method some
  -- referring companies file jobs under — all free text, admin-entered
  project_name text,
  job_classification text,
  payment_method text,
  requested_date date,
  end_date date,
  -- set automatically the first time a job's status flips to 'paid'
  -- (also manually editable, for backfilling historical jobs)
  paid_date date,
  -- editable per job, but defaults to 30 days after requested_date
  -- (computed client-side) until the admin overrides it
  payment_due_date date,
  -- who the finished report gets emailed to — comma-joined, first address
  -- is always the customer contact's own email
  report_emails text,
  -- auto-detected from the uploaded EMSL lab report (any sample with a
  -- percentage + regulated mineral makes the whole report positive;
  -- otherwise negative once every sample analyzed comes back None
  -- Detected) — manually editable in case the detection gets it wrong.
  -- Null until a lab report's been uploaded and parsed.
  asbestos_result text check (asbestos_result in ('positive', 'negative')),
  -- per-sample field code + result text, pulled straight from the same
  -- uploaded lab report, for showing the admin the breakdown behind the
  -- auto-detected result above (e.g. [{"fieldCode":"03A","result":"15%
  -- Chrysotile"}, ...]) — not billing data, just a plain-text reference.
  sample_results jsonb not null default '[]'::jsonb,
  "window" job_window not null default 'ANY',
  status job_status not null default 'needs_scheduling',
  notes text,
  disclaimer_ack boolean not null default false,
  distance_miles double precision,
  stripe_invoice_id text,
  created_at timestamptz not null default now()
);

create index if not exists jobs_requested_date_idx on jobs (requested_date);
create index if not exists jobs_status_idx on jobs (status);
create index if not exists jobs_project_number_idx on jobs (project_number);

-- Run this separately against an existing database (new installs get the
-- column from the create table above already):
-- alter table jobs add column if not exists paid_date date;
-- alter table jobs add column if not exists sample_counts jsonb not null default '{}'::jsonb;
-- alter table jobs add column if not exists report_emails text;
-- alter table jobs add column if not exists scope_of_work text;
-- alter table jobs add column if not exists payment_due_date date;
-- alter table jobs add column if not exists asbestos_result text check (asbestos_result in ('positive', 'negative'));
-- alter table jobs add column if not exists sample_results jsonb not null default '[]'::jsonb;
-- alter table jobs add column if not exists invoice_auto boolean not null default true;

-- ─────────────────────────────────────────────────────────────────────────
-- saved_addresses — a contractor's reusable job-site addresses, for fast
-- repeat booking from the portal (src/app/portal/addresses)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists saved_addresses (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers (id) on delete cascade,
  label text,
  address text not null,
  lat double precision,
  lng double precision,
  created_at timestamptz not null default now()
);

create index if not exists saved_addresses_customer_id_idx on saved_addresses (customer_id);

-- ─────────────────────────────────────────────────────────────────────────
-- daily_routes — record of what was computed/sent each morning
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists daily_routes (
  id uuid primary key default gen_random_uuid(),
  route_date date not null,
  ordered_job_ids jsonb not null default '[]'::jsonb,
  -- per-leg drive seconds, same order as ordered_job_ids; leg[0] is base -> first stop
  leg_seconds jsonb not null default '[]'::jsonb,
  total_drive_seconds integer not null default 0,
  sent_at timestamptz
);

create index if not exists daily_routes_date_idx on daily_routes (route_date);

-- ─────────────────────────────────────────────────────────────────────────
-- settings — single row keyed table
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists settings (
  id integer primary key default 1,
  -- the actual booking-acceptance gate: state abbreviations the owner is
  -- currently licensed to work in (MA-only for now) — NOT a driving radius;
  -- service_area_center_lat/lng/service_radius_miles below remain in use
  -- only for the area-health "how spread out are we" metrics, a separate,
  -- informational concern from what's legal to accept.
  service_states jsonb not null default '["MA"]'::jsonb,
  service_area_center_lat double precision not null default 42.3467,
  service_area_center_lng double precision not null default -71.0823,
  service_radius_miles double precision not null default 4,
  base_address text not null default '118 Greenacre Rd, Westwood, MA 02090',
  timezone text not null default 'America/New_York',
  workday_start text not null default '08:00',
  workday_end text not null default '17:00',
  max_jobs_per_day integer not null default 8,
  default_service_minutes integer not null default 30,
  route_email_time_local text not null default '05:00',
  alert_interstop_minutes double precision not null default 12,
  alert_avg_distance_miles double precision not null default 3.0,
  alert_nearmiss_count integer not null default 5,
  alert_centroid_offset_miles double precision not null default 1.5,
  last_area_alert_sent_at timestamptz,
  -- drives the report's header/signature block (src/lib/report-pdf.tsx) and
  -- email header (src/lib/email.ts) without hardcoding them in code
  business_name text not null default 'Commonwealth Inspection Services, LLC.',
  -- printed in the report letterhead's top-right contact block, alongside base_address
  business_phone text not null default '617-390-4778',
  owner_name text not null default 'Timothy Hall',
  owner_title text not null default 'Project Manager',
  -- MA asbestos inspector license #, printed on the COC and report footer
  license_number text not null default 'AI901405',
  -- storage path (job-documents bucket) of a single PDF combining the
  -- owner's license + state certificate — merged into every report packet
  credentials_document_path text,
  disclaimer_text text not null default
    'This inspection is provided for informational purposes. Commonwealth Inspection Services performs sampling in accordance with Massachusetts DLS/MassDEP guidance; results are reported by an accredited laboratory. This is not a guarantee of the absence of asbestos or mold outside of sampled locations.',
  service_types jsonb not null default '[
    {"key":"asbestos","label":"Asbestos Inspection","base_fee_cents":45000,"per_sample_cents":2500},
    {"key":"mold","label":"Mold Inspection","base_fee_cents":45000,"per_sample_cents":8500}
  ]'::jsonb,
  -- overrides a service type's base_fee_cents by region (src/lib/pricing-zones.ts);
  -- matched by checking each zone's town list against the geocoded address,
  -- first match wins, falls back to the service type's own base_fee_cents
  -- if nothing matches. Town lists are a best-effort starting point digitized
  -- from a pricing map image, not precise polygon boundaries — editable in
  -- Settings, review before relying on it for real bookings.
  pricing_zones jsonb not null default '[]'::jsonb,
  -- saved lab profiles — picking one in "Enter lab results" auto-fills
  -- name + NIST/NVLAP + MassDLS cert #s instead of retyping them each time
  labs jsonb not null default '[
    {"name":"Asbestos Identification Laboratory, Inc.","nist_cert":"200919-0","massdls_cert":"AA000208"},
    {"name":"EMSL Analytical, Inc.","nist_cert":"101147-0","massdls_cert":"AA000188"},
    {"name":"Crystal Analytical, LLC.","nist_cert":"600387-0","massdls_cert":"AA000259"}
  ]'::jsonb,
  constraint settings_singleton check (id = 1)
);

insert into settings (id) values (1)
  on conflict (id) do nothing;

-- ─────────────────────────────────────────────────────────────────────────
-- updated_at helper (settings only needs one row, but keep it honest)
-- ─────────────────────────────────────────────────────────────────────────
alter table settings add column if not exists updated_at timestamptz not null default now();

-- ─────────────────────────────────────────────────────────────────────────
-- Backfill for databases created before these columns existed. `create
-- table if not exists` above is a no-op on an existing table, so columns
-- added to customers/jobs after initial launch need an explicit ALTER here
-- to actually reach a live database when this file is re-run.
-- ─────────────────────────────────────────────────────────────────────────
alter table customers add column if not exists auth_user_id uuid unique references auth.users (id);
create index if not exists customers_auth_user_id_idx on customers (auth_user_id);
alter table jobs add column if not exists sample_items jsonb not null default '[]'::jsonb;
alter table jobs add column if not exists report_notes text;

-- Real-workflow additions: project numbers, site contact, lab cost/results,
-- report summary, the awaiting_lab_results status, and report branding settings.
alter type job_status add value if not exists 'awaiting_lab_results' before 'completed';
create sequence if not exists project_number_seq start 1;
create or replace function next_project_number() returns text as $$
  select to_char(now(), 'YY') || '-' || lpad(nextval('project_number_seq')::text, 4, '0');
$$ language sql;
create or replace function peek_next_project_number() returns text as $$
  select to_char(now(), 'YY') || '-' || lpad(
    (case when is_called then last_value + 1 else last_value end)::text, 4, '0'
  )
  from project_number_seq;
$$ language sql;
alter table jobs add column if not exists project_number text unique;
create index if not exists jobs_project_number_idx on jobs (project_number);
alter table jobs add column if not exists site_contact_name text;
alter table jobs add column if not exists site_contact_phone text;
alter table jobs add column if not exists lab_name text;
alter table jobs add column if not exists lab_cost_cents integer;
alter table jobs add column if not exists report_summary text;
alter table settings add column if not exists business_name text not null default 'Commonwealth Inspection Services, LLC.';
alter table settings add column if not exists owner_name text not null default 'Timothy Hall';
alter table settings add column if not exists owner_title text not null default 'Project Manager';
alter table settings add column if not exists pricing_zones jsonb not null default '[]'::jsonb;
alter table settings add column if not exists service_states jsonb not null default '["MA"]'::jsonb;

-- Homogeneous-area sample model + document storage + COC turnaround fields.
-- sample_items now holds SampleArea[] rather than a flat sample list — no
-- migration needed for existing rows since real jobs so far have an empty
-- array (historical imports didn't include sample-level detail).
alter table jobs add column if not exists lab_turnaround text;
alter table jobs add column if not exists lab_date_needed date;
alter table jobs add column if not exists documents jsonb not null default '[]'::jsonb;
alter table settings add column if not exists license_number text not null default 'AI901405';

-- Real report-packet format: lab accreditation #s (printed in the letter's
-- Sampling Summary block) and a standing credentials PDF merged into every
-- report, matching the real FLI letter + attached lab report + license pages.
alter table jobs add column if not exists lab_nist_cert text;
alter table jobs add column if not exists lab_massdls_cert text;
alter table settings add column if not exists credentials_document_path text;

-- Manual line-item invoicing, matching the owner's existing Quantity/Billing
-- Unit/Description/Unit Cost workflow.
alter table jobs add column if not exists invoice_line_items jsonb not null default '[]'::jsonb;

-- Saved lab profiles (name + NIST/NVLAP + MassDLS cert #s) — seeded with his
-- 3 real labs so "Enter lab results" can auto-fill instead of retyping.
alter table settings add column if not exists labs jsonb not null default '[
    {"name":"Asbestos Identification Laboratory, Inc.","nist_cert":"200919-0","massdls_cert":"AA000208"},
    {"name":"EMSL Analytical, Inc.","nist_cert":"101147-0","massdls_cert":"AA000188"},
    {"name":"Crystal Analytical, LLC.","nist_cert":"600387-0","massdls_cert":"AA000259"}
  ]'::jsonb;

-- Companies are the payer entity (e.g. a restoration company); customers
-- rows become individual contacts at a company. Kept as a separate table
-- (rather than trusting the free-text customers.company column) so the
-- Add Project company picker can't create near-duplicate spellings of the
-- same company, and so billing address lives in one place per company.
create table if not exists companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  billing_address text,
  phone text,
  email text,
  created_at timestamptz not null default now()
);
create unique index if not exists companies_name_lower_idx on companies (lower(name));

alter table customers add column if not exists company_id uuid references companies (id);

-- Real clock time for a job, alongside requested_date — replaces the old
-- coarse AM/PM/no-preference window field for admin-created projects.
alter table jobs add column if not exists requested_time text;

-- Full job-flow pipeline (see the job_status comment above) — lets every
-- open project be tracked from intake through to invoice, not just from
-- the point it's actually scheduled.
alter type job_status add value if not exists 'needs_scheduling' before 'scheduled';
alter type job_status add value if not exists 'fieldwork_in_progress' after 'scheduled';
alter type job_status add value if not exists 'needs_report' after 'awaiting_lab_results';
alter table jobs alter column status set default 'needs_scheduling';

-- Parity fields from the owner's real Access "Project Details" form —
-- all free text/date, admin-entered via ProjectDetailDialog's Edit form,
-- never required.
alter table jobs add column if not exists end_date date;
alter table jobs add column if not exists project_name text;
alter table jobs add column if not exists job_classification text;
alter table jobs add column if not exists payment_method text;
alter table jobs add column if not exists po_number text;
alter table jobs add column if not exists invoice_number text;

-- Collapses 'fieldwork_in_progress' + 'awaiting_lab_results' + 'needs_report'
-- into one wait state (see the job_status comment above). Run this
-- statement alone first and let it commit before running anything below
-- that uses the new value — Postgres won't allow both in the same
-- transaction.
alter type job_status add value if not exists 'pending_lab_results' after 'needs_report';

-- ─────────────────────────────────────────────────────────────────────────
-- RLS perimeter — deliberately zero policies.
--
-- The app never queries Postgres directly from the browser: every table is
-- read/written exclusively through Next.js API routes using the privileged
-- service_role client (src/lib/supabase.ts), which bypasses RLS regardless
-- of whether it's enabled. Authorization is decided in that application
-- code (src/lib/admin-api.ts, src/lib/contractor-api.ts), not in policies.
--
-- Enabling RLS here isn't a second authorization system — it's a network
-- perimeter lock. Once the portal ships a public NEXT_PUBLIC_SUPABASE_ANON_KEY
-- for Supabase Auth, that key becomes a valid PostgREST credential in the
-- browser bundle; with RLS on and no policies, every table below is
-- default-deny for the anon/authenticated roles, so that key alone can't
-- read or write anything directly, even though it can still complete auth.
-- ─────────────────────────────────────────────────────────────────────────
-- Report letterhead's top-right contact block (src/lib/report-pdf.tsx),
-- matching the real FLI letter's address/phone block — printed alongside
-- the existing base_address field.
alter table settings add column if not exists business_phone text not null default '617-390-4778';

-- Single-row Gmail OAuth connection (the owner's own inbox, watched for
-- incoming lab result emails). Deliberately its own table rather than
-- columns on `settings` — settings.* is returned wholesale by GET
-- /api/admin/settings for the Settings page to render, and a refresh token
-- has no business ever reaching the browser. Only src/lib/gmail.ts reads
-- this table; the API surface exposes connected/email only (see
-- src/app/api/admin/gmail/status/route.ts).
create table if not exists gmail_connection (
  id int primary key default 1,
  email text,
  access_token text,
  refresh_token text,
  token_expiry timestamptz,
  updated_at timestamptz not null default now(),
  constraint gmail_connection_singleton check (id = 1)
);

-- Tracks whether the final report has actually gone out — set
-- automatically (report_drafted_at, whenever a Gmail draft gets created,
-- automatic or via the manual "Create Email Draft" button) or by hand
-- (report_sent_at, once the owner reviews the draft and hits send
-- themselves in Gmail — the app has no way to detect that on its own,
-- since it deliberately never gets gmail.send). Together these are what a
-- "drafted but not yet sent" indicator on the project list is driven by,
-- and what the Final Report tab checks before letting a duplicate draft
-- get created without confirmation.
alter table jobs add column if not exists report_drafted_at timestamptz;
alter table jobs add column if not exists report_sent_at timestamptz;
-- Gmail's own draft id, so the Final Report tab can check live whether that
-- draft is still sitting in Drafts (vs. already sent or deleted by hand)
-- instead of trusting report_drafted_at alone.
alter table jobs add column if not exists report_draft_gmail_id text;
-- The draft's underlying Gmail message id — checked for the SENT label once
-- the draft itself disappears, so report_sent_at can be set automatically
-- (there is no manual "mark as sent").
alter table jobs add column if not exists report_draft_gmail_message_id text;

-- Same four-column pattern, but for the invoice email specifically — split
-- out from the report so the invoice can go out the moment lab results
-- land while the report itself stays held back until the job is paid (see
-- markJobPaid in lib/lab-email.ts).
alter table jobs add column if not exists invoice_drafted_at timestamptz;
alter table jobs add column if not exists invoice_sent_at timestamptz;
alter table jobs add column if not exists invoice_draft_gmail_id text;
alter table jobs add column if not exists invoice_draft_gmail_message_id text;

-- Collapses 'completed' ("Report Ready") and 'invoiced' into a single
-- 'ready_to_send' step — lab results are in, the report/invoice are
-- generatable and (for most jobs) already drafted. Both old values are kept
-- in the enum (Postgres can't drop enum values) and in JobsDashboard's
-- STATUS_LABEL/STATUS_COLOR so any old row still deserializes, but neither
-- is written by new code — .../jobs/[id]/complete/route.ts now sets
-- 'ready_to_send' instead of 'invoiced'.
alter type job_status add value if not exists 'ready_to_send' after 'pending_lab_results';

-- Most jobs are booked through a contractor, not the homeowner directly —
-- for those, the report drafts immediately alongside the invoice the
-- moment lab results land (see processMatchedLabEmail in lib/lab-email.ts).
-- Checking this box on the Invoice tab flags a job as homeowner-billed,
-- which holds its report back until the job is marked Paid instead —
-- same "Create Report Draft" gate the app used to apply to every job,
-- now scoped to just this flag.
alter table jobs add column if not exists is_homeowner boolean not null default false;

-- Lets a company designate a specific existing contact as who invoices go
-- to (e.g. an AP person), separate from whichever contact a given job
-- happens to be tied to. Falls back to the job's own contact when unset —
-- see draftInvoiceEmailForJob in lib/lab-email.ts.
alter table companies add column if not exists billing_contact_id uuid references customers (id);

-- Extra Cc's on the invoice email specifically — report_emails (see its
-- comment above) is the equivalent list for the report email; the two are
-- deliberately separate since who should be looped in on billing often
-- isn't who should be looped in on the results.
alter table jobs add column if not exists invoice_emails text;

-- Set once at portal signup (Homeowner vs Contractor choice — see
-- src/app/portal/signup/page.tsx). Lets new jobs booked by this account
-- default their own is_homeowner flag (see its comment above) from the
-- account type instead of the admin having to check it by hand every time.
-- Still false/unset for customers created via the anonymous booking flow
-- or added directly by the admin, who can keep using the per-job checkbox.
alter table customers add column if not exists is_homeowner boolean not null default false;

-- Snapshot of requested_date/requested_time the moment the admin clicks
-- "Confirm & send to client" — kept separate from requested_date/
-- requested_time (which the admin can freely retune while coordinating
-- logistics with the contractor/lab) so the contractor portal never shows
-- a schedule change before it's been deliberately confirmed. Set to match
-- requested_date/requested_time only while schedule_visible_to_customer is
-- on — off by default, flipped per job from JobsDashboard's JobRow, and
-- kept live-synced to requested_date/requested_time while on so no repeat
-- click is needed after every reschedule.
alter table jobs add column if not exists confirmed_date date;
alter table jobs add column if not exists confirmed_time text;
alter table jobs add column if not exists schedule_visible_to_customer boolean not null default false;

-- Per-job override of who the invoice goes to — the portal's "Billing
-- contact for this project" selector on a single job. Must reference a
-- customers row sharing the job's own customer's company_id (enforced in
-- app code, see /api/portal/projects/[id]). Null falls back to the
-- company-wide companies.billing_contact_id default, same as today. See
-- draftInvoiceEmailForJob in lib/lab-email.ts.
alter table jobs add column if not exists billing_contact_id uuid references customers (id);

-- Per-project photo gallery — a lightweight, admin-and-client-uploadable
-- counterpart to `documents` above (which is lab paperwork specifically,
-- grouped by service type). Same storage-bucket-plus-jsonb-array pattern,
-- just a flat list with no service-type stations, since a site photo isn't
-- tied to a particular sample. Stored in the "job-photos" bucket.
alter table jobs add column if not exists photos jsonb not null default '[]'::jsonb;

-- Per-project chat between the admin and the client (customer account),
-- shown as its own tab on the project detail view on both sides. A
-- separate table (not a jsonb column on jobs, unlike documents/photos)
-- since it's an append-only log that can grow unbounded and doesn't need
-- to be read back as a whole on every job fetch — see /api/admin/jobs/[id]/
-- messages and /api/portal/projects/[id]/messages.
create table if not exists job_messages (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs (id) on delete cascade,
  sender_role text not null check (sender_role in ('admin', 'customer')),
  sender_name text not null,
  body text not null,
  created_at timestamptz not null default now(),
  read_by_admin boolean not null default false,
  read_by_customer boolean not null default false
);
create index if not exists job_messages_job_id_idx on job_messages (job_id, created_at);

alter table customers enable row level security;
alter table jobs enable row level security;
alter table saved_addresses enable row level security;
alter table daily_routes enable row level security;
alter table settings enable row level security;
alter table companies enable row level security;
alter table gmail_connection enable row level security;
alter table job_messages enable row level security;

-- Consolidates a duplicate contact into the one being kept — e.g. someone
-- who self-signed-up through the portal with a different email than the
-- one an admin had already put on file for them, creating a second
-- customers row instead of linking to the existing one. Reassigns every
-- reference to loser_id (jobs, saved addresses, company billing/cc links)
-- over to survivor_id, carries over the portal login if only one side has
-- one, then deletes the duplicate — all in one transaction so a failure
-- partway through can't leave things half-merged. Refuses to merge two
-- records that each already have their own distinct portal login, since
-- deciding which one wins isn't something to do silently.
create or replace function merge_customers(survivor_id uuid, loser_id uuid) returns void as $$
declare
  loser_auth_id uuid;
  survivor_auth_id uuid;
begin
  select auth_user_id into loser_auth_id from customers where id = loser_id;
  select auth_user_id into survivor_auth_id from customers where id = survivor_id;

  if loser_auth_id is not null and survivor_auth_id is not null and loser_auth_id != survivor_auth_id then
    raise exception 'Both records have their own portal login — resolve manually before merging';
  end if;

  update jobs set customer_id = survivor_id where customer_id = loser_id;
  update jobs set billing_contact_id = survivor_id where billing_contact_id = loser_id;
  update saved_addresses set customer_id = survivor_id where customer_id = loser_id;
  update companies set billing_contact_id = survivor_id where billing_contact_id = loser_id;

  if loser_auth_id is not null and survivor_auth_id is null then
    update customers set auth_user_id = null where id = loser_id;
    update customers set auth_user_id = loser_auth_id where id = survivor_id;
  end if;

  delete from customers where id = loser_id;
end;
$$ language plpgsql;

-- Licensed inspectors who may perform jobs — name/title/license #, editable
-- in Settings. Not yet wired into report/invoice/CoC generation, which
-- still uses the single owner_name/owner_title/license_number columns above.
alter table settings add column if not exists inspectors jsonb not null default '[]'::jsonb;
