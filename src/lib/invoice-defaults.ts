import { resolveZoneBaseFeeCents } from "@/lib/pricing-zones";
import { NEWTON_FIRE_FLOOD_COMPANY_ID } from "@/lib/report-findings";
import type { InvoiceLineItem, JobWithCustomer, PricingZone, ServiceType } from "@/lib/types";

// Single source of truth for "what should this invoice look like before
// anyone's touched it by hand" — used live by the Invoice tab
// (JobsDashboard.tsx) as the admin fills in project info and lab results,
// and reused as-is by the Gmail lab-results pipeline (src/lib/lab-email.ts)
// so an invoice built automatically from an inbound email prices exactly
// the same as one built by hand in the UI.

// Recomputes the base fee live from the project's current address and the
// current Settings rates, rather than trusting job.base_fee_cents — that
// column is only ever set once, at creation time, so it goes stale the
// moment the address is corrected or a rate changes afterward. A region
// override in Settings wins if the address matches one; otherwise it's the
// first matched service type's own base fee. The stored value is only a
// last-resort fallback once nothing else is available at all.
export function resolveBaseFeeCents(
  job: JobWithCustomer,
  serviceTypeSettings: ServiceType[],
  pricingZones: PricingZone[]
): number | null {
  if (!job.service_address) return job.base_fee_cents ?? null;

  const serviceTypeLabels = (job.service_type ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const matchedTypes = serviceTypeLabels
    .map((label) => serviceTypeSettings.find((t) => t.label === label))
    .filter((t): t is ServiceType => t != null);

  // A job whose only service type(s) are custom "Other" text has no
  // configured rate to look up — default the base fee to $0 (still
  // editable per invoice) rather than guessing from an unrelated zone or
  // configured type's rate. Only decided once serviceTypeSettings has
  // actually loaded — while it's still empty on first render, "no match"
  // just means "haven't checked yet", not "this is really an Other type".
  if (serviceTypeSettings.length > 0 && serviceTypeLabels.length > 0 && matchedTypes.length === 0) {
    // Before giving up, though: a label with no *exact* match can still be
    // an old, more generic spelling of a real configured category (e.g.
    // "Asbestos Inspection" from a historical bulk-rename, vs. today's
    // "Limited/Pre-Renovation/Pre-Demolition Asbestos Inspection") — that's
    // not the same as a genuinely custom "Other" label, and shouldn't
    // silently zero out the invoice.
    const CATEGORY_KEYWORDS = ["asbestos", "mold", "lead"];
    for (const keyword of CATEGORY_KEYWORDS) {
      if (!serviceTypeLabels.some((l) => l.toLowerCase().includes(keyword))) continue;
      const categoryMatch = serviceTypeSettings.find((t) => t.label.toLowerCase().includes(keyword));
      if (categoryMatch) return categoryMatch.base_fee_cents;
    }
    return 0;
  }

  const zoneFee = resolveZoneBaseFeeCents(job.service_address, pricingZones);
  if (zoneFee != null) return zoneFee;

  // Only one visit happens per job regardless of how many service types are
  // picked, so the base fee is charged once — not once per service type.
  if (matchedTypes.length > 0) {
    return matchedTypes[0].base_fee_cents;
  }

  if (serviceTypeSettings.length > 0) {
    return serviceTypeSettings[0].base_fee_cents;
  }

  return job.base_fee_cents ?? null;
}

// Lab-facing description for a service type's per-sample line item —
// confirmed against the actual analysis method each type's samples go
// through. Matched by keyword rather than an exact label list: real and
// historical jobs use label variants ("Asbestos Inspection", "Pre-Demo
// Asbestos Inspection", etc.) beyond the three exact labels currently in
// Settings, and every one of this business's asbestos bulk samples goes
// through the same AHERA/PLM method regardless of which inspection label
// the job happens to carry.
export function sampleDescriptionForServiceType(label: string): string {
  const lower = label.toLowerCase();
  if (lower.includes("lead")) return "Bulk Samples for Total Lead Analysis";
  if (lower.includes("mold")) {
    if (lower.includes("air")) return "Air-O-Cell Samples for Mold Analysis";
    if (lower.includes("swab")) return "Swab Samples for Mold Analysis";
    return "Bulk Samples for Mold Analysis";
  }
  if (lower.includes("asbestos")) return "Bulk Samples for Asbestos Analysis by PLM";
  return `${label} Samples`;
}

// A legacy/custom service type label (e.g. "Asbestos Inspection" instead
// of one of the three exact asbestos labels in Settings) has no direct
// match in serviceTypeSettings, so its per-sample rate would otherwise
// fall through to null and silently drop the sample count from the
// invoice entirely. Falling back to any configured service type in the
// same analysis-method bucket keeps the rate correct without requiring
// every historical label variant to be re-typed into Settings verbatim.
export function resolvePerSampleCentsForLabel(
  label: string,
  serviceTypeSettings: ServiceType[],
  jobPerSampleCents: number | null
): number | null {
  const exact = serviceTypeSettings.find((t) => t.label === label);
  if (exact) return exact.per_sample_cents;

  const category = sampleDescriptionForServiceType(label);
  const sameCategory = serviceTypeSettings.find((t) => sampleDescriptionForServiceType(t.label) === category);
  if (sameCategory) return sameCategory.per_sample_cents;

  return jobPerSampleCents ?? null;
}

// Builds the invoice's starting point — one line for the base fee, one per
// service type on the job priced from its current per-sample rate in
// Settings, times however many samples were logged for that service type.
// Rush turnaround doubles the per-sample rate (see resolveBaseFeeCents'
// caller comment history / the Invoice tab's Rush toggle) but never the
// base fee — one visit happens regardless of lab turnaround.
export function defaultInvoiceLineItems(
  job: JobWithCustomer,
  serviceTypeSettings: ServiceType[] = [],
  pricingZones: PricingZone[] = []
): InvoiceLineItem[] {
  const rows: InvoiceLineItem[] = [];
  const baseFeeCents = resolveBaseFeeCents(job, serviceTypeSettings, pricingZones);
  const serviceTypeLabels = (job.service_type ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (baseFeeCents != null) {
    const hasAsbestos = serviceTypeLabels.some((l) => l.toLowerCase().includes("asbestos"));
    const baseFeeDescription =
      serviceTypeLabels.length === 0
        ? "Licensed Asbestos Inspector"
        : hasAsbestos
          ? `Licensed Asbestos Inspector (${serviceTypeLabels.join(", ")})`
          : serviceTypeLabels.join(", ");
    rows.push({
      description: baseFeeDescription,
      quantity: 1,
      billing_unit: "Base Fee",
      unit_cost_cents: baseFeeCents,
    });
  }

  const isRush = job.lab_turnaround === "Rush";

  for (const label of serviceTypeLabels) {
    const count = job.sample_counts?.[label];
    if (!count) continue;
    const perSampleCents = resolvePerSampleCentsForLabel(label, serviceTypeSettings, job.per_sample_cents);
    if (perSampleCents == null) continue;
    rows.push({
      description: sampleDescriptionForServiceType(label) + (isRush ? " (Rush)" : ""),
      quantity: count,
      billing_unit: "Sample",
      unit_cost_cents: isRush ? perSampleCents * 2 : perSampleCents,
    });
  }

  // No per-service-type counts yet (e.g. before that migration is run, or
  // none logged) — fall back to the single overall sample_count/rate the
  // job was created with, same as before.
  if (rows.length === (baseFeeCents != null ? 1 : 0) && job.sample_count && job.per_sample_cents != null) {
    rows.push({
      description: "Bulk Samples for Asbestos Analysis by PLM" + (isRush ? " (Rush)" : ""),
      quantity: job.sample_count,
      billing_unit: "Sample",
      unit_cost_cents: isRush ? job.per_sample_cents * 2 : job.per_sample_cents,
    });
  }

  // Newton Fire & Flood's own standing rush fee — per Tim, 2026-08-27, every
  // job for this company runs on same-day service, so a 20% surcharge on
  // top of everything above applies automatically rather than
  // needing to be added by hand on every invoice. Matched against
  // company_id, same as this company's other standing rules (report
  // conclusion text, "Final Report and Invoice" label) — see
  // NEWTON_FIRE_FLOOD_COMPANY_ID's own comment. Skipped on a $0 invoice
  // (nothing priced yet) rather than adding a $0 rush fee line.
  if (job.customers?.company_id === NEWTON_FIRE_FLOOD_COMPANY_ID) {
    const subtotalCents = invoiceLineItemsTotalCents(rows);
    if (subtotalCents > 0) {
      rows.push({
        description: "Rush Fee (Same Day Service) - 20%",
        quantity: 1,
        billing_unit: "Fee",
        unit_cost_cents: Math.round(subtotalCents * 0.2),
      });
    }
  }

  return rows;
}

export function invoiceLineItemsTotalCents(items: InvoiceLineItem[]): number {
  return items.reduce((sum, item) => sum + item.quantity * item.unit_cost_cents, 0);
}
