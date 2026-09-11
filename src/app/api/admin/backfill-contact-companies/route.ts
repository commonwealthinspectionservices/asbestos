import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";
import { cleanupNoisyBackfilledContacts } from "@/lib/contact-import";

// One-off, 2026-09-11 — not a route anything else calls. Delete after use.
//
// This route originally ran backfillCompanyForExistingContacts (the
// company-grouping catch-up). That run is done and it exposed real noise
// in production (see cleanupNoisyBackfilledContacts' own comment) — reusing
// this same still-undeleted one-off route for the follow-up cleanup instead
// of shipping a second one.
export const maxDuration = 60;

export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const result = await cleanupNoisyBackfilledContacts();
  return NextResponse.json(result);
});
