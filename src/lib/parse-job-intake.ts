// Boston Harbor Water Restoration's "ACM Order" emails follow one of two
// fixed templates — not freeform English, an actual template either way,
// just two different ones seen in the wild:
//
// Bare/positional (confirmed against 3 real examples: Peter Linski/22
// Sunnyplain Ave, Allie Duffy/315 Broadway, Mike Drummond/27 Spring St):
//
//   Homeowner name
//   Job site street address
//   Job site town
//   Homeowner phone
//   Boston Harbor contact name
//   Boston Harbor contact phone
//   Date of request (YYYY-MM-DD)
//   Scope of work (one or more lines)
//
// Labeled (confirmed live 2026-08-24 against a real order — Geraldine
// Burns/61 Partridge St — that the bare-format parser rejected outright,
// which meant no candidate email even fell through to the "couldn't
// parse" alert path since it wasn't recognized as a real order at all):
// each field is its own label line immediately followed by its value line,
// and a trailing "--" line (a conventional email signature delimiter)
// marks the end of the scope-of-work text, not more of it:
//
//   Customer Name
//   <value>
//   Customer Address
//   <value>
//   City
//   <value>
//   Customer Phone
//   <value>
//   BHWR contact
//   <value>
//   BHWR contact phone
//   <value>
//   Date needed
//   <value>
//   Description
//   <value — everything up to a lone "--" line, or end of message>
//
// Anchoring on the two phone-number lines and the date line (all three have
// a strict, unambiguous shape) rather than just taking "the first 8 lines"
// blind — a genuinely malformed or off-template email should fail to parse
// and fall through to manual handling, not silently misfile a wrong address
// into a real job. Same discipline applies to the labeled format: every
// field must be present and pass its own shape check, or this returns null
// just like the bare format does.
import { formatPhoneNumber } from "@/lib/phone";

export interface ParsedJobIntake {
  homeownerName: string;
  streetAddress: string;
  town: string;
  /**
   * Explicit state code if the town line carried one ("Somerville, NH"),
   * else null. Previously this was silently stripped and every address
   * was assumed Massachusetts regardless — safe for the real examples
   * seen so far, but a real out-of-state town (plausible for a company
   * this close to the NH border) would then get mislabeled "MA" instead
   * of caught. The caller (job-intake.ts) validates this against the
   * licensed service states before creating anything.
   */
  stateHint: string | null;
  homeownerPhone: string;
  companyContactName: string;
  companyContactPhone: string;
  requestedDate: string;
  scopeOfWork: string;
}

// Usually dashed ("781-974-6204"), but a real forwarded order had bare
// 10-digit phone lines instead ("5089582862") — both accepted.
const PHONE_LINE = /^\d{3}-?\d{3}-?\d{4}$/;
const DATE_LINE = /^\d{4}-\d{2}-\d{2}$/;
// A greeting glued onto the name line itself ("Hi, Mike Drummond") is left
// as-is — see the test for that. This is the other real-world shape: a
// standalone salutation on its own line before the template starts
// (confirmed against a real forwarded order: "Hi,\n\nMelanie steck\n...").
// Unlike the glued case there's no ambiguity about where it ends, so it's
// safe to just drop it rather than fold it into the name.
const GREETING_LINE = /^(hi|hello|hey|dear)\b[,.]?\s*$/i;

// Shared by both formats below — every field's already been split out by
// the time either parser gets here, this just runs the one validation/
// shape-checking pass and builds the final result (or rejects) either way.
function buildParsedResult(fields: {
  homeownerName: string;
  streetAddress: string;
  town: string;
  homeownerPhone: string;
  companyContactName: string;
  companyContactPhone: string;
  requestedDate: string;
  scopeOfWork: string;
}): ParsedJobIntake | null {
  const { homeownerName, streetAddress, town, homeownerPhone, companyContactName, companyContactPhone, requestedDate, scopeOfWork } = fields;

  // Phones are validated when present but not required — a third labeled
  // variant confirmed live 2026-08-24 (Cory Ford/690 Blue Hill Ave, Stephanie
  // Kra/29 Tilesboro St) drops both phone lines from the template entirely,
  // rather than sending them blank. Rejecting on missing phones here would
  // silently drop every real order in that shape, same failure class as the
  // original bare-vs-labeled mismatch.
  if (homeownerPhone && !PHONE_LINE.test(homeownerPhone)) return null;
  if (companyContactPhone && !PHONE_LINE.test(companyContactPhone)) return null;
  if (!DATE_LINE.test(requestedDate)) return null;
  // A real street address always has a house number; a real person's name
  // never does — cheap, low-false-positive guard against the two lines
  // having been swapped (e.g. a copy-paste mistake in an off-template
  // email), which would otherwise parse "clean" into a job with a person's
  // name as its service address and a street as the site contact's name.
  if (!/\d/.test(streetAddress)) return null;
  if (!homeownerName || !streetAddress || !town || !companyContactName || !scopeOfWork) return null;

  // Some real examples include the state ("Somerville, Ma"), some don't
  // ("Weymouth") — captured here rather than discarded, so a genuine
  // out-of-state town doesn't silently get labeled Massachusetts. The
  // comma is required (not just any trailing 2 letters) — otherwise a
  // plain town name ending in a 2-letter sequence, e.g. "Weymouth" → "th",
  // would falsely read as a state code.
  const stateMatch = town.match(/,\s*([A-Za-z]{2})\.?$/);
  const stateHint = stateMatch ? stateMatch[1].toUpperCase() : null;

  return {
    homeownerName,
    streetAddress,
    town: town.replace(/,\s*[A-Za-z]{2}\.?$/, "").trim(),
    stateHint,
    homeownerPhone: formatPhoneNumber(homeownerPhone),
    companyContactName,
    companyContactPhone: formatPhoneNumber(companyContactPhone),
    requestedDate,
    scopeOfWork,
  };
}

