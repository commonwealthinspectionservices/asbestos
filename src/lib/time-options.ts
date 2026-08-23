// Half-hour interval time-of-day options ("HH:MM", 24hr) for every time
// picker across the app — 5:00 AM to 7:30 PM, the same business-hours range
// PortalBookingForm's preferred-time select has used since before this
// existed. A plain <input type="time"> lets someone scroll through every
// individual minute, and on mobile its native picker can fire onChange with
// an intermediate value before the field is actually done being edited —
// a fixed list of half-hour slots avoids both problems.
export const TIME_OPTIONS: string[] = [];
for (let totalMinutes = 5 * 60; totalMinutes <= 19 * 60 + 30; totalMinutes += 30) {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  TIME_OPTIONS.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
}

// TIME_OPTIONS plus the field's current value, if it's set but doesn't fall
// on a half-hour boundary — e.g. a subcontractor's preferred-window start
// time, or a historical requested_time from before this existed — so a
// select never silently drops or misrepresents an off-grid value that's
// already stored.
export function timeSelectOptions(current?: string | null): string[] {
  if (!current || TIME_OPTIONS.includes(current)) return TIME_OPTIONS;
  return [...TIME_OPTIONS, current].sort();
}
