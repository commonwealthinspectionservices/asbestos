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