function parseBareFormat(lines: string[]): ParsedJobIntake | null {
  if (lines.length < 8) return null;

  const [
    homeownerName,
    streetAddress,
    town,
    homeownerPhone,
    companyContactName,
    companyContactPhone,
    requestedDate,
    ...scopeLines
  ] = lines;

  return buildParsedResult({
    homeownerName, streetAddress, town, homeownerPhone,
    companyContactName, companyContactPhone, requestedDate,
    scopeOfWork: scopeLines.join(" ").trim(),
  });
}

// label line -> which field it introduces; the line immediately after a
// label is that field's value, except "description", which runs to the end
// of the message (or a signature block, see below) rather than just one line.
// Two label spellings per field ("customer address"/"address", "city"/
// "town", "bhwr contact"/"bhwr rep") because Boston Harbor Water switched
// wording between the first labeled order seen (Geraldine Burns, 2026-08-24)
// and the very next batch (Cory Ford/Stephanie Kra, same day) — both
// confirmed live, so both stay supported rather than betting on either one
// being final.
const LABELED_FIELD_FOR_LABEL: Record<string, string> = {
  "customer name": "homeownerName",
  "customer address": "streetAddress",
  "address": "streetAddress",
  "city": "town",
  "town": "town",
  "customer phone": "homeownerPhone",
  "bhwr contact": "companyContactName",
  "bhwr rep": "companyContactName",
  "bhwr contact phone": "companyContactPhone",
  "date needed": "requestedDate",
  "description": "scopeOfWork",
};

// Unlike the bare/positional format, the phone labels above aren't always
// present at all in a labeled order (see buildParsedResult's own comment) —
// required here mirrors that: every field except the two phones.
const REQUIRED_LABELED_FIELDS = ["homeownerName", "streetAddress", "town", "companyContactName", "requestedDate", "scopeOfWork"];

function parseLabeledFormat(lines: string[]): ParsedJobIntake | null {
  const values: Record<string, string> = {};
  let i = 0;
  while (i < lines.length) {
    const field = LABELED_FIELD_FOR_LABEL[lines[i].toLowerCase()];
    if (!field) {
      i++;
      continue;
    }
    if (field === "scopeOfWork") {
      // Everything after "Description" up to a lone "--" line (the
      // conventional email-signature delimiter) is the scope text — not
      // just the next line, since a real description can run longer, and
      // not the rest of the message either, since that would swallow the
      // sender's name/company/phone/website signature block as if it were
      // part of the scope of work.
      const rest = lines.slice(i + 1);
      const signatureIndex = rest.findIndex((l) => /^-{2,}$/.test(l));
      const scopeLines = signatureIndex === -1 ? rest : rest.slice(0, signatureIndex);
      values[field] = scopeLines.join(" ").trim();
      break;
    }
    values[field] = lines[i + 1] ?? "";
    i += 2;
  }

  if (!REQUIRED_LABELED_FIELDS.every((f) => values[f])) return null;

  return buildParsedResult({
    homeownerName: values.homeownerName,
    streetAddress: values.streetAddress,
    town: values.town,
    // Defaulted, not just typed as string — a labeled order that never sent
    // a phone label at all (see REQUIRED_LABELED_FIELDS) leaves these keys
    // genuinely absent from `values`, and formatPhoneNumber below would
    // throw on undefined rather than treat it as blank.
    homeownerPhone: values.homeownerPhone ?? "",
    companyContactName: values.companyContactName,
    companyContactPhone: values.companyContactPhone ?? "",
    requestedDate: values.requestedDate,
    scopeOfWork: values.scopeOfWork,
  });
}

export function parseAcmOrderEmail(bodyText: string): ParsedJobIntake | null {
  let lines = bodyText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length > 0 && GREETING_LINE.test(lines[0])) {
    lines = lines.slice(1);
  }

  return parseBareFormat(lines) ?? parseLabeledFormat(lines);
}
