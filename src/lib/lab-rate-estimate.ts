import type { Job } from "@/lib/types";

// Per Tim, 2026-08-28 — Crystal Analytical is moving to billing once a
// week (Fridays), covering everything analyzed that week. He wants to see
// a running estimate of what that invoice will total *before* it actually
// arrives, using rates inferred from three real invoices he provided
// (#6491, #6497, #6498) rather than an editable rate table — anything
// outside what those three invoices actually billed is left unestimated
// (contributes $0) rather than guessed, since a wrong guess here is worse
// than an admitted gap.
//
// Confirmed rates (per sample):
//   - Asbestos, any inspection type (Limited/Pre-Renovation/Pre-Demolition):
//     "PLM - Bulk CVE, Per-Layer - 24 Hr TAT" — $12.00/sample standard,
//     $15.00/sample when the job is Rush ("- 3Hr TAT" instead of "- 24 Hr
//     TAT" — confirmed against the weekly summary's own line item for
//     26-0009, 2026-08-28: "Tim: that must mean that they charge fifteen
//     dollars for a rush then." No Newton exception here — unlike the
//     invoice-defaults.ts rush *customer* pricing, this is what Crystal
//     itself charges us, which doesn't depend on who the customer is).
//   - Mold Air Sampling: "Mold - Spore Trap Analysis - 24Hr TAT" —
//     $20.00/sample.
//   - Mold Bulk Sampling: "Mold - Direct Examination - 24Hr TAT" —
//     $20.00/sample.
// Not covered by any real invoice seen yet — left unestimated (null):
//   - Mold Swab Sampling, any Lead service type, a Rush mold line item.
export function labRateCentsForServiceType(label: string, isRush: boolean): number | null {
  const l = label.toLowerCase();
  if (l.includes("mold")) {
    if (l.includes("air")) return 2000;
    if (l.includes("bulk")) return 2000;
    return null; // swab, or any other mold type not seen on a real invoice yet
  }
  if (l.includes("lead")) return null; // no lead line item on any invoice seen yet
  return isRush ? 1500 : 1200; // everything else = an asbestos inspection type
}

// Sums sample_counts × known rate across every service type on the job —
// silently contributes $0 for a service type with no confirmed rate (see
// labRateCentsForServiceType above) rather than throwing off the whole
// job's estimate over one unknown line.
export function estimatedLabCostCents(job: Pick<Job, "sample_counts" | "lab_turnaround">): number {
  const isRush = job.lab_turnaround === "Rush";
  let total = 0;
  for (const [label, count] of Object.entries(job.sample_counts ?? {})) {
    const rate = labRateCentsForServiceType(label, isRush);
    if (rate != null) total += rate * count;
  }
  return total;
}
