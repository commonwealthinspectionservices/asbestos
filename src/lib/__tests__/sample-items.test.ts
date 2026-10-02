import { describe, it, expect } from "vitest";
import { deriveFullInspectionMaterials, defaultSampleCode, nextSampleCode, airOCellEndTime } from "@/lib/sample-items";
import type { FullInspectionMaterial } from "@/lib/types";

describe("deriveFullInspectionMaterials", () => {
  it("groups an A/B field-code pair into one negative material", () => {
    const derived = deriveFullInspectionMaterials(
      [
        { fieldCode: "01A", result: "None Detected", material: "Plaster wall base, First Floor" },
        { fieldCode: "01B", result: "None Detected", material: "Plaster wall base, First Floor" },
      ],
      []
    );
    expect(derived).toEqual([
      { material: "Plaster wall base, First Floor", is_acm: false, locations: [], sample_numbers: "01A, 01B", estimated_quantity: null },
    ]);
  });

  it("marks the group ACM when any sample in it came back positive", () => {
    const derived = deriveFullInspectionMaterials(
      [
        { fieldCode: "15A", result: "Chrysotile 10%" },
        { fieldCode: "15B", result: "Chrysotile 10%" },
      ],
      []
    );
    expect(derived).toEqual([
      { material: "", is_acm: true, locations: [], sample_numbers: "15A, 15B", estimated_quantity: null },
    ]);
  });

  it("groups .1/.2 sub-samples under the same leading number as their A/B pair", () => {
    const derived = deriveFullInspectionMaterials(
      [
        { fieldCode: "18A.1", result: "None Detected", material: "Assoc adhesive Clear" },
        { fieldCode: "18A.2", result: "None Detected", material: "Assoc adhesive Red" },
        { fieldCode: "18B.1", result: "None Detected", material: "Assoc adhesive Clear" },
        { fieldCode: "18B.2", result: "None Detected", material: "Assoc adhesive Red" },
      ],
      []
    );
    expect(derived).toHaveLength(1);
    expect(derived[0].sample_numbers).toBe("18A.1, 18A.2, 18B.1, 18B.2");
    expect(derived[0].is_acm).toBe(false);
  });

  it("never touches a field code an existing row already covers", () => {
    const existing: FullInspectionMaterial[] = [
      {
        material: "Red vinyl floor tile (layer 2)",
        is_acm: true,
        locations: ["Basement, back right room"],
        sample_numbers: "15A, 15B",
        estimated_quantity: "80 sq ft",
      },
    ];
    const derived = deriveFullInspectionMaterials(
      [
        { fieldCode: "15A", result: "Chrysotile 10%" },
        { fieldCode: "15B", result: "Chrysotile 10%" },
        { fieldCode: "16A", result: "None Detected", material: "Black mastic - 15A" },
        { fieldCode: "16B", result: "None Detected", material: "Black mastic - 15B" },
      ],
      existing
    );
    // The hand-entered 15A/15B row survives untouched, still first...
    expect(derived[0]).toEqual(existing[0]);
    // ...and only the un-covered 16A/16B group gets a new derived row.
    expect(derived).toHaveLength(2);
    expect(derived[1].sample_numbers).toBe("16A, 16B");
  });

  it("produces the full 20-group breakdown for the real 26-0026 sample set", () => {
    const codes = [
      "01A", "01B", "02A", "02B", "03A", "03B", "04A", "04B", "05A", "05B",
      "06A", "06B", "07A", "07B", "08A", "08B", "09A", "09B", "10A", "10B",
      "11A", "11B", "12A", "12B", "13A", "13B", "14A", "14B", "15A", "15B",
      "16A", "16B", "17A", "17B", "18A.1", "18A.2", "18B.1", "18B.2",
      "19A", "19B", "20A", "20B",
    ];
    const sampleResults = codes.map((fieldCode) => ({
      fieldCode,
      result: fieldCode.startsWith("15") ? "Chrysotile 10%" : "None Detected",
    }));
    const derived = deriveFullInspectionMaterials(sampleResults, []);
    expect(derived).toHaveLength(20); // one group per leading number, 01 through 20
    expect(derived.filter((m) => m.is_acm)).toHaveLength(1);
  });
});

describe("defaultSampleCode", () => {
  // Per Tim, 2026-09-28 (walking back the earlier material-grouped
  // version): "the sequence should always go 01A, 01B, 02A, 02B, 03A,
  // 03B" — purely positional, pairs of rows in entry order.
  it("pairs rows in entry order: 01A, 01B, 02A, 02B, 03A, 03B", () => {
    const codes = [0, 1, 2, 3, 4, 5].map((i) => defaultSampleCode(i, true));
    expect(codes).toEqual(["01A", "01B", "02A", "02B", "03A", "03B"]);
  });

  // Per Tim's own real Air-O-Cell COC (coc-air_o_cell-somerville.pdf) —
  // no Material column at all, samples just numbered 1, 2, 3 with no
  // letters.
  it("no material field (Air-O-Cell): plain sequential numbers, no letters", () => {
    const codes = [0, 1, 2].map((i) => defaultSampleCode(i, false));
    expect(codes).toEqual(["1", "2", "3"]);
  });
});

describe("airOCellEndTime", () => {
  // Per Tim, 2026-09-28 — "time for all of them is always 5 mins...
  // the end time will always be 5 mins after the start time."
  it("adds 5 minutes to the start time", () => {
    expect(airOCellEndTime("09:00")).toBe("09:05");
    expect(airOCellEndTime("14:32")).toBe("14:37");
  });

  it("rolls over the hour", () => {
    expect(airOCellEndTime("09:58")).toBe("10:03");
  });

  it("rolls over midnight", () => {
    expect(airOCellEndTime("23:58")).toBe("00:03");
  });

  it("returns an empty string for a blank or malformed start time", () => {
    expect(airOCellEndTime("")).toBe("");
    expect(airOCellEndTime("not a time")).toBe("");
  });
});

describe("nextSampleCode", () => {
  it("walks 01A, 01B, 02A, 02B, 03A from the last row's actual code", () => {
    expect(nextSampleCode("01A", 1, true)).toBe("01B");
    expect(nextSampleCode("01B", 2, true)).toBe("02A");
    expect(nextSampleCode("04A", 6, true)).toBe("04B");
    expect(nextSampleCode("04B", 7, true)).toBe("05A");
    expect(nextSampleCode("09B", 17, true)).toBe("10A");
  });

  it("follows the last code, not the row count, after a deletion or edit", () => {
    expect(nextSampleCode("03B", 2, true)).toBe("04A");
  });

  it("falls back to the positional default for blank or free-typed codes", () => {
    expect(nextSampleCode("", 2, true)).toBe(defaultSampleCode(2, true));
    expect(nextSampleCode("kitchen", 3, true)).toBe(defaultSampleCode(3, true));
  });

  it("adds one to mold's plain numbers", () => {
    expect(nextSampleCode("3", 3, false)).toBe("4");
    expect(nextSampleCode(undefined, 0, false)).toBe("1");
  });
});
