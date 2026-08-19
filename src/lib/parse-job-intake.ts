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

  const scopeOfWork = scopeLines.join(" ").trim();
  if (!homeownerName || !streetAddress || !town || !companyContactName || !scopeOfWork) return null;

  return {
    homeownerName,
    streetAddress,
    // Some real examples include the state ("Somerville, Ma"), some don't
    // ("Weymouth") — stripped here since the full address (street + town)
    // gets geocoded as one string with ", MA" appended regardless (every
    // real example so far has been a Massachusetts address).
    town: town.replace(/,\s*[A-Za-z]{2}\.?$/, "").trim(),
    homeownerPhone,
    companyContactName,
    companyContactPhone,
    requestedDate,
    scopeOfWork,
  };
}
