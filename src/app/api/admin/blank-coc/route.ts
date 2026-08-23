import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { getSettings } from "@/lib/settings";
import { renderBlankCocPdf } from "@/lib/blank-coc-pdf";
import { withApiErrors } from "@/lib/api-handler";

// The job-independent counterpart to jobs/[id]/blank-coc — a generic,
// entirely-blank template (no client/project/site pre-filled) for printing
// a stack of paper copies to keep on hand, rather than one tied to a
// specific job.
export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const settings = await getSettings();
  const pdf = await renderBlankCocPdf({ job: null, customer: null, settings });

  const disposition = req.nextUrl.searchParams.get("download") != null ? "attachment" : "inline";
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${disposition}; filename="coc-blank.pdf"`,
    },
  });
});
