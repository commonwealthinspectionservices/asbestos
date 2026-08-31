import type { FullInspectionMaterial, SampleItem } from "@/lib/types";

/** Validates and normalizes a raw SampleItem[] payload from the Samples tab. */
export function parseSampleItems(raw: unknown): { items: SampleItem[] } | { error: string } {
  if (!Array.isArray(raw)) {
    return { error: "sample_items must be an array" };
  }

  const items: SampleItem[] = [];
  for (const rawItem of raw) {
    const sampleNumber = typeof rawItem?.sample_number === "string" ? rawItem.sample_number.trim() : "";
    const material = typeof rawItem?.material === "string" ? rawItem.material.trim() : "";
    const location = typeof rawItem?.location === "string" ? rawItem.location.trim() : "";
    items.push({ sample_number: sampleNumber, material, location });
  }

  return { items };
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
export function parseSampleFindings(raw: unknown): { findings: { fieldCode: string; material: string; estimated_quantity: string }[] } | { error: string } {
  if (!Array.isArray(raw)) {
    return { error: "sample_findings must be an array" };
  }

  const findings: { fieldCode: string; material: string; estimated_quantity: string }[] = [];
  for (const rawItem of raw) {
    const fieldCode = typeof rawItem?.fieldCode === "string" ? rawItem.fieldCode.trim() : "";
    const material = typeof rawItem?.material === "string" ? rawItem.material.trim() : "";
    const estimatedQuantity = typeof rawItem?.estimated_quantity === "string" ? rawItem.estimated_quantity.trim() : "";
    if (!fieldCode) continue;
    findings.push({ fieldCode, material, estimated_quantity: estimatedQuantity });
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
