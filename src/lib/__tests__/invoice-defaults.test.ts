import { describe, it, expect } from "vitest";
import { defaultInvoiceLineItems, resolveBaseFeeCents } from "@/lib/invoice-defaults";
import { NEWTON_FIRE_FLOOD_COMPANY_ID } from "@/lib/report-findings";
import type { Customer, JobWithCustomer, ServiceType } from "@/lib/types";

const asbestosBulk: ServiceType = {
  key: "asbestos_bulk",
  label: "Limited Asbestos Inspection",
  base_fee_cents: 45000,
  per_sample_cents: 2500,
  rush_fee_cents: 5000,
};

const moldAir: ServiceType = {
  key: "mold_air",
  label: "Mold Air Sampling",
  base_fee_cents: 45000,
  per_sample_cents: 8500,
  rush_fee_cents: 0,
};

function baseJob(overrides: Partial<JobWithCustomer> = {}): JobWithCustomer {
  return {
    id: "job-1",
    project_number: "26-1",
    customer_id: "cust-1",
    customers: null,
    service_address: "800 Boylston St, Boston, MA",
    lat: 42.347, lng: -71.082,
    site_contact_name: null,
    site_contact_phone: null,
    site_contact_email: null,
    subcontractor_preferred_window: null,
    subcontractor_sample_types: [],
    service_type: "Limited Asbestos Inspection",
    scope_of_work: null,
    base_fee_cents: null,
    per_sample_cents: null,
    duration_minutes: 30,
    sample_count: null,
    sample_items: [],
    sample_counts: {},
    full_inspection_materials: [],
    lab_name: null,
    lab_cost_cents: null,
    lab_nist_cert: null,
    lab_massdls_cert: null,
    lab_turnaround: null,
    lab_date_needed: null,
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
    requested_date: null,
    confirmed_date: null,
    confirmed_time: null,
    schedule_visible_to_customer: false,
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
    window: "ANY",
    status: "needs_scheduling",
    notes: null,
    disclaimer_ack: true,
    distance_miles: null,
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
    ...overrides,
  };
}

const newtonCustomer: Customer = {
  id: "cust-newton",
  name: "Phil Straghalis",
  company: "Newton Fire & Flood",
  company_id: NEWTON_FIRE_FLOOD_COMPANY_ID,
  email: "phil@newtonfireandflood.com",
  phone: "617-817-1701",
  billing_address: null,
  stripe_customer_id: null,
  auth_user_id: null,
  is_individual: false,
  created_at: new Date().toISOString(),
  onboarding_completed_at: null,
};

