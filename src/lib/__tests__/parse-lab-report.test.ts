import { describe, it, expect } from "vitest";
import { extractSampleCount, detectAsbestosResult, extractSampleResults, extractReportProjectNumber, extractReportProjectAddress, detectLabInfo, extractMoldSampleCount, extractMoldSampleResults } from "../parse-lab-report";

// Excerpts of real EMSL bulk asbestos PLM report text, exactly as pdf-parse
// extracts it (value-before-label ordering and all — PDF text extraction
// follows the content stream's draw order, not visual reading order, so
// "132605192\nEMSL Order:" is what actually comes out, not the reverse).
const REPORT_8_SAMPLES = `
EMSL Analytical, Inc.
5 Constitution Way, Unit A Woburn, MA  01801
132605192
EMSL Order:
Customer ID:
FLIE62
Project:
26-2752 - 21 Plain Road; Weston, MA
SampleDescriptionAppearance% Fibrous% Non-Fibrous
01A
132605192-0001
None DetectedNon-fibrous (Other)88%
01B
132605192-0002
None DetectedNon-fibrous (Other)88%
02A
132605192-0003
None DetectedNon-fibrous (Other)100%
02B
132605192-0004
None DetectedNon-fibrous (Other)100%
03A
132605192-0005
None DetectedNon-fibrous (Other)88%
03B
132605192-0006
None DetectedNon-fibrous (Other)88%
04A
132605192-0007
None DetectedNon-fibrous (Other)100%
04B
132605192-0008
None DetectedNon-fibrous (Other)100%
Samples analyzed by EMSL Analytical, Inc. Woburn, MA NVLAP Lab Code 101147-0, CT PH-0315, MA AA000188
`;

const REPORT_10_SAMPLES = `
EMSL Analytical, Inc.
132605194
EMSL Order:
Customer ID:
FLIE62
Project:
26-2760 - 184 Dedham Street; Canton, MA
01A
132605194-0001
None DetectedNon-fibrous (Other)60%
01B
132605194-0002
None DetectedNon-fibrous (Other)60%
02A
132605194-0003
None DetectedNon-fibrous (Other)100%
02B
132605194-0004
None DetectedNon-fibrous (Other)100%
03A
132605194-0005
15% Chrysotile
03B
132605194-0006
15% Chrysotile
04A
132605194-0007
None DetectedNon-fibrous (Other)100%
04B
132605194-0008
None DetectedNon-fibrous (Other)100%
05A
132605194-0009
None DetectedNon-fibrous (Other)90%
05B
132605194-0010
None DetectedNon-fibrous (Other)90%
Samples analyzed by EMSL Analytical, Inc. Woburn, MA NVLAP Lab Code 101147-0, CT PH-0315, MA AA000188
`;

// Real Crystal Analytical report (their 2nd lab, distinct format from
// EMSL's — no per-sample lab ID at all, just a "Client ID" field code, and
// the "Project ID"/"Project Name" label ends up separated from its value
// by an entire block of other labels/values in the linearized text). All
// 10 samples negative.
const CRYSTAL_ANALYTICAL_NEGATIVE = `
Laboratory ID:
Project Address:
Project Name:
MA DLS - License # AA000259
CT DPH - Registration # PH-0838
RI DoH - Certification # PLM00163
NVLAP - Lab Code 600387-0
Enclosed are the results for your project at 400 New River Rd., Apt 708, Manville RI.
These samples were analyzed for asbestos via Calibrated Visual Estimation (CVE) following the U. S.
Environmental Protection Agency (EPA) Interim Method for the Determination of Asbestos in Bulk Insulation
Samples (EPA 600/M4-82-020) as found in 40 CFR, Part 763, Appendix E to Subpart E and supplemental
methods such as U. S. EPA Method for the Determination of Asbestos in Bulk Building Materials (EPA/600/R-
93/116, July 1993) as necessary.
2601002883
400 New River Rd., Apt 708, Manville RI
26-2603
To Tim Hall
Crystal Analytical LLC
Client IDItem ID
Physical
Attributes
0001GrayCellulose
Semi-Fibrous
Homogeneous
05BMastic (Black) on Bathroom Adhesive, Apt
708 - Bathroom
None Detected
05AMastic (Black) on Bathroom Adhesive, Apt
708 - Bathroom
None Detected
04BWall Tile Adhesive, Apt 708 - BathroomNone Detected
04AWall Tile Adhesive, Apt 708 - BathroomNone Detected
03BCeiling Tile, Apt 708 - Bathroom
35%
None Detected
35%
03ACeiling Tile, Apt 708 - Bathroom
35%
None Detected
35%
02BDrywall Wall Skim, Apt 708 - BathroomNone Detected
02ADrywall Wall Skim, Apt 708 - BathroomNone Detected
01BDrywall Wall Base, Apt 708 - Bathroom
10%
None Detected
Description & Location
Non-Asbestos
Fibrous Components
Asbestos %
01ADrywall Wall Base, Apt 708 - Bathroom
10%
None Detected
Project Name:26-2603
LABORATORY ID: 2601002883
Project Address:400 New River Rd., Apt 708, Manville RI
Crystal Analytical, LLC.      •       55 Accord Park Dr., Ste. 2D; Rockland, MA 02370      •      (781) 347-3936
`;

