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

// Scope of Work bullets for a mold job, one per sample type actually
// selected on it (job.service_type — the comma-joined labels chosen at
// booking time, e.g. "Mold Air Sampling, Mold Bulk Sampling") — known from
// the moment the job's created, unlike sample_counts which stays empty
// until lab results come back. Falls back to showing all three only if
// service_type doesn't clearly name any of them (e.g. a custom/free-text
// type), rather than guessing wrong and omitting one that turns out to
// apply. Shared by the PDF (report-pdf.tsx) and the admin's read-only
// Scope of Work preview cell so the two never drift apart.
export function moldScopeOfWorkItems(serviceType: string | null | undefined): string[] {
  const labels = (serviceType ?? "").split(",").map((s) => s.trim().toLowerCase());
  const hasAir = labels.some((l) => l.includes("air"));
  const hasBulk = labels.some((l) => l.includes("bulk"));
  const hasSwab = labels.some((l) => l.includes("swab"));
  const none = !hasAir && !hasBulk && !hasSwab;
  return [
    ...(hasAir || none ? ["Collection of air samples within the subject area for mold;"] : []),
    ...(hasBulk || none ? ["Collection of bulk samples within the subject area for mold;"] : []),
    ...(hasSwab || none ? ["Collection of swab samples within the subject area for mold;"] : []),
    "Preparation of a summary report detailing the sampling methodology along with analytical results and a conclusion.",
  ];
}
