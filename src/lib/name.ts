// Every "full name" field in the app is stored as a single string — these
// just let a form split that into separate First/Last cells for editing,
// then rejoin them the same way before saving, without touching the
// underlying single-column storage anywhere.
export function splitFullName(fullName: string | null | undefined): { first: string; last: string } {
  const trimmed = (fullName ?? "").trim();
  if (!trimmed) return { first: "", last: "" };
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1] };
}

export function joinName(first: string, last: string): string {
  return [first.trim(), last.trim()].filter(Boolean).join(" ");
}
