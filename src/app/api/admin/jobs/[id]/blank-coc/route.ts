import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getSettings } from "@/lib/settings";
import { renderBlankCocPdf } from "@/lib/blank-coc-pdf";
import { withApiErrors } from "@/lib/api-handler";
import type { Customer, Job } from "@/lib/types";

// A printable chain-of-custody with the header fields (client, site,
// project #, date, license #) already filled in from the job — the only
// thing left to fill by hand in the field is the sample table itself,
// which has to exist on paper regardless since it travels with the
// physical samples to the lab.
export const GET = withApiErrors(async (
  req: NextRequest,
  { params }: { params: { id: string } }
) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

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
  const pdf = await renderBlankCocPdf({ job: jobRow, customer: jobRow.customers, settings });

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="coc-${jobRow.project_number ?? params.id}.pdf"`,
    },
  });
});
