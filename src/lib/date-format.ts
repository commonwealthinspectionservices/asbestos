// Standard display format for every date shown anywhere in this app —
// DD/MM/YYYY, not the US-conventional MM/DD/YYYY — per explicit owner
// request (2026-08-15). Takes an ISO "YYYY-MM-DD" string (however it
// reached the caller — a DB column, a form field, etc.) and returns it
// reordered; returns null for anything that isn't a real date so callers
// can fall back to their own blank/placeholder handling.
export function formatDateDMY(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.slice(0, 10).split("-");
  if (!y || !m || !d || y.length !== 4) return null;
  return `${d}/${m}/${y}`;
}
