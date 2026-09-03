import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getSettings } from "@/lib/settings";
import { withApiErrors } from "@/lib/api-handler";
import { withCompanyBillingAddress } from "@/lib/customer-billing";
import { expandAddress } from "@/lib/address";
import { renderMoistureMappingReportPdf, moistureMappingPhotoFormat } from "@/lib/report-pdf";
import type { Company, Customer, Job } from "@/lib/types";

// Deliberately outside the report/[id] route above (which only ever
// serves the 3 lab-sample domains — see ReportDocumentForDomain) — this
// is its own standalone document built straight from the job's uploaded
// Photos, not the lab pipeline. See renderMoistureMappingReportPdf's own
// comment in report-pdf.tsx for why it doesn't plug into ReportDomain.
export const GET = withApiErrors(async (
  req: NextRequest,
  { params }: { params: { id: string } }
) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const supabase = getSupabaseAdmin();
  const { data: job, error } = await supabase
    .from("jobs")
    .select("*, customers!customer_id(*, companies!company_id(*))")
    .eq("id", params.id)
    .single();
  if (error || !job) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const jobRow = job as unknown as Job & { customers: Customer & { companies: Company | null } };
  const customer = withCompanyBillingAddress(jobRow.customers, jobRow.customers.companies);
  const settings = await getSettings();

  const jobPhotos = jobRow.photos ?? [];
  if (jobPhotos.length === 0) {
    return NextResponse.json({ error: "This job has no photos yet" }, { status: 400 });
  }

  const photos = await Promise.all(
    jobPhotos.map(async (photo) => {
      const { data: blob, error: downloadError } = await supabase.storage
        .from("job-photos")
        .download(photo.storage_path);
      if (downloadError || !blob) {
        console.error(`Skipping missing moisture mapping photo ${photo.storage_path}:`, downloadError);
        return null;
      }
      return {
        room: photo.room ?? null,
        caption: photo.caption ?? null,
        buffer: Buffer.from(await blob.arrayBuffer()),
        format: moistureMappingPhotoFormat(photo.file_name),
      };
    })
  );
  const resolvedPhotos = photos.filter((p): p is NonNullable<typeof p> => p !== null);
  if (resolvedPhotos.length === 0) {
    return NextResponse.json({ error: "None of this job's photos could be loaded" }, { status: 500 });
  }

  const pdf = await renderMoistureMappingReportPdf({ job: jobRow, customer, settings, photos: resolvedPhotos });

  const disposition = req.nextUrl.searchParams.get("download") != null ? "attachment" : "inline";
  const filename = `${jobRow.project_number ?? params.id} Moisture Mapping Report ${expandAddress(jobRow.service_address)}`
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${disposition}; filename="${filename}.pdf"`,
    },
  });
});
