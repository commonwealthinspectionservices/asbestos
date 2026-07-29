/** Google Maps "Directions" URL with all stops as ordered waypoints. */
export function buildMapsWaypointsUrl(origin: string, orderedAddresses: string[]): string {
  if (orderedAddresses.length === 0) return "";
  const destination = orderedAddresses[orderedAddresses.length - 1];
  const waypoints = orderedAddresses.slice(0, -1);

  const params = new URLSearchParams({
    api: "1",
    origin,
    destination,
    travelmode: "driving",
  });
  if (waypoints.length) params.set("waypoints", waypoints.join("|"));

  return `https://www.google.com/maps/dir/?${params.toString()}`;
}