// Real Crystal Analytical report with a genuine positive result — two
// different splits confirmed in the wild: "10%\nChrysotile" (percentage and
// mineral stay adjacent) and "...BaseChrysotile" (mineral runs straight
// into the previous word with zero space, AND its own percentage landed
// far away in an unrelated part of the text entirely).
const CRYSTAL_ANALYTICAL_POSITIVE = `
Laboratory ID:
Project Address:
Project Name:
Enclosed are the results for your project at 221 Oak St., Brockton, MA.
2601003063
221 Oak St., Brockton, MA
Building 12, Unit# 11
To Tim Hall
Crystal Analytical LLC
Client IDItem ID
Physical
Attributes
0001White/Yellow
25%
Semi-Fibrous
Homogeneous
05BAssoc Adhesive 04B, Kitchen- Base LayerNone Detected
05AAssoc Adhesive 04A, Kitchen- Base LayerNone Detected
04BBrown Vinyl Sheet Floor, Kitchen- Base
Layer
10%
Chrysotile
04ABrown Vinyl Sheet Floor, Kitchen- Base
Layer
10%
Chrysotile
03BMastic 02B, Kitchen- Top LayerNone Detected
03AMastic 02A, Kitchen- Top LayerNone Detected
02BTan Vinyl Sheet Floor, Kitchen- Top LayerNone Detected
02ATan Vinyl Sheet Floor, Kitchen- Top LayerNone Detected
01BWhite Mastic, Kitchen- On Concrete BaseChrysotile
Description & Location
Non-Asbestos
Fibrous Components
Asbestos %
01AWhite Mastic, Kitchen- On Concrete BaseChrysotile
Project Name:Building 12, Unit# 11
LABORATORY ID: 2601003063
Project Address:221 Oak St., Brockton, MA
Crystal Analytical, LLC.      •       55 Accord Park Dr., Ste. 2D; Rockland, MA 02370      •      (781) 347-3936
`;

// Real Crystal Analytical report (job 26-0005, confirmed live 2026-08-26)
// where two rows' own material description cites a *different* sample's
// field code in parentheses ("Drywall Joint Compound (01A)" — the joint
// compound that goes with wall base 01A) rather than the plain-space
// phrasing ("Assoc Adhesive 04B, Kitchen...") the fixture above already
// covers. "(01A)" isn't preceded by a space, so it slipped past that
// exclusion and got mistaken for 02A's own next-row boundary — truncating
// 02A's window before it ever reached its actual result and silently
// dropping both 02A and 02B from the report (6 samples counted, not 8).
const CRYSTAL_ANALYTICAL_PARENTHETICAL_REFERENCE = `
Physical Non-Asbestos
Description & Location Asbestos %
Client ID Item ID
Attributes Fibrous Components
3%
01A 0001 Drywall Wall Base, Back Left Closet White Cellulose None Detected
Semi-Fibrous
Homogeneous
01B 0002 Drywall Wall Base, Back Left Closet White 3% Cellulose None Detected
Semi-Fibrous
Homogeneous
02A 0003 Drywall Joint Compound (01A), Back Left White None Detected
Closet Non-Fibrous
Homogeneous
02B 0004 Drywall Joint Compound (01B), Back Left White None Detected
Closet Non-Fibrous
Homogeneous
03A 0005 Sheet Rock Ceiling Base, Back Left Closet White 3% Cellulose None Detected
Semi-Fibrous
Homogeneous
03B 0006 Sheet Rock Ceiling Base, Back Left Closet White 3% Cellulose None Detected
Semi-Fibrous
Homogeneous
04A 0007 Sheet Rock Ceiling Skim Layer, Back Left White None Detected
Closet Non-Fibrous
Homogeneous
04B 0008 Sheet Rock Ceiling Skim Layer, Back Left White None Detected
Closet Non-Fibrous
Homogeneous
`;

