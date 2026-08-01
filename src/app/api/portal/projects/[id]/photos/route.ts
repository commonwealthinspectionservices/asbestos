import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireContractorApi, getCompanyCustomerIds } from "@/lib/contractor-api";
import { getSupabaseAdmin } from "@/lib/supabase";
import { withApiErrors } from "@/lib/api-handler";
import type { Job, JobPhoto } from "@/lib/types";

export const POST = withApiErrors(async (
  req: NextRequest,
  { params }: { params: { id: string } }
) => {
  const auth = await requireContractorApi();
  if (auth.error) return auth.error;

  const formData = await req.formData().catch(() => null);
  const file = formData?.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "A file is required" }, { status: 400 });
  }

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

  const photoId = randomUUID();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `${params.id}/${photoId}-${safeName}`;
  const fileBuffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await supabase.storage
    .from("job-photos")
    .upload(storagePath, fileBuffer, {
      contentType: file.type || "application/octet-stream",
    });
  if (uploadError) {
    throw new Error(`Failed to upload photo: ${uploadError.message}`);
  }

  const photo: JobPhoto = {
    id: photoId,
    file_name: file.name,
    storage_path: storagePath,
    uploaded_at: new Date().toISOString(),
    uploaded_by: "customer",
  };

  const { data: updated, error: updateError } = await supabase
    .from("jobs")
    .update({ photos: [...(jobRow.photos ?? []), photo] })
    .eq("id", params.id)
    .select("*")
    .single();
  if (updateError || !updated) {
    return NextResponse.json({ error: updateError?.message }, { status: 500 });
  }
  return NextResponse.json({ job: updated });
});
