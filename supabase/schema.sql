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

-- Self-healing against the sequence falling behind reality — e.g. a job
-- created with a hand-typed project_number (the admin can type a custom
-- one instead of using the generated value) that's ahead of wherever the
-- sequence happens to be, which would otherwise make nextval() hand out a
-- number that collides with one already in use. Bumps the sequence up to
-- the actual max in-use number for the current year first, if needed, so
-- generated numbers stay unique no matter how past ones got in.
create or replace function next_project_number() returns text as $$
declare
  yr text := to_char(now(), 'YY');
  max_existing integer;
  seq_current bigint;
  seq_called boolean;
begin
  select coalesce(max(substring(project_number from '-(\d+)$')::integer), 0)
    into max_existing
    from jobs
    where project_number like yr || '-%';

  -- A sequence's last_value reads as its start value even before nextval()
  -- has ever been called on it (is_called stays false) — comparing against
  -- last_value directly would wrongly treat a never-touched sequence as
  -- already at position 1, so this must fall back to 0 when is_called is
  -- false, not last_value.
  select last_value, is_called into seq_current, seq_called from project_number_seq;

  if max_existing > (case when seq_called then seq_current else 0 end) then
    perform setval('project_number_seq', max_existing);
  end if;

  return yr || '-' || lpad(nextval('project_number_seq')::text, 4, '0');
end;
$$ language plpgsql;

-- Non-consuming counterpart for the "GET NEXT #" preview button — reads
-- what next_project_number() would return without actually advancing the
-- sequence, so looking at the number (without creating a project) never
-- burns it. Mirrors the same self-heal check so the preview is never
-- stale/wrong relative to what a real save would actually generate.
create or replace function peek_next_project_number() returns text as $$
declare
  yr text := to_char(now(), 'YY');
  max_existing integer;
  seq_current bigint;
  seq_called boolean;
begin
  select coalesce(max(substring(project_number from '-(\d+)$')::integer), 0)
    into max_existing
    from jobs
    where project_number like yr || '-%';

  select last_value, is_called into seq_current, seq_called from project_number_seq;

  if max_existing > (case when seq_called then seq_current else 0 end) then
    return yr || '-' || lpad((max_existing + 1)::text, 4, '0');
  end if;

  return yr || '-' || lpad((case when seq_called then seq_current + 1 else seq_current end)::text, 4, '0');
end;
$$ language plpgsql;

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
  -- Full-inspection (Pre-Renovation/Pre-Demolition) asbestos jobs only —
  -- one row per homogeneous material identified/sampled, driving the
  -- report's Appendix A/B tables. Empty for Limited/mold/lead jobs.
  full_inspection_materials jsonb not null default '[]'::jsonb,
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
  -- set by hand on the Final Report tab's Positive/Negative toggle — lead
  -- labs (SanAir/Crystal Analytical) aren't EMSL-format, so there's no
  -- auto-detection for this one, unlike asbestos_result above.
  lead_result text check (lead_result in ('positive', 'negative')),
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
  -- printed in the report letterhead's top-right contact block
  business_phone text not null default '617-390-4778',
  -- printed in the report letterhead's top-right contact block, next to business_phone
  business_email text not null default 'tim@commonwealthinspectionservices.com',
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
-- Full-inspection (Pre-Renovation/Pre-Demolition) asbestos jobs' per-material sample log — see the inline column comment above.
alter table jobs add column if not exists full_inspection_materials jsonb not null default '[]'::jsonb;

-- Real-workflow additions: project numbers, site contact, lab cost/results,
-- report summary, the awaiting_lab_results status, and report branding settings.
alter type job_status add value if not exists 'awaiting_lab_results' before 'completed';
-- project_number_seq, next_project_number(), and peek_next_project_number()
-- are defined once, above, near the jobs table itself.
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
-- Printed in the report letterhead's top-right contact block, next to business_phone.
alter table settings add column if not exists business_email text not null default 'tim@commonwealthinspectionservices.com';

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

