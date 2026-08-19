// Standard display format for every date shown anywhere in this app —
// MM/DD/YYYY. Was briefly swept to DD/MM/YYYY per an owner request on
// 2026-08-15 (that variant lived here as formatDateDMY), then reverted
// back to MM/DD/YYYY everywhere per a follow-up owner request on
// 2026-08-19 — DD/MM/YYYY turned out to be the wrong call. Emails already
// used MM/DD/YYYY throughout (see the old comment below, now moot since
// there's no longer a second convention to be an exception to), so this
// single function now covers both admin/portal UI and every email. Takes
// an ISO "YYYY-MM-DD" string (however it reached the caller — a DB
// column, a form field, etc.) and returns it reordered; returns null for
// anything that isn't a real date so callers can fall back to their own
// blank/placeholder handling.
export function formatDateMDY(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.slice(0, 10).split("-");
  if (!y || !m || !d || y.length !== 4) return null;
  return `${m}/${d}/${y}`;
}

function formatClockTime(totalMinutes: number): string {
  const normalized = ((totalMinutes % 1440) + 1440) % 1440;
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 || 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

/** The portal booking form's raw "HH:MM" (24hr, from <input type="time">) as a plain 12hr clock time. */
export function formatRequestedTime(hhmm: string | null | undefined): string | null {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return formatClockTime(h * 60 + m);
}

// A requested time (from the portal booking form's <input type="time">) is
// never a promise — nothing is confirmed until the owner sets a real
// confirmed_date/confirmed_time. The request-received email shows the exact
// time the customer typed (formatRequestedTime above) plus this +/-1hr
// window as explanatory subtext underneath it, per explicit owner request
// (2026-08-15) — "list the actual time... beneath the time, explain that
// window rule... it's an approximate time", not literally replace the exact
// time. Wraps past midnight without a "next day" note — a real edge case
// (an 11:30pm request) but not worth the complexity, the owner is following
// up personally regardless.
export function formatRequestedTimeWindow(hhmm: string | null | undefined): string | null {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  const totalMinutes = h * 60 + m;
  return `${formatClockTime(totalMinutes - 60)} – ${formatClockTime(totalMinutes + 60)}`;
}
