import { describe, it, expect } from "vitest";
import { renderBlankCocPdf } from "@/lib/blank-coc-pdf";
import { renderMoldCocPdf, type MoldSampleType } from "@/lib/mold-coc-pdf";
import type { Job, Customer, Settings, SampleItem } from "@/lib/types";

// Both renderers only ever read a handful of job/customer fields (see
// their own JSX) — a minimal cast avoids hand-filling the full ~100-field
// Job type for a PDF-rendering smoke test (same approach invoice-due-
// date.test.ts's own job() helper takes, for the same reason).
const job = {
  project_number: "26-9001",
  confirmed_date: "2026-09-28",
  requested_date: null,
  service_address: "50 Broadway Unit 2, Somerville, MA 02145",
  lab_date_needed: null,
} as unknown as Job;

const customer = { company: "Newton Fire & Flood", name: null } as unknown as Customer;

const settings = {
  inspectors: [{ name: "Timothy Hall", title: "Project Manager", license_number: "AI901405" }],
} as unknown as Settings;

const sampleItems: SampleItem[] = [
  { sample_number: "1", material: "Plaster ceiling", location: "Bedroom — inside containment" },
  { sample_number: "2A", material: "Paper on top side of ceiling under pipes", location: "Bedroom — inside containment" },
];

const relinquishedBy = { name: "Tim Hall", date: "09/28/2026", time: "11:36 AM" };

describe("renderBlankCocPdf (asbestos bulk)", () => {
  it("renders a valid PDF with the traditional blank table (no electronic-COC fields passed)", async () => {
    const pdf = await renderBlankCocPdf({ job: null, customer: null, settings });
    expect(pdf.subarray(0, 4).toString("utf-8")).toBe("%PDF");
  });

  it("renders a valid PDF with real sample rows, a circled turnaround, and a filled Relinquished By line", async () => {
    const pdf = await renderBlankCocPdf({ job, customer, settings, sampleItems, turnaround: "Rush", relinquishedBy });
    expect(pdf.subarray(0, 4).toString("utf-8")).toBe("%PDF");
  });

  it("renders across the continuation page when there are more than 20 samples", async () => {
    const many: SampleItem[] = Array.from({ length: 25 }, (_, i) => ({ sample_number: String(i + 1), material: "Drywall", location: "Kitchen" }));
    const pdf = await renderBlankCocPdf({ job, customer, settings, sampleItems: many, turnaround: "24-Hr", relinquishedBy });
    expect(pdf.subarray(0, 4).toString("utf-8")).toBe("%PDF");
  });
});

describe("renderMoldCocPdf", () => {
  const types: MoldSampleType[] = ["air_o_cell", "bulk", "swab"];

  for (const sampleType of types) {
    it(`renders a valid blank PDF for ${sampleType}`, async () => {
      const pdf = await renderMoldCocPdf({ job: null, customer: null, settings, sampleType });
      expect(pdf.subarray(0, 4).toString("utf-8")).toBe("%PDF");
    });

    it(`renders a valid filled-in PDF for ${sampleType} (real rows, circled turnaround, Relinquished By)`, async () => {
      const pdf = await renderMoldCocPdf({ job, customer, settings, sampleType, sampleItems, turnaround: "Rush", relinquishedBy });
      expect(pdf.subarray(0, 4).toString("utf-8")).toBe("%PDF");
    });
  }
});
