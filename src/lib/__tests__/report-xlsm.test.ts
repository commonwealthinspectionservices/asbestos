import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { renderProjectXlsm } from "@/lib/report-xlsm";
import type { Job, Customer } from "@/lib/types";

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
  is_revisit: false,
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
  id: "job-1",
  project_number: "26-2760",
  customer_id: "cust-1",
  service_address: "184 Dedham Street, Canton, MA 02021",
  lat: 42.13, lng: -71.15,
  site_contact_name: "John Homeowner",
  site_contact_phone: "617-555-0111",
  site_contact_email: null,
  service_type: "Limited Asbestos Inspection",
  scope_of_work: null,
  base_fee_cents: 45000,
  per_sample_cents: 2500,
  duration_minutes: 30,
  sample_count: 0,
  sample_items: [],
  full_inspection_materials: [],
  subcontractor_shipping: null,
  subcontractor_compensation: null,
  subcontractor_preferred_window: null,
  subcontractor_sample_types: [],
  subcontractor_client_company: null,
  subcontractor_client_address: null,
  sample_counts: { "Limited Asbestos Inspection": 10 },
  lab_name: "EMSL Analytical, Inc.",
  lab_cost_cents: 12000,
  lab_nist_cert: "101147-0",
  lab_massdls_cert: "AA000188",
  lab_turnaround: "24-Hr",
  lab_date_needed: null,
  lab_date_sampled: null,
  mold_date_sampled: null,
  lead_date_sampled: null,
  report_summary: null,
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
  invoice_line_items: [],
  invoice_auto: true,
  invoice_total_cents: null,
  po_number: null,
  invoice_number: null,
  project_name: null,
  job_classification: null,
  payment_method: null,
  requested_date: "2026-07-20",
  confirmed_date: "2026-07-20",
  confirmed_time: null,
  schedule_visible_to_customer: true,
  end_date: null,
  paid_date: null,
  payment_due_date: null,
  report_emails: null,
  invoice_emails: null,
  billing_contact_id: null,
  asbestos_result: "positive",
  lead_result: null,
  sample_results: [],
  mold_sample_results: [],
  requested_time: null,
  window: "AM",
  status: "completed",
  notes: null,
  disclaimer_ack: true,
  distance_miles: 0.5,
  stripe_invoice_id: null,
  documents: [],
  photos: [],
  payment_type: "online",
  created_at: new Date().toISOString(),
};

async function readBack(buffer: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  return wb;
}

