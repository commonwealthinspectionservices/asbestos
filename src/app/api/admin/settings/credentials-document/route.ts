import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { getSupabaseAdmin } from "@/lib/supabase";
import { updateSettings } from "@/lib/settings";
import { withApiErrors } from "@/lib/api-handler";

// A single standing PDF (owner's license + state certificate, combined)
// merged into every report packet — see .../jobs/[id]/report/route.ts.
// Single-owner business, so one fixed storage path is enough; re-uploading
// replaces it.
const STORAGE_PATH = "_settings/credentials.pdf";

export const POST = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const formData = await req.formData().catch(() => null);
  const file = formData?.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "A file is required" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { error: uploadError } = await supabase.storage
    .from("job-documents")
    .upload(STORAGE_PATH, await file.arrayBuffer(), {
      contentType: file.type || "application/pdf",
      upsert: true,
    });
  if (uploadError) {
    throw new Error(`Failed to upload credentials document: ${uploadError.message}`);
  }

  const settings = await updateSettings({ credentials_document_path: STORAGE_PATH });
  return NextResponse.json({ settings });
});
