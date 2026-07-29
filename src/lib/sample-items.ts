import type { SampleItem } from "@/lib/types";

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
