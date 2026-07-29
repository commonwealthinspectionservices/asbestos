/** Absolute base URL of the deployed app, or "" if not deployed (e.g. local dev without a tunnel). */
export function getAppUrl(): string {
  return process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "";
}
