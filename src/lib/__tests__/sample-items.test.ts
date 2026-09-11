import { describe, it, expect } from "vitest";
import { deriveFullInspectionMaterials } from "@/lib/sample-items";
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
