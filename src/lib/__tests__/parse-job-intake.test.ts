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

// A real order (Geraldine Burns/61 Partridge St) that the bare-format
// parser rejected outright — Boston Harbor Water switched to this labeled
// shape at some point, confirmed live 2026-08-24 (it never even reached
// the "couldn't parse" alert as a recognized-but-broken order; the whole
// email just wasn't recognized as this sender's pattern until this format
// was added). Includes the real trailing signature block, verbatim.
const GERALDINE_BURNS_LABELED = `Hey Tim,

Customer Name
Geraldine Burns
Customer Address
61 Partridge st
City
West Roxbury
Customer Phone
617-678-1565
BHWR contact
Niall
BHWR contact phone
857-939-7890
Date needed
2026-08-24
Description
Alvin Kamara jersey wall, the ceiling above it, hardwood flooring beneath it. Thank you!

--
Jack Cook
*Boston Harbor Water Restoration*
781-985-7432
bostonharborwater.com`;

describe("parseAcmOrderEmail", () => {
  it("parses a simple single-line scope of work", () => {
    expect(parseAcmOrderEmail(PETER_LINSKI)).toEqual({
      homeownerName: "Peter Linski",
      streetAddress: "22 Sunnyplain Ave",
      town: "Weymouth",
      stateHint: null,
      homeownerPhone: "781-974-6204",
      companyContactName: "Jack Cook",
      companyContactPhone: "781-985-7432",
      requestedDate: "2026-08-18",
      scopeOfWork: "Dining room ceiling",
    });
  });

  it("captures a trailing state abbreviation off the town (not silently discarded) and joins a multi-paragraph scope", () => {
    const result = parseAcmOrderEmail(ALLIE_DUFFY);
    expect(result?.town).toBe("Somerville");
    expect(result?.stateHint).toBe("MA");
    expect(result?.scopeOfWork).toBe(
      "Entrance flooring, drywall on vent and window wall Flooring and affected drywall in office and Pilates area"
    );
  });

  it("captures a non-MA state hint instead of assuming Massachusetts", () => {
    const nhOrder = PETER_LINSKI.replace("Weymouth", "Nashua, NH");
    const result = parseAcmOrderEmail(nhOrder);
    expect(result?.town).toBe("Nashua");
    expect(result?.stateHint).toBe("NH");
  });

  it("returns null when the name and street-address lines are swapped", () => {
    // A real street address always has a house number; a name never does.
    const swapped = "22 Sunnyplain Ave\nPeter Linski\nWeymouth\n781-974-6204\nJack Cook\n781-985-7432\n2026-08-18\nDining room ceiling";
    expect(parseAcmOrderEmail(swapped)).toBeNull();
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

  it("drops a standalone greeting line before the template starts", () => {
    // Real-world quirk from an actual forwarded order: "Hi," on its own
    // line (with a blank line after it), rather than glued to the name.
    const withGreeting = `Hi,\n\n${PETER_LINSKI}`;
    expect(parseAcmOrderEmail(withGreeting)).toEqual(parseAcmOrderEmail(PETER_LINSKI));
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

  it("parses the labeled format (Customer Name / value pairs), stopping the description at the signature", () => {
    expect(parseAcmOrderEmail(GERALDINE_BURNS_LABELED)).toEqual({
      homeownerName: "Geraldine Burns",
      streetAddress: "61 Partridge st",
      town: "West Roxbury",
      stateHint: null,
      homeownerPhone: "617-678-1565",
      companyContactName: "Niall",
      companyContactPhone: "857-939-7890",
      requestedDate: "2026-08-24",
      scopeOfWork: "Alvin Kamara jersey wall, the ceiling above it, hardwood flooring beneath it. Thank you!",
    });
  });

  it("returns null for a labeled email missing a required field", () => {
    const missingCity = GERALDINE_BURNS_LABELED.replace("City\nWest Roxbury\n", "");
    expect(parseAcmOrderEmail(missingCity)).toBeNull();
  });
});
