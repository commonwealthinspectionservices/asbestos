import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";
import { getSupabaseAdmin } from "@/lib/supabase";

// One-off, 2026-09-12 (26-0019) — not a route anything else calls. Delete
// after use.
//
// Read-only. Each upload gets its own unique storage_path (job id +
// random doc id prefix) — replacing a document's entry in the jobs.documents
// array doesn't necessarily delete the OLD file's bytes from Storage, just
// stops referencing them. Lists everything actually sitting in this job's
// Storage folder so any orphaned original asbestos lab report can be found,
// even though it's no longer in the documents array.
const JOB_ID = "02d16558-77c4-4efa-8f6a-df97bf2612b7";

export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const supabase = getSupabaseAdmin();
  const { data: files, error } = await supabase.storage.from("job-documents").list(JOB_ID);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: job } = await supabase.from("jobs").select("documents").eq("id", JOB_ID).maybeSingle();
  const referencedPaths = new Set((job?.documents ?? []).map((d: { storage_path: string }) => d.storage_path));

  return NextResponse.json({
    allFiles: (files ?? []).map((f) => ({
      name: f.name,
      created_at: f.created_at,
      size: f.metadata?.size,
      currentlyReferenced: referencedPaths.has(`${JOB_ID}/${f.name}`),
    })),
  });
});
