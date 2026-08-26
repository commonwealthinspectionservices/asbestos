import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { getSupabaseAdmin } from "@/lib/supabase";
import { withApiErrors } from "@/lib/api-handler";
import type { Job } from "@/lib/types";

export const GET = withApiErrors(async (
  req: NextRequest,
  { params }: { params: { id: string; docId: string } }
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
  const doc = jobRow.documents.find((d) => d.id === params.docId);
  if (!doc) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  const { data: blob, error: downloadError } = await supabase.storage
    .from("job-documents")
    .download(doc.storage_path);
  if (downloadError || !blob) {
    throw new Error(`Failed to download document: ${downloadError?.message}`);
  }

  // Same reasoning as the invoice/report routes' own disposition switch —
  // "attachment" is what actually forces a save-to-disk for the Download
  // link, since some browsers ignore the <a download> attribute entirely
  // and just follow Content-Disposition.
  const disposition = req.nextUrl.searchParams.get("download") != null ? "attachment" : "inline";

  return new NextResponse(await blob.arrayBuffer(), {
    headers: {
      "Content-Type": blob.type || "application/octet-stream",
      "Content-Disposition": `${disposition}; filename="${doc.file_name}"`,
    },
  });
});

export const DELETE = withApiErrors(async (
  req: NextRequest,
  { params }: { params: { id: string; docId: string } }
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
  const doc = jobRow.documents.find((d) => d.id === params.docId);
  if (!doc) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  await supabase.storage.from("job-documents").remove([doc.storage_path]);

  const update: Record<string, unknown> = {
    documents: jobRow.documents.filter((d) => d.id !== params.docId),
  };

  // The sample count, asbestos result, and per-sample breakdown all came
  // from this specific report — once it's gone, none of them should keep
  // reflecting a report no longer on file.
  if (doc.kind === "lab_report" && doc.service_type) {
    update.sample_counts = { ...(jobRow.sample_counts ?? {}), [doc.service_type]: 0 };
    if (/asbestos/i.test(doc.service_type)) {
      update.asbestos_result = null;
      update.sample_results = [];
    }
  }

  // asbestos_result/sample_results may not exist yet if these migrations
  // haven't been run — tolerate that rather than losing the delete itself.
  const TOLERATED_MISSING_COLUMNS = ["sample_counts", "asbestos_result", "sample_results"];
  let updated: Record<string, unknown> | null = null;
  let updateError: { message?: string } | null = null;
  for (let attempt = 0; attempt <= TOLERATED_MISSING_COLUMNS.length; attempt++) {
    ({ data: updated, error: updateError } = await supabase
      .from("jobs")
      .update(update)
      .eq("id", params.id)
      .select("*")
      .single());
    if (!updateError) break;
    const missingColumn = TOLERATED_MISSING_COLUMNS.find(
      (col) => col in update && new RegExp(col, "i").test(updateError?.message ?? "")
    );
    if (!missingColumn) break;
    delete update[missingColumn];
  }

  if (updateError || !updated) {
    return NextResponse.json({ error: updateError?.message }, { status: 500 });
  }
  return NextResponse.json({ job: updated });
});