// Real report where 2 of the 16 rows are "Layer Not Present" — the layer
// the field tech expected to sample wasn't actually there, so the lab never
// reported a real result for it. Those two still get a field code and lab
// ID like any other row, but shouldn't count as completed samples (14, not
// 16) since neither "None Detected" nor a positive % ever showed up.
const REPORT_WITH_LAYER_NOT_PRESENT = `
EMSL Analytical, Inc.
132604806
EMSL Order:
Customer ID:
FLIE62
Project:
26-2605 - 192 Commonwealth Avenue; Boston, MA
01A
132604806-0001
None DetectedNon-fibrous (Other)100%Gray/Black
01B
132604806-0002
None DetectedNon-fibrous (Other)100%Gray/Black
01C
132604806-0003
None DetectedNon-fibrous (Other)100%White/Black
01D
132604806-0004
None DetectedNon-fibrous (Other)100%White/Black
01E
132604806-0005
None DetectedNon-fibrous (Other)100%White/Black
01F
132604806-0006
None DetectedNon-fibrous (Other)100%White/Black
01G
132604806-0007
None DetectedNon-fibrous (Other)90%Cellulose10%Tan/White/Black
01H
132604806-0008
None DetectedNon-fibrous (Other)100%Black
02A
132604806-0009
Layer Not Present
9th Floor - Right Wall
- Wall Board Skim
02B
132604806-0010
Layer Not Present
9th Floor - Right Wall
- Wall Board Skim
03A
132604806-0011
None DetectedNon-fibrous (Other)85%Cellulose15%Tan/White
03B
132604806-0012
None DetectedNon-fibrous (Other)85%Cellulose15%Tan/White
01I
132604806-0013
None DetectedNon-fibrous (Other)100%Hair<1%Gray/White
01H
132604806-0014
None DetectedNon-fibrous (Other)100%Hair<1%Gray/White
04A
132604806-0015
None DetectedNon-fibrous (Other)100%Gray/White
04B
132604806-0016
None DetectedNon-fibrous (Other)100%Gray/White
Samples analyzed by EMSL Analytical, Inc. Woburn, MA NVLAP Lab Code 101147-0, CT PH-0315, MA AA000188
`;

