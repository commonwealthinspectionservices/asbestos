// Formats digits as the user types into a phone number, e.g.
// "6175551234" -> "617-555-1234" — same dash-separated style as
// formatPhoneInput in admin/JobsDashboard.tsx (kept as a separate copy
// there for the same client-bundle-size reason as the rest of this app's
// admin/portal format helpers). Extra non-digit characters are stripped
// and re-applied; anything past 10 digits is ignored.
export function formatPhoneNumber(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}
