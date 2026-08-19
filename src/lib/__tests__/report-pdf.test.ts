import { describe, it, expect } from "vitest";
import rawPdfParse from "pdf-parse/lib/pdf-parse.js";
import { renderProjectReportPdfForDomain } from "@/lib/report-pdf";
import type { Job, Customer, Settings } from "@/lib/types";

// Collapses whitespace (including the line breaks pdf-parse inserts at
// wherever a sentence happens to wrap) so multi-word toContain() checks
// below don't break just because a font-size change shifted a wrap point
// mid-phrase — this is text-extraction noise, not a real content change.
async function pdfParse(pdf: Buffer): Promise<{ text: string }> {
  const { text } = await rawPdfParse(pdf);
  return { text: text.replace(/\s+/g, " ") };
}

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

const job: Job = {
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
  service_type: "asbestos",
  scope_of_work: null,
  base_fee_cents: 45000,
  per_sample_cents: 2500,
  duration_minutes: 30,
  sample_count: 4,
  sample_items: [
    { sample_number: "01A", material: "Drywall wall base", location: "Back bedroom - Unit 11" },
    { sample_number: "01B", material: "Drywall wall base", location: "Back bedroom - Unit 11" },
    { sample_number: "02A", material: "Drywall wall skim", location: "Back bedroom - Unit 11" },
    { sample_number: "02B", material: "Drywall wall skim", location: "Back bedroom - Unit 11" },
  ],
  sample_counts: {},
  lab_name: "Crystal Analytical, LLC.",
  lab_cost_cents: 12000,
  lab_nist_cert: "600387-0",
  lab_massdls_cert: "AA000259",
  lab_turnaround: "24-Hr",
  lab_date_needed: null,
  report_summary: "None of the suspect materials sampled were determined to have asbestos fibers present.",
  report_notes: "Field visit went smoothly.",
  mold_report_summary: null,
  mold_report_notes: null,
  mold_lab_name: null,
  invoice_line_items: [
    { description: "Licensed Asbestos Inspector", quantity: 1, billing_unit: "Flat Fee", unit_cost_cents: 45000 },
    { description: "Bulk Samples for Asbestos Analysis by PLM", quantity: 4, billing_unit: "Sample", unit_cost_cents: 2500 },
  ],
  invoice_auto: false,
  invoice_total_cents: 55000,
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
  asbestos_result: null,
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
  source: "portal_booking",
  payment_type: "online",
  created_at: new Date().toISOString(),
};

