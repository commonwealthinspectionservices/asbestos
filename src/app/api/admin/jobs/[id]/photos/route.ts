import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { getSupabaseAdmin } from "@/lib/supabase";
import { withApiErrors } from "@/lib/api-handler";
import { normalizePhotoUpload } from "@/lib/photo-upload";
import type { Job, JobPhoto } from "@/lib/types";

// Site/progress photos, uploaded by either side (see the portal counterpart
// at /api/portal/projects/[id]/photos) — a flat gallery, unlike `documents`
// which is admin-only lab paperwork grouped by service type.
export const POST = withApiErrors(async (
  req: NextRequest,
  { params }: { params: { id: string } }
) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const formData = await req.formData().catch(() => null);
  const file = formData?.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "A file is required" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .select("*")
    .eq("id", params.id)
    .single();
  if (jobError || !job) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  const jobRow = job as unknown as Job;

  const photoId = randomUUID();
  const { fileName, buffer: fileBuffer, contentType } = await normalizePhotoUpload(
    file.name,
    Buffer.from(await file.arrayBuffer()),
    file.type || "application/octet-stream"
  );
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `${params.id}/${photoId}-${safeName}`;

  const { error: uploadError } = await supabase.storage
    .from("job-photos")
    .upload(storagePath, fileBuffer, { contentType });
  if (uploadError) {
    throw new Error(`Failed to upload photo: ${uploadError.message}`);
  }

  const photo: JobPhoto = {
    id: photoId,
    file_name: fileName,
    storage_path: storagePath,
    uploaded_at: new Date().toISOString(),
    uploaded_by: "admin",
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
