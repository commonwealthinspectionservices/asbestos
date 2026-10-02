import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { getSupabaseAdmin } from "@/lib/supabase";
import { withApiErrors } from "@/lib/api-handler";
import { mergePdfBuffers } from "@/lib/pdf-merge";
import type { Job } from "@/lib/types";

// Per Tim, 2026-10-02 — the Invoice tab's Lab Invoice row should be plain
// View/Download buttons like every row above it, even when a job has several
// lab invoices (daily invoicing means 3-5 is normal). Both buttons point
// here: every distinct lab invoice PDF on the job, in upload order, merged
// into one file.
export const GET = withApiErrors(async (
  req: NextRequest,
  { params }: { params: { id: string } }
) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const supabase = getSupabaseAdmin();
  const { data: job } = await supabase.from("jobs").select("project_number, documents").eq("id", params.id).single();
  if (!job) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const docs = ((job as unknown as Pick<Job, "documents" | "project_number">).documents ?? [])
    .filter((d) => d.kind === "lab_invoice")
    .sort((a, b) => a.uploaded_at.localeCompare(b.uploaded_at));
  const seen = new Set<string>();
  const buffers: Buffer[] = [];
  for (const doc of docs) {
    if (seen.has(doc.storage_path)) continue;
    seen.add(doc.storage_path);
    const { data: blob } = await supabase.storage.from("job-documents").download(doc.storage_path);
    if (blob) buffers.push(Buffer.from(await blob.arrayBuffer()));
  }
  if (buffers.length === 0) return NextResponse.json({ error: "No lab invoices on this project" }, { status: 404 });

  const merged = await mergePdfBuffers(buffers);
  const disposition = req.nextUrl.searchParams.get("download") != null ? "attachment" : "inline";
  return new NextResponse(new Uint8Array(merged), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${disposition}; filename="${job.project_number ?? params.id} Lab Invoices.pdf"`,
    },
  });
});
