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

// Scope of Work bullets for a mold job, one per sample type actually taken
// on it (inferred from sample_counts' own keys) — falls back to showing
// all three when there's no sample data yet (e.g. previewing before lab
// results come in) rather than guessing wrong and omitting one that turns
// out to apply. Shared by the PDF (report-pdf.tsx) and the admin's
// read-only Scope of Work preview cell so the two never drift apart.
export function moldScopeOfWorkItems(sampleCounts: Record<string, number> | null | undefined): string[] {
  const sampleLabels = Object.keys(sampleCounts ?? {});
  const hasAir = sampleLabels.length === 0 || sampleLabels.some((l) => l.toLowerCase().includes("air"));
  const hasBulk = sampleLabels.length === 0 || sampleLabels.some((l) => l.toLowerCase().includes("bulk"));
  const hasSwab = sampleLabels.length === 0 || sampleLabels.some((l) => l.toLowerCase().includes("swab"));
  return [
    ...(hasAir ? ["Collection of air samples within the subject area for mold;"] : []),
    ...(hasBulk ? ["Collection of bulk samples within the subject area for mold;"] : []),
    ...(hasSwab ? ["Collection of swab samples within the subject area for mold;"] : []),
    "Preparation of a summary report detailing the sampling methodology along with analytical results and a conclusion.",
  ];
}
