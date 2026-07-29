import { NextResponse } from "next/server";

/**
 * Wraps a route handler so any thrown error (missing env var, Supabase/
 * Stripe/Google failure, etc.) becomes a clean JSON 500 instead of an
 * unhandled exception — which Next.js would otherwise turn into a
 * non-JSON error page, breaking every client-side `res.json()` caller.
 */
// Next.js uses thrown errors with these `.digest` prefixes as internal
// control-flow signals (redirects, notFound(), and the static-generation
// prober's dynamic-usage detection). Those must propagate unchanged —
// swallowing them into a JSON response breaks Next's own handling of them.
const NEXT_INTERNAL_DIGEST_PREFIXES = ["NEXT_REDIRECT", "NEXT_NOT_FOUND", "DYNAMIC_SERVER_USAGE"];

function isNextInternalError(err: unknown): boolean {
  const digest = (err as { digest?: string } | undefined)?.digest;
  return typeof digest === "string" && NEXT_INTERNAL_DIGEST_PREFIXES.some((p) => digest.startsWith(p));
}

export function withApiErrors<Args extends unknown[]>(
  handler: (...args: Args) => Promise<NextResponse>
) {
  return async (...args: Args): Promise<NextResponse> => {
    try {
      return await handler(...args);
    } catch (err) {
      if (isNextInternalError(err)) throw err;
      console.error("API route error:", err);
      const message = err instanceof Error ? err.message : "Internal error";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  };
}
