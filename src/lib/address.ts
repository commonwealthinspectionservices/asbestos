// Every US state's two-letter abbreviation, for the State field on every
// structured address form (admin Add/Edit Project, portal Book a Project
// and Saved Addresses) — a dropdown instead of free text avoids "Ma" vs
// "MA" vs "Massachusetts" typos, even though this business currently only
// serves Massachusetts.
export const US_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
];

// Used wherever a job's address is shown as a clickable link out to Google
// Maps (admin project list/detail, portal project list/detail) — a plain
// search URL rather than a place ID, since all we have on file is the
// formatted address string, not a Places ID.
export function googleMapsUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

// Waze's universal link — opens the Waze app directly (with turn-by-turn
// navigation queued up, via navigate=yes) if installed, falls back to the
// App/Play Store listing otherwise. Same "just a formatted address string,
// no place ID" caveat as googleMapsUrl above.
export function wazeUrl(address: string): string {
  return `https://waze.com/ul?q=${encodeURIComponent(address)}&navigate=yes`;
}

// Splits a formatted address into a street/business/unit line and a
// city/state/zip line — the last two comma-separated segments are always
// "City" and "State [Zip]", regardless of what comes before (a business
// name, a unit number, both, or neither).
// A "Location Name - Street" prefix on the street portion (e.g. "Freedom
// Trail Clinic - 25 Staniford Street") gets its own line, since some
// service addresses are a business/site name and some are just a street.
export function splitLocationName(streetPart: string): { locationName: string; street: string } {
  const dashMatch = streetPart.match(/^(.+?)\s+-\s+(.+)$/);
  if (dashMatch) return { locationName: dashMatch[1].trim(), street: dashMatch[2].trim() };
  return { locationName: "", street: streetPart };
}

