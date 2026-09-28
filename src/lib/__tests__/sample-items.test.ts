import { describe, it, expect } from "vitest";
import { deriveFullInspectionMaterials, computeSampleCodes } from "@/lib/sample-items";
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

describe("computeSampleCodes", () => {
  // Per Tim, 2026-09-28 — verified against the real field codes on
  // 26-0051 exactly: same two materials (carpet mastic, then drywall
  // base) sampled at two locations each.
  it("reproduces 26-0051's real field codes exactly", () => {
    const rows = [
      { material: "Yellow carpet mastic", location: "Basement - Finished half" },
      { material: "Yellow carpet mastic", location: "Basement - Finished half" },
      { material: "Drywall wall base", location: "Bottom of stairs" },
      { material: "Drywall wall base", location: "Bottom of stairs" },
    ];
    expect(computeSampleCodes(rows, true)).toEqual(["01A", "01B", "02A", "02B"]);
  });

  // Per Tim: "drywall is always put into the same bag, and drywall gets
  // broken down into drywall skim coat and drywall base... the drywall
  // base is usually 01A, and the drywall skim coat would be 02A... there
  // would also be a second bag 01B and 02B" — two materials taken
  // together at each of two locations, interleaved in entry order rather
  // than grouped by location, still numbers/letters correctly.
  it("interleaved entry order (base, skim, base, skim) still groups correctly by material", () => {
    const rows = [
      { material: "Drywall wall base", location: "Kitchen" },
      { material: "Drywall wall skim coat", location: "Kitchen" },
      { material: "Drywall wall base", location: "Bathroom" },
      { material: "Drywall wall skim coat", location: "Bathroom" },
    ];
    expect(computeSampleCodes(rows, true)).toEqual(["01A", "02A", "01B", "02B"]);
  });

  it("material matching is case/whitespace-insensitive", () => {
    const rows = [
      { material: "Drywall Wall Base", location: "Kitchen" },
      { material: "  drywall wall base  ", location: "Bathroom" },
    ];
    expect(computeSampleCodes(rows, true)).toEqual(["01A", "01B"]);
  });

  it("a third location for the same material gets a third letter", () => {
    const rows = [
      { material: "Gray Insulation", location: "Attic" },
      { material: "Gray Insulation", location: "Mudroom" },
      { material: "Gray Insulation", location: "Basement" },
    ];
    expect(computeSampleCodes(rows, true)).toEqual(["01A", "01B", "01C"]);
  });

  it("a blank material gets no code yet, without disrupting numbering around it", () => {
    const rows = [
      { material: "Plaster ceiling base", location: "Bedroom" },
      { material: "", location: "" },
      { material: "Plaster ceiling base", location: "Bedroom 2" },
    ];
    expect(computeSampleCodes(rows, true)).toEqual(["01A", "", "01B"]);
  });

  // Per Tim's own real Air-O-Cell COC (coc-air_o_cell-somerville.pdf) —
  // no Material column at all, samples just numbered 1, 2, 3 with no
  // letters.
  it("no material field (Air-O-Cell): plain sequential numbers, no letters", () => {
    const rows = [
      { material: "", location: "Bedroom" },
      { material: "", location: "Closet" },
      { material: "", location: "Outdoor ambient" },
    ];
    expect(computeSampleCodes(rows, false)).toEqual(["1", "2", "3"]);
  });
});
