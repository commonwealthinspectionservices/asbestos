import type { ServiceType } from "@/lib/types";

export function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * The service's rate structure (base + per-sample), with no estimated
 * total — the final price depends on the sample count, which isn't known
 * until the visit, so no "typical price" range is quoted up front.
 */
export function serviceRateLabel(service: ServiceType): string {
  return `${formatCents(service.base_fee_cents)} base + ${formatCents(service.per_sample_cents)}/sample`;
}

export function computeInvoiceTotalCents(
  baseFeeCents: number,
  perSampleCents: number,
  sampleCount: number
): number {
  return baseFeeCents + sampleCount * perSampleCents;
}
