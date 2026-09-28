import { describe, it, expect } from "vitest";
import { matchTransactionToJobGlobally } from "@/lib/lab-email";

const jobs = [
  { projectNumber: "26-0025", serviceAddress: "14 Heather St, Beverly, MA 01915, USA", company: "Boston Harbor Water Restoration", status: "report_invoice_sent" },
  { projectNumber: "26-0026", serviceAddress: "58 Parker Rd, Wellesley, MA 02482", company: "WSF Construction Services Inc.", status: "report_invoice_sent" },
  { projectNumber: "26-0019", serviceAddress: "91 Belcher Ave, Brockton, MA 02301", company: "IPDL Holdings Inc. DBA Restore to New", status: "report_invoice_sent" },
  { projectNumber: "26-0002", serviceAddress: "36 Drummer Rd, Acton, MA 01720", company: "Newton Fire & Flood", status: "report_invoice_sent" },
  { projectNumber: "26-0002.1", serviceAddress: "36 Drummer Rd, Acton, MA 01720", company: "Newton Fire & Flood", status: "report_invoice_sent" },
];

describe("matchTransactionToJobGlobally", () => {
  it("matches on the street line even when the town is misspelled", () => {
    expect(matchTransactionToJobGlobally("14 Heather St., Beverley MA", jobs)).toBe("26-0025");
    expect(matchTransactionToJobGlobally("58 Parker Rd., Wellesley, MA", jobs)).toBe("26-0026");
  });

  it("matches a company-name-only billing line to that company's one job", () => {
    expect(matchTransactionToJobGlobally("Restore to New", jobs)).toBe("26-0019");
  });

  it("refuses an ambiguous address when more than one candidate is still awaiting lab results (or none are)", () => {
    expect(matchTransactionToJobGlobally("36 Drummer Rd, Acton MA", jobs)).toBeNull();
  });

  // Per Tim, 2026-09-28 (Sales Receipt #6932, 50 Broadway Unit 2,
  // Somerville — Newton Fire & Flood) — 26-0041/26-0041.1/26-0041.2 all
  // share one address, but only the still-open revisit could possibly be
  // the right one; the other two are already closed out.
  it("resolves an address shared by several jobs to the one still awaiting lab results", () => {
    const withRevisit = [
      ...jobs,
      { projectNumber: "26-0041", serviceAddress: "50 Broadway Unit 2, Somerville, MA 02145", company: "Newton Fire & Flood", status: "report_invoice_sent" },
      { projectNumber: "26-0041.1", serviceAddress: "50 Broadway Unit 2, Somerville, MA 02145", company: "Newton Fire & Flood", status: "report_invoice_sent" },
      { projectNumber: "26-0041.2", serviceAddress: "50 Broadway Unit 2, Somerville, MA 02145", company: "Newton Fire & Flood", status: "pending_lab_results" },
    ];
    expect(matchTransactionToJobGlobally("50 Broadway Unit 2, Somerville MA", withRevisit)).toBe("26-0041.2");
  });

  it("returns null when nothing matches or there's no address", () => {
    expect(matchTransactionToJobGlobally("1 Nowhere Ln, Boston, MA", jobs)).toBeNull();
    expect(matchTransactionToJobGlobally(null, jobs)).toBeNull();
    expect(matchTransactionToJobGlobally("Some Unknown Company", jobs)).toBeNull();
  });
});
