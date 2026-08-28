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
//     "PLM - Bulk CVE, Per-Layer - 24 Hr TAT" — $12.00/sample.
//   - Mold Air Sampling: "Mold - Spore Trap Analysis - 24Hr TAT" —
//     $20.00/sample.
//   - Mold Bulk Sampling: "Mold - Direct Examination - 24Hr TAT" —
//     $20.00/sample.
// Not covered by any of the three invoices — left unestimated (null):
//   - Mold Swab Sampling, any Lead service type.
export function labRateCentsForServiceType(label: string): number | null {
  const l = label.toLowerCase();
  if (l.includes("mold")) {
    if (l.includes("air")) return 2000;
    if (l.includes("bulk")) return 2000;
    return null; // swab, or any other mold type not seen on a real invoice yet
  }
  if (l.includes("lead")) return null; // no lead line item on any invoice seen yet
  return 1200; // everything else = an asbestos inspection type
}

// Sums sample_counts × known rate across every service type on the job —
// silently contributes $0 for a service type with no confirmed rate (see
// labRateCentsForServiceType above) rather than throwing off the whole
// job's estimate over one unknown line.
export function estimatedLabCostCents(job: Pick<Job, "sample_counts">): number {
  let total = 0;
  for (const [label, count] of Object.entries(job.sample_counts ?? {})) {
    const rate = labRateCentsForServiceType(label);
    if (rate != null) total += rate * count;
  }
  return total;
}
