import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";
import { checkForLabResultEmails } from "@/lib/lab-email";

// Phase 1's trigger is this manual button rather than real-time Gmail push
// (Pub/Sub) — push needs a publicly reachable webhook URL, which a local
// dev server doesn't have. Swap this for push once deployed; the matching/
// draft-creation logic in @/lib/lab-email doesn't change either way.
export const POST = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const result = await checkForLabResultEmails();
  return NextResponse.json(result);
});
