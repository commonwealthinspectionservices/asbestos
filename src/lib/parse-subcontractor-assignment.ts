// Fast Mold Testing's "New Assignment" / "Inspection Rescheduled" emails —
// the first (and so far only) company that sends Tim subcontracted work
// rather than his own client work. Unlike parse-job-intake.ts's plain-text
// template, these are real HTML emails with a consistent labeled-table
// layout ("<td>Label:</td><td>Value</td>"), so extraction is anchored on
// those labels rather than line position — same underlying philosophy
// (fail to null on anything unexpected, never guess) in a shape that fits
// the actual source format.

export interface ParsedAssignment {
  address: string;
  /** Human-readable window text as sent, e.g. "Wednesday, August 19, 2026, 8:00 AM - 4:00 PM" — kept verbatim since it's a range to call the client about, not a real appointment time yet. */
  preferredWindowText: string;
  /** YYYY-MM-DD parsed out of preferredWindowText, for requested_date — null if the date couldn't be confidently parsed (falls back to manual entry rather than guessing). */
  preferredDate: string | null;
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  clientNotes: string;
  jobNotes: string;
  baseCompensation: string | null;
  labFees: string | null;
  netPayment: string | null;
}

export interface ParsedReschedule {
  address: string;
  newWindowText: string;
  newDate: string | null;
}

// Finds `<td ...>{label}</td>` then captures the very next `<td>...</td>`'s
// inner content — skipping any HTML comment that lands between them (a
// real, observed quirk: one of Fast Mold Testing's own template source
// comments has leaked into the actual sent email between the Job Notes
// label and its value). Tags are stripped and entities unescaped from the
// captured value; a nested <strong>Window 1:</strong>-style prefix is left
// in place since callers that care (parsePreferredWindowText) parse it
// themselves.
function extractLabeledField(html: string, label: string): string | null {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `<td[^>]*>\\s*${escapedLabel}\\s*</td>\\s*(?:<!--[\\s\\S]*?-->\\s*)?<td[^>]*>([\\s\\S]*?)</td>`,
    "i"
  );
  const match = html.match(pattern);
  if (!match) return null;
  return stripHtml(match[1]);
}

function stripHtml(fragment: string): string {
  return fragment
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&middot;/g, "·")
    .replace(/&copy;/g, "©")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .filter((line, i, arr) => line.length > 0 || (i > 0 && arr[i - 1].length > 0))
    .join("\n")
    .trim();
}

const MONTHS: Record<string, string> = {
  january: "01", february: "02", march: "03", april: "04", may: "05", june: "06",
  july: "07", august: "08", september: "09", october: "10", november: "11", december: "12",
};

// Anchored on "Month D, YYYY" (e.g. "August 19, 2026") rather than trusting
// Date.parse/new Date(string) — locale/engine-dependent and this app
// deliberately avoids ambiguous date parsing elsewhere (see job-intake.ts).
function parseMonthDayYear(text: string): string | null {
  const match = text.match(/([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})/);
  if (!match) return null;
  const month = MONTHS[match[1].toLowerCase()];
  if (!month) return null;
  const day = match[2].padStart(2, "0");
  return `${match[3]}-${month}-${day}`;
}

export function parseNewAssignmentEmail(html: string): ParsedAssignment | null {
  const address = extractLabeledField(html, "Address:");
  const preferredWindowsRaw = extractLabeledField(html, "Preferred Windows:");
  const clientName = extractLabeledField(html, "Name:");
  const clientEmail = extractLabeledField(html, "Email:");
  const clientPhone = extractLabeledField(html, "Phone:");
  const clientNotes = extractLabeledField(html, "Client Notes:");
  const jobNotes = extractLabeledField(html, "Job Notes:");
  const baseCompensation = extractLabeledField(html, "Base Compensation:");
  const netPayment = extractLabeledField(html, "Est. Net Payment:");
  // The label itself carries a variable sample count ("Est. Lab Fees (4
  // samples):") — matched separately since extractLabeledField needs the
  // exact label text.
  const labFeesMatch = html.match(/<td[^>]*>\s*Est\.\s*Lab Fees[^<]*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/i);
  const labFees = labFeesMatch ? stripHtml(labFeesMatch[1]) : null;

  if (!address || !preferredWindowsRaw || !clientName) return null;

  // Only "Window 1" is used even when a job offers multiple candidate
  // windows — the actual appointment gets set by calling the client
  // anyway (see "Action Required" in the source email), so this is
  // always provisional, not a promise of which window wins.
  const windowMatch = preferredWindowsRaw.match(/Window 1:\s*(.+)/i) ?? [null, preferredWindowsRaw];
  const preferredWindowText = (windowMatch[1] ?? preferredWindowsRaw).trim();

  return {
    address,
    preferredWindowText,
    preferredDate: parseMonthDayYear(preferredWindowText),
    clientName,
    clientEmail: clientEmail ?? "",
    clientPhone: clientPhone ?? "",
    clientNotes: clientNotes ?? "",
    jobNotes: jobNotes ?? "",
    baseCompensation,
    labFees,
    netPayment,
  };
}

// "The inspection at {address} has been rescheduled: From: {old} To: {new}"
export function parseRescheduledEmail(html: string): ParsedReschedule | null {
  const text = stripHtml(html);
  const addressMatch = text.match(/inspection at (.+?) has been rescheduled/i);
  const toMatch = text.match(/To:\s*(.+)/i);
  if (!addressMatch || !toMatch) return null;

  const address = addressMatch[1].trim();
  const newWindowText = toMatch[1].trim();
  return {
    address,
    newWindowText,
    newDate: parseMonthDayYear(newWindowText),
  };
}
