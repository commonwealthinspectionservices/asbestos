import type { CocType, FullInspectionMaterial, SampleItem } from "@/lib/types";

const COC_TYPES: CocType[] = ["asbestos_bulk", "mold_air_o_cell", "mold_bulk", "mold_swab"];

/** Validates and normalizes a raw SampleItem[] payload from the Samples tab
    (and the Chain of Custody tab — see ChainOfCustodyPanel.tsx). */
export function parseSampleItems(raw: unknown): { items: SampleItem[] } | { error: string } {
  if (!Array.isArray(raw)) {
    return { error: "sample_items must be an array" };
  }

  const items: SampleItem[] = [];
  for (const rawItem of raw) {
    const sampleNumber = typeof rawItem?.sample_number === "string" ? rawItem.sample_number.trim() : "";
    const material = typeof rawItem?.material === "string" ? rawItem.material.trim() : "";
    const location = typeof rawItem?.location === "string" ? rawItem.location.trim() : "";
    const cocType = COC_TYPES.includes(rawItem?.coc_type) ? (rawItem.coc_type as CocType) : undefined;
    items.push({ sample_number: sampleNumber, material, location, ...(cocType ? { coc_type: cocType } : {}) });
  }

  return { items };
}

// Per Tim, 2026-09-28 — "you need to understand how the sample formats
// work... drywall is always put into the same bag, and drywall gets
// broken down into drywall skim coat and drywall base... the drywall base
// is usually 01A, and the drywall skim coat would be 02A... A means
// sample one and B means sample two... there would also be a second bag
// 01B and 02B, and it'll be the same combination". Confirmed against real
// field codes across a dozen recent jobs (26-0041 through 26-0051): the
// leading number identifies which distinct MATERIAL this is (assigned in
// the order a new material is first typed, within this one COC — not a
// fixed code, 01 means something different on every job), and the letter
// identifies which physical sampling location/round that material came
// from (A = first location it was taken at, B = second, ...). So the
// admin (ChainOfCustodyPanel.tsx) never picks a sample number by hand —
// it's entirely derived from the order Materials get typed and repeated.
// No material field on Air-O-Cell (see the coc-pdf files' own
// thirdColumnLabel: null) — those just number sequentially, matching his
// own real Air-O-Cell COC, which has no letters at all.
export function computeSampleCodes(rows: { material: string; location: string }[], hasMaterial: boolean): string[] {
  if (!hasMaterial) return rows.map((_, i) => String(i + 1));
  const materialOrder: string[] = [];
  const letterCounts: Record<string, number> = {};
  return rows.map((r) => {
    const norm = r.material.trim().toLowerCase();
    if (!norm) return "";
    let idx = materialOrder.indexOf(norm);
    if (idx === -1) {
      idx = materialOrder.length;
      materialOrder.push(norm);
    }
    const letterIdx = letterCounts[norm] ?? 0;
    letterCounts[norm] = letterIdx + 1;
    return `${String(idx + 1).padStart(2, "0")}${String.fromCharCode(65 + letterIdx)}`;
  });
}

/**
 * Validates a raw { [serviceTypeLabel]: count } payload — the per-service-type
 * sample counts shown on the Samples tab (one cell per service type on the
 * job, e.g. "Mold Air Sampling": 3, "Asbestos Inspection": 5).
 */
export function parseSampleCounts(raw: unknown): { counts: Record<string, number> } | { error: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { error: "sample_counts must be an object" };
  }

  const counts: Record<string, number> = {};
  for (const [label, value] of Object.entries(raw as Record<string, unknown>)) {
    const trimmedLabel = label.trim();
    if (!trimmedLabel) continue;
    const n = Number(value);
    if (Number.isNaN(n) || n < 0) {
      return { error: `Invalid sample count for "${trimmedLabel}"` };
    }
    counts[trimmedLabel] = n;
  }

  return { counts };
}

/** Validates and normalizes a raw sample_findings payload — the per-positive-
    sample material + approximate footage typed in next to each lab result. */
