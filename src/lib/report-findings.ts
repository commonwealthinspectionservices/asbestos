// Canned Remarks-and-Limitations sentences, shared by the PDF report
// (report-pdf.tsx), the .xlsm template (report-xlsm.ts, asbestos only),
// and the "Overall findings" dropdown in the admin UI — one source of
// truth so the dropdown offers exactly the wording the generated
// documents actually use.
export const ASBESTOS_NEGATIVE_REMARK =
  "None of the suspect materials sampled were determined to have asbestos fibers present when analyzed by Polarized Light Microscopy.";
export const ASBESTOS_POSITIVE_REMARK =
  "Each identified asbestos containing material must be removed by a licensed asbestos abatement contractor prior to being disturbed by building maintenance, renovation or demolition activities.";

export const LEAD_NEGATIVE_REMARK =
  "None of the sampled paints contained detectable levels of lead based on analysis for Total Concentration of Lead.";
export const LEAD_POSITIVE_REMARK =
  "One or more of the sampled paints was determined to contain lead at a concentration meeting or exceeding the Massachusetts Department of Public Health (MassDPH) and Federal HUD lead-based paint threshold of 0.5% by weight (5,000 ppm). Materials determined to be lead-based paint should be managed in accordance with applicable state and federal regulations prior to being disturbed by building maintenance, renovation, or demolition activities.";

// Newton Fire & Flood's own standing mold Conclusions & Recommendations —
// per Tim, this exact wording (bulleted) belongs in every mold report for
// this one company specifically, always, the same way the two fixed
// MOLD_INDOOR_AIR_QUALITY/MOLD_AIR_INVESTIGATION_GOAL paragraphs below
// already render unconditionally for every air-inclusive mold report.
// Rendered directly into the report PDF (report-pdf.tsx), not pre-filled
// into mold_report_notes — that field is real per-job "Additional
// Conclusions & Recommendations" on top of this standing text, not a
// starting point Tim has to edit down. Not a general per-company default
// feature; every other company still needs its own case-specific write-up
// per mold job. Matched against the job's customer's company_id, not the
// job's own customer_id, since a second contact at the same company gets
// the same standing text.
export const NEWTON_FIRE_FLOOD_COMPANY_ID = "6481c518-8a22-4c83-83a1-6341e66d1f62";
export const NEWTON_FIRE_FLOOD_STANDARD_MOLD_CONCLUSION = `• Based on visual inspection and moisture assessment, materials exhibiting mold growth, elevated moisture levels, or organic buildup should undergo targeted remediation and specialized cleaning to restore indoor environmental quality.
• It is recommended that all structural surfaces, building components and hard materials identified with mold or microbial accumulation undergo thorough HEPA-vacuuming to capture settled spores and particulate prior to and following treatment.
• Where porous items have sustained microbial growth or water intrusion, removal and disposal is advised.
• Semi-porous and non-porous structural elements should be scrubbed and treated with an appropriate EPA registered antimicrobial agent after HEPA vacuuming to prevent further surface growth.`;

// Which final-report domain a single service-type label belongs to.
// Defaults to "asbestos" for anything that doesn't clearly say "mold" or
// "lead" (a custom/free-text type, or the common case where the label is
// just "Limited Asbestos Inspection") — matches the fallback every existing
// isMoldJob/isLeadJob check already used before this domain split existed.
export type ReportDomain = "asbestos" | "lead" | "mold";

export function domainForServiceTypeLabel(label: string): ReportDomain {
  const l = label.toLowerCase();
  if (l.includes("mold")) return "mold";
  if (l.includes("lead")) return "lead";
  return "asbestos";
}

// Pre-Renovation and Pre-Demolition are a full, inspector-directed survey of
// the whole property (the inspector decides what/where to sample) — a
// genuinely different report from Limited Asbestos Inspection's short,
// client-directed sampling letter, confirmed against 12 real past reports.
// Both share this one "full inspection" template (they only differ from
// each other in why the inspection happened, not in report structure).
// Same substring-match-on-job.service_type pattern as isMoldJob/isLeadJob
// elsewhere — accepts the same risk (renaming a service type's label in
// Settings reclassifies future jobs) that those already carry.
export function isFullInspectionAsbestosJob(serviceType: string | null | undefined): boolean {
  const l = (serviceType ?? "").toLowerCase();
  return l.includes("pre-renovation") || l.includes("pre-demolition");
}

// Fixed paragraphs for the full-inspection asbestos report, confirmed
// verbatim across 12 real past reports (all inspected by the same
// AHERA-accredited inspector under the owner's prior company) — same
// "rendered unconditionally, not admin-editable" treatment as the mold
// ACGIH/IAQ paragraphs above.
export const FULL_INSPECTION_SCOPE_PARAGRAPH =
  "provided a state licensed and EPA AHERA accredited asbestos inspector to perform an inspection of the subject area(s). The purpose of the inspection was to identify and sample building materials suspected to contain asbestos. Suspect materials include thermal system insulation, fireproofing, soundproofing, plasters, skimcoating, spray-applied or trowel applied finishes, ceiling & floor tiles, sheet flooring, caulking, glazing, mastics, adhesives, cement board products, roofing materials and numerous other products. Materials having the same function/application, similar color, texture or other observed similar characteristics were grouped together and sampled as one homogeneous material. A minimum of 2 samples of each homogenous material were collected.";

