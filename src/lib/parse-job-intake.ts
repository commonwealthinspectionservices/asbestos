// Boston Harbor Water Restoration's "ACM Order" emails follow one fixed,
// consistent line-by-line template every time (confirmed against 3 real
// examples: Peter Linski/22 Sunnyplain Ave, Allie Duffy/315 Broadway,
// Mike Drummond/27 Spring St) — not freeform English, an actual template:
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
// Anchoring on the two phone-number lines and the date line (all three have
// a strict, unambiguous shape) rather than just taking "the first 8 lines"
// blind — a genuinely malformed or off-template email should fail to parse
// and fall through to manual handling, not silently misfile a wrong address
// into a real job.
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

const PHONE_LINE = /^\d{3}-\d{3}-\d{4}$/;
const DATE_LINE = /^\d{4}-\d{2}-\d{2}$/;

export function parseAcmOrderEmail(bodyText: string): ParsedJobIntake | null {
  const lines = bodyText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

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

  if (!PHONE_LINE.test(homeownerPhone)) return null;
  if (!PHONE_LINE.test(companyContactPhone)) return null;
  if (!DATE_LINE.test(requestedDate)) return null;
  // A real street address always has a house number; a real person's name
  // never does — cheap, low-false-positive guard against the two lines
  // having been swapped (e.g. a copy-paste mistake in an off-template
  // email), which would otherwise parse "clean" into a job with a person's
  // name as its service address and a street as the site contact's name.
  if (!/\d/.test(streetAddress)) return null;

  const scopeOfWork = scopeLines.join(" ").trim();
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
    homeownerPhone,
    companyContactName,
    companyContactPhone,
    requestedDate,
    scopeOfWork,
  };
}