describe("renderProjectXlsm", () => {
  it("produces a valid xlsx buffer with all five template sheets intact", async () => {
    const buffer = await renderProjectXlsm({ job, customer });
    expect(buffer.length).toBeGreaterThan(0);
    const wb = await readBack(buffer);
    expect(wb.worksheets.map((s) => s.name).sort()).toEqual(["COC", "COC (2)", "Dropdowns", "Labs", "Report"].sort());
  });

  it("fills the recipient block from the customer's company/name/billing address", async () => {
    const buffer = await renderProjectXlsm({ job, customer });
    const wb = await readBack(buffer);
    const report = wb.getWorksheet("Report")!;
    expect(report.getCell("B3").value).toBe("Boston Harbor Water Restoration");
    expect(report.getCell("B4").value).toBe("Joe Kline");
    expect(report.getCell("B5").value).toBe("36 Finnell Drive Suite #1");
    expect(report.getCell("B6").value).toBe("Weymouth, MA 02188");
    expect(report.getCell("C13").value).toBe("Joe Kline:");
  });

  it("falls back to name-only recipient lines when there's no company", async () => {
    const buffer = await renderProjectXlsm({ job, customer: { ...customer, company: null } });
    const wb = await readBack(buffer);
    const report = wb.getWorksheet("Report")!;
    expect(report.getCell("B3").value).toBe("Joe Kline");
    expect(report.getCell("B4").value).toBe("36 Finnell Drive Suite #1");
    expect(report.getCell("B5").value).toBe("Weymouth, MA 02188");
    expect(report.getCell("B6").value).toBe("");
  });

  it("fills the COC sheet's project number, client, date, and site address", async () => {
    const buffer = await renderProjectXlsm({ job, customer });
    const wb = await readBack(buffer);
    const coc = wb.getWorksheet("COC")!;
    expect(coc.getCell("F4").value).toBe("26-2760");
    expect(coc.getCell("B5").value).toBe("Boston Harbor Water Restoration");
    expect(coc.getCell("B6").value).toBe("184 Dedham Street");
    expect(coc.getCell("B7").value).toBe("Canton, MA 02021");
    const dateValue = coc.getCell("F5").value as Date;
    expect(dateValue instanceof Date).toBe(true);
    expect(dateValue.toISOString().slice(0, 10)).toBe("2026-07-20");
  });

  it("fills one 'x' placeholder row per sample, summed across asbestos service types", async () => {
    const buffer = await renderProjectXlsm({
      job: { ...job, sample_counts: { "Limited Asbestos Inspection": 6, "Asbestos Bulk Sampling": 3 } },
      customer,
    });
    const wb = await readBack(buffer);
    const coc = wb.getWorksheet("COC")!;
    for (let i = 0; i < 9; i++) {
      expect(coc.getCell(`B${10 + i}`).value).toBe("x");
    }
    expect(coc.getCell("B19").value).toBeNull();
  });

  it("excludes another domain's sample_counts entries — this template is asbestos-only", async () => {
    const buffer = await renderProjectXlsm({
      job: { ...job, sample_counts: { "Limited Asbestos Inspection": 6, "Mold Bulk Sampling": 3 } },
      customer,
    });
    const wb = await readBack(buffer);
    const coc = wb.getWorksheet("COC")!;
    for (let i = 0; i < 6; i++) {
      expect(coc.getCell(`B${10 + i}`).value).toBe("x");
    }
    expect(coc.getCell("B16").value).toBeNull();
  });

  it("fills the lab info cells", async () => {
    const buffer = await renderProjectXlsm({ job, customer });
    const wb = await readBack(buffer);
    const report = wb.getWorksheet("Report")!;
    expect(report.getCell("H21").value).toBe("EMSL Analytical, Inc.");
    expect(report.getCell("H22").value).toBe("101147-0");
    expect(report.getCell("H23").value).toBe("AA000188");
  });

  it("writes the abatement remark when the job is positive", async () => {
    const buffer = await renderProjectXlsm({ job: { ...job, asbestos_result: "positive" }, customer });
    const wb = await readBack(buffer);
    const report = wb.getWorksheet("Report")!;
    expect(report.getCell("C30").value).toContain("must be removed by a licensed asbestos abatement contractor");
  });

  it("writes the none-detected remark when the job is negative", async () => {
    const buffer = await renderProjectXlsm({ job: { ...job, asbestos_result: "negative" }, customer });
    const wb = await readBack(buffer);
    const report = wb.getWorksheet("Report")!;
    expect(report.getCell("C30").value).toContain("None of the suspect materials sampled were determined to have asbestos fibers present");
  });

  it("leaves the template's own default remark when the result is undetermined", async () => {
    const buffer = await renderProjectXlsm({ job: { ...job, asbestos_result: null }, customer });
    const wb = await readBack(buffer);
    const report = wb.getWorksheet("Report")!;
    // Template's own default happens to already be the negative wording —
    // confirms we simply didn't touch the cell rather than clearing it.
    expect(report.getCell("C30").value).toContain("None of the suspect materials sampled were determined to have asbestos fibers present");
  });

  it("preserves the Report sheet's formulas untouched", async () => {
    const buffer = await renderProjectXlsm({ job, customer });
    const wb = await readBack(buffer);
    const report = wb.getWorksheet("Report")!;
    const j3 = report.getCell("J3").value as { formula: string } | null;
    expect(j3).not.toBeNull();
    expect(j3!.formula).toBe("COC!F5");
    const h20 = report.getCell("H20").value as { formula: string } | null;
    expect(h20!.formula).toContain("COUNTA(COC!B10:B29)");
  });
});