export function parseSampleFindings(raw: unknown): { findings: { fieldCode: string; material: string; estimated_quantity: string; unit: "sq_ft" | "linear_ft" }[] } | { error: string } {
  if (!Array.isArray(raw)) {
    return { error: "sample_findings must be an array" };
  }

  const findings: { fieldCode: string; material: string; estimated_quantity: string; unit: "sq_ft" | "linear_ft" }[] = [];
  for (const rawItem of raw) {
    const fieldCode = typeof rawItem?.fieldCode === "string" ? rawItem.fieldCode.trim() : "";
    const material = typeof rawItem?.material === "string" ? rawItem.material.trim() : "";
    const estimatedQuantity = typeof rawItem?.estimated_quantity === "string" ? rawItem.estimated_quantity.trim() : "";
    const unit = rawItem?.unit === "linear_ft" ? "linear_ft" : "sq_ft";
    if (!fieldCode) continue;
    findings.push({ fieldCode, material, estimated_quantity: estimatedQuantity, unit });
  }

  return { findings };
}

/** Validates and normalizes a raw FullInspectionMaterial[] payload from the full-inspection materials editor. */
export function parseFullInspectionMaterials(raw: unknown): { materials: FullInspectionMaterial[] } | { error: string } {
  if (!Array.isArray(raw)) {
    return { error: "full_inspection_materials must be an array" };
  }

  const materials: FullInspectionMaterial[] = [];
  for (const rawItem of raw) {
    const material = typeof rawItem?.material === "string" ? rawItem.material.trim() : "";
    const isAcm = Boolean(rawItem?.is_acm);
    const locations = Array.isArray(rawItem?.locations)
      ? rawItem.locations.filter((l: unknown): l is string => typeof l === "string").map((l: string) => l.trim()).filter(Boolean)
      : [];
    const sampleNumbers = typeof rawItem?.sample_numbers === "string" ? rawItem.sample_numbers.trim() : "";
    const estimatedQuantity = typeof rawItem?.estimated_quantity === "string" ? rawItem.estimated_quantity.trim() || null : null;
    materials.push({ material, is_acm: isAcm, locations, sample_numbers: sampleNumbers, estimated_quantity: estimatedQuantity });
  }

  return { materials };
}

// Per Tim, 2026-09-11 (26-0026) — "Total Materials Sampled" (report-pdf.tsx)
// only counts rows actually logged in this table, but that table started
// out requiring every homogeneous material to be typed in by hand — a
// Full Inspection job easily has 15-20+ of them, most negative, so the
// count read "1" (just the one ACM material he'd bothered to log) instead
// of the real total. This derives the missing rows straight from the
// lab's own per-sample results (same fieldCode/result/material data the
// Sample Results box already shows), grouped by field code's leading
// number — "01A"/"01B" (and any ".1"/".2" sub-samples, e.g. "18A.1"/
// "18A.2") are the same homogeneous material sampled at more than one
// spot/layer, matching how Crystal Analytical's own field codes are laid
// out. Never touches a field code any EXISTING row already covers (an
// admin's own typed-in material name, locations, footage) — this only
// fills the gap, so re-running it after a manual edit can't clobber it.
export function deriveFullInspectionMaterials(
  sampleResults: { fieldCode: string; result: string; material?: string }[],
  existing: FullInspectionMaterial[]
): FullInspectionMaterial[] {
  const coveredCodes = new Set<string>();
  for (const m of existing) {
    for (const code of m.sample_numbers.split(",").map((c) => c.trim()).filter(Boolean)) {
      coveredCodes.add(code);
    }
  }

  const groups = new Map<string, { fieldCode: string; result: string; material?: string }[]>();
  for (const s of sampleResults) {
    if (coveredCodes.has(s.fieldCode)) continue;
    const groupKey = s.fieldCode.match(/^\d+/)?.[0] ?? s.fieldCode;
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey)!.push(s);
  }

  const derived: FullInspectionMaterial[] = [];
  for (const samples of groups.values()) {
    derived.push({
      material: samples.find((s) => s.material)?.material ?? "",
      is_acm: samples.some((s) => /%/.test(s.result)),
      locations: [],
      sample_numbers: samples.map((s) => s.fieldCode).join(", "),
      estimated_quantity: null,
    });
  }

  return [...existing, ...derived];
}
