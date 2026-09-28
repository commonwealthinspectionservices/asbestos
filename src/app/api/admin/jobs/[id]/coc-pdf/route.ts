import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";
import { parseSampleItems } from "@/lib/sample-items";
import { renderCocPdfBuffer } from "@/lib/lab-email";
import { getSupabaseAdminFresh } from "@/lib/supabase";
import { getSettingsFresh } from "@/lib/settings";
import type { CocType, Customer, Company, Job } from "@/lib/types";

const COC_TYPES: CocType[] = ["asbestos_bulk", "mold_air_o_cell", "mold_bulk", "mold_swab"];

// The Chain of Custody tab's "View"/"Download" buttons — per Tim,
// 2026-09-28: "a button next to create draft... that allows me to view
// and another for download." Renders the exact same PDF createCocDraft
// would email (see renderCocPdfBuffer in lab-email.ts), but reads
// straight from whatever's currently typed into the tab (posted from
// the client, same shape as /coc-draft) instead of the job's last-saved
// state — so View/Download always match what's on screen right now,
// even a keystroke that hasn't auto-saved yet, not what Create Draft
// last sent to the lab. Never touches Gmail and never writes to the
// job — a pure render, so it needs neither a Gmail access token nor the
// coc-draft route's own "at least one sample" hard requirement (an
// empty preview is still a valid thing to look at).
export const POST = withApiErrors(async (
  req: NextRequest,
  { params }: { params: { id: string } }
) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const body = await req.json().catch(() => null);
  const cocType = body?.cocType;
  if (!COC_TYPES.includes(cocType)) {
    return NextResponse.json({ error: "Invalid or missing cocType" }, { status: 400 });
  }

  const parsed = parseSampleItems(body?.sampleItems);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const sampleItems = parsed.items.filter((s) => s.sample_number || s.material || s.location);

  const turnaround = body?.turnaround === "Rush" || body?.turnaround === "24-Hr" ? body.turnaround : null;
  const relinquishedDate = typeof body?.relinquishedDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.relinquishedDate) ? body.relinquishedDate : null;
  const relinquishedTime = typeof body?.relinquishedTime === "string" && /^\d{2}:\d{2}$/.test(body.relinquishedTime) ? body.relinquishedTime : null;

  const supabase = getSupabaseAdminFresh();
  const { data: jobRow, error } = await supabase
    .from("jobs")
    .select("*, customers!customer_id(*, companies!company_id(*))")
    .eq("id", params.id)
    .single();
  if (error || !jobRow) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  const job = jobRow as unknown as Job & { customers: Customer & { companies: Company | null } };
  const settings = await getSettingsFresh();

  const pdfBuffer = await renderCocPdfBuffer({ job, settings, cocType, sampleItems, turnaround, relinquishedDate, relinquishedTime });

  return new NextResponse(new Uint8Array(pdfBuffer), {
    headers: { "Content-Type": "application/pdf" },
  });
});
