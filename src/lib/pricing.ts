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

/**
 * Revenue minus lab cost minus the real Stripe processing fee, all in
 * cents. Shared by the per-job Profit line (JobsDashboard's
 * LineItemsEditor) and BillingView's own per-job/period rollups — they
 * drifted out of sync once already, so this is the one place either
 * should compute it.
 */
export function computeMarginCents(revenueCents: number, labCostCents: number, stripeFeeCents: number): number {
  return revenueCents - labCostCents - stripeFeeCents;
}

export function computeInvoiceTotalCents(
  baseFeeCents: number,
  perSampleCents: number,
  sampleCount: number
): number {
  return baseFeeCents + sampleCount * perSampleCents;
}

const MINUTES_PER_SAMPLE = 5; // ten minutes for every two samples

/** Estimated on-site time from actual sample count — falls back when there's no sample data yet (e.g. before a visit). */
export function estimateDurationMinutes(sampleCount: number, fallbackMinutes: number): number {
  return sampleCount > 0 ? Math.round(sampleCount * MINUTES_PER_SAMPLE) : fallbackMinutes;
}
