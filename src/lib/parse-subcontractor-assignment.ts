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
  /** The job's real scope of work — physical inspection/testing instructions — with the sample/service list and any "call/text to confirm arrival" line split out into sampleTypes/arrivalInstruction, so this stays focused on what to actually do on site rather than logistics or an itemized list. */
  scopeOfWork: string;
  /** From an "Includes: (x1 A) + (x1 B) + ..." line, e.g. ["x1 Outdoor Air", "x1 Indoor Air", ...] — empty if no such line was present. */
  sampleTypes: string[];
  /** A scheduling instruction like "PLEASE CALL/TEXT CLIENT TO CONFIRM ARRIVAL TIME" — logistics, not scope of work, so it's split out here instead of living inside it. Null if the job notes didn't have one. */
  arrivalInstruction: string | null;
  baseCompensation: string | null;
  labFees: string | null;
  netPayment: string | null;
  /** Only the shipment included in this email (typically the sample kit) — Fast Mold Testing's portal has shown a second shipment (e.g. a HERTSMI dust-test kit to a different lab) added later with no follow-up email, so this is a floor, not a guarantee of everything they'll eventually ship. */
  shippingProvider: string | null;
  shippingSpeed: string | null;
  shippingTrackingNumber: string | null;
  shippingLabelUrl: string | null;
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

// Fast Mold Testing's "Job Notes" is one freeform multi-line blob mixing
// real work instructions with an itemized sample list and a scheduling
// aside — split those two out by their own recognizable shape (an
// "Includes: (...) + (...)" line, and any line mentioning "confirm
// arrival time") rather than trying to classify every sentence, which
// would mean guessing at wording this template hasn't shown us yet.
// Whatever's left is the real scope of work.
function splitJobNotes(raw: string): { scopeOfWork: string; sampleTypes: string[]; arrivalInstruction: string | null } {
  let sampleTypes: string[] = [];
  let arrivalInstruction: string | null = null;
  const kept: string[] = [];

  for (const line of raw.split("\n")) {
    const includesMatch = line.match(/^Includes:\s*(.+)$/i);
    if (includesMatch) {
      sampleTypes = includesMatch[1]
        .split(/\)\s*\+\s*\(/)
        .map((s) => s.replace(/^\(/, "").replace(/\)$/, "").trim())
        .filter(Boolean);
      continue;
    }
    if (/confirm\s+arrival\s+time/i.test(line)) {
      arrivalInstruction = line.trim().replace(/:\s*$/, "");
      continue;
    }
    kept.push(line);
  }

  return {
    scopeOfWork: kept.join("\n").replace(/\n{3,}/g, "\n\n").trim(),
    sampleTypes,
    arrivalInstruction,
  };
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
  // Present on most assignments (the sample-kit shipment) but not
  // guaranteed — e.g. the "Rescheduled" email never has one, and it's
  // plausible some assignment type doesn't ship anything. Left optional
  // rather than failing the whole parse over it.
  const shippingProvider = extractLabeledField(html, "Provider:");
  const shippingSpeed = extractLabeledField(html, "Speed:");
  const shippingTrackingNumber = extractLabeledField(html, "Tracking Number:");
  const shippingLabelUrl = extractLabeledField(html, "Label URL:");

  if (!address || !preferredWindowsRaw || !clientName) return null;

  // Only "Window 1" is used even when a job offers multiple candidate
  // windows — the actual appointment gets set by calling the client
  // anyway (see "Action Required" in the source email), so this is
  // always provisional, not a promise of which window wins.
  const windowMatch = preferredWindowsRaw.match(/Window 1:\s*(.+)/i) ?? [null, preferredWindowsRaw];
  const preferredWindowText = (windowMatch[1] ?? preferredWindowsRaw).trim();
  const { scopeOfWork, sampleTypes, arrivalInstruction } = splitJobNotes(jobNotes ?? "");

  return {
    address,
    preferredWindowText,
    preferredDate: parseMonthDayYear(preferredWindowText),
    clientName,
    clientEmail: clientEmail ?? "",
    clientPhone: clientPhone ?? "",
    clientNotes: clientNotes ?? "",
    scopeOfWork,
    sampleTypes,
    arrivalInstruction,
    baseCompensation,
    labFees,
    netPayment,
    shippingProvider,
    shippingSpeed,
    shippingTrackingNumber,
    shippingLabelUrl,
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