describe("extractSampleCount", () => {
  it("counts 8 samples in the first real EMSL report", () => {
    expect(extractSampleCount(REPORT_8_SAMPLES)).toBe(8);
  });

  it("counts 10 samples in the second real EMSL report", () => {
    expect(extractSampleCount(REPORT_10_SAMPLES)).toBe(10);
  });

  it("excludes rows marked Layer Not Present from the count (14, not 16)", () => {
    expect(extractSampleCount(REPORT_WITH_LAYER_NOT_PRESENT)).toBe(14);
  });

  it("excludes a row with no real result (insufficient material, sample not provided, etc.)", () => {
    // Rows like this can carry any wording — "Insufficient Sample",
    // "Sample Not Provided", "Layer Not Present" — since a real result is
    // always either "None Detected" or a positive %, we just check for
    // those two rather than trying to enumerate every "not analyzed" phrase.
    const text = `
      132600000
      EMSL Order:
      132600000-0001
      None DetectedNon-fibrous (Other)100%
      132600000-0002
      Insufficient Sample
      132600000-0003
      None DetectedNon-fibrous (Other)100%
    `;
    expect(extractSampleCount(text)).toBe(2);
  });

  // Real 2-page, 18-row report where one row (07B) came back "Positive Stop
  // (Not Analyzed)" — a phrase this admin doesn't otherwise use, included
  // here only to confirm the allow-list approach excludes an unfamiliar
  // "not analyzed" phrasing correctly without needing its own dedicated rule.
  it("excludes a row with an unfamiliar not-analyzed result, across a 2-page report", () => {
    const text = `
      132507283
      EMSL Order:
      1210-01A
      132507283-0001
      None DetectedNon-fibrous (Other)100%
      1210-07A
      132507283-0014
      6% Chrysotile94%Non-fibrous (Other)Black
      1210-07B
      132507283-0015
      Positive Stop (Not Analyzed)
      Middle Skylight on
      Roof - Black Skylight
      Window Sealer
      1210-08A
      132507283-0016
      None DetectedNon-fibrous (Other)100%
      Page 1 of 2
      132507283
      EMSL Order:
      1210-08B
      132507283-0017
      None DetectedNon-fibrous (Other)100%
      1210-09A
      132507283-0018
      12% Chrysotile88%Non-fibrous (Other)Black
      Page 2 of 2
    `;
    expect(extractSampleCount(text)).toBe(5);
  });

  it("returns null when there's nothing resembling a sample ID", () => {
    expect(extractSampleCount("Some other lab's report with no matching IDs at all")).toBeNull();
  });

  it("de-duplicates a sample ID that appears twice", () => {
    const text = `
      132605192
      EMSL Order:
      132605192-0001
      None Detected
      132605192-0001
      None Detected
      132605192-0002
      None Detected
    `;
    expect(extractSampleCount(text)).toBe(2);
  });

  it("picks the largest repeating prefix, ignoring one-off unrelated dash-digit matches", () => {
    const text = `
      NVLAP Lab Code 101147-0000
      None Detected
      132605192-0001
      None Detected
      132605192-0002
      None Detected
      132605192-0003
      None Detected
    `;
    expect(extractSampleCount(text)).toBe(3);
  });
});

describe("detectAsbestosResult", () => {
  it("is negative when every sample in a real report came back None Detected", () => {
    expect(detectAsbestosResult(REPORT_8_SAMPLES)).toBe("negative");
  });

  it("is positive when any sample carries a percentage + regulated mineral, even alongside mostly-negative samples", () => {
    expect(detectAsbestosResult(REPORT_10_SAMPLES)).toBe("positive");
  });

  it("is negative when the only non-result rows are Layer Not Present, not positive", () => {
    expect(detectAsbestosResult(REPORT_WITH_LAYER_NOT_PRESENT)).toBe("negative");
  });

  it("returns null when there's nothing resembling a sample ID", () => {
    expect(detectAsbestosResult("Some other lab's report with no matching IDs at all")).toBeNull();
  });

  it("is positive from a single positive row across a 2-page report with an unfamiliar not-analyzed phrase", () => {
    const text = `
      132507283
      EMSL Order:
      1210-01A
      132507283-0001
      None DetectedNon-fibrous (Other)100%
      1210-07A
      132507283-0014
      6% Chrysotile94%Non-fibrous (Other)Black
      1210-07B
      132507283-0015
      Positive Stop (Not Analyzed)
      1210-08A
      132507283-0016
      None DetectedNon-fibrous (Other)100%
      Page 1 of 2
    `;
    expect(detectAsbestosResult(text)).toBe("positive");
  });
});

