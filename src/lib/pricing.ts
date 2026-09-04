import type { ServiceType } from "@/lib/types";
import { FLI_ENVIRONMENTAL_COMPANY_ID } from "@/lib/report-findings";

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

/**
 * job.lab_cost_cents itself, EXCEPT for an FLI Environmental subcontract
 * job, where a still-null value means "correctly zero, permanently," not
 * "not billed yet" — FLI submits samples to the lab under their own
 * account and pays for that themselves (see invoice-defaults.ts's own
 * FLI_ENVIRONMENTAL_COMPANY_ID comment), so Commonwealth never gets a real
 * lab invoice for one of these jobs. Anywhere that reads job.lab_cost_cents
 * directly to decide "do we know the real margin yet" should read this
 * instead — confirmed live, 2026-09-04: job 26-0011 (FLI) was showing an
 * estimated ≈$111.74 lab cost, and a correspondingly understated margin,
 * that would never actually become a real charge.
 */
export function knownLabCostCentsForJob(job: { lab_cost_cents: number | null; customers?: { company_id?: string | null } | null }): number | null {
  if (job.customers?.company_id === FLI_ENVIRONMENTAL_COMPANY_ID) return 0;
  return job.lab_cost_cents ?? null;
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
