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

// Lets the Settings page's own "View current file" link open the PDF
// that's actually merged into report packets — same download pattern as
// the per-job document route (jobs/[id]/documents/[docId]), just against
// this one fixed path instead of a job's documents array.
export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const supabase = getSupabaseAdmin();
  const { data: blob, error: downloadError } = await supabase.storage
    .from("job-documents")
    .download(STORAGE_PATH);
  if (downloadError || !blob) {
    return NextResponse.json({ error: "No credentials document on file" }, { status: 404 });
  }

  return new NextResponse(await blob.arrayBuffer(), {
    headers: {
      "Content-Type": blob.type || "application/pdf",
      "Content-Disposition": 'inline; filename="credentials.pdf"',
    },
  });
});

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
