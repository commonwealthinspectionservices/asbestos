import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireAdminApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";

// Streams one Ray's Library reference photo's actual image bytes — same
// authenticated-proxy pattern as job photos/documents (see
// api/admin/jobs/[id]/photos/[photoId]/route.ts), never a public/signed URL.
export const GET = withApiErrors(async (
  req: NextRequest,
  { params }: { params: { id: string } }
) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const supabase = getSupabaseAdmin();
  const { data: photo, error: photoError } = await supabase
    .from("rays_library_photos")
    .select("storage_path")
    .eq("id", params.id)
    .single();
  if (photoError || !photo) {
    return NextResponse.json({ error: "Photo not found" }, { status: 404 });
  }

  const { data: blob, error: downloadError } = await supabase.storage
    .from("rays-library-photos")
    .download(photo.storage_path);
  if (downloadError || !blob) {
    throw new Error(`Failed to download photo: ${downloadError?.message}`);
  }

  return new NextResponse(await blob.arrayBuffer(), {
    headers: {
      "Content-Type": blob.type || "application/octet-stream",
      "Content-Disposition": "inline",
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
});
