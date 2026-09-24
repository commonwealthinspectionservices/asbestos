// Per Tim, 2026-09-20 — mileage is tracked per day as an editable route:
// home → each job that day → the lab → home. Auto-filled from the schedule,
// then dragged/edited by hand. Feeds the monthly payout table.
export const LAB_ADDRESS = "55 Accord Park Dr, Rockland, MA 02370";
export const LAB_LABEL = "Crystal Analytical";
// IRS standard business mileage rate, cents per mile. Update when the IRS
// publishes a new one each January.
export const MILEAGE_RATE_CENTS = 76; // 2026 rate, matches what QuickBooks uses ($0.76/mi)
// Share of each month's profit (after mileage) set aside for taxes.
export const TAX_SET_ASIDE_PERCENT = 35;

export type StopKind = "home" | "job" | "lab" | "other" | "summary";

export interface MileageStop {
  id: string;
  kind: StopKind;
  label: string;
  address: string;
  job_id?: string;
}

export interface MileageLeg {
  miles: number;
  manual?: boolean;
  /** Past days keep their stops as a plain list, with one leg holding the whole day's miles. */
  total?: boolean;
  /** A day total typed over the computed one; cleared whenever the stops change. */
  dayTotal?: number;
  /** Jobs whose stop was deliberately removed from this day, so a schedule sync doesn't put them back. */
  dismissedJobs?: string[];
}

export interface MileageDay {
  day: string;
  stops: MileageStop[];
  /** legs[i] is the drive from stops[i] to stops[i+1]. */
  legs: MileageLeg[];
}

let idCounter = 0;
export function newStopId(): string {
  idCounter += 1;
  return `${Date.now().toString(36)}${idCounter}${Math.random().toString(36).slice(2, 6)}`;
}

export function normalizeAddress(a: string): string {
  return a.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function totalMiles(day: Pick<MileageDay, "legs">): number {
  if (day.legs[0]?.dayTotal != null) return day.legs[0].dayTotal;
  return Math.round(day.legs.reduce((s, l) => s + (l.miles || 0), 0) * 10) / 10;
}

/** The day a job was actually scheduled/done — confirmed_date when set
    (Boston Harbor-style jobs never have requested_date), else
    requested_date. Lives here (not mileage.ts, which pulls in
    getSupabaseAdminFresh and other server-only imports) specifically so
    client components — Revenue & Earnings Summary's own billingDateFor
    and its "Not showing up above" gap check — can use the exact same
    fallback the mileage/routing code already uses, per Tim, 2026-09-23:
    a job whose Project Info tab already shows this same fallback for
    "Completed date" was confusingly still getting flagged as missing a
    fieldwork date, since that display fallback was never actually
    reflected in what this page bucketed jobs by. */
export function effectiveJobDate(j: { confirmed_date?: string | null; requested_date: string | null }): string | null {
  return j.confirmed_date ?? j.requested_date ?? null;
}

