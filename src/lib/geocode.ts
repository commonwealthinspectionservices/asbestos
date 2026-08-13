const EARTH_RADIUS_MILES = 3958.8;

export interface GeocodeResult {
  lat: number;
  lng: number;
  formattedAddress: string;
  /** State/province abbreviation (e.g. "MA"), from the address_components administrative_area_level_1 short_name. */
  state: string | null;
  zip: string | null;
}

// `status`, when present, is the raw Google API status string (e.g.
// "ZERO_RESULTS", "OVER_QUERY_LIMIT", "REQUEST_DENIED") — lets callers tell
// a genuine "no match" apart from a quota/billing failure, which every
// caller used to collapse into the same empty response with no way to
// distinguish "bad address" from "the API key stopped working."
export class GeocodeError extends Error {
  status?: string;
  constructor(message: string, status?: string) {
    super(message);
    this.status = status;
  }
}

// Google statuses that mean the API call itself failed, not that the
// address/place genuinely doesn't exist — worth logging loudly since a
// silent collapse to "not found" looks identical to real user error.
const GOOGLE_FAILURE_STATUSES = new Set(["OVER_QUERY_LIMIT", "REQUEST_DENIED", "INVALID_REQUEST", "UNKNOWN_ERROR"]);

export function isGoogleApiFailure(status: string | undefined): boolean {
  return !!status && GOOGLE_FAILURE_STATUSES.has(status);
}

// Every geocode-zip route (root/admin/portal) collapses a GeocodeError to
// the exact same {zip: null} a genuinely unmatched address gets — that's
// still the right thing to show the user (no good alternative mid-request),
// but it used to mean a real API failure (quota exceeded, billing disabled,
// bad key) was completely indistinguishable from "bad address" in the
// server logs too, discoverable only when a client complained. This at
// least makes the two cases loudly distinct in logs.
export function logGeocodeFailure(e: GeocodeError, context: string): void {
  if (isGoogleApiFailure(e.status)) {
    console.error(`[GOOGLE API FAILURE] ${context}: ${e.message} — this is NOT a bad address, the Google Maps API call itself failed (quota/billing/key issue). Check the Google Cloud Console.`);
  } else {
    console.error(`${context}: ${e.message}`);
  }
}

/**
 * Every ZIP code that maps to a given town — not just one geocoded guess.
 * Google's geocoder returns a single result for a bare town name, which
 * hides the fact that many towns split across several ZIPs (Newton, MA
 * alone has 16). zippopotam.us is a free, keyless lookup built for exactly
 * this: given a town, list all its ZIPs so the caller can auto-fill when
 * there's only one and offer a pick-list otherwise, rather than silently
 * guessing wrong for a multi-ZIP town.
 */
export async function getZipsForTown(town: string, state: string): Promise<string[]> {
  const res = await fetch(
    `https://api.zippopotam.us/us/${encodeURIComponent(state)}/${encodeURIComponent(town)}`
  );
  if (res.status === 404) return [];
  if (!res.ok) throw new GeocodeError(`Zip lookup failed: ${res.status}`);
  const data = await res.json();
  const zips: string[] = (data.places ?? []).map((p: { "post code": string }) => p["post code"]);
  return [...new Set(zips)].sort();
}

export async function geocodeAddress(address: string): Promise<GeocodeResult> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) throw new Error("Missing GOOGLE_MAPS_API_KEY env var");

  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", address);
  url.searchParams.set("key", apiKey);
  // Bias results toward the Boston metro area so short/ambiguous addresses resolve correctly.
  url.searchParams.set("bounds", "42.0,-71.6|42.8,-70.5");

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new GeocodeError(`Geocoding request failed: ${res.status}`);
  }

  const data = await res.json();
  if (data.status !== "OK" || !data.results?.length) {
    throw new GeocodeError(`Could not geocode address: ${data.status}`, data.status);
  }

  const result = data.results[0];
  const components: { types: string[]; short_name: string }[] = result.address_components ?? [];
  const stateComponent = components.find((c) => c.types.includes("administrative_area_level_1"));
  const zipComponent = components.find((c) => c.types.includes("postal_code"));

  return {
    lat: result.geometry.location.lat,
    lng: result.geometry.location.lng,
    formattedAddress: result.formatted_address,
    state: stateComponent?.short_name ?? null,
    zip: zipComponent?.short_name ?? null,
  };
}

export interface AddressSuggestion {
  placeId: string;
  description: string;
}

/**
 * Type-ahead address suggestions for the Add Project form, backed by
 * Google Places Autocomplete. `townHint` — the town already entered in
 * a separate Town field — gets folded into the query sent to Google so
 * a bare street query like "123 Main" surfaces that street's match
 * *within that town* first, instead of every "123 Main" in the state.
 * Results are then hard-filtered back down to that same town, since the
 * hint only biases Google's ranking rather than restricting it.
 */
