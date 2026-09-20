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
  return Math.round(day.legs.reduce((s, l) => s + (l.miles || 0), 0) * 10) / 10;
}