// Second and third "Scope and Approach:" paragraphs — unlabeled
// continuations in the real reports, not their own section.
export const FULL_INSPECTION_NON_SUSPECT_PARAGRAPH =
  "Homogeneous materials determined to be non-suspect by the inspector (if observed), include concrete floors, wood flooring/joists, concrete block, black/brown vinyl flexible duct connectors, fiberglass insulation, armaflex (neoprene) insulation, rubber, plastic, ceramic tile, glass and metal.";

export const FULL_INSPECTION_WALLS_PARAGRAPH =
  "If present, areas within walls, drywall encased columns and above ceilings were inspected where possible in accessible representative locations. However, each individual enclosed area was not inspected. Accessible areas beneath such surfaces were examined and sampled, and material quantities were estimated based on these observations.";

export const FULL_INSPECTION_BULK_SAMPLING_PARAGRAPH =
  "Bulk samples were collected in a random manner and submitted via chain of custody to the analytical laboratory. The samples were analyzed by Polarized Light Microscopy per EPA Method 600/R-93-116, July 1993. The detection limit of the EPA recommended method is one percent asbestos by weight. Materials containing greater than one percent asbestos are treated as asbestos-containing as required by the EPA. The laboratory is accredited by the National Institute of Standards and Technologies NIST/NVLAP Program and licensed by the Massachusetts Department of Labor Standards (DLS) for asbestos analysis in bulk materials.";

export const FULL_INSPECTION_ACM_CATEGORY_PARAGRAPH =
  "Any homogeneous material having at least one (1) sample analytically identified as containing one percent (1%) asbestos or greater is categorized as an asbestos containing material. Any material analytically identified as containing any asbestos fibers is categorized as an asbestos containing waste material. A summary of materials identified to contain asbestos is provided in Appendix A including approximate location(s) of the material and estimated quantities. Laboratory Analytical Data Sheets for each sample analyzed are included in Appendix C.";

export const FULL_INSPECTION_NON_ACM_CATEGORY_PARAGRAPH =
  "Homogeneous materials where each sample analyzed was determined not to contain asbestos are categorized as non-asbestos. A summary of non-asbestos materials is provided in Appendix B. Laboratory Analytical Data Sheets for each sample analyzed are included in Appendix C.";

// Always the first "Remarks and Limitations:" numbered item.
export const FULL_INSPECTION_ADDITIONAL_SUSPECT_REMARK =
  "Additional suspect materials may be present beneath surfaces (multiple layers) or within chases or crawlspace areas that were unknown or unaccessible at the time of the inspection but may be discovered during demolition, renovation or maintenance activities. Any additional suspect materials not identified in this report that become exposed during building renovation, maintenance or demolition should be sampled and analyzed for asbestos content prior to disturbing.";

export const FULL_INSPECTION_ACM_ABATEMENT_REMARK =
  "Each identified asbestos containing material must be removed by a licensed asbestos abatement contractor prior to being disturbed by building maintenance, renovation or demolition activities.";

export const FULL_INSPECTION_ACM_PLAN_DISCLAIMER_REMARK =
  "This report is not meant to be used as an asbestos abatement plan or abatement specification. Material quantities and locations are estimates and approximations and should not be used to obtain pricing from contractors. We recommend contracting for abatement after an abatement specification is prepared by a licensed Asbestos Project Designer.";

// Every report domain actually present on a job, in the order their labels
// were originally selected — a job combining service types from more than
// one domain (e.g. "Limited Asbestos Inspection, Mold Air Sampling")
// produces one final report per domain returned here, not just one. Used
// wherever the old code picked a single winner via isMoldJob/isLeadJob
// priority (report-pdf.tsx, report-packet.ts, lab-email.ts,
// JobsDashboard.tsx) — those all silently dropped whichever domain lost.
export function jobReportDomains(serviceType: string | null | undefined): ReportDomain[] {
  const labels = (serviceType ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (labels.length === 0) return ["asbestos"];
  const domains: ReportDomain[] = [];
  for (const label of labels) {
    const domain = domainForServiceTypeLabel(label);
    if (!domains.includes(domain)) domains.push(domain);
  }
  return domains;
}

const REPORT_DOMAIN_FILENAME_LABEL: Record<ReportDomain, string> = {
  asbestos: "Asbestos",
  lead: "Lead",
  mold: "Mold",
};

// Downloaded report filename: "[job #] [service type] [address].pdf" —
// same for every caller (admin and portal report routes) so a report saved
// from either place is identifiable without opening it. Strips characters
// that are unsafe in a filename on any OS rather than just the ones that
// happen to show up in a Massachusetts street address today.
export function reportDownloadFilename(
  job: { project_number: string | null; service_address: string },
  domain: ReportDomain,
  fallbackId: string
): string {
  const projectNumber = job.project_number ?? fallbackId;
  const raw = `${projectNumber} ${REPORT_DOMAIN_FILENAME_LABEL[domain]} ${job.service_address}`;
  return raw.replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, " ").trim();
}

