import { describe, it, expect } from "vitest";
import { computeLabCostCentsFromDocuments } from "../lab-cost";
import type { JobDocument } from "../types";

function doc(overrides: Partial<JobDocument>): JobDocument {
  return {
    id: overrides.id ?? "doc-1",
    kind: "lab_invoice",
    service_type: "Limited Asbestos Inspection",
    file_name: "lab-invoice.pdf",
    storage_path: "job-1/doc-1-lab-invoice.pdf",
    uploaded_at: "2026-08-26T12:00:00.000Z",
    project_number_mismatch: null,
    ...overrides,
  };
}

describe("computeLabCostCentsFromDocuments", () => {
  it("returns 0 for a job with no lab_invoice documents", () => {
    expect(computeLabCostCentsFromDocuments([])).toBe(0);
    expect(computeLabCostCentsFromDocuments([doc({ kind: "lab_report", amount_cents: 5000 })])).toBe(0);
  });

  it("sums a single invoice's amount", () => {
    expect(computeLabCostCentsFromDocuments([doc({ lab_invoice_number: "6491", amount_cents: 9600 })])).toBe(9600);
  });

  it("dedupes per-service-type-label copies of the same real invoice (mixed asbestos+mold job, #6491/26-0002)", () => {
    // Confirmed against the real invoice: 12 asbestos + 4 mold air + 1 mold
    // bulk, one shared invoice, $244.00 total — filed as 3 separate
    // JobDocument rows (one per label) all carrying the identical amount.
    const documents = [
      doc({ id: "a", service_type: "Limited Asbestos Inspection", lab_invoice_number: "6491", amount_cents: 24400 }),
      doc({ id: "b", service_type: "Mold Air Sampling", lab_invoice_number: "6491", amount_cents: 24400 }),
      doc({ id: "c", service_type: "Mold Bulk Sampling", lab_invoice_number: "6491", amount_cents: 24400 }),
    ];
    expect(computeLabCostCentsFromDocuments(documents)).toBe(24400);
  });

  it("sums across distinct invoice numbers for the same job (26-0007: three separate Sales Receipts)", () => {
    const documents = [
      doc({ id: "a", lab_invoice_number: "6506", amount_cents: 12000 }),
      doc({ id: "b", lab_invoice_number: "6510", amount_cents: 4000 }),
      doc({ id: "c", lab_invoice_number: "6512", amount_cents: 6000 }),
    ];
    expect(computeLabCostCentsFromDocuments(documents)).toBe(22000);
  });

  it("nets a Refund's negative amount against the same job's other invoices", () => {
    const documents = [
      doc({ id: "a", lab_invoice_number: "6504", amount_cents: 4800 }),
      doc({ id: "b", lab_invoice_number: "6505", amount_cents: -4800 }),
    ];
    expect(computeLabCostCentsFromDocuments(documents)).toBe(0);
  });

  it("skips a document with no amount_cents yet (not backfilled) instead of treating it as $0", () => {
    const documents = [
      doc({ id: "a", lab_invoice_number: "6491", amount_cents: null }),
      doc({ id: "b", lab_invoice_number: "6497", amount_cents: 12000 }),
    ];
    expect(computeLabCostCentsFromDocuments(documents)).toBe(12000);
  });

  it("falls back to the document's own id when there's no invoice number (an EMSL invoice), so two unrelated EMSL invoices don't collapse into one", () => {
    const documents = [
      doc({ id: "a", lab_invoice_number: null, amount_cents: 8480 }),
      doc({ id: "b", lab_invoice_number: null, amount_cents: 4240 }),
    ];
    expect(computeLabCostCentsFromDocuments(documents)).toBe(12720);
  });
});
