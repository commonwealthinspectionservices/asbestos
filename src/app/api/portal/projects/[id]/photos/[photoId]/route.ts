import { NextRequest, NextResponse } from "next/server";
import { requireContractorApi, getCompanyCustomerIds } from "@/lib/contractor-api";
import { getSupabaseAdmin } from "@/lib/supabase";
import { withApiErrors } from "@/lib/api-handler";
import type { Job } from "@/lib/types";

export const GET = withApiErrors(async (
  req: NextRequest,
  { params }: { params: { id: string; photoId: string } }
) => {
  const auth = await requireContractorApi();
  if (auth.error) return auth.error;

  const companyCustomerIds = await getCompanyCustomerIds(auth.customer);

  const supabase = getSupabaseAdmin();
  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .select("*")
    .eq("id", params.id)
    .in("customer_id", companyCustomerIds)
    .single();
  if (jobError || !job) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  const jobRow = job as unknown as Job;
  const photo = (jobRow.photos ?? []).find((p) => p.id === params.photoId);
  if (!photo) {
    return NextResponse.json({ error: "Photo not found" }, { status: 404 });
  }

  const { data: blob, error: downloadError } = await supabase.storage
    .from("job-photos")
    .download(photo.storage_path);
  if (downloadError || !blob) {
    throw new Error(`Failed to download photo: ${downloadError?.message}`);
  }

  return new NextResponse(await blob.arrayBuffer(), {
    headers: {
      "Content-Type": blob.type || "application/octet-stream",
      "Content-Disposition": `inline; filename="${photo.file_name}"`,
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
});