// Matches a trailing street-type word (e.g. "...Street", "...Ave") so a
// legacy address with no comma before the city ("20 Fayette Place Taunton,
// MA") can still be split into street vs. city — city is whatever's left
// after the last such word, however many words long ("West Newton", "Fall
// River"), rather than guessing by word count.
const STREET_SUFFIX_RE = /\b(Street|St|Road|Rd|Avenue|Ave|Lane|Ln|Drive|Dr|Way|Circle|Cir|Terrace|Ter|Place|Pl|Court|Ct|Boulevard|Blvd|Path|Parkway|Pkwy|Highway|Hwy|Trail|Square|Sq|Park)\b\.?/gi;
// A trailing "State [Zip]", with or without a preceding comma — covers
// entries typed without the comma Google Places would normally supply.
const TRAILING_STATE_RE = /,?\s*([A-Z]{2})(\s+\d{5}(?:-\d{4})?)?\s*$/;
const UNIT_PREFIX_RE = /^(Unit|Apt|Apartment|Suite|Ste|#)\s*\S+\s*/i;

// Google's formatted_address (and some manually typed addresses) can carry
// a trailing country segment — strip it before splitting on commas, or
// it'd get mistaken for part of the city/state/zip line below.
const TRAILING_COUNTRY_RE = /,\s*(USA|United States)\s*$/i;

export function splitAddress(address: string | null | undefined): { locationName: string; street: string; cityStateZip: string } {
  if (!address) return { locationName: "", street: "", cityStateZip: "" };
  const trimmed = address.trim().replace(TRAILING_COUNTRY_RE, "");
  const commaParts = trimmed.split(",").map((p) => p.trim()).filter(Boolean);

  // Well-formed, comma-separated address (e.g. from Google Places) — the
  // last two segments are city and state/zip.
  if (commaParts.length >= 3) {
    const cityStateZip = commaParts.slice(-2).join(", ");
    return { ...splitLocationName(commaParts.slice(0, -2).join(", ")), cityStateZip };
  }

  // Legacy/manually-typed address with too few commas to split that way —
  // fall back to locating the state (and optional zip) at the very end,
  // then the last street-type word before it to separate street from city.
  const stateMatch = trimmed.match(TRAILING_STATE_RE);
  const statePart = stateMatch ? stateMatch[0].replace(/^,\s*/, "").trim() : "";
  const rest = stateMatch ? trimmed.slice(0, stateMatch.index).trim() : trimmed;

  const suffixMatches = [...rest.matchAll(STREET_SUFFIX_RE)];
  if (suffixMatches.length === 0) {
    // No recognizable street — the whole thing is a city (e.g. "Westwood, MA").
    return { locationName: "", street: "", cityStateZip: trimmed };
  }

  const last = suffixMatches[suffixMatches.length - 1];
  const splitIdx = last.index! + last[0].length;
  let street = rest.slice(0, splitIdx).trim();
  let cityPart = rest.slice(splitIdx).trim();
  const unitMatch = cityPart.match(UNIT_PREFIX_RE);
  if (unitMatch) {
    street = `${street} ${unitMatch[0].trim()}`;
    cityPart = cityPart.slice(unitMatch[0].length).trim();
  }
  const cityStateZip = [cityPart, statePart].filter(Boolean).join(", ");
  return { ...splitLocationName(street), cityStateZip };
}

// Same abbreviation set STREET_SUFFIX_RE already recognizes for parsing,
// reversed — per Tim: no abbreviation ("St", "Dr", "Rd", ...) should show
// up anywhere on the system, always fully spelled out ("36 Finnell
// Drive," not "36 Finnell Dr"), even though the raw address on file (from
// Google Places, or typed by an admin) is usually abbreviated. Display-
// only: every call site wraps an address only at the point it's actually
// shown to someone — the stored address itself is never rewritten, so
// nothing that depends on the raw string (geocoding, pricing-zone
// matching, editing a saved address back into its form fields) is
// affected.
const STREET_SUFFIX_EXPANSION: Record<string, string> = {
  st: "Street", rd: "Road", ave: "Avenue", ln: "Lane", dr: "Drive",
  cir: "Circle", ter: "Terrace", pl: "Place", ct: "Court",
  blvd: "Boulevard", pkwy: "Parkway", hwy: "Highway", sq: "Square",
};

// Expands every abbreviated street-type word anywhere in a full address
// string ("36 Finnell Dr Suite 1, Weymouth, MA" -> "36 Finnell Drive
// Suite 1, Weymouth, MA") — safe to run on an already-fully-spelled-out
// address (STREET_SUFFIX_EXPANSION has no entry for "Street" itself, so
// full-word matches just pass through unchanged) or on a bare street
// fragment with no city/state at all.
export function expandAddress(address: string | null | undefined): string {
  if (!address) return "";
  return address.replace(STREET_SUFFIX_RE, (match) => {
    const full = STREET_SUFFIX_EXPANSION[match.replace(/\.$/, "").toLowerCase()];
    return full ?? match;
  });
}

export interface AddressFields {
  street: string;
  unit: string;
  city: string;
  state: string;
  zip: string;
}

const TRAILING_UNIT_RE = /\s+(Unit|Apt|Apartment|Suite|Ste|#)\s*\S+\s*$/i;

// Splits a single billing_address string (e.g. "36 Finnell Drive Suite #1,
// Weymouth, MA 02188") into the separate fields the Add Project billing
// address form uses — the inverse of buildBillingAddress below.
export function parseAddressToFields(address: string | null | undefined): AddressFields {
  if (!address) return { street: "", unit: "", city: "", state: "", zip: "" };
  const { locationName, street: rawStreet, cityStateZip } = splitAddress(address);
  let street = locationName ? `${locationName} ${rawStreet}` : rawStreet;
  let unit = "";
  const unitMatch = street.match(TRAILING_UNIT_RE);
  if (unitMatch) {
    unit = unitMatch[0].trim();
    street = street.slice(0, unitMatch.index).trim();
  }

  const [cityPart = "", stateZipPart = ""] = cityStateZip.split(",").map((p) => p.trim());
  const stateZipMatch = stateZipPart.match(/^([A-Za-z]{2})\s*(\d{5}(?:-\d{4})?)?$/);

  return {
    street,
    unit,
    city: cityPart,
    state: stateZipMatch?.[1]?.toUpperCase() ?? stateZipPart,
    zip: stateZipMatch?.[2] ?? "",
  };
}

// A bare "Unit #" entry ("3") gets labeled "Unit 3" below; an entry that
// already names its own type ("Suite 3", "Apt 2", "#4") is left as-is so it
// never becomes "Unit Suite 3". Same label set splitAddress/parseAddressToFields
// already recognize when parsing a unit back out of a full address.
const UNIT_LABEL_RE = /^(Unit|Apt|Apartment|Suite|Ste|#)\b/i;

export function buildBillingAddress({ street, unit, city, state, zip }: AddressFields): string {
  // Per Tim, 2026-08-30 — "leave stuff blank instead of filling in generic
  // info": every one of these forms defaults its State dropdown to "MA"
  // with no blank option, so an address section nobody touched (e.g. a
  // company-contact form that never shows street/city/zip fields at all)
  // was still producing a lone "MA" instead of a genuinely empty address.
  // Only the state defaulting to something is a UI convenience, not a real
  // address — so treat state-only as nothing entered at all.
  if (!street.trim() && !unit.trim() && !city.trim() && !zip.trim()) return "";
  const trimmedUnit = unit.trim();
  const labeledUnit = trimmedUnit && !UNIT_LABEL_RE.test(trimmedUnit) ? `Unit ${trimmedUnit}` : trimmedUnit;
  const streetLine = [street.trim(), labeledUnit].filter(Boolean).join(" ");
  const cityStateZip = [city.trim(), [state.trim(), zip.trim()].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  return [streetLine, cityStateZip].filter(Boolean).join(", ");
}

// Google's Place Details formatted_address doesn't always carry the zip —
// append it (and drop the trailing ", USA") so addresses picked from
// autocomplete never need a manual zip lookup afterward.
export function withZip(formattedAddress: string, zip: string | null | undefined): string {
  // Always drop the trailing country — it isn't useful here and, left in,
  // it'd throw off splitAddress's "last two segments are city/state[zip]"
  // assumption regardless of whether zip needed appending.
  const withoutCountry = formattedAddress.replace(/,\s*USA$/, "");
  if (!zip || withoutCountry.includes(zip)) return withoutCountry;
  return `${withoutCountry} ${zip}`;
}
