import { describe, it, expect } from "vitest";
import rawPdfParse from "pdf-parse/lib/pdf-parse.js";
import { renderProjectReportPdfForDomain } from "@/lib/report-pdf";
import { FLI_ENVIRONMENTAL_COMPANY_ID } from "@/lib/report-findings";
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
  subcontractor_client_company: null,
  subcontractor_client_address: null,
  fli_project_number: null,
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
  report_notes: "Field visit went smoothly.",
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
  is_revisit: false,
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

  it("doesn't leak lead's report summary/lab info into the asbestos report", async () => {
    const pdf = await renderProjectReportPdfForDomain({
      job: {
        ...job,
        service_type: "Limited Asbestos Inspection, Lead Bulk Sampling",
        report_summary: "Asbestos-only finding.",
        lead_report_summary: "Lead-only finding, should never appear here.",
        lab_name: "EMSL Analytical",
        lead_lab_name: "SanAir Technologies",
      },
      customer,
      settings,
    }, "asbestos");
    const { text } = await pdfParse(pdf);
    expect(text).toContain("Asbestos-only finding.");
    expect(text).not.toContain("Lead-only finding");
    expect(text).toContain("EMSL Analytical");
    expect(text).not.toContain("SanAir Technologies");
  });

  it("doesn't leak asbestos's report summary/lab info into the lead report", async () => {
    const pdf = await renderProjectReportPdfForDomain({
      job: {
        ...job,
        service_type: "Limited Asbestos Inspection, Lead Bulk Sampling",
        report_summary: "Asbestos-only finding, should never appear here.",
        lead_report_summary: "Lead-only finding.",
        lab_name: "EMSL Analytical",
        lead_lab_name: "SanAir Technologies",
      },
      customer,
      settings,
    }, "lead");
    const { text } = await pdfParse(pdf);
    expect(text).toContain("Lead-only finding.");
    expect(text).not.toContain("Asbestos-only finding");
    expect(text).toContain("SanAir Technologies");
    expect(text).not.toContain("EMSL Analytical");
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

  it("adds a summary table page listing every positive sample with its material and footage", async () => {
    const pdf = await renderProjectReportPdfForDomain({
      job: {
        ...job,
        asbestos_result: "positive",
        sample_results: [
          { fieldCode: "01A", result: "7% Chrysotile" },
          { fieldCode: "02A", result: "10% Chrysotile" },
        ],
        sample_findings: [
          { fieldCode: "01A", material: "12x12 floor tile", estimated_quantity: "120", unit: "sq_ft" },
          { fieldCode: "02A", material: "Pipe insulation", estimated_quantity: "40", unit: "linear_ft" },
        ],
      },
      customer,
      settings,
    }, "asbestos");
    const { text } = await pdfParse(pdf);
    expect(text).toContain("Asbestos-Containing Materials Summary Table");
    expect(text).toContain("01A");
    expect(text).toContain("12x12 floor tile");
    expect(text).toContain("120 square feet");
    expect(text).toContain("02A");
    expect(text).toContain("Pipe insulation");
    expect(text).toContain("40 linear feet");
  });

  it("omits the summary table page entirely when there are no positive sample results", async () => {
    const pdf = await renderProjectReportPdfForDomain({
      job: {
        ...job,
        asbestos_result: "negative",
        sample_results: [{ fieldCode: "01A", result: "None Detected" }],
        sample_findings: [],
      },
      customer,
      settings,
    }, "asbestos");
    const { text } = await pdfParse(pdf);
    expect(text).not.toContain("Asbestos-Containing Materials Summary Table");
  });

  it("still lists a positive sample in the table when it has no matching sample_findings entry yet", async () => {
    const pdf = await renderProjectReportPdfForDomain({
      job: {
        ...job,
        asbestos_result: "positive",
        sample_results: [{ fieldCode: "01A", result: "7% Chrysotile" }],
        sample_findings: [],
      },
      customer,
      settings,
    }, "asbestos");
    const { text } = await pdfParse(pdf);
    expect(text).toContain("Asbestos-Containing Materials Summary Table");
    expect(text).toContain("01A");
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

  it("spells out math symbols that Times-Roman can't render as plain words, rather than garbling", async () => {
    const pdf = await renderProjectReportPdfForDomain({
      job: {
        ...job,
        service_type: "Mold Air Sampling",
        mold_air_discussion: "A shift in composition (≈25% or more) can indicate amplification. Levels ≥100 spores/m³ or ≤5 spores/m³ are notable.",
      },
      customer,
      settings,
    }, "mold");
    const { text } = await pdfParse(pdf);
    expect(text).toContain("(about 25% or more)");
    expect(text).toContain("at least 100 spores/m");
    expect(text).toContain("at most 5 spores/m");
    expect(text).not.toMatch(/[≈≥≤~]/);
  });

  it("still splits bullet-marked lines into separate list items after symbol sanitization", async () => {
    const pdf = await renderProjectReportPdfForDomain({
      job: {
        ...job,
        service_type: "Mold Air Sampling",
        mold_report_notes: "• First recommendation (≈25% threshold)\n• Second recommendation",
      },
      customer,
      settings,
    }, "mold");
    const { text } = await pdfParse(pdf);
    expect(text).toContain("First recommendation (about 25% threshold)");
    expect(text).toContain("Second recommendation");
    // A regression here would collapse the newline and glue both bullets
    // into one paragraph/list item instead of two.
    expect(text).not.toContain("threshold)• Second recommendation");
  });

  describe("full-inspection asbestos report (Pre-Renovation/Pre-Demolition)", () => {
    const fullInspectionJob: Job = {
      ...job,
      service_type: "Pre-Renovation Asbestos Inspection",
      asbestos_result: "positive",
      report_notes: "Additional samples were taken on 8-4-26 to rule out any additional asbestos containing materials.",
      full_inspection_materials: [
        { material: "Transite Siding", is_acm: true, locations: ["Exterior Siding"], sample_numbers: "2458-1", estimated_quantity: "~1,600 SF" },
        { material: "Asphalt Shingle", is_acm: false, locations: ["Roof, Debris", "Roof, Debris"], sample_numbers: "2458-5", estimated_quantity: null },
      ],
    };

    it("renders the full-inspection letter, not the Limited template", async () => {
      const pdf = await renderProjectReportPdfForDomain({ job: fullInspectionJob, customer, settings }, "asbestos");
      const { text } = await pdfParse(pdf);
      expect(text).toContain("Inspection for Asbestos Containing Materials");
      expect(text).toContain("Scope and Approach");
      expect(text).not.toContain("Bulk Sample Analytical Results");
    });

    it("splits Scope and Approach into its own titled sections, matching the real reports", async () => {
      const pdf = await renderProjectReportPdfForDomain({ job: fullInspectionJob, customer, settings }, "asbestos");
      const { text } = await pdfParse(pdf);
      expect(text).toContain("Bulk Sampling:");
      expect(text).toContain("Asbestos Containing Materials:");
      expect(text).toContain("Non-Asbestos Containing Materials:");
      expect(text).toContain("Remarks and Limitations:");
      // The old version wrongly folded these into the numbered Remarks list.
      expect(text).toContain("Additional suspect materials may be present beneath surfaces");
    });

    it("shows Total Materials Sampled as the materials list length, not sample_counts", async () => {
      const pdf = await renderProjectReportPdfForDomain({ job: fullInspectionJob, customer, settings }, "asbestos");
      const { text } = await pdfParse(pdf);
      expect(text).toMatch(/Total Materials Sampled:\s*2/);
    });

    it("lists a positive material in Appendix A with its quantity", async () => {
      const pdf = await renderProjectReportPdfForDomain({ job: fullInspectionJob, customer, settings }, "asbestos");
      const { text } = await pdfParse(pdf);
      expect(text).toContain("Appendix A");
      expect(text).toContain("Transite Siding");
      expect(text).toContain("~1,600 SF");
    });

    it("lists a negative material in Appendix B with up to 3 locations", async () => {
      const pdf = await renderProjectReportPdfForDomain({ job: fullInspectionJob, customer, settings }, "asbestos");
      const { text } = await pdfParse(pdf);
      expect(text).toContain("Appendix B");
      expect(text).toContain("Asphalt Shingle");
    });

    it("includes the fixed abatement remarks when any material is ACM", async () => {
      const pdf = await renderProjectReportPdfForDomain({ job: fullInspectionJob, customer, settings }, "asbestos");
      const { text } = await pdfParse(pdf);
      expect(text).toContain("must be removed by a licensed asbestos abatement contractor");
      expect(text).toContain("not meant to be used as an asbestos abatement plan");
    });

    it("includes the admin's free-text additional remark", async () => {
      const pdf = await renderProjectReportPdfForDomain({ job: fullInspectionJob, customer, settings }, "asbestos");
      const { text } = await pdfParse(pdf);
      expect(text).toContain("Additional samples were taken on 8-4-26");
    });

    it("uses the shared negative remark, not the abatement remarks, when nothing is ACM", async () => {
      const pdf = await renderProjectReportPdfForDomain({
        job: { ...fullInspectionJob, asbestos_result: "negative", full_inspection_materials: [fullInspectionJob.full_inspection_materials[1]] },
        customer,
        settings,
      }, "asbestos");
      const { text } = await pdfParse(pdf);
      expect(text).toContain("None of the suspect materials sampled were determined to have asbestos fibers present");
      expect(text).not.toContain("must be removed by a licensed asbestos abatement contractor");
    });

    it("Pre-Demolition uses the same full-inspection template as Pre-Renovation", async () => {
      const pdf = await renderProjectReportPdfForDomain({
        job: { ...fullInspectionJob, service_type: "Pre-Demolition Asbestos Inspection" },
        customer,
        settings,
      }, "asbestos");
      const { text } = await pdfParse(pdf);
      expect(text).toContain("Inspection for Asbestos Containing Materials");
    });

    it("Limited Asbestos Inspection still renders the original simple template", async () => {
      const pdf = await renderProjectReportPdfForDomain({
        job: { ...job, service_type: "Limited Asbestos Inspection" },
        customer,
        settings,
      }, "asbestos");
      const { text } = await pdfParse(pdf);
      expect(text).toContain("Bulk Sample Analytical Results");
      expect(text).not.toContain("Inspection for Asbestos Containing Materials");
    });
  });

  describe("FLI Environmental subcontract jobs", () => {
    const fliCustomer: Customer = { ...customer, company: "FLI Environmental", company_id: FLI_ENVIRONMENTAL_COMPANY_ID };

    it("renders FLI's own letterhead/wording instead of Commonwealth's normal template", async () => {
      const pdf = await renderProjectReportPdfForDomain({
        job: { ...job, service_type: "Limited Asbestos Inspection" },
        customer: fliCustomer,
        settings,
      }, "asbestos");
      const { text } = await pdfParse(pdf);
      expect(text).toContain("FLI Environmental, Inc. collected samples");
      expect(text).toContain("FLI Project #:");
      expect(text).toContain("(781) 251-0040");
      expect(text).not.toContain(settings.business_name);
      expect(text).not.toContain("Asbestos Inspector License #");
    });

    it("addresses the report to the job site contact, not FLI's own internal contact", async () => {
      const pdf = await renderProjectReportPdfForDomain({
        job: {
          ...job,
          service_type: "Limited Asbestos Inspection",
          site_contact_name: "Chris Bromley",
          subcontractor_client_company: "Restore1",
          subcontractor_client_address: "100 Main Street, Boston, MA 02101",
        },
        customer: fliCustomer,
        settings,
      }, "asbestos");
      const { text } = await pdfParse(pdf);
      expect(text).toContain("Dear Chris Bromley");
      expect(text).toContain("Restore1");
      expect(text).toContain("100 Main Street");
      expect(text).toContain("Boston, MA 02101");
      expect(text).not.toContain(fliCustomer.name);
      expect(text).not.toContain(fliCustomer.billing_address ?? " never-matches");
    });

    it("shows FLI's own assigned project number, not this app's internal one, when set", async () => {
      const pdf = await renderProjectReportPdfForDomain({
        job: { ...job, service_type: "Limited Asbestos Inspection", project_number: "26-0011", fli_project_number: "FLI-4471" },
        customer: fliCustomer,
        settings,
      }, "asbestos");
      const { text } = await pdfParse(pdf);
      expect(text).toMatch(/FLI Project #:\s*FLI-4471/);
      expect(text).not.toMatch(/FLI Project #:\s*26-0011/);
    });

    it("still uses Commonwealth's own template for a job at a different company", async () => {
      const pdf = await renderProjectReportPdfForDomain({
        job: { ...job, service_type: "Limited Asbestos Inspection" },
        customer,
        settings,
      }, "asbestos");
      const { text } = await pdfParse(pdf);
      expect(text).not.toContain("FLI Environmental, Inc. collected samples");
      expect(text).toContain(settings.business_name);
    });

    it("still lists positive materials in the same summary table format", async () => {
      const pdf = await renderProjectReportPdfForDomain({
        job: {
          ...job,
          asbestos_result: "positive",
          sample_results: [{ fieldCode: "01A", result: "7% Chrysotile" }],
          sample_findings: [{ fieldCode: "01A", material: "12x12 floor tile", estimated_quantity: "80", unit: "sq_ft" }],
        },
        customer: fliCustomer,
        settings,
      }, "asbestos");
      const { text } = await pdfParse(pdf);
      expect(text).toContain("Asbestos-Containing Materials Summary Table");
      expect(text).toContain("12x12 floor tile");
      expect(text).toContain("80 square feet");
    });
  });
});
