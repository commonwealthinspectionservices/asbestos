import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { getSettings } from "@/lib/settings";
import { renderMoldCocPdf, type MoldSampleType } from "@/lib/mold-coc-pdf";
import { withApiErrors } from "@/lib/api-handler";

const SAMPLE_TYPES: MoldSampleType[] = ["air_o_cell", "bulk", "swab"];

// The job-independent counterpart to jobs/[id]/mold-coc — a generic,
// entirely-blank template (no client/project/site pre-filled) for printing
// a stack of paper copies to keep on hand, rather than one tied to a
// specific job. ?type=air_o_cell|bulk|swab, same as the per-job route.
export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const typeParam = req.nextUrl.searchParams.get("type");
  const sampleType = SAMPLE_TYPES.includes(typeParam as MoldSampleType) ? (typeParam as MoldSampleType) : "air_o_cell";

  const settings = await getSettings();
  const pdf = await renderMoldCocPdf({ job: null, customer: null, settings, sampleType });

  const disposition = req.nextUrl.searchParams.get("download") != null ? "attachment" : "inline";
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${disposition}; filename="mold-coc-${sampleType}-blank.pdf"`,
    },
  });
});
