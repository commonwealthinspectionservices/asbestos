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

export function moldScopeOfWorkItems(serviceType: string | null | undefined): string[] {
  const { hasAir, hasBulk, hasSwab } = moldServiceTypeFlags(serviceType);
  return [
    ...(hasAir ? ["Collection of air samples within the subject area for mold;"] : []),
    ...(hasBulk ? ["Collection of bulk samples within the subject area for mold;"] : []),
    ...(hasSwab ? ["Collection of swab samples within the subject area for mold;"] : []),
    "Preparation of a summary report detailing the sampling methodology along with analytical results and a conclusion.",
  ];
}

// Fixed paragraphs confirmed (against 3 real air-inclusive FLI reports,
// verbatim) to be reused on every air-sampling mold report regardless of
// findings — the ACGIH comparison methodology in Discussion of Results, and
// the two generic-IAQ paragraphs that always open Conclusions & Recommendations
// on an air job. Bulk/swab-only reports use neither: real examples show no
// equivalent fixed paragraph for those, just fully custom prose per job.
export const MOLD_ACGIH_PARAGRAPH =
  "Although there are currently no standards or regulations to indicate acceptable levels of airborne fungal spores derived from indoor environments, a comparison of the indoor/outdoor (I/O) ratio of total spore enumeration is recommended below 1.0 (indoor levels should not overly exceed outdoor levels). The indoor and outdoor spore types and distribution should also be similar. According to ACGIH, \"…differences that can be detected with manageable sample sizes are likely to be in 10-fold multiplicative steps (e.g., 100 versus 1000...)\". Following this logic, if total fungal spores are ten (10) times greater in the sample from a suspect area than in the negative control sample collected from a non-suspect area, then that sample area may be a fungal amplification site.";

export const MOLD_INDOOR_AIR_QUALITY_PARAGRAPH =
  "Indoor air quality problems are often the result of complex and dynamic interactions between building systems, space use activities, management practices and occupant expectations. In most cases, indoor contaminants become problematic through irritation or odor before they reach levels toxic to humans. An HVAC system that brings fresh air into the space will generally remove pollutants from the occupied space and dilute the levels of pollutants in that space. With reduced exposure to pollutants, a reduction or elimination of symptoms in occupants should occur.";

export const MOLD_AIR_INVESTIGATION_GOAL_PARAGRAPH =
  "When an indoor air investigation is conducted, the goal is to determine whether the detected contaminant concentrations originate from the occupied spaces being surveyed or if they merely represent typical background concentrations.";

export function moldDiscussionDefault(serviceType: string | null | undefined): string {
  return moldServiceTypeFlags(serviceType).hasAir ? MOLD_ACGIH_PARAGRAPH : "";
}

export function moldConclusionsDefault(serviceType: string | null | undefined): string {
  return moldServiceTypeFlags(serviceType).hasAir
    ? `${MOLD_INDOOR_AIR_QUALITY_PARAGRAPH}\n\n${MOLD_AIR_INVESTIGATION_GOAL_PARAGRAPH}`
    : "";
}