describe("extractSampleResults", () => {
  it("pulls each sample's field code and exact result text from a real report", () => {
    expect(extractSampleResults(REPORT_8_SAMPLES)).toEqual([
      { fieldCode: "01A", result: "None Detected" },
      { fieldCode: "01B", result: "None Detected" },
      { fieldCode: "02A", result: "None Detected" },
      { fieldCode: "02B", result: "None Detected" },
      { fieldCode: "03A", result: "None Detected" },
      { fieldCode: "03B", result: "None Detected" },
      { fieldCode: "04A", result: "None Detected" },
      { fieldCode: "04B", result: "None Detected" },
    ]);
  });

  it("carries through positive results with their exact percentage and mineral", () => {
    const results = extractSampleResults(REPORT_10_SAMPLES);
    expect(results.find((r) => r.fieldCode === "03A")).toEqual({ fieldCode: "03A", result: "15% Chrysotile" });
    expect(results.find((r) => r.fieldCode === "03B")).toEqual({ fieldCode: "03B", result: "15% Chrysotile" });
    expect(results).toHaveLength(10);
  });

  it("inserts a space between a percentage and mineral name when the real report has none", () => {
    const text = `
      132605194
      EMSL Order:
      03A
      132605194-0005
      15%Chrysotile
    `;
    expect(extractSampleResults(text)).toEqual([{ fieldCode: "03A", result: "15% Chrysotile" }]);
  });

  it("excludes Layer Not Present rows, same as the sample count", () => {
    const results = extractSampleResults(REPORT_WITH_LAYER_NOT_PRESENT);
    expect(results).toHaveLength(14);
    expect(results.some((r) => r.fieldCode === "02A")).toBe(false);
    expect(results.some((r) => r.fieldCode === "02B")).toBe(false);
  });

  it("returns an empty array when there's nothing resembling a sample ID", () => {
    expect(extractSampleResults("Some other lab's report with no matching IDs at all")).toEqual([]);
  });
});

describe("extractReportProjectNumber", () => {
  it("pulls the project number off the Project: line in a real report", () => {
    expect(extractReportProjectNumber(REPORT_8_SAMPLES)).toBe("26-2752");
  });

  it("pulls it from a different real report too", () => {
    expect(extractReportProjectNumber(REPORT_10_SAMPLES)).toBe("26-2760");
  });

  it("returns null when there's no Project: line at all", () => {
    expect(extractReportProjectNumber("Some other lab's report with no Project line")).toBeNull();
  });

  it("falls back to FLI's own number shape for Crystal Analytical's 'Project Name:' label", () => {
    expect(extractReportProjectNumber(CRYSTAL_ANALYTICAL_NEGATIVE)).toBe("26-2603");
  });

  it("doesn't mistake a regulatory citation for a project number", () => {
    // "EPA 600/M4-82-020" contains "82-020", which fits \d{2}-\d{3,6} —
    // must not be picked up as the project number.
    expect(extractReportProjectNumber("Method (EPA 600/M4-82-020) as found in 40 CFR")).toBeNull();
  });
});

// Confirmed live 2026-08-26, job 26-0004 ("690 Blue Hill Ave") — Crystal
// Analytical's own cover-letter sentence is the fallback source for a
// report whose project number was only ever handwritten on the scanned
// chain-of-custody page (not machine-readable text at all), so
// extractReportProjectNumber found nothing to match on.
describe("extractReportProjectAddress", () => {
  it("pulls the address out of Crystal Analytical's cover-letter sentence", () => {
    const text = "To Tim Hall\nEnclosed are the results for your project at 690 Blue Hill Ave, Dorchester, MA.\nThese samples were analyzed";
    expect(extractReportProjectAddress(text)).toBe("690 Blue Hill Ave, Dorchester, MA");
  });

  it("returns null when that sentence isn't present at all", () => {
    expect(extractReportProjectAddress("Some other lab's report with no matching sentence")).toBeNull();
  });
});

describe("detectLabInfo", () => {
  it("recognizes an EMSL report and returns its standing lab info", () => {
    expect(detectLabInfo(REPORT_8_SAMPLES)).toEqual({
      labName: "EMSL Analytical, Inc.",
      nistCert: "101147-0",
      massdlsCert: "AA000188",
    });
  });

  it("recognizes a Crystal Analytical report and returns its standing lab info", () => {
    expect(detectLabInfo(CRYSTAL_ANALYTICAL_NEGATIVE)).toEqual({
      labName: "Crystal Analytical, LLC.",
      nistCert: "600387-0",
      massdlsCert: "AA000259",
    });
  });

  it("returns null for a report from a different (unrecognized) lab", () => {
    expect(detectLabInfo("Some other lab's report with no matching mention at all")).toBeNull();
  });
});

