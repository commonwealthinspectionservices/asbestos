import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";
import { backfillCompanyForExistingContacts } from "@/lib/contact-import";

// One-off, 2026-09-11 — not a route anything else calls. Delete after use.
//
// Catches up every company-less contact that predates company-grouping in
// the Gmail contact-import pipeline (any contact with a non-personal email
// domain and no company_id yet — see backfillCompanyForExistingContacts'
// own comment). No dry-run split like the other one-off diagnostics this
// session: the underlying function is already safe to call more than once
// (a contact that already has a company is skipped), and the change is a
// single, easily-reversible column on each row.
export const maxDuration = 60;

export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const result = await backfillCompanyForExistingContacts();
  return NextResponse.json(result);
});
