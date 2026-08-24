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

// Person names often arrive as free text (e.g. all-lowercase from an email
// signature, or however an admin happened to type it) — capitalized for
// display only, everywhere a stored full name is shown. Never applied to
// business/company names, which can have intentional casing (LLC, &, etc).
export function toTitleCase(value: string): string {
  return value
    .toLowerCase()
    .split(" ")
    .map((word) => word.split("-").map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part)).join("-"))
    .join(" ");
}