// Real 2-sample Crystal Analytical report where the column draw order
// wasn't consistent row-to-row: 01A's own "None Detected" landed *before*
// the "01A" field code text, while 01B's landed after it as usual — this
// used to make extractSampleCount return 1 instead of 2, since 01A's
// forward-only window (up to the next field code) never saw its result.
const CRYSTAL_ANALYTICAL_RESULT_BEFORE_FIELD_CODE = `
Laboratory ID:
Project Address:
Project Name:
FLI Project #:
MA DLS - License # AA000259
Crystal Analytical LLC
55 Accord Park Drive, Suite 2D
Rockland, MA 02370
2601003391
26 Hallowell St., Mattapan, MA
26-2925
Client IDItem ID
Physical
Attributes
0001Gray
Non-Fibrous
Homogeneous
0002Gray
Non-Fibrous
Homogeneous
08/07/26
08/07/26
None Detected
08/07/26
08/07/26
LABORATORY ID: 2601003391
Test Report for the Analysis of Asbestos in Bulk Materials - Calibrated Visual Estimation via
Polarized Light Microscopy
01A
Description & Location
Gray tile associated adhesive, Kitchen
floor
Gray tile associated adhesive, Kitchen
floor
01B
Non-Asbestos
Fibrous Components
None Detected
Asbestos %
`;

describe("Crystal Analytical report format", () => {
  it("counts all 10 samples in a real negative report", () => {
    expect(extractSampleCount(CRYSTAL_ANALYTICAL_NEGATIVE)).toBe(10);
  });

  it("calls a real negative report negative", () => {
    expect(detectAsbestosResult(CRYSTAL_ANALYTICAL_NEGATIVE)).toBe("negative");
  });

  it("counts all 10 samples in a real positive report", () => {
    expect(extractSampleCount(CRYSTAL_ANALYTICAL_POSITIVE)).toBe(10);
  });

  it("calls a real positive report positive", () => {
    expect(detectAsbestosResult(CRYSTAL_ANALYTICAL_POSITIVE)).toBe("positive");
  });

  it("still reports a bare mineral name (no adjacent percentage) as that sample's result", () => {
    const results = extractSampleResults(CRYSTAL_ANALYTICAL_POSITIVE);
    const row01A = results.find((r) => r.fieldCode === "01A");
    expect(row01A?.result).toBe("Chrysotile");
  });

  it("reports a percentage-and-mineral result cleanly even when they came out on separate lines", () => {
    const results = extractSampleResults(CRYSTAL_ANALYTICAL_POSITIVE);
    const row04A = results.find((r) => r.fieldCode === "04A");
    expect(row04A?.result).toBe("10% Chrysotile");
  });

  it("doesn't miscount a field code that runs straight into a description with no space", () => {
    // "...Kitchen01B\nNone Detected" — code glued onto the previous word,
    // must still be recognized as its own row and not merged into 01A's.
    const results = extractSampleResults(CRYSTAL_ANALYTICAL_POSITIVE);
    expect(results.filter((r) => r.fieldCode === "01A" || r.fieldCode === "01B")).toHaveLength(2);
  });

  it("still finds the first sample's result when it was drawn before its own field code", () => {
    expect(extractSampleCount(CRYSTAL_ANALYTICAL_RESULT_BEFORE_FIELD_CODE)).toBe(2);
    const results = extractSampleResults(CRYSTAL_ANALYTICAL_RESULT_BEFORE_FIELD_CODE);
    expect(results).toEqual([
      { fieldCode: "01A", result: "None Detected" },
      { fieldCode: "01B", result: "None Detected" },
    ]);
  });

  it("doesn't drop a sample whose own description cites another field code in parentheses", () => {
    expect(extractSampleCount(CRYSTAL_ANALYTICAL_PARENTHETICAL_REFERENCE)).toBe(8);
    const results = extractSampleResults(CRYSTAL_ANALYTICAL_PARENTHETICAL_REFERENCE);
    expect(results.map((r) => r.fieldCode)).toEqual(["01A", "01B", "02A", "02B", "03A", "03B", "04A", "04B"]);
    expect(results.every((r) => r.result === "None Detected")).toBe(true);
  });
});