export async function autocompleteAddress(input: string, townHint?: string): Promise<AddressSuggestion[]> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) throw new Error("Missing GOOGLE_MAPS_API_KEY env var");

  const url = new URL("https://maps.googleapis.com/maps/api/place/autocomplete/json");
  url.searchParams.set("input", townHint ? `${input}, ${townHint}` : input);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("types", "address");
  url.searchParams.set("components", "country:us");
  // Biased toward Massachusetts via locationbias (Google's legacy
  // `bounds`+`strictbounds` hard-restrict combo now errors with "Bad
  // viewport"), then hard-filtered to MA-only below — he's only licensed
  // there for now, and a soft bias alone still lets other states' matches
  // through for generic inputs like "1 Main St".
  url.searchParams.set("locationbias", "rectangle:41.2,-73.6|42.9,-69.8");

  const res = await fetch(url.toString());
  if (!res.ok) throw new GeocodeError(`Autocomplete request failed: ${res.status}`);
  const data = await res.json();
  if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    throw new GeocodeError(`Autocomplete failed: ${data.status}`, data.status);
  }
  const townNeedle = townHint?.trim().toLowerCase();
  return (data.predictions ?? [])
    .filter((p: { description: string }) => /,\s*MA,\s*USA$/.test(p.description))
    .filter((p: { description: string }) => !townNeedle || p.description.toLowerCase().includes(townNeedle))
    .map((p: { place_id: string; description: string }) => ({
      placeId: p.place_id,
      description: p.description,
    }));
}

/**
 * Type-ahead TOWN suggestions (no street), for a Town field used before a
 * street address is known. `types=address` (used by autocompleteAddress)
 * only ever returns street-level matches — searching a town name against
 * it can surface an unrelated town whose street happens to share that
 * name (e.g. "Newton" matching "Newton Street, Waltham"), filling in the
 * wrong town entirely. `types=(cities)` restricts to actual localities.
 */
export async function autocompleteCity(input: string): Promise<AddressSuggestion[]> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) throw new Error("Missing GOOGLE_MAPS_API_KEY env var");

  const url = new URL("https://maps.googleapis.com/maps/api/place/autocomplete/json");
  url.searchParams.set("input", input);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("types", "(cities)");
  url.searchParams.set("components", "country:us");
  url.searchParams.set("locationbias", "rectangle:41.2,-73.6|42.9,-69.8");

  const res = await fetch(url.toString());
  if (!res.ok) throw new GeocodeError(`Autocomplete request failed: ${res.status}`);
  const data = await res.json();
  if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    throw new GeocodeError(`Autocomplete failed: ${data.status}`, data.status);
  }
  return (data.predictions ?? [])
    .filter((p: { description: string }) => /,\s*MA,\s*USA$/.test(p.description))
    .map((p: { place_id: string; description: string }) => ({
      placeId: p.place_id,
      description: p.description,
    }));
}

export interface PlaceDetails {
  formattedAddress: string;
  lat: number;
  lng: number;
  state: string | null;
  zip: string | null;
}

/** Resolves an autocomplete suggestion's place_id to a full formatted address (incl. zip), for when a suggestion is picked. */
export async function getPlaceDetails(placeId: string): Promise<PlaceDetails> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) throw new Error("Missing GOOGLE_MAPS_API_KEY env var");

  const url = new URL("https://maps.googleapis.com/maps/api/place/details/json");
  url.searchParams.set("place_id", placeId);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("fields", "formatted_address,geometry,address_component");

  const res = await fetch(url.toString());
  if (!res.ok) throw new GeocodeError(`Place details request failed: ${res.status}`);
  const data = await res.json();
  if (data.status !== "OK") throw new GeocodeError(`Place details failed: ${data.status}`, data.status);

  const result = data.result;
  const components: { types: string[]; short_name: string }[] = result.address_components ?? [];
  const stateComponent = components.find((c) => c.types.includes("administrative_area_level_1"));
  const zipComponent = components.find((c) => c.types.includes("postal_code"));

  return {
    formattedAddress: result.formatted_address,
    lat: result.geometry.location.lat,
    lng: result.geometry.location.lng,
    state: stateComponent?.short_name ?? null,
    zip: zipComponent?.short_name ?? null,
  };
}

/** Great-circle distance between two lat/lng points, in miles. */
export function haversineMiles(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return EARTH_RADIUS_MILES * c;
}

export function isWithinServiceArea(
  lat: number,
  lng: number,
  centerLat: number,
  centerLng: number,
  radiusMiles: number
): { withinArea: boolean; distanceMiles: number } {
  const distanceMiles = haversineMiles(lat, lng, centerLat, centerLng);
  return { withinArea: distanceMiles <= radiusMiles, distanceMiles };
}

/**
 * The actual booking-acceptance gate: licensing is per-state (MA-only as
 * of this build), not a driving radius — a legitimate address in Worcester
 * or the Berkshires is still Massachusetts even though it's far from the
 * old Prudential Center reference point. `distanceMiles`/`isWithinServiceArea`
 * above remain in use for the area-health "how spread out are we" metrics,
 * which is a separate, informational concern from what's legal to accept.
 */
export function isWithinServiceStates(state: string | null, allowedStates: string[]): boolean {
  if (!state) return false;
  return allowedStates.some((s) => s.trim().toUpperCase() === state.trim().toUpperCase());
}

/** Compass bearing from center point (a) to point (b), e.g. "NE". Used by the area-health monitor. */
export function compassBearing(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number
): string {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const toDeg = (rad: number) => (rad * 180) / Math.PI;
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const dLng = toRad(bLng - aLng);

  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  const bearing = (toDeg(Math.atan2(y, x)) + 360) % 360;

  const directions = [
    "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
    "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
  ];
  return directions[Math.round(bearing / 22.5) % 16];
}
