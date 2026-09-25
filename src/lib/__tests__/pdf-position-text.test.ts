import { describe, it, expect } from "vitest";
import { columnIndexForNameFragment } from "../pdf-position-text";

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