// Real EMSL swab report text (exactly as pdf-parse extracts it) — 2 real
// samples (SW01, SW02) plus 3 unused reserved "Dummy" ID slots.
const MOLD_SWAB_REPORT = `
http://www.EMSL.com / bostonlab@emsl.com
Tel/Fax: (781) 933-8411 / (781) 933-8412
5 Constitution Way, Unit A Woburn, MA  01801
EMSL Analytical, Inc.
EMSL Order:
132605555
Customer ID:
FLIE62
Attention:
Richard Bourassa
FLI Environmental
Project:
Harbor Point Apt. 409 / 26-1136.2
Test Report: Microscopic Examination of Fungal Spores, Fungal Structures, Hyphae, and Other
Particulates from Swab Samples (EMSL Method MICRO-SOP-200)
Lab Sample Number:
Client Sample ID:
Sample Location:
132605555-0001
SW01
132605555-0002
SW02
132605555-9901
Dummy
132605555-9902
Dummy
132605555-9903
Dummy
Hall Bath CeilingKitchen CeilingDummyDummyDummy
Spore Types
CategoryCategory---
Alternaria (Ulocladium)-Rare---
Cladosporium*High*Rare---
No discernable field blank was submitted with this group of samples.
`;

// Real EMSL Air-O-Cell report text, 2 pages — 6 real samples (0001-0006,
// including the "Exterior" ambient sample), no unused slots. Deliberately
// includes the page-1 footer disclaimer ("No discernable field blank...")
// between sample 0003 and sample 0004, the exact real-world case that
// would wrongly exclude 0003 if the whole inter-ID window were checked for
// "blank" instead of just the line right after each ID.
const MOLD_AIR_O_CELL_REPORT = `
EMSL Analytical, Inc.
EMSL Order:
132605556
Project:
Harbor Point Apt. 409 / 26-1136.2
Test Report:Air-O-Cell(™) Analysis of Fungal Spores & Particulates by Optical Microscopy (Methods MICRO-SOP-201, ASTM D7391)
Lab Sample Number:
Client Sample ID:
Volume (L):
Sample Location:
132605556-0001
1
75
132605556-0002
2
75
132605556-0003
3
75
Hall BathMaster BathKitchen
Spore TypesRaw Count†Count/m³% of TotalRaw Count†Count/m³% of TotalRaw Count†Count/m³% of Total
Cladosporium95390098.2110*3.4310052.6
Total Fungi
98397010072901006190100
Steve Grise, Laboratory Manager
No discernable field blank was submitted with this group of samples.
EMSL Analytical, Inc. maintains liability limited to cost of analysis.
MIC_M001_0002_0003  Printed: 07/31/2026 09:47 PM
Page 1 of 2

EMSL Analytical, Inc.
EMSL Order:
132605556
Project:
Harbor Point Apt. 409 / 26-1136.2
Test Report:Air-O-Cell(™) Analysis of Fungal Spores & Particulates by Optical Microscopy (Methods MICRO-SOP-201, ASTM D7391)
Lab Sample Number:
Client Sample ID:
Volume (L):
Sample Location:
132605556-0004
4
75
132605556-0005
5
75
132605556-0006
6
75
Living RoomCommon HallExterior
Spore TypesRaw Count†Count/m³% of TotalRaw Count†Count/m³% of TotalRaw Count†Count/m³% of Total
Total Fungi
62401001771010017700100
No discernable field blank was submitted with this group of samples.
Page 2 of 2
`;

