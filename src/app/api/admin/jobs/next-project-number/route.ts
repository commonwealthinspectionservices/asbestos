import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { generateProjectNumber } from "@/lib/project-number";
import { withApiErrors } from "@/lib/api-handler";

// Backs the "GET NEXT #" button on the Add Project screen — same sequence
// used when a project is auto-numbered at submit time, just exposed so the
// owner can see (and still overwrite) the number before creating the project.
export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const projectNumber = await generateProjectNumber();
  return NextResponse.json({ projectNumber });
});
