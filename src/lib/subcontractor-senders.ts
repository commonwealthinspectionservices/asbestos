// The subcontracting companies Tim takes calendar-only work from — see
// subcontractor-intake.ts for the email pipeline that reads from this list.
// Kept in its own file (rather than alongside subcontractor-intake.ts,
// which pulls in server-only Supabase/Gmail code) so JobsDashboard.tsx can
// safely import just the sender metadata into client-side UI, e.g. to link
// out to a company's own portal from a subcontracted job's detail view.
export interface SubcontractorSender {
  domain: string;
  companyName: string;
  companyPhone: string;
  /** Their own scheduling/portal site — not deep-linkable to a specific job (no stable per-job URL is available to us), but useful as a one-click jump-off point for anything only visible there, e.g. a second shipment added after the assignment email went out. */
  portalUrl: string;
  /** Every job from this company is the same kind of work (Fast Mold Testing only ever sends mold inspections) — set as the job's real service_type at intake. */
  serviceType: string;
}

export const KNOWN_SUBCONTRACTOR_SENDERS: SubcontractorSender[] = [
  { domain: "fastmoldtesting.com", companyName: "Fast Mold Testing", companyPhone: "424-274-7425", portalUrl: "https://portal.fastmoldtesting.com/dashboard", serviceType: "Subcontracted Mold Inspection" },
];

// Matched by the job's own contact email domain (set once per company by
// getOrCreateSenderContact in subcontractor-intake.ts) rather than by
// service_type text — more robust if that text ever changes.
export function subcontractorSenderForJob(email: string | null | undefined): SubcontractorSender | null {
  if (!email || !email.includes("@")) return null;
  const domain = email.split("@")[1]?.toLowerCase();
  return KNOWN_SUBCONTRACTOR_SENDERS.find((s) => s.domain === domain) ?? null;
}

// Structural treatment — Shipping/Compensation tabs in place of Report/
// Invoice, excluded from Billing, source: "subcontractor". Per Tim,
// 2026-08-30: "the only subcontracted jobs that should have this format
// is fastmoldtesting.com. For FLI Environmental subcontracted jobs, we
// need to use the same normal format." So this stays derived from
// KNOWN_SUBCONTRACTOR_SENDERS alone (currently just Fast Mold Testing) —
// FLI Environmental jobs get a normal source: "admin" job, Report/Invoice
// tabs, and normal Billing inclusion, even though the work itself is
// subcontracted.
export const KNOWN_SUBCONTRACTOR_COMPANY_NAMES: string[] = KNOWN_SUBCONTRACTOR_SENDERS.map((s) => s.companyName);

export function isKnownSubcontractorCompanyName(name: string | null | undefined): boolean {
  const normalized = name?.trim().toLowerCase();
  if (!normalized) return false;
  return KNOWN_SUBCONTRACTOR_COMPANY_NAMES.some((n) => n.toLowerCase() === normalized);
}

// Cosmetic-only detection — only ever drives labels/fields in the Add/Edit
// Project forms, never `source`, tabs, or Billing. FLI Environmental used to
// be in this list too (just an italicized label, otherwise a fully normal
// job) but per Tim, 2026-08-31, that's now superseded by a real structural
// workflow of its own — see FLI_ENVIRONMENTAL_COMPANY_ID in
// report-findings.ts, which every future FLI Environmental job uses
// instead. Left as its own list (rather than folded back into
// KNOWN_SUBCONTRACTOR_COMPANY_NAMES) since a future genuinely-cosmetic-only
// subcontractor could still be added here without also getting Fast Mold
// Testing's heavier Shipping/Compensation treatment.
export const KNOWN_SUBCONTRACTING_FOR_NAMES: string[] = [...KNOWN_SUBCONTRACTOR_COMPANY_NAMES];

export function isKnownSubcontractingForName(name: string | null | undefined): boolean {
  const normalized = name?.trim().toLowerCase();
  if (!normalized) return false;
  return KNOWN_SUBCONTRACTING_FOR_NAMES.some((n) => n.toLowerCase() === normalized);
}
