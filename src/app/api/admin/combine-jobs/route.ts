import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { requireAdminApi } from "@/lib/admin-api";
import { getSupabaseAdmin } from "@/lib/supabase";
import { withApiErrors } from "@/lib/api-handler";
import { detectAsbestosResult, extractSampleResults, extractCrystalAnalyticalMaterialDescriptions } from "@/lib/parse-lab-report";
import { extractPositionOrderedText } from "@/lib/pdf-position-text";
import type { Job, JobDocument } from "@/lib/types";

// ONE-OFF (2026-10-02, 26-0065 + 26-0067) — Tim: "job 65 and 67 should
// probably just be combined into one job". Copies the source job's lab
// report/CoC PDFs onto the target (real copies — deleting the source job
// removes its own storage files), parses the source's PLM results into the
// target's sample_results/sample_counts. Dry run unless ?apply=1. Remove
// this route once the merge is done.
export const POST = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const fromId = req.nextUrl.searchParams.get("from");
  const intoId = req.nextUrl.searchParams.get("into");
  const apply = req.nextUrl.searchParams.get("apply") === "1";
  if (!fromId || !intoId) return NextResponse.json({ error: "from and into are required" }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { data: rows } = await supabase.from("jobs").select("*").in("id", [fromId, intoId]);
  const from = (rows ?? []).find((r) => r.id === fromId) as unknown as Job | undefined;
  const into = (rows ?? []).find((r) => r.id === intoId) as unknown as Job | undefined;
  if (!from || !into) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  if (from.customer_id !== into.customer_id || from.service_address !== into.service_address) {
    return NextResponse.json({ error: "Jobs are for a different customer or address" }, { status: 400 });
  }

  const label = (into.service_type ?? "").split(",")[0].trim();
  const fromLab = (from.documents ?? []).filter((d) => d.kind === "lab_report");
  const fromCoc = (from.documents ?? []).filter((d) => d.kind === "coc");
  if (fromLab.length === 0) return NextResponse.json({ error: "Source job has no lab report" }, { status: 400 });

  const { data: labBlob } = await supabase.storage.from("job-documents").download(fromLab[0].storage_path);
  if (!labBlob) return NextResponse.json({ error: "Could not download the source lab report" }, { status: 500 });
  const labBuffer = Buffer.from(await labBlob.arrayBuffer());
  const { text } = await pdfParse(labBuffer);
  const positionOrderedText = await extractPositionOrderedText(labBuffer);
  const parsed = extractSampleResults(text, positionOrderedText);
  const materials = positionOrderedText ? extractCrystalAnalyticalMaterialDescriptions(positionOrderedText) : {};
  const parsedWithMaterial = parsed.map((s) => (materials[s.fieldCode] ? { ...s, material: materials[s.fieldCode] } : s));
  // Crystal's single-sample layout isn't recognized by extractSampleResults
  // (26-0067 returned nothing) — the caller supplies the result read off the
  // report by hand in that case.
  const body = await req.json().catch(() => null);
  const manual = Array.isArray(body?.results) ? (body.results as { fieldCode: string; result: string; material?: string }[]) : [];
  const newResults = parsedWithMaterial.length > 0 ? parsedWithMaterial : manual;
  const sourceResult = detectAsbestosResult(text, positionOrderedText);

  const existing = into.sample_results ?? [];
  const collisions = newResults.filter((n) => existing.some((e) => e.fieldCode === n.fieldCode)).map((n) => n.fieldCode);
  const mergedResults = [...existing, ...newResults.filter((n) => !existing.some((e) => e.fieldCode === n.fieldCode))];
  const anyPositive = mergedResults.some((r) => /%/.test(r.result));
  const plan = {
    intoLabel: label,
    copyDocs: [...fromLab, ...fromCoc].map((d) => `${d.kind}:${d.file_name}`),
    newResults,
    sourceResult,
    collisions,
    mergedCount: mergedResults.length,
    combinedAsbestosResult: anyPositive ? "positive" : "negative",
    invoice_auto: into.invoice_auto,
    invoiceItemsBefore: into.invoice_line_items,
    reportText: text.slice(0, 4000),
    reportTextPositioned: (positionOrderedText ?? "").slice(0, 4000),
  };
  if (!apply) return NextResponse.json({ dryRun: true, plan });
  if (collisions.length > 0 || newResults.length === 0) return NextResponse.json({ error: "Refusing to apply — see plan", plan }, { status: 400 });

  const copied: JobDocument[] = [];
  for (const d of [...fromLab, ...fromCoc]) {
    const { data: blob } = await supabase.storage.from("job-documents").download(d.storage_path);
    if (!blob) throw new Error(`Could not download ${d.file_name}`);
    const newPath = `${into.id}/${randomUUID()}-${d.file_name}`;
    const { error } = await supabase.storage.from("job-documents").upload(newPath, Buffer.from(await blob.arrayBuffer()), { contentType: "application/pdf" });
    if (error) throw new Error(`Upload failed: ${error.message}`);
    copied.push({ ...d, id: randomUUID(), service_type: label, storage_path: newPath, project_number_mismatch: null, domain_mismatch: false });
  }

  const note = `[combined with ${from.project_number} on ${new Date().toISOString().slice(0, 10)}]`;
  const { error: updateError } = await supabase
    .from("jobs")
    .update({
      documents: [...(into.documents ?? []), ...copied],
      sample_results: mergedResults,
      sample_counts: { ...(into.sample_counts ?? {}), [label]: mergedResults.length },
      asbestos_result: anyPositive ? "positive" : "negative",
      notes: into.notes ? `${into.notes}\n${note}` : note,
    })
    .eq("id", into.id);
  if (updateError) throw new Error(updateError.message);
  return NextResponse.json({ applied: true, plan });
});
