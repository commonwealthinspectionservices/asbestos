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
    const startTime = typeof rawItem?.start_time === "string" && /^\d{2}:\d{2}$/.test(rawItem.start_time) ? rawItem.start_time : undefined;
    const endTime = typeof rawItem?.end_time === "string" && /^\d{2}:\d{2}$/.test(rawItem.end_time) ? rawItem.end_time : undefined;
    items.push({ sample_number: sampleNumber, material, location, ...(cocType ? { coc_type: cocType } : {}), ...(startTime ? { start_time: startTime } : {}), ...(endTime ? { end_time: endTime } : {}) });
  }

  return { items };
}

// Per Tim, 2026-09-30 — 26-0056's field-code-collision recovery: no
// admin route could write sample_results directly (only the lab-email
// pipeline and the manual-upload route ever set it, both by parsing a
// real PDF), so reconstructing the correct 12-sample result set after
// two reports' data got tangled had nowhere to go. `material` isn't part
// of SampleResult's own formal type (both existing writers attach it via
// plain object spread instead — see lab-email.ts's own comment on why),
// so this validates it the same loose way: kept only when it's really a
// string, dropped otherwise, same as every other optional field here.
export function parseSampleResults(raw: unknown): { results: (SampleResultInput)[] } | { error: string } {
  if (!Array.isArray(raw)) {
    return { error: "sample_results must be an array" };
  }
  const results: SampleResultInput[] = [];
  for (const rawItem of raw) {
    const fieldCode = typeof rawItem?.fieldCode === "string" ? rawItem.fieldCode.trim() : "";
    const result = typeof rawItem?.result === "string" ? rawItem.result.trim() : "";
    if (!fieldCode || !result) {
      return { error: "Every sample_results row needs a fieldCode and a result" };
    }
    const material = typeof rawItem?.material === "string" ? rawItem.material.trim() : undefined;
    const serviceType = typeof rawItem?.serviceType === "string" ? rawItem.serviceType.trim() : undefined;
    results.push({ fieldCode, result, ...(material ? { material } : {}), ...(serviceType ? { serviceType } : {}) });
  }
  return { results };
}

interface SampleResultInput {
  fieldCode: string;
  result: string;
  material?: string;
  serviceType?: string;
}

// "HH:MM" in, "HH:MM" out, rolling over past midnight the same way a real
// clock would (23:58 + 5 -> 00:03) rather than producing an invalid hour.
// Shared by airOCellEndTime below (start -> its own end, +5) and
// ChainOfCustodyPanel's own addRow (previous row's end -> next row's
// start, +2 — see that call site's own comment).
export function addMinutesToTime(time: string, minutes: number): string {
  const match = time.match(/^(\d{2}):(\d{2})$/);
  if (!match) return "";
  const totalMinutes = (Number(match[1]) * 60 + Number(match[2]) + minutes) % (24 * 60);
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

// Per Tim, 2026-09-28 — "time for all of them is always 5 mins... it
// needs a start time and end time for each sample" (Mold Air-O-Cell
// only — the pump runs a fixed 5-minute sample), then a follow-up:
// "editable for both start time and end time but end time always
// [pre-filled] defaulting to 5 mins after start time" — end_time is a
// real, independently editable field (see SampleItem in types.ts), this
// just computes its STARTING default whenever start_time changes (see
// ChainOfCustodyPanel.tsx's own updateRow for the "only overwrite while
// it hasn't already diverged" rule, same pattern as every other
// auto-filled default in this feature).
export function airOCellEndTime(startTime: string): string {
  return addMinutesToTime(startTime, 5);
}

// Per Tim, 2026-09-28 — first pass at this derived the number from which
// distinct Material text was typed (grouping repeats of the same material
// as the letter) — his own follow-up walked that back: "I don't know if
// the system is ever going to be able to [get that right]... it should
// just start out entirely blank and you should just be able to click into
// it and edit it... the sequence should always go 01A, 01B, 02A, 02B,
// 03A, 03B." So this is now a plain positional default, nothing to do
// with what's typed into Material — pairs of rows in entry order, not
// grouped/matched by text at all. It's only ever a STARTING value the
// admin can freely type over (a rare third "C" sample at the same
// material, or anything else that breaks the pattern — "don't even worry
// about that... for now the system should know the sequence"), never
// recomputed out from under an edit — see ChainOfCustodyPanel.tsx's own
// addRow, which calls this once per new row rather than live-deriving the
// whole list on every render the old version did.
// The boolean param means "pairs samples into lettered A/B groups"
// (COC_PAIRS_SAMPLES in JobsDashboard.tsx), not "has a Material field" —
// asbestos_bulk is the only coc_type that pairs. Per Tim, 2026-09-28:
// "mold is always just plain one, two, three" — mold_bulk/mold_swab DO
// have their own Material/Surface Swabbed field, but still never pair;
// only mold_air_o_cell has no material-like field at all. Both cases
// pass false here and get plain sequential numbers with no letters.
export function defaultSampleCode(index: number, pairsSamples: boolean): string {
  if (!pairsSamples) return String(index + 1);
  const pairIndex = Math.floor(index / 2);
  const letter = index % 2 === 0 ? "A" : "B";
  return `${String(pairIndex + 1).padStart(2, "0")}${letter}`;
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