describe("defaultInvoiceLineItems", () => {
  it("itemizes a base fee line plus a sample line, priced from sample_counts", () => {
    const job = baseJob({
      service_type: "Limited Asbestos Inspection",
      sample_counts: { "Limited Asbestos Inspection": 6 },
    });
    const items = defaultInvoiceLineItems(job, [asbestosBulk], []);

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ billing_unit: "Base Fee", quantity: 1, unit_cost_cents: 45000 });
    expect(items[1]).toMatchObject({ billing_unit: "Sample", quantity: 6, unit_cost_cents: 2500 });
  });

  it("falls back to the job's own sample_count/per_sample_cents when sample_counts is empty", () => {
    const job = baseJob({
      service_type: "Limited Asbestos Inspection",
      sample_count: 9,
      per_sample_cents: 2500,
    });
    const items = defaultInvoiceLineItems(job, [asbestosBulk], []);

    expect(items).toHaveLength(2);
    expect(items[0].billing_unit).toBe("Base Fee");
    expect(items[1]).toMatchObject({ billing_unit: "Sample", quantity: 9, unit_cost_cents: 2500 });
  });

  it("charges the base fee once but a sample line per service type when a job has more than one", () => {
    const job = baseJob({
      service_type: "Limited Asbestos Inspection, Mold Air Sampling",
      sample_counts: { "Limited Asbestos Inspection": 5, "Mold Air Sampling": 3 },
    });
    const items = defaultInvoiceLineItems(job, [asbestosBulk, moldAir], []);

    const baseFeeRows = items.filter((i) => i.billing_unit === "Base Fee");
    const sampleRows = items.filter((i) => i.billing_unit === "Sample");
    expect(baseFeeRows).toHaveLength(1);
    expect(sampleRows).toHaveLength(2);
    expect(sampleRows.find((r) => r.quantity === 5)?.unit_cost_cents).toBe(2500);
    expect(sampleRows.find((r) => r.quantity === 3)?.unit_cost_cents).toBe(8500);
  });

  it("doubles the per-sample rate for Rush turnaround but never the base fee", () => {
    const job = baseJob({
      service_type: "Limited Asbestos Inspection",
      sample_counts: { "Limited Asbestos Inspection": 4 },
      lab_turnaround: "Rush",
    });
    const items = defaultInvoiceLineItems(job, [asbestosBulk], []);

    expect(items.find((i) => i.billing_unit === "Base Fee")?.unit_cost_cents).toBe(45000);
    expect(items.find((i) => i.billing_unit === "Sample")?.unit_cost_cents).toBe(5000);
  });

  it("never invents a sample line when no sample data exists at all", () => {
    const job = baseJob({ service_type: "Limited Asbestos Inspection" });
    const items = defaultInvoiceLineItems(job, [asbestosBulk], []);

    expect(items).toHaveLength(1);
    expect(items[0].billing_unit).toBe("Base Fee");
  });

  it("adds a 20% rush fee for Newton Fire & Flood, computed off everything else", () => {
    const job = baseJob({
      service_type: "Limited Asbestos Inspection",
      sample_counts: { "Limited Asbestos Inspection": 6 },
      customers: newtonCustomer,
    });
    const items = defaultInvoiceLineItems(job, [asbestosBulk], []);

    // Base fee 45000 + 6 * 2500 = 60000 subtotal -> 20% = 12000
    expect(items).toHaveLength(3);
    expect(items[2]).toMatchObject({
      description: "Rush Fee (Same Day Service and Results)",
      quantity: 1,
      billing_unit: "Fee",
      unit_cost_cents: 12000,
    });
  });

  it("does not add a rush fee for any other company", () => {
    const job = baseJob({
      service_type: "Limited Asbestos Inspection",
      sample_counts: { "Limited Asbestos Inspection": 6 },
      customers: { ...newtonCustomer, id: "cust-other", company_id: "some-other-company-id" },
    });
    const items = defaultInvoiceLineItems(job, [asbestosBulk], []);

    expect(items.some((i) => i.description.includes("Rush Fee"))).toBe(false);
  });

  it("skips the rush fee on a Newton job with nothing priced yet", () => {
    const job = baseJob({ service_type: "Limited Asbestos Inspection", customers: newtonCustomer });
    // No service type settings and no stored base_fee_cents -> resolveBaseFeeCents
    // returns null, so there's no base fee row, no sample rows, and a $0
    // subtotal — nothing for 20% of nothing to attach to.
    const items = defaultInvoiceLineItems(job, [], []);

    expect(items).toHaveLength(0);
  });
});

describe("resolveBaseFeeCents", () => {
  it("uses the matched service type's configured base fee", () => {
    const job = baseJob({ service_type: "Limited Asbestos Inspection" });
    expect(resolveBaseFeeCents(job, [asbestosBulk], [])).toBe(45000);
  });

  it("charges the base fee once even when the job has multiple service types", () => {
    const job = baseJob({ service_type: "Limited Asbestos Inspection, Mold Air Sampling" });
    expect(resolveBaseFeeCents(job, [asbestosBulk, moldAir], [])).toBe(45000);
  });

  it("prefers a region pricing-zone override over the service type's own base fee", () => {
    const job = baseJob({ service_type: "Limited Asbestos Inspection", service_address: "1 Main St, Newton, MA" });
    const zoned = resolveBaseFeeCents(
      job,
      [asbestosBulk],
      [{ name: "Newton premium", base_fee_cents: 60000, towns: ["Newton"] }]
    );
    expect(zoned).toBe(60000);
  });
});