-- Same four-column pattern again, but for the "your report is ready, pay
-- to receive it" notice sent to an individual-billed customer at the same
-- moment the report would have drafted for anyone else — see the
-- is_individual branch in processMatchedLabEmail (lib/lab-email.ts). Kept
-- separate from report_drafted_at/report_draft_gmail_id so this notice
-- draft is never mistaken for the real report having been drafted (which
-- would wrongly suppress the "Create Report Draft" button or mark the
-- Final Report tab as sent once the owner sends this instead).
alter table jobs add column if not exists payment_reminder_drafted_at timestamptz;
alter table jobs add column if not exists payment_reminder_sent_at timestamptz;
alter table jobs add column if not exists payment_reminder_draft_gmail_id text;
alter table jobs add column if not exists payment_reminder_draft_gmail_message_id text;

-- Manual admin escape hatch for the individual-billed payment gate — an
-- occasional exception (a trusted customer, a special case), not the
-- normal path. Off by default; once the admin flips it on for a job, the
-- portal treats that job's report as released exactly like a paid one
-- (see reportReady in ProjectDetailModal.tsx and
-- api/portal/projects/[id]/report/route.ts) — persists on the job, not a
-- one-time action, so the customer keeps seeing it on every visit rather
-- than the admin needing to remember to re-release it.
alter table jobs add column if not exists report_release_override boolean not null default false;

