// Pure route-ordering engine: nearest-neighbor seed + 2-opt improvement over
// a precomputed travel-time matrix, with a soft penalty for AM/PM window
// mismatches. No I/O here so it can be unit-tested with a fixed mock matrix
// (see §7 of the master prompt / __tests__/routing.test.ts).

export type JobWindow = "AM" | "PM" | "ANY";

export interface RouteStop {
  id: string;
  window: JobWindow;
  durationMinutes: number;
}

export interface SolveRouteInput {
  /** NxN traffic-aware travel seconds. Index 0 is the base; indices 1..N-1 correspond to `stops` in order. */
  matrixSeconds: number[][];
  stops: RouteStop[];
  workdayStartMinutes: number;
  workdayEndMinutes: number;
}

export interface ScheduledStop {
  stopIndex: number; // index into `stops`
  arrivalMinutes: number;
  departMinutes: number;
}

export interface SolveRouteResult {
  /** Visiting order as indices into `stops` (base excluded — it's implicit start/end). */
  order: number[];
  totalDriveSeconds: number;
  schedule: ScheduledStop[];
}

// A wrong-half-day arrival costs more than any plausible drive-time saving,
// so 2-opt escapes it whenever a same-or-lower-drive alternative exists —
// but it's a penalty, not a hard constraint, so one awkward job never makes
// the whole route infeasible.
const WINDOW_PENALTY_SECONDS = 3600 * 6;

function stopMatrixIndex(stopIdx: number): number {
  return stopIdx + 1; // matrix index 0 is base
}

function computeSchedule(
  order: number[],
  matrix: number[][],
  stops: RouteStop[],
  workdayStartMinutes: number
): { schedule: ScheduledStop[]; totalDriveSeconds: number } {
  const schedule: ScheduledStop[] = [];
  let totalDriveSeconds = 0;
  let clockMinutes = workdayStartMinutes;
  let prevMatrixIdx = 0; // base

  for (const stopIdx of order) {
    const matrixIdx = stopMatrixIndex(stopIdx);
    const driveSeconds = matrix[prevMatrixIdx][matrixIdx];
    totalDriveSeconds += driveSeconds;
    const arrivalMinutes = clockMinutes + driveSeconds / 60;
    const departMinutes = arrivalMinutes + stops[stopIdx].durationMinutes;
    schedule.push({ stopIndex: stopIdx, arrivalMinutes, departMinutes });
    clockMinutes = departMinutes;
    prevMatrixIdx = matrixIdx;
  }

  return { schedule, totalDriveSeconds };
}

function windowPenalty(
  schedule: ScheduledStop[],
  stops: RouteStop[],
  workdayStartMinutes: number,
  workdayEndMinutes: number
): number {
  const midpoint = (workdayStartMinutes + workdayEndMinutes) / 2;
  let penalty = 0;
  for (const s of schedule) {
    const window = stops[s.stopIndex].window;
    if (window === "ANY") continue;
    const isAfternoon = s.arrivalMinutes >= midpoint;
    if (window === "AM" && isAfternoon) penalty += WINDOW_PENALTY_SECONDS;
    if (window === "PM" && !isAfternoon) penalty += WINDOW_PENALTY_SECONDS;
  }
  return penalty;
}

function objective(
  order: number[],
  matrix: number[][],
  stops: RouteStop[],
  workdayStartMinutes: number,
  workdayEndMinutes: number
): number {
  const { schedule, totalDriveSeconds } = computeSchedule(
    order, matrix, stops, workdayStartMinutes
  );
  return (
    totalDriveSeconds +
    windowPenalty(schedule, stops, workdayStartMinutes, workdayEndMinutes)
  );
}

function nearestNeighborSeed(matrix: number[][], stopCount: number): number[] {
  const remaining = new Set(Array.from({ length: stopCount }, (_, i) => i));
  const order: number[] = [];
  let currentMatrixIdx = 0; // base

  while (remaining.size > 0) {
    let best: number | null = null;
    let bestSeconds = Infinity;
    for (const stopIdx of remaining) {
      const seconds = matrix[currentMatrixIdx][stopMatrixIndex(stopIdx)];
      if (seconds < bestSeconds) {
        bestSeconds = seconds;
        best = stopIdx;
      }
    }
    order.push(best as number);
    remaining.delete(best as number);
    currentMatrixIdx = stopMatrixIndex(best as number);
  }

  return order;
}

function twoOptImprove(
  initialOrder: number[],
  matrix: number[][],
  stops: RouteStop[],
  workdayStartMinutes: number,
  workdayEndMinutes: number
): number[] {
  let order = [...initialOrder];
  let bestCost = objective(order, matrix, stops, workdayStartMinutes, workdayEndMinutes);
  let improved = true;

  while (improved) {
    improved = false;
    for (let i = 0; i < order.length - 1; i++) {
      for (let j = i + 1; j < order.length; j++) {
        const candidate = [
          ...order.slice(0, i),
          ...order.slice(i, j + 1).reverse(),
          ...order.slice(j + 1),
        ];
        const cost = objective(candidate, matrix, stops, workdayStartMinutes, workdayEndMinutes);
        if (cost < bestCost - 1e-9) {
          order = candidate;
          bestCost = cost;
          improved = true;
        }
      }
    }
  }

  return order;
}

export function solveRoute(input: SolveRouteInput): SolveRouteResult {
  const { matrixSeconds, stops, workdayStartMinutes, workdayEndMinutes } = input;

  if (stops.length === 0) {
    return { order: [], totalDriveSeconds: 0, schedule: [] };
  }

  const seed = nearestNeighborSeed(matrixSeconds, stops.length);
  const order = twoOptImprove(seed, matrixSeconds, stops, workdayStartMinutes, workdayEndMinutes);
  const { schedule, totalDriveSeconds } = computeSchedule(
    order, matrixSeconds, stops, workdayStartMinutes
  );

  return { order, totalDriveSeconds, schedule };
}

export function minutesToClock(minutes: number, timezoneOffsetLabel = ""): string {
  const h24 = Math.floor(minutes / 60) % 24;
  const m = Math.round(minutes % 60);
  const period = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}${timezoneOffsetLabel}`;
}

export function parseHHMMToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}