// Real Crystal Analytical mold report, trimmed — 26-0002, an air+bulk combo
// where Crystal bundles both methods (BIO-SOP-001 spore-trap for the 4 air
// samples, BIO-SOP-002 Direct Analysis for the 1 bulk sample) into a single
// PDF. Confirmed live wrong twice: uploading this same file tagged "Mold
// Bulk Sampling" originally reported 4 bulk samples (the spore-trap
// pattern's own air count) when only 1 bulk sample ("1 - Insulation") was
// actually taken; a later fix stopped the wrong number but then reported
// none at all until crystalDirectAnalysisFieldCodes (26-0008, "1 - Wall -
// Right of washer unit") was added to actually read the Direct Analysis
// section instead of leaving it unhandled.
const CRYSTAL_MOLD_AIR_BULK_COMBO_REPORT = `
Tim Hall
Commonwealth Inspection Services, LLC
Boston
MA
0001000200030004
Count
Struct/m
3
% of Total   Count
Struct/m
3
% of Total
Eval
Count
Struct/m
3
% of Total  Count
Struct/m
3
% of Total
1872,707100%52705100%45626100%61828100%
Collected:08/20/26
Received:08/24/26
Analyzed:08/25/26
Reported:08/25/26
Lab ID: 2601003618
BIO-SOP-001
Inertial Impactor (Spore Trap)
Sample Name Outdoor Ambient
Crystal Analytical, LLC.      •       55 Accord Park Dr., Ste. 2D; Rockland, MA 02370      •      (781) 347-3936     •      Page 2 of 3

Tim Hall
Commonwealth Inspection Services, LLC
Boston
MA
0005Pollen
Collected:08/20/26
Received:08/24/26
Analyzed:08/25/26
Reported:08/25/26
Trace
Epithelial Cells
Tape-Lift
Fungal Structure IDSpore/Material LoadDebris
1 - InsulationPenicillium/AspergillusTrace
NoneNone
BIO-SOP-002
Lab ID: 2601003618
Direct Analysis
Very Heavy
Crystal Analytical, LLC.      •       55 Accord Park Dr., Ste. 2D; Rockland, MA 02370      •      (781) 347-3936     •      Page 3 of 3
`;

describe("extractMoldSampleCount", () => {
  it("counts only the 2 real swab samples, excluding the 3 Dummy slots", () => {
    expect(extractMoldSampleCount(MOLD_SWAB_REPORT)).toBe(2);
  });

  it("counts all 6 real Air-O-Cell samples across both pages", () => {
    // Would come out as 4 (missing 0003 and 0006, the last sample on each
    // page) if the "blank" check looked at the whole window up to the next
    // ID instead of just the line right after — that window includes the
    // page footer's "No discernable field blank..." disclaimer.
    expect(extractMoldSampleCount(MOLD_AIR_O_CELL_REPORT)).toBe(6);
  });

  it("returns null when there's nothing recognizable", () => {
    expect(extractMoldSampleCount("not a lab report")).toBeNull();
  });

  it("counts the 4 air samples on a Crystal air+bulk combo report", () => {
    expect(extractMoldSampleCount(CRYSTAL_MOLD_AIR_BULK_COMBO_REPORT, "Mold Air Sampling")).toBe(4);
  });

  it("counts the 1 real bulk sample on the same combo report, not the air count", () => {
    expect(extractMoldSampleCount(CRYSTAL_MOLD_AIR_BULK_COMBO_REPORT, "Mold Bulk Sampling")).toBe(1);
  });

  it("still returns the spore-trap count when no serviceType is given at all", () => {
    expect(extractMoldSampleCount(CRYSTAL_MOLD_AIR_BULK_COMBO_REPORT)).toBe(4);
  });
});

describe("extractMoldSampleResults", () => {
  it("lists the real swab samples' own client sample IDs, not the Dummy slots", () => {
    expect(extractMoldSampleResults(MOLD_SWAB_REPORT)).toEqual([
      { fieldCode: "SW01", result: "Analyzed" },
      { fieldCode: "SW02", result: "Analyzed" },
    ]);
  });

  it("lists all 6 Air-O-Cell client sample IDs across both pages", () => {
    expect(extractMoldSampleResults(MOLD_AIR_O_CELL_REPORT).map((r) => r.fieldCode)).toEqual([
      "1", "2", "3", "4", "5", "6",
    ]);
  });

  it("lists the 1 real bulk sample for a bulk request on a Crystal air+bulk combo report", () => {
    expect(extractMoldSampleResults(CRYSTAL_MOLD_AIR_BULK_COMBO_REPORT, "Mold Bulk Sampling")).toEqual([
      { fieldCode: "1", result: "Analyzed", serviceType: "Mold Bulk Sampling" },
    ]);
  });

  it("adds a second real example (26-0008) confirming the pattern generalizes past a single fixture", () => {
    const REPORT = `
1 - Wall - Right of washer unitCladosporiumLight
NoneNone
BIO-SOP-002
`;
    expect(extractMoldSampleResults(REPORT, "Mold Bulk Sampling")).toEqual([
      { fieldCode: "1", result: "Analyzed", serviceType: "Mold Bulk Sampling" },
    ]);
  });
});
