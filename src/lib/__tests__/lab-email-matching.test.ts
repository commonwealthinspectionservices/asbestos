import { describe, it, expect } from "vitest";
import { matchTransactionToJobGlobally } from "@/lib/lab-email";

const jobs = [
  { projectNumber: "26-0025", serviceAddress: "14 Heather St, Beverly, MA 01915, USA", company: "Boston Harbor Water Restoration" },
  { projectNumber: "26-0026", serviceAddress: "58 Parker Rd, Wellesley, MA 02482", company: "WSF Construction Services Inc." },
  { projectNumber: "26-0019", serviceAddress: "91 Belcher Ave, Brockton, MA 02301", company: "IPDL Holdings Inc. DBA Restore to New" },
  { projectNumber: "26-0002", serviceAddress: "36 Drummer Rd, Acton, MA 01720", company: "Newton Fire & Flood" },
  { projectNumber: "26-0002.1", serviceAddress: "36 Drummer Rd, Acton, MA 01720", company: "Newton Fire & Flood" },
];

describe("matchTransactionToJobGlobally", () => {
  it("matches on the street line even when the town is misspelled", () => {
    expect(matchTransactionToJobGlobally("14 Heather St., Beverley MA", jobs)).toBe("26-0025");
    expect(matchTransactionToJobGlobally("58 Parker Rd., Wellesley, MA", jobs)).toBe("26-0026");
  });

  it("matches a company-name-only billing line to that company's one job", () => {
    expect(matchTransactionToJobGlobally("Restore to New", jobs)).toBe("26-0019");
  });

  it("refuses an ambiguous address (a revisit shares its parent's address)", () => {
    expect(matchTransactionToJobGlobally("36 Drummer Rd, Acton MA", jobs)).toBeNull();
  });

  it("returns null when nothing matches or there's no address", () => {
    expect(matchTransactionToJobGlobally("1 Nowhere Ln, Boston, MA", jobs)).toBeNull();
    expect(matchTransactionToJobGlobally(null, jobs)).toBeNull();
    expect(matchTransactionToJobGlobally("Some Unknown Company", jobs)).toBeNull();
  });
});
