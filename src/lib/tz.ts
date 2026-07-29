// Dependency-free timezone helpers using Intl.DateTimeFormat's timezone
// database (no external tz library needed).

function offsetMinutesAt(instant: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const parts = dtf.formatToParts(instant).reduce((acc, p) => {
    acc[p.type] = p.value;
    return acc;
  }, {} as Record<string, string>);

  const asIfUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute), Number(parts.second)
  );
  // localTime = utcTime + offset, so offset = (wall-clock in tz, read as UTC) - (actual UTC instant).
  return (asIfUtc - instant.getTime()) / 60000;
}

/** Converts a wall-clock date + "HH:MM" in `timeZone` to the equivalent UTC instant. */
export function zonedTimeToUtc(dateIso: string, hhmm: string, timeZone: string): Date {
  const [year, month, day] = dateIso.split("-").map(Number);
  const [hour, minute] = hhmm.split(":").map(Number);
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const offset = offsetMinutesAt(guess, timeZone);
  return new Date(guess.getTime() - offset * 60000);
}

/** Current wall-clock "HH:MM" and "YYYY-MM-DD" in `timeZone`, for the given instant (default now). */
export function nowInTimeZone(timeZone: string, at: Date = new Date()): { hhmm: string; dateIso: string } {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
  const parts = dtf.formatToParts(at).reduce((acc, p) => {
    acc[p.type] = p.value;
    return acc;
  }, {} as Record<string, string>);
  return {
    hhmm: `${parts.hour}:${parts.minute}`,
    dateIso: `${parts.year}-${parts.month}-${parts.day}`,
  };
}
