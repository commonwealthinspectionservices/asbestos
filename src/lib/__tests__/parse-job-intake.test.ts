import { describe, it, expect } from "vitest";
import { parseAcmOrderEmail } from "@/lib/parse-job-intake";

// All three bodies below are real Boston Harbor Water Restoration "ACM
// Order" emails (verbatim, as shown in the actual inbox).
const PETER_LINSKI = `Peter Linski
22 Sunnyplain Ave
Weymouth
781-974-6204
Jack Cook
781-985-7432
2026-08-18
Dining room ceiling`;

const ALLIE_DUFFY = `Allie Duffy
315 Broadway
Somerville, Ma
860-888-2708
Ryan Hammond
339-832-2274
2026-08-17
Entrance flooring, drywall on vent and window wall

Flooring and affected drywall in office and Pilates area`;

const MIKE_DRUMMOND = `Hi, Mike Drummond
27 Spring St
Pembroke
508-577-0653
Ryan Hammond
339-832-2274
2026-08-17
Ceiling and wall in kitchen and hallway area after kitchen`;

describe("parseAcmOrderEmail", () => {
  it("parses a simple single-line scope of work", () => {
    expect(parseAcmOrderEmail(PETER_LINSKI)).toEqual({
      homeownerName: "Peter Linski",
      streetAddress: "22 Sunnyplain Ave",
      town: "Weymouth",
      homeownerPhone: "781-974-6204",
      companyContactName: "Jack Cook",
      companyContactPhone: "781-985-7432",
      requestedDate: "2026-08-18",
      scopeOfWork: "Dining room ceiling",
    });
  });

  it("strips a trailing state abbreviation off the town and joins a multi-paragraph scope", () => {
    const result = parseAcmOrderEmail(ALLIE_DUFFY);
    expect(result?.town).toBe("Somerville");
    expect(result?.scopeOfWork).toBe(
      "Entrance flooring, drywall on vent and window wall Flooring and affected drywall in office and Pilates area"
    );
  });

  it("still parses when the first line has a greeting glued onto the homeowner's name", () => {
    // Real-world quirk: "Hi, Mike Drummond" on one line instead of a
    // separate greeting line — the name field itself just carries the
    // "Hi, " prefix through as-is, left for the admin to notice/edit
    // rather than guessed at.
    const result = parseAcmOrderEmail(MIKE_DRUMMOND);
    expect(result?.homeownerName).toBe("Hi, Mike Drummond");
    expect(result?.streetAddress).toBe("27 Spring St");
    expect(result?.requestedDate).toBe("2026-08-17");
  });

  it("returns null for a body that doesn't match the template at all", () => {
    expect(parseAcmOrderEmail("Hey, just checking in on the invoice for last week's job.")).toBeNull();
  });

  it("returns null when the phone fields aren't real phone numbers", () => {
    const bad = PETER_LINSKI.replace("781-974-6204", "call me maybe");
    expect(parseAcmOrderEmail(bad)).toBeNull();
  });

  it("returns null when the date isn't in YYYY-MM-DD form", () => {
    const bad = PETER_LINSKI.replace("2026-08-18", "8/18/2026");
    expect(parseAcmOrderEmail(bad)).toBeNull();
  });
});