-- Collapses 'completed' ("Report Ready") and 'invoiced' into a single
-- 'ready_to_send' step — lab results are in, the report/invoice are
-- generatable and (for most jobs) already drafted. Both old values are kept
-- in the enum (Postgres can't drop enum values) and in JobsDashboard's
-- STATUS_LABEL/STATUS_COLOR so any old row still deserializes, but neither
-- is written by new code — .../jobs/[id]/complete/route.ts now sets
-- 'ready_to_send' instead of 'invoiced'.
alter type job_status add value if not exists 'ready_to_send' after 'pending_lab_results';

-- Most jobs are booked through a company, not an individual directly —
-- for those, the report drafts immediately alongside the invoice the
-- moment lab results land (see processMatchedLabEmail in lib/lab-email.ts).
-- Checking this box on the Invoice tab flags a job as individual-billed,
-- which holds its report back until the job is marked Paid instead —
-- same "Create Report Draft" gate the app used to apply to every job,
-- now scoped to just this flag.
alter table jobs add column if not exists is_individual boolean not null default false;

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

-- Set once at portal signup (Individual vs Company choice — see
-- src/app/portal/signup/page.tsx). Lets new jobs booked by this account
-- default their own is_individual flag (see its comment above) from the
-- account type instead of the admin having to check it by hand every time.
-- Still false/unset for customers created via the anonymous booking flow
-- or added directly by the admin, who can keep using the per-job checkbox.
alter table customers add column if not exists is_individual boolean not null default false;

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

-- "Ray's Library" — a reference-only catalog of materials/locations/results
-- seen across real past full-inspection asbestos reports (all inspected by
-- Raymond Leger at the owner's prior company), kept for the owner's own
-- reference while doing full inspections himself. Deliberately NOT wired
-- into any data-entry workflow (confirmed with the owner) — full-inspection
-- jobs' own materials (jobs.full_inspection_materials) are entered fresh
-- per job, independent of this table.
create table if not exists rays_library (
  id uuid primary key default gen_random_uuid(),
  material text not null,
  locations text[] not null default '{}',
  -- null = seen both ways (ACM in one source report, non-ACM in another)
  is_acm boolean,
  source_project_number text,
  source_address text,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists rays_library_material_idx on rays_library (material);

-- Reference site photos for Ray's Library, keyed by material name (not tied
-- to any one rays_library row, since those are per-occurrence and a photo
-- represents the material generally) — stored in the "rays-library-photos"
-- Storage bucket, served through an authenticated API route the same way
-- job documents/photos already are (see job-documents/job-photos buckets).
create table if not exists rays_library_photos (
  id uuid primary key default gen_random_uuid(),
  material text not null,
  storage_path text not null,
  source_project_number text,
  source_address text,
  created_at timestamptz not null default now()
);
create index if not exists rays_library_photos_material_idx on rays_library_photos (material);

alter table customers enable row level security;
alter table jobs enable row level security;
alter table saved_addresses enable row level security;
alter table daily_routes enable row level security;
alter table settings enable row level security;
alter table companies enable row level security;
alter table gmail_connection enable row level security;
alter table job_messages enable row level security;
alter table rays_library enable row level security;
alter table rays_library_photos enable row level security;

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
  -- A stale/bad id (a UI race, a copy-pasted old id) used to silently
  -- no-op here: every UPDATE/DELETE below just matches zero rows with no
  -- exception raised, so the caller (POST /api/admin/customers/merge)
  -- reported {ok:true} even though nothing happened — the admin believes
  -- a duplicate was resolved when it wasn't. Fail loudly instead.
  if not exists (select 1 from customers where id = loser_id) then
    raise exception 'merge_customers: loser_id % does not exist', loser_id;
  end if;
  if not exists (select 1 from customers where id = survivor_id) then
    raise exception 'merge_customers: survivor_id % does not exist', survivor_id;
  end if;

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
-- in Settings. The first entry is what prints on every report, invoice, and
-- Chain of Custody form's signature block (see primaryInspector() in
-- src/lib/settings.ts), replacing the old single owner_name/owner_title/
-- license_number columns dropped below.
alter table settings add column if not exists inspectors jsonb not null default '[]'::jsonb;

-- owner_name/owner_title/license_number are superseded by inspectors (the
-- first entry is now the signature-block source) — dropped once any
-- existing row's values have been migrated into inspectors.
alter table settings drop column if exists owner_name;
alter table settings drop column if exists owner_title;
alter table settings drop column if exists license_number;

-- disclaimer_text is no longer editable — the booking-acknowledgment wording
-- is hardcoded (DISCLAIMER_TEXT in src/components/BookingForm.tsx) instead
-- of a Settings field.
alter table settings drop column if exists disclaimer_text;

-- One-time rename: is_homeowner -> is_individual on both jobs and customers,
-- dropping the "homeowner vs contractor" terminology in favor of "individual
-- vs company" everywhere (including the account_type signup value). Guarded
-- so this whole file can still be replayed safely after the rename has run.
do $$
begin
  if exists (select 1 from information_schema.columns where table_name = 'jobs' and column_name = 'is_homeowner') then
    alter table jobs rename column is_homeowner to is_individual;
  end if;
  if exists (select 1 from information_schema.columns where table_name = 'customers' and column_name = 'is_homeowner') then
    alter table customers rename column is_homeowner to is_individual;
  end if;
end $$;

-- Lead's own positive/negative, parallel to asbestos_result — set by hand
-- on the Final Report tab (no auto-detection; lead labs aren't EMSL-format).
alter table jobs add column if not exists lead_result text check (lead_result in ('positive', 'negative'));

-- Distinguishes a real customer request (api/portal/book) from a project
-- the admin entered directly (api/admin/jobs, Add Project) — both can start
-- at status "needs_scheduling", but only the former has an actual request
-- for AcceptScheduleControl to show. Defaults existing rows to
-- "portal_booking" (accurate for every job created before this column
-- existed, since Add Project's admin-direct-entry path is what this column
-- was introduced to distinguish going forward).
alter table jobs add column if not exists source text not null default 'portal_booking';

-- How this job actually gets paid — most are "online" (Stripe hosted
-- invoice, pay-now link on the auto-drafted invoice email and the portal's
-- Pay now button), but some clients pay by check/cash instead, where
-- creating a Stripe invoice at all is just noise (and an unnecessary
-- processing fee if they ever did click it). Checked in
-- draftInvoiceEmailForJob/draftCombinedEmailForJob (lib/lab-email.ts) and
-- the portal's pay route/button — "check" skips Stripe invoice creation
-- entirely on those paths. The admin's own on-demand "Get payment link"
-- button is intentionally NOT gated by this — it's an explicit action, not
-- automatic.
alter table jobs add column if not exists payment_type text not null default 'online' check (payment_type in ('online', 'check'));

-- Mold jobs' Scope of Work as an editable, ordered list of numbered lines —
-- empty array means "nothing customized yet," in which case the admin UI
-- and PDF both fall back to moldScopeOfWorkItems' auto-derived list (one
-- line per selected sample type, plus the fixed closing summary line). The
-- moment the admin edits or adds a line, the full edited array is saved
-- here and becomes the source of truth going forward, same override
-- pattern as invoice_line_items/invoice_auto above.
alter table jobs add column if not exists mold_scope_items jsonb not null default '[]'::jsonb;

-- One final report per service type: a job combining mold with asbestos or
-- lead (e.g. "Limited Asbestos Inspection, Mold Air Sampling") produces two
-- separate report PDFs, not one that silently drops whichever type lost the
-- old mold>lead>asbestos priority pick. Mold gets its own parallel set of
-- report-content fields rather than sharing report_summary/report_notes/
-- lab_name/sample_results with asbestos/lead, since sharing them let a
-- mold lab upload silently overwrite the asbestos lab's own name/certs and
-- sample results on a mixed job. Report delivery (drafting/sending) stays
-- combined — one email, each domain's PDF as its own attachment — so no
-- parallel report_drafted_at/report_sent_at tracking columns are needed.
alter table jobs add column if not exists mold_report_summary text;
alter table jobs add column if not exists mold_report_notes text;
alter table jobs add column if not exists mold_lab_name text;
alter table jobs add column if not exists mold_sample_results jsonb not null default '[]'::jsonb;

-- Same reasoning as mold above, applied to lead: a job combining asbestos
-- and lead was sharing report_summary/report_notes/lab_name/lab_nist_cert/
-- lab_massdls_cert between the two domains' reports, so a lead finding
-- could leak into the asbestos letter (or vice versa) and whichever lab's
-- info was entered/uploaded second silently overwrote the other's. lead_lab_cert
-- (not lead_lab_nist_cert) since lead labs carry an AIHA cert, not NIST —
-- MassDLS doesn't apply to lead at all, so there's no lead_lab_massdls_cert.
alter table jobs add column if not exists lead_report_summary text;
alter table jobs add column if not exists lead_report_notes text;
alter table jobs add column if not exists lead_lab_name text;
alter table jobs add column if not exists lead_lab_cert text;

-- Auto-create (or link) a bare `customers` row the instant someone signs
-- up for a portal account, instead of waiting until they finish onboarding
-- (POST /api/portal/profile). Without this, a client who confirms their
-- email but never completes onboarding (closes the tab, gets a
-- link-expired error and gives up, etc.) has a real, confirmed auth.users
-- account but shows up nowhere in the admin's Directory/contact search —
-- discovered when a real client (confirmed account, zero customers row)
-- got stuck exactly this way. Placeholder name is their email so it's
-- still substring-searchable by first name (e.g. "joe" matches
-- "joe@bostonharborwater.com") — gets overwritten with their real name
-- once onboarding actually completes, same insert-or-update-by-email
-- logic /api/portal/profile already had. Safe for the admin-invite flow
-- too: if a customers row already exists for that email (created ahead of
-- time via Invite), this links auth_user_id onto it instead of creating a
-- duplicate — customers.email has a unique index (see above), so ON
-- CONFLICT DO UPDATE is required here, not a plain insert.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.customers (name, email, phone, auth_user_id)
  values (new.email, lower(new.email), '', new.id)
  on conflict (email) do update
    set auth_user_id = excluded.auth_user_id
    where customers.auth_user_id is null;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- Set when a payment the Stripe webhook already marked "paid" is later
-- reversed (refund, chargeback/dispute, or the invoice itself gets voided
-- after being paid — rare but possible via manual Stripe Dashboard action).
-- Distinct from status ('paid' is left alone here, not reverted
-- automatically — see markJobPaymentReversed in lib/lab-email.ts) so this
-- is purely a flag for the admin to notice and act on: the report may
-- already have been released. Also doubles as a guard against a late/
-- retried invoice.paid webhook delivery silently re-confirming a payment
-- that's already known to have been reversed.
alter table jobs add column if not exists payment_reversed_at timestamptz;

-- The client's "Request cancellation" button used to have NO database
-- record at all — its only effect was a best-effort owner-alert email that
-- fails completely silently on any Resend hiccup (see lib/email.ts's
-- sendEmail), leaving zero trace anywhere that a client believes they
-- cancelled while crew/lab work proceeds normally. This is now the real
-- record; the email is just a heads-up on top of it, not the record itself.
alter table jobs add column if not exists cancellation_requested_at timestamptz;

-- Lets a job's whole customer-facing email history (request received ->
-- confirmed -> final report/invoice draft) read as one thread instead of
-- separate emails, even though it's sent through two independent systems
-- (Resend for the automated ones, Gmail for the report/invoice draft the
-- owner reviews and sends). The app assigns its own Message-ID to every
-- email in the chain rather than trusting either system's own generated
-- one, storing each here (oldest first) so the next email's In-Reply-To/
-- References headers can be built from it. confirmation_sent_at is the
-- one-time marker for the "job confirmed" email specifically — shown as
-- small tracking text in the admin dashboard.
alter table jobs add column if not exists email_thread_message_ids jsonb not null default '[]'::jsonb;
alter table jobs add column if not exists email_gmail_thread_id text;