// Which mold sample types are actually on a job — derived from
// job.service_type (the comma-joined labels chosen at booking time, e.g.
// "Mold Air Sampling, Mold Bulk Sampling"), known from the moment the job's
// created, unlike sample_counts which stays empty until lab results come
// back. Falls back to all three only if service_type doesn't clearly name
// any of them (e.g. a custom/free-text type), rather than guessing wrong
// and omitting one that turns out to apply. Shared by the PDF
// (report-pdf.tsx) and the admin's Scope of Work preview / Discussion &
// Conclusions default text so none of them can drift out of sync.
export function moldServiceTypeFlags(serviceType: string | null | undefined): { hasAir: boolean; hasBulk: boolean; hasSwab: boolean } {
  const labels = (serviceType ?? "").split(",").map((s) => s.trim().toLowerCase());
  const hasAir = labels.some((l) => l.includes("air"));
  const hasBulk = labels.some((l) => l.includes("bulk"));
  const hasSwab = labels.some((l) => l.includes("swab"));
  if (!hasAir && !hasBulk && !hasSwab) return { hasAir: true, hasBulk: true, hasSwab: true };
  return { hasAir, hasBulk, hasSwab };
}

const MOLD_SCOPE_AIR_LINE = "Collection of air samples within the subject area for mold;";
const MOLD_SCOPE_BULK_LINE = "Collection of bulk samples within the subject area for mold;";
const MOLD_SCOPE_SWAB_LINE = "Collection of swab samples within the subject area for mold;";

// The per-sample-type Scope of Work lines, driven entirely by job.service_type
// — no admin input at all, since which sample types are on a job is already
// known from booking. Not shown as a cell anywhere in the admin UI, same
// treatment as the fixed Discussion/Conclusions paragraphs.
export function moldScopeOfWorkItems(serviceType: string | null | undefined): string[] {
  const { hasAir, hasBulk, hasSwab } = moldServiceTypeFlags(serviceType);
  return [
    ...(hasAir ? [MOLD_SCOPE_AIR_LINE] : []),
    ...(hasBulk ? [MOLD_SCOPE_BULK_LINE] : []),
    ...(hasSwab ? [MOLD_SCOPE_SWAB_LINE] : []),
  ];
}

// Always the last numbered line in Scope of Work, on every mold job
// regardless of sample types.
export const MOLD_SCOPE_CLOSING_LINE =
  "Preparation of a summary report detailing the sampling methodology along with analytical results and a conclusion.";

// Fixed paragraphs confirmed (against 3 real air-inclusive FLI reports,
// verbatim) to be reused on every air-sampling mold report regardless of
// findings — the ACGIH comparison methodology in Discussion of Results, and
// the two generic-IAQ paragraphs that always open Conclusions & Recommendations
// on an air job. Rendered unconditionally by report-pdf.tsx (not stored in
// the admin's editable report_summary/report_notes cells, and not
// deletable by editing them) — same treatment as the fixed Limitations
// section. Bulk/swab-only reports get neither: real examples show no
// equivalent fixed paragraph for those, just fully custom prose per job.
export const MOLD_ACGIH_PARAGRAPH =
  "Although there are currently no standards or regulations to indicate acceptable levels of airborne fungal spores derived from indoor environments, a comparison of the indoor/outdoor (I/O) ratio of total spore enumeration is recommended below 1.0 (indoor levels should not overly exceed outdoor levels). The indoor and outdoor spore types and distribution should also be similar. According to ACGIH, \"…differences that can be detected with manageable sample sizes are likely to be in 10-fold multiplicative steps (e.g., 100 versus 1000...)\". Following this logic, if total fungal spores are ten (10) times greater in the sample from a suspect area than in the negative control sample collected from a non-suspect area, then that sample area may be a fungal amplification site.";

export const MOLD_INDOOR_AIR_QUALITY_PARAGRAPH =
  "Indoor air quality problems are often the result of complex and dynamic interactions between building systems, space use activities, management practices and occupant expectations. In most cases, indoor contaminants become problematic through irritation or odor before they reach levels toxic to humans. An HVAC system that brings fresh air into the space will generally remove pollutants from the occupied space and dilute the levels of pollutants in that space. With reduced exposure to pollutants, a reduction or elimination of symptoms in occupants should occur.";

export const MOLD_AIR_INVESTIGATION_GOAL_PARAGRAPH =
  "When an indoor air investigation is conducted, the goal is to determine whether the detected contaminant concentrations originate from the occupied spaces being surveyed or if they merely represent typical background concentrations.";
