// Crystal Analytical's official per-sample pricing, transcribed from the
// general pricing sheet Tim sent 2026-09-04 ("General Pricing - Crystal
// Analytical 2026-2", dated 08/20/2026 on the document itself). Scoped to
// only the test families that actually show up on Commonwealth's real
// invoices so far — asbestos bulk PLM, mold (spore trap + direct
// examination), and lead. If a new test type starts showing up, add it
// here rather than guessing a family for it (see identifyTestFamily below
// — unmatched text returns null, never a wrong guess).
export type TurnaroundTier = "3hr" | "6hr" | "24hr" | "48hr" | "72hr" | "5day";
export type TestFamily = "plm-bulk-cve" | "mold" | "lead-total";

const PRICE_TABLE_CENTS: Record<TestFamily, Partial<Record<TurnaroundTier, number>>> = {
  // PLM-1 "Asbestos Bulk - PLM CVE, Per-Layer" — the only asbestos bulk
  // test type seen on a real Commonwealth invoice so far.
  "plm-bulk-cve": { "3hr": 1500, "6hr": 1350, "24hr": 1200, "48hr": 1000, "72hr": 900, "5day": 850 },
  // MLD-1 "Spore Trap Analysis" and MLD-2 "Surface Samples - Semi-
  // Quantitative Direct Identification of Fungi" (billed on real invoices
  // as "Mold - Spore Trap Analysis" / "Mold - Direct Examination") price
  // identically at every tier, so one shared table covers both.
  mold: { "3hr": 3000, "6hr": 2500, "24hr": 2000, "48hr": 1900, "72hr": 1850, "5day": 1800 },
  // MTL-1 "Lead - Total Lead Concentration via AA" — no 3hr/6hr rush
  // tier offered for this test.
  "lead-total": { "24hr": 3500, "48hr": 2200, "72hr": 1900, "5day": 1700 },
};

// Matches the "Product/Service full name" + description text a weekly
// summary line prints (e.g. "Analytical Services:Asbestos Analysis:PLM -
// Bulk CVE, Per-Layer - 6Hr TAT") to one of the families above. Deliberately
// narrow — returns null rather than a guess for anything that doesn't
// clearly say which test this is, so an unrecognized test type is silently
// skipped (no price check at all) rather than flagged against the wrong
// row.
export function identifyTestFamily(testDescription: string): TestFamily | null {
  const text = testDescription.replace(/\s+/g, " ");
  if (/PLM\s*-?\s*Bulk\s*CVE/i.test(text)) return "plm-bulk-cve";
  if (/Mold\s*-\s*(Direct Examination|Spore Trap)/i.test(text)) return "mold";
  if (/Lead\b[\s\S]{0,40}Total|Total Lead/i.test(text)) return "lead-total";
  return null;
}

// Same narrow-match, null-if-unsure approach for the turnaround tier —
// real invoices abbreviate as "24 Hr TAT" / "24Hr TAT" / "6Hr TAT" (space
// before "Hr" isn't consistent), and a 5-day tier would presumably print
// as some variant of "5 Day" though none has shown up on a real invoice
// yet.
export function identifyTurnaroundTier(text: string): TurnaroundTier | null {
  if (/5\s*Day/i.test(text)) return "5day";
  const hrMatch = text.match(/(\d+)\s*Hr\s*TAT/i);
  if (!hrMatch) return null;
  const tier = `${hrMatch[1]}hr`;
  const validHourTiers: string[] = ["3hr", "6hr", "24hr", "48hr", "72hr"];
  return validHourTiers.includes(tier) ? (tier as TurnaroundTier) : null;
}

/** The official per-sample rate for this test+tier, or null if either couldn't be confidently identified (never a guess). */
export function expectedUnitPriceCents(testDescription: string): number | null {
  const family = identifyTestFamily(testDescription);
  const tier = identifyTurnaroundTier(testDescription);
  if (!family || !tier) return null;
  return PRICE_TABLE_CENTS[family][tier] ?? null;
}

export interface LabInvoicePriceCheck {
  ok: boolean;
  family: TestFamily | null;
  tier: TurnaroundTier | null;
  expectedUnitPriceCents: number | null;
  billedUnitPriceCents: number;
}

// Small tolerance for rounding — real invoices seen so far match the price
// sheet exactly, but this avoids a false alarm over a stray penny.
const TOLERANCE_CENTS = 1;

/** Compares what Crystal actually billed per sample against their own published rate for that test+tier. `ok` is true whenever the family/tier couldn't be identified — that's "nothing to check," not "passed a check." */
export function checkLabInvoiceLineItemPrice(testDescription: string, billedUnitPriceCents: number): LabInvoicePriceCheck {
  const family = identifyTestFamily(testDescription);
  const tier = identifyTurnaroundTier(testDescription);
  const expected = family && tier ? PRICE_TABLE_CENTS[family][tier] ?? null : null;
  return {
    ok: expected == null || Math.abs(expected - billedUnitPriceCents) <= TOLERANCE_CENTS,
    family,
    tier,
    expectedUnitPriceCents: expected,
    billedUnitPriceCents,
  };
}