describe("renderProjectReportPdf", () => {
  it("renders a valid, non-empty PDF buffer", async () => {
    const pdf = await renderProjectReportPdfForDomain({ job, customer, settings }, "asbestos");
    expect(pdf.length).toBeGreaterThan(0);
    expect(pdf.subarray(0, 4).toString("utf-8")).toBe("%PDF");
  });

  it("renders without any sample areas recorded yet", async () => {
    const pdf = await renderProjectReportPdfForDomain({
      job: { ...job, sample_items: [] },
      customer,
      settings,
    }, "asbestos");
    expect(pdf.length).toBeGreaterThan(0);
    expect(pdf.subarray(0, 4).toString("utf-8")).toBe("%PDF");
  });

  it("totals samples from sample_counts (per service type) rather than the legacy single sample_count", async () => {
    const pdf = await renderProjectReportPdfForDomain({
      job: { ...job, sample_count: 0, sample_counts: { "Limited Asbestos Inspection": 10 } },
      customer,
      settings,
    }, "asbestos");
    const { text } = await pdfParse(pdf);
    expect(text).toContain("Total # of Samples");
    expect(text).toMatch(/Total # of Samples:\s*10/);
  });

  it("sums sample_counts across every label in this report's own domain", async () => {
    const pdf = await renderProjectReportPdfForDomain({
      job: { ...job, sample_count: 0, sample_counts: { "Limited Asbestos Inspection": 6, "Asbestos Bulk Sampling": 3 } },
      customer,
      settings,
    }, "asbestos");
    const { text } = await pdfParse(pdf);
    expect(text).toMatch(/Total # of Samples:\s*9/);
  });

  it("excludes another domain's sample_counts entries from this report's total", async () => {
    const pdf = await renderProjectReportPdfForDomain({
      job: { ...job, sample_count: 0, sample_counts: { "Limited Asbestos Inspection": 6, "Mold Bulk Sampling": 3 } },
      customer,
      settings,
    }, "asbestos");
    const { text } = await pdfParse(pdf);
    expect(text).toMatch(/Total # of Samples:\s*6/);
  });

  it("applies the same domain filtering to the lead report's total", async () => {
    const pdf = await renderProjectReportPdfForDomain({
      job: { ...job, service_type: "Lead Bulk Sampling, Mold Air Sampling", sample_count: 0, sample_counts: { "Lead Bulk Sampling": 4, "Mold Air Sampling": 6 } },
      customer,
      settings,
    }, "lead");
    const { text } = await pdfParse(pdf);
    expect(text).toMatch(/Total # of Samples:\s*4/);
  });

  it("falls back to the legacy sample_count when sample_counts is empty", async () => {
    const pdf = await renderProjectReportPdfForDomain({
      job: { ...job, sample_count: 4, sample_counts: {} },
      customer,
      settings,
    }, "asbestos");
    const { text } = await pdfParse(pdf);
    expect(text).toMatch(/Total # of Samples:\s*4/);
  });

  it("includes the abatement remark when the job is positive", async () => {
    const pdf = await renderProjectReportPdfForDomain({
      job: { ...job, asbestos_result: "positive", report_summary: null, report_notes: null },
      customer,
      settings,
    }, "asbestos");
    const { text } = await pdfParse(pdf);
    expect(text).toContain("must be removed by a licensed asbestos abatement contractor");
    expect(text).not.toContain("None of the suspect materials sampled were determined to have asbestos fibers present");
  });

  it("includes the none-detected remark when the job is negative", async () => {
    const pdf = await renderProjectReportPdfForDomain({
      job: { ...job, asbestos_result: "negative", report_summary: null, report_notes: null },
      customer,
      settings,
    }, "asbestos");
    const { text } = await pdfParse(pdf);
    expect(text).toContain("None of the suspect materials sampled were determined to have asbestos fibers present");
    expect(text).not.toContain("must be removed by a licensed asbestos abatement contractor");
  });

  it("omits the auto remark entirely when the result hasn't been determined yet", async () => {
    const pdf = await renderProjectReportPdfForDomain({
      job: { ...job, asbestos_result: null, report_summary: null, report_notes: null },
      customer,
      settings,
    }, "asbestos");
    const { text } = await pdfParse(pdf);
    expect(text).not.toContain("must be removed by a licensed asbestos abatement contractor");
    expect(text).not.toContain("None of the suspect materials sampled were determined to have asbestos fibers present");
  });

  it("renders bullet- and number-marked lines in mold_report_notes as an actual list, not literal markers", async () => {
    const pdf = await renderProjectReportPdfForDomain({
      job: {
        ...job,
        service_type: "Mold Air Sampling",
        mold_report_notes: "• First recommendation\n• Second recommendation\n1. Step one\n2. Step two",
      },
      customer,
      settings,
    }, "mold");
    const { text } = await pdfParse(pdf);
    expect(text).toContain("First recommendation");
    expect(text).toContain("Second recommendation");
    expect(text).toMatch(/1\.\s*Step one/);
    expect(text).toMatch(/2\.\s*Step two/);
    // The raw markers shouldn't survive as literal paragraph text either.
    expect(text).not.toContain("• First recommendation\n• Second recommendation");
  });

  it("leaves plain (non-list) mold_report_notes lines as ordinary paragraphs", async () => {
    const pdf = await renderProjectReportPdfForDomain({
      job: {
        ...job,
        service_type: "Mold Air Sampling",
        mold_report_notes: "No further mold-specific remediation is recommended at this time.",
      },
      customer,
      settings,
    }, "mold");
    const { text } = await pdfParse(pdf);
    expect(text).toContain("No further mold-specific remediation is recommended at this time.");
  });
});
