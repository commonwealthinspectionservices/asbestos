export interface LatLng {
  lat: number;
  lng: number;
}

/**
 * Traffic-aware travel-time matrix (seconds) over `locations` using Google's
 * Routes API computeRouteMatrix. locations[0] should be the base; the
 * returned matrix is NxN with matrix[i][j] = seconds from i to j.
 */
export async function computeTravelTimeMatrixSeconds(
  locations: LatLng[],
  departureTime: Date
): Promise<number[][]> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) throw new Error("Missing GOOGLE_MAPS_API_KEY env var");

  const waypoints = locations.map((loc) => ({
    waypoint: { location: { latLng: { latitude: loc.lat, longitude: loc.lng } } },
  }));

  const res = await fetch(
    "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask":
          "originIndex,destinationIndex,duration,condition",
      },
      body: JSON.stringify({
        origins: waypoints,
        destinations: waypoints,
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_AWARE",
        departureTime: departureTime.toISOString(),
      }),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Routes API computeRouteMatrix failed: ${res.status} ${text}`);
  }

  const elements: {
    originIndex?: number;
    destinationIndex?: number;
    duration?: string;
    condition?: string;
  }[] = await res.json();

  const n = locations.length;
  const matrix: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));

  for (const el of elements) {
    const i = el.originIndex ?? 0;
    const j = el.destinationIndex ?? 0;
    if (el.condition && el.condition !== "ROUTE_EXISTS") continue;
    const seconds = el.duration ? parseInt(el.duration.replace("s", ""), 10) : 0;
    matrix[i][j] = seconds;
  }

  return matrix;
}
