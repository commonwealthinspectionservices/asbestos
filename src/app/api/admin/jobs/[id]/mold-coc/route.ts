import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getSettings } from "@/lib/settings";
import { renderMoldCocPdf, type MoldSampleType } from "@/lib/mold-coc-pdf";
import { withApiErrors } from "@/lib/api-handler";
import type { Customer, Job } from "@/lib/types";

const SAMPLE_TYPES: MoldSampleType[] = ["air_o_cell", "bulk", "swab"];

// Three printable, Commonwealth-branded mold chain-of-custody forms — one
// per sample type (?type=air_o_cell|bulk|swab), since a bulk-material
// column and a surface-swab column don't mean anything on an air-sample
// form and vice versa. Same idea as blank-coc for asbestos (own letterhead,
// fill the sample table and sign by hand on-site).
export const GET = withApiErrors(async (
  req: NextRequest,
  { params }: { params: { id: string } }
) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const typeParam = req.nextUrl.searchParams.get("type");
  const sampleType = SAMPLE_TYPES.includes(typeParam as MoldSampleType) ? (typeParam as MoldSampleType) : "air_o_cell";

  const supabase = getSupabaseAdmin();
  const { data: job, error } = await supabase
    .from("jobs")
    .select("*, customers!customer_id(*)")
    .eq("id", params.id)
    .single();

  if (error || !job) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const jobRow = job as unknown as Job & { customers: Customer };
  const settings = await getSettings();
  const pdf = await renderMoldCocPdf({ job: jobRow, customer: jobRow.customers, settings, sampleType });

  const disposition = req.nextUrl.searchParams.get("download") != null ? "attachment" : "inline";
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${disposition}; filename="mold-coc-${sampleType}-${jobRow.project_number ?? params.id}.pdf"`,
    },
  });
});
