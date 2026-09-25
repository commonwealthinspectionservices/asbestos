import { describe, it, expect } from "vitest";
import { columnIndexForNameFragment, parseDirectAnalysisPageItems } from "../pdf-position-text";

// 26-0041.1, 2026-09-25 — real x-positions read off Crystal's spore-trap
// table: column left edges are the long-form lab numbers ("0003", "0001",
// "0002"), and a long sample name starts a few points LEFT of its column's
// short sample-number cell. The old nearest-short-code-anchor matching put
// "Inside Ceiling Opening, Containment Zone in" (x=311) in the outdoor
// column and "Closet at End of the Bed Near Baseboards," (x=452) in sample
// 1's, swapping every location against its numbers.
describe("columnIndexForNameFragment", () => {
  const leftEdges = [172, 314, 457];

  it("puts each fragment of 26-0041.1's sample names in its own column", () => {
    expect(columnIndexForNameFragment(202, leftEdges)).toBe(0); // "Outdoor Ambient"
    expect(columnIndexForNameFragment(311, leftEdges)).toBe(1); // "Inside Ceiling Opening, Containment Zone in"
    expect(columnIndexForNameFragment(360, leftEdges)).toBe(1); // "Bedroom"
    expect(columnIndexForNameFragment(452, leftEdges)).toBe(2); // "Closet at End of the Bed Near Baseboards,"
    expect(columnIndexForNameFragment(468, leftEdges)).toBe(2); // "Containment Zone in Bedroom"
  });

  it("returns -1 for text left of every column", () => {
    expect(columnIndexForNameFragment(100, leftEdges)).toBe(-1);
  });
});

// Real x/y positions off Crystal's Direct Analysis (tape-lift) pages.
const row = (y: number, ...cells: [string, number][]) => cells.map(([str, x]) => ({ str, x, y }));
const HEADER = (y: number): [string, number][] => [["Fungal Structure ID", 359], ["Spore/Material Load", 451], ["Debris", 545], ["Pollen", 590], ["Epithelial Cells", 646]];

describe("parseDirectAnalysisPageItems", () => {
  // 26-0041.1, 2026-09-25 — samples 1, 2A, 2B, 3; sample 1 has TWO mold types
  // (basidiospores and Penicillium/Aspergillus, both Trace). The block's own
  // last row also carries the sample's Debris/Pollen/Epithelial values in
  // the columns to the right, which must not be read as a load.
  it("reads every mold type per sample with its own load, including a second type on a later row", () => {
    const items = [
      ...row(505, ["0001", 70], ...HEADER(505)),
      ...row(493, ["1: Plaster Ceiling", 52], ["basidiospores", 372], ["Trace", 482]),
      ...row(478, ["Penicillium/Aspergillus", 358], ["Trace", 482], ["Moderate", 541], ["None", 593], ["Trace", 664]),
      ...row(450, ["0002", 70], ...HEADER(450)),
      ...row(438, ["2A: Paper on Top Side of Ceiling Under Pipes", 52], ["basidiospores", 372], ["Trace", 481]),
      ...row(423, ["Moderate", 541], ["None", 593], ["Trace", 664]),
      ...row(395, ["0003", 70], ...HEADER(395)),
      ...row(383, ["2B:Paper on Top Side of Ceiling Under Pipes", 52], ["basidiospores", 372], ["Trace", 481]),
      ...row(368, ["Moderate", 541], ["None", 593], ["Trace", 664]),
      ...row(340, ["0004", 70], ...HEADER(340)),
      ...row(328, ["3: Behind Baseboard in Closet", 52], ["basidiospores", 372], ["Trace", 482]),
      ...row(313, ["Moderate", 541], ["None", 593], ["Trace", 664]),
      ...row(84, ["Analyst:", 66], ["Reviewer:", 352]),
    ];
    expect(parseDirectAnalysisPageItems(items)).toEqual([
      { location: "Plaster Ceiling", taxon: "basidiospores", load: "Trace" },
      { location: "Plaster Ceiling", taxon: "Penicillium/Aspergillus", load: "Trace" },
      { location: "Paper on Top Side of Ceiling Under Pipes", taxon: "basidiospores", load: "Trace" },
      { location: "Paper on Top Side of Ceiling Under Pipes", taxon: "basidiospores", load: "Trace" },
      { location: "Behind Baseboard in Closet", taxon: "basidiospores", load: "Trace" },
    ]);
  });

  // 26-0002's Insulation sample: the old text-based reader took the Debris
  // rating ("Very Heavy", debris column) for Alternaria's load. Alternaria
  // is Trace; Very Heavy is its debris.
  it("does not mistake the Debris column's rating for a mold type's load", () => {
    const items = [
      ...row(505, ["0005", 70], ...HEADER(505)),
      ...row(493, ["1 - Insulation", 52], ["Penicillium/Aspergillus", 358], ["Trace", 482]),
      ...row(478, ["Alternaria", 378], ["Trace", 481], ["Very Heavy", 539], ["None", 593], ["None", 664]),
    ];
    expect(parseDirectAnalysisPageItems(items)).toEqual([
      { location: "Insulation", taxon: "Penicillium/Aspergillus", load: "Trace" },
      { location: "Insulation", taxon: "Alternaria", load: "Trace" },
    ]);
  });

  it("returns nothing for a page that isn't a Direct Analysis table", () => {
    expect(parseDirectAnalysisPageItems([{ str: "Sample Number", x: 102, y: 506 }])).toEqual([]);
  });
});
