import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { peekNextProjectNumber } from "@/lib/project-number";
import { withApiErrors } from "@/lib/api-handler";

// Backs the "GET NEXT #" button on the Add Project screen — a non-consuming
// look at what the next project number would be. Deliberately doesn't call
// generateProjectNumber() (which actually advances the sequence): this
// button gets clicked far more often than projects actually get created
// with the previewed number (e.g. the admin looks, then cancels), and that
// was silently burning numbers no job ever used.
export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const projectNumber = await peekNextProjectNumber();
  return NextResponse.json({ projectNumber });
});
