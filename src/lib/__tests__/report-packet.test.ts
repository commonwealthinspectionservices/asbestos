import { describe, it, expect, vi } from "vitest";
import type { Job, Customer, Settings } from "@/lib/types";

// buildFinalReportPacket only reaches Supabase storage for its actual
// attachments — the domain_mismatch gate below throws before ever getting
// there, so this mock exists purely so getSupabaseAdmin() doesn't blow up
// on missing env vars in a test environment, not because storage is
// expected to be called in the case under test.
vi.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: () => ({
    storage: {
      from: () => ({
        download: async () => ({ data: null, error: new Error("no such file in this test") }),
      }),
    },
  }),
}));

import { buildFinalReportPacket, DomainMismatchError } from "@/lib/report-packet";

const settings: Settings = {
  id: 1,
  service_states: ["MA"],
  service_area_center_lat: 42.3467,
  service_area_center_lng: -71.0823,
  service_radius_miles: 4,
  base_address: "118 Greenacre Rd, Westwood, MA 02090",
  timezone: "America/New_York",
  workday_start: "08:00",
  workday_end: "17:00",
  max_jobs_per_day: 8,
  default_service_minutes: 30,
  route_email_time_local: "05:00",
  alert_interstop_minutes: 12,
  alert_avg_distance_miles: 3.0,
  alert_nearmiss_count: 5,
  alert_centroid_offset_miles: 1.5,
  last_area_alert_sent_at: null,
  business_name: "Commonwealth Inspection Services, LLC.",
  business_phone: "617-390-4778",
  business_email: "tim@commonwealthinspectionservices.com",
  service_types: [
    { key: "asbestos", label: "Asbestos Inspection", base_fee_cents: 45000, per_sample_cents: 2500, rush_fee_cents: 5000 },
  ],
  pricing_zones: [],
  labs: [],
  inspectors: [{ name: "Timothy Hall", title: "Project Manager", license_number: "AI901405" }],
  credentials_document_path: null,
  updated_at: new Date().toISOString(),
};

const customer: Customer = {
  id: "cust-1",
  name: "Joe Kline",
  company: "Boston Harbor Water Restoration",
  company_id: null,
  email: "joe@example.com",
  phone: "617-555-0100",
  billing_address: "36 Finnell Drive Suite #1, Weymouth, MA 02188",
  stripe_customer_id: null,
  auth_user_id: null,
  is_individual: false,
  created_at: new Date().toISOString(),
  onboarding_completed_at: null,
};

const baseJob: Job = {
  id: "job-1",
  project_number: "26-1001",
  customer_id: "cust-1",
  service_address: "800 Boylston St, Boston, MA",
  lat: 42.347, lng: -71.082,
  site_contact_name: "John Homeowner",
  site_contact_phone: "617-555-0111",
  site_contact_email: null,
  subcontractor_preferred_window: null,
  subcontractor_sample_types: [],
  subcontractor_client_company: null,
  fli_project_number: null,
  service_type: "Limited Asbestos Inspection",
  scope_of_work: null,
  base_fee_cents: 45000,
  per_sample_cents: 2500,
  duration_minutes: 30,
  sample_count: 4,
  sample_items: [],
  sample_counts: {},
  full_inspection_materials: [],
  sample_findings: [],
  lab_name: "Crystal Analytical, LLC.",
  lab_cost_cents: 12000,
  stripe_fee_cents: null,
  lab_nist_cert: "600387-0",
  lab_massdls_cert: "AA000259",
  lab_turnaround: "24-Hr",
  lab_date_needed: null,
  report_summary: "None of the suspect materials sampled were determined to have asbestos fibers present.",
  report_notes: null,
  mold_air_discussion: null,
  mold_bulk_discussion: null,
  mold_swab_discussion: null,
  mold_report_notes: null,
  mold_lab_name: null,
  lead_report_summary: null,
  lead_report_notes: null,
  lead_lab_name: null,
  lead_lab_cert: null,
  lab_date_sampled: null,
  mold_date_sampled: null,
  lead_date_sampled: null,
  invoice_line_items: [],
  invoice_auto: true,
  invoice_total_cents: null,
  po_number: null,
  invoice_number: null,
  project_name: null,
  job_classification: null,
  payment_method: null,
  requested_date: "2026-07-18",
  confirmed_date: "2026-07-18",
  confirmed_time: null,
  schedule_visible_to_customer: true,
  end_date: null,
  paid_date: null,
  payment_due_date: null,
  report_emails: null,
  invoice_emails: null,
  billing_contact_id: null,
  asbestos_result: "negative",
  lead_result: null,
  sample_results: [],
  mold_sample_results: [],
  subcontractor_shipping: null,
  subcontractor_compensation: null,
  requested_time: null,
  window: "AM",
  status: "completed",
  notes: null,
  disclaimer_ack: true,
  distance_miles: 0.5,
  stripe_invoice_id: null,
  documents: [],
  photos: [],
  report_drafted_at: null,
  report_draft_gmail_id: null,
  report_draft_gmail_message_id: null,
  report_sent_at: null,
  payment_reversed_at: null,
  cancellation_requested_at: null,
  email_thread_message_ids: [],
  confirmation_sent_at: null,
  reminder_sent_at: null,
  email_gmail_thread_id: null,
  invoice_drafted_at: null,
  invoice_draft_gmail_id: null,
  invoice_draft_gmail_message_id: null,
  invoice_sent_at: null,
  payment_reminder_drafted_at: null,
  payment_reminder_draft_gmail_id: null,
  payment_reminder_draft_gmail_message_id: null,
  payment_reminder_sent_at: null,
  is_individual: false,
  report_release_override: false,
  is_revisit: false,
  source: "portal_booking",
  payment_type: "online",
  created_at: new Date().toISOString(),
};

describe("buildFinalReportPacket", () => {
  // Per Tim, 2026-08-27 — this is the actual guarantee behind "this can't
  // reach a customer again": every path that produces a customer-facing
  // report (admin download, portal download, both draft builders) funnels
  // through this one function, so this test is the load-bearing proof that
  // a flagged document really does stop all of them, not just the one
  // that happened to catch 26-0008.
  it("refuses to build a packet when a lab_report document is flagged domain_mismatch", async () => {
    const flaggedJob: Job = {
      ...baseJob,
      documents: [
        {
          id: "doc-1",
          kind: "lab_report",
          service_type: "Limited Asbestos Inspection",
          file_name: "lab-report.pdf",
          storage_path: "job-1/doc-1-lab-report.pdf",
          uploaded_at: new Date().toISOString(),
          project_number_mismatch: null,
          domain_mismatch: true,
        },
      ],
    };
    await expect(buildFinalReportPacket(flaggedJob, customer, settings, "asbestos")).rejects.toThrow(DomainMismatchError);
  });

  it("builds normally when no document is flagged", async () => {
    const cleanJob: Job = {
      ...baseJob,
      documents: [
        {
          id: "doc-1",
          kind: "lab_report",
          service_type: "Limited Asbestos Inspection",
          file_name: "lab-report.pdf",
          storage_path: "job-1/doc-1-lab-report.pdf",
          uploaded_at: new Date().toISOString(),
          project_number_mismatch: null,
          domain_mismatch: false,
        },
      ],
    };
    const buffer = await buildFinalReportPacket(cleanJob, customer, settings, "asbestos");
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(0);
  });
});
