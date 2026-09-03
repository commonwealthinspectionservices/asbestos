import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { getSupabaseAdmin } from "@/lib/supabase";
import { withApiErrors } from "@/lib/api-handler";
import type { Job } from "@/lib/types";

export const GET = withApiErrors(async (
  req: NextRequest,
  { params }: { params: { id: string; photoId: string } }
) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

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

// Sets a photo's room/caption — Moisture Mapping's own report (see
// report-pdf.tsx) groups photos under room as headings and prints caption
// underneath each one. Admin-only, same as delete; the portal side never
// gets this endpoint wired in.
export const PATCH = withApiErrors(async (
  req: NextRequest,
  { params }: { params: { id: string; photoId: string } }
) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .select("photos")
    .eq("id", params.id)
    .single();
  if (jobError || !job) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  const jobRow = job as unknown as Job;
  if (!(jobRow.photos ?? []).some((p) => p.id === params.photoId)) {
    return NextResponse.json({ error: "Photo not found" }, { status: 404 });
  }

  const photos = jobRow.photos.map((p) =>
    p.id === params.photoId
      ? {
          ...p,
          ...("room" in body ? { room: body.room || null } : {}),
          ...("caption" in body ? { caption: body.caption || null } : {}),
        }
      : p
  );

  const { data: updated, error: updateError } = await supabase
    .from("jobs")
    .update({ photos })
    .eq("id", params.id)
    .select("*")
    .single();
  if (updateError || !updated) {
    return NextResponse.json({ error: updateError?.message }, { status: 500 });
  }
  return NextResponse.json({ job: updated });
});

export const DELETE = withApiErrors(async (
  req: NextRequest,
  { params }: { params: { id: string; photoId: string } }
) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

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
  const photo = (jobRow.photos ?? []).find((p) => p.id === params.photoId);
  if (!photo) {
    return NextResponse.json({ error: "Photo not found" }, { status: 404 });
  }

  await supabase.storage.from("job-photos").remove([photo.storage_path]);

  const { data: updated, error: updateError } = await supabase
    .from("jobs")
    .update({ photos: jobRow.photos.filter((p) => p.id !== params.photoId) })
    .eq("id", params.id)
    .select("*")
    .single();
  if (updateError || !updated) {
    return NextResponse.json({ error: updateError?.message }, { status: 500 });
  }
  return NextResponse.json({ job: updated });
});