-- Ground truth for "has this account actually finished onboarding
-- (including setting a password)" — catches a real bug: on_auth_user_created
-- (above) creates a bare customers row the instant someone signs up or gets
-- Invited, before they've ever set a password. /portal/onboarding used to
-- gate purely on `customers` row existence, so both self-signup and Invite
-- (which often pre-fills a real name/phone on the contact row ahead of
-- time) could redirect straight to the dashboard, skipping the only place a
-- password is ever set (OnboardingForm's updateUser({password}), always
-- called before that page's own profile POST) — leaving a confirmed
-- auth.users account with no way to sign back in.
--
-- First attempt checked auth.users.encrypted_password directly via a
-- security-definer function, on the assumption it stays empty until
-- updateUser({password}) is called — wrong in practice: Supabase doesn't
-- leave it empty for OTP-only accounts, so that check returned true for
-- accounts that had never set a password at all, letting the exact same bug
-- through again. onboarding_completed_at instead, set explicitly by
-- POST /api/portal/profile (which only ever runs right after that
-- updateUser({password}) call succeeds), is real proof rather than an
-- inference about Supabase's internal representation.
alter table customers add column if not exists onboarding_completed_at timestamptz;

-- Backfill for accounts that completed onboarding before this column
-- existed, so this fix doesn't retroactively bounce currently-working
-- accounts back to the onboarding form. Old onboarding always required a
-- non-empty phone; the auto-create trigger's stub always leaves it '' — a
-- non-empty phone on a linked account is a reliable signal for existing
-- rows (a few already-broken Invite edge cases stay exactly as broken as
-- before, not worse; nothing currently-working regresses).
update customers
set onboarding_completed_at = created_at
where auth_user_id is not null and phone <> '' and onboarding_completed_at is null;

drop function if exists public.customer_has_password(uuid);

-- One-time marker for the automated "your inspection is tomorrow" reminder
-- (see lib/job-reminders.ts / api/cron/job-reminders) — same idempotency
-- pattern as confirmation_sent_at above, guarding against a double-send if
-- the cron is ever triggered twice for the same job.
alter table jobs add column if not exists reminder_sent_at timestamptz;
alter table jobs add column if not exists confirmation_sent_at timestamptz;

-- Dedupe timestamps for withCronAlert (lib/cron-auth.ts) — keyed by cron
-- name, so a sustained outage on the 15-minute check-lab-emails cron sends
-- one owner alert per hour instead of one every 15 minutes.
alter table settings add column if not exists cron_alert_sent_at jsonb not null default '{}'::jsonb;

-- Structured shipping/compensation data for subcontracted jobs (source =
-- 'subcontractor'), parsed out of the subcontracting company's "New
-- Assignment" email (see parse-subcontractor-assignment.ts) — split out of
-- jobs.notes (a single free-text blob) into their own columns so
-- JobsDashboard.tsx can give each its own dedicated tab instead of the
-- admin having to read them out of a wall of text. Null means "not
-- provided in the email," not "known to be zero."
alter table jobs add column if not exists subcontractor_shipping jsonb;
alter table jobs add column if not exists subcontractor_compensation jsonb;

-- Two more fields that were living as redundant free-text lines inside
-- jobs.notes ("Client: Shaki (...) — shakid...@gmail.com" and "Preferred
-- window: ..."), duplicating what Job Site Contact/Date of Sampling
-- already show (or should show). site_contact_email fills the one gap
-- Job Site Contact didn't already cover (name/phone only, no email);
-- subcontractor_preferred_window holds the human-readable time range
-- (e.g. "8:00 AM - 4:00 PM") a subcontractor's requested_date/window
-- can't represent on its own, and gets overwritten (not appended to) on
-- a reschedule email so it never goes stale.
alter table jobs add column if not exists site_contact_email text;
alter table jobs add column if not exists subcontractor_preferred_window text;

-- The itemized sample/service list a subcontractor's "Job Notes" buries in
-- an "Includes: (x1 Outdoor Air) + (x1 Indoor Air) + ..." line, split out
-- (see splitJobNotes in parse-subcontractor-assignment.ts) so it can be
-- shown as an actual list instead of read out of a wall of prose. Empty
-- array means no such line was present, not "no samples."
alter table jobs add column if not exists subcontractor_sample_types jsonb not null default '[]'::jsonb;

-- The report's own "Date of Sampling" line was pulling requested_date (the
-- scheduled/booked date), not the date the tech actually collected samples
-- — confirmed live wrong on 26-0002, where the report needed the real
-- collection date the lab itself prints on its report (Crystal's own
-- "Date(s) Sampled:"/"Collected:" line), not what was originally booked.
-- One column per domain, same reasoning as mold_lab_name/lead_lab_name
-- above — a mixed job's domains can be sampled on different dates (or one
-- report parses cleanly and the other doesn't), so they can't share a
-- single field without one overwriting the other.
alter table jobs add column if not exists lab_date_sampled date;
alter table jobs add column if not exists mold_date_sampled date;
alter table jobs add column if not exists lead_date_sampled date;

-- Splitting mold_report_summary into one Discussion of Results field per
-- sample type — confirmed against a real air+bulk+swab combo report
-- ("MOLD GOLD.pdf") that each type (Airborne/Bulk/Swab) gets its own
-- distinct findings under its own numbered subsection, not one shared
-- blob. The old single field was never populated with real data on any
-- live job, so this is a clean split rather than a data migration.
alter table jobs drop column if exists mold_report_summary;
alter table jobs add column if not exists mold_air_discussion text;
alter table jobs add column if not exists mold_bulk_discussion text;
alter table jobs add column if not exists mold_swab_discussion text;

-- New pipeline step between 'ready_to_send' and 'paid' — the report and
-- invoice have both actually gone out to the client (report_sent_at and
-- invoice_sent_at both set, inferred from Gmail by
-- .../jobs/[id]/draft-status/route.ts the same way those two columns
-- already are), still awaiting payment. Per Tim, 2026-08-26: distinct from
-- 'ready_to_send' (drafted, not yet sent) so the two are no longer
-- indistinguishable in the status field itself — draft-status/route.ts
-- auto-advances a job here the moment both timestamps land; nothing sets
-- it by hand.
alter type job_status add value if not exists 'report_invoice_sent' after 'ready_to_send';
