import { describe, it, expect } from "vitest";
import { extractSampleCount, detectAsbestosResult, extractSampleResults, extractReportProjectNumber, detectLabInfo } from "../parse-lab-report";

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
});
