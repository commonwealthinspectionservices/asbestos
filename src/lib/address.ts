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

export function splitAddress(address: string | null | undefined): { locationName: string; street: string; cityStateZip: string } {
  if (!address) return { locationName: "", street: "", cityStateZip: "" };
  const trimmed = address.trim();
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

export function buildBillingAddress({ street, unit, city, state, zip }: AddressFields): string {
  const streetLine = [street.trim(), unit.trim()].filter(Boolean).join(" ");
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
