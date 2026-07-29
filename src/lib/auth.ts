import crypto from "crypto";
import { cookies } from "next/headers";

// Single-owner admin gate: no user table, no Supabase Auth — just an env
// secret and a signed cookie. Route handlers run on the Node runtime by
// default, so Node's crypto module is available here (no Edge middleware).
export const ADMIN_COOKIE_NAME = "admin_session";
const SESSION_PAYLOAD = "admin";

function sign(value: string): string {
  const secret = process.env.ADMIN_PASSWORD;
  if (!secret) throw new Error("Missing ADMIN_PASSWORD env var");
  return crypto.createHmac("sha256", secret).update(value).digest("hex");
}

export function checkPassword(candidate: string): boolean {
  const secret = process.env.ADMIN_PASSWORD;
  if (!secret) throw new Error("Missing ADMIN_PASSWORD env var");
  const a = Buffer.from(candidate);
  const b = Buffer.from(secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function createSessionToken(): string {
  return `${SESSION_PAYLOAD}.${sign(SESSION_PAYLOAD)}`;
}

export function verifySessionToken(token: string | undefined | null): boolean {
  if (!token) return false;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return false;
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** For use in server components/pages. Returns true if the admin cookie is valid. */
export function hasAdminSession(): boolean {
  const token = cookies().get(ADMIN_COOKIE_NAME)?.value;
  return verifySessionToken(token);
}

/** For use in API route handlers. Returns true if the request carries a valid admin cookie. */
export function requestHasAdminSession(req: Request): boolean {
  const cookieHeader = req.headers.get("cookie") ?? "";
  const match = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${ADMIN_COOKIE_NAME}=`));
  const token = match?.slice(ADMIN_COOKIE_NAME.length + 1);
  return verifySessionToken(token ? decodeURIComponent(token) : undefined);
}
