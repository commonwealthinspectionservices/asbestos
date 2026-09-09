import crypto from "crypto";
import { cookies } from "next/headers";

// Two-role admin gate: no user table, no Supabase Auth — still just env
// secrets and a signed cookie, extended from the original single-owner
// version to support Joe's staff login (2026-09-09) without a real
// accounts system. Each role has its own password/secret (ADMIN_PASSWORD
// for owner, STAFF_PASSWORD for staff), and the role itself rides in the
// signed payload — sign() picks the secret to HMAC with based on which
// role is being created/verified, so a staff-role token can never be
// forged into an owner-role token (that would need ADMIN_PASSWORD, which
// staff was never given). Route handlers run on the Node runtime by
// default, so Node's crypto module is available here (no Edge middleware).
export const ADMIN_COOKIE_NAME = "admin_session";
export type AdminRole = "owner" | "staff";

function secretForRole(role: AdminRole): string {
  const envVar = role === "owner" ? "ADMIN_PASSWORD" : "STAFF_PASSWORD";
  const secret = process.env[envVar];
  if (!secret) throw new Error(`Missing ${envVar} env var`);
  return secret;
}

function sign(value: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(value).digest("hex");
}

function timingSafeStringEqual(candidate: string, expected: string): boolean {
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Checks a submitted password against both roles' secrets and returns
 * whichever one matched — owner takes priority in the unlikely case both
 * secrets were set to the same value. STAFF_PASSWORD is optional (Joe's
 * login doesn't exist until Tim sets it), so a missing env var there
 * just means no password will ever match the staff role, not a thrown
 * error like a missing ADMIN_PASSWORD would be.
 */
export function checkCredentials(password: string): AdminRole | null {
  const ownerSecret = secretForRole("owner");
  if (timingSafeStringEqual(password, ownerSecret)) return "owner";
  const staffSecret = process.env.STAFF_PASSWORD;
  if (staffSecret && timingSafeStringEqual(password, staffSecret)) return "staff";
  return null;
}

export function createSessionToken(role: AdminRole): string {
  const payload = `admin:${role}`;
  return `${payload}.${sign(payload, secretForRole(role))}`;
}

/** Returns the session's role if the token is valid, else null. */
export function verifySessionToken(token: string | undefined | null): AdminRole | null {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const [, role] = payload.split(":");
  if (role !== "owner" && role !== "staff") return null;
  let expected: string;
  try {
    expected = sign(payload, secretForRole(role));
  } catch {
    return null;
  }
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? role : null;
}

/** For use in server components/pages. Returns true if the admin cookie is valid (either role). */
export function hasAdminSession(): boolean {
  return getSessionRole() !== null;
}

/** For use in server components/pages. Returns the session's role, or null if not signed in. */
export function getSessionRole(): AdminRole | null {
  const token = cookies().get(ADMIN_COOKIE_NAME)?.value;
  return verifySessionToken(token);
}

/** For use in API route handlers. Returns true if the request carries a valid admin cookie (either role). */
export function requestHasAdminSession(req: Request): boolean {
  return requestSessionRole(req) !== null;
}

/** For use in API route handlers. Returns the request's session role, or null if not signed in. */
export function requestSessionRole(req: Request): AdminRole | null {
  const cookieHeader = req.headers.get("cookie") ?? "";
  const match = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${ADMIN_COOKIE_NAME}=`));
  const token = match?.slice(ADMIN_COOKIE_NAME.length + 1);
  return verifySessionToken(token ? decodeURIComponent(token) : undefined);
}
