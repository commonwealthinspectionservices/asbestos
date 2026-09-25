import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";
import { savePaidInvoiceDocument } from "@/lib/paid-invoice";

// Files Stripe's paid invoice PDF on this job — for jobs paid before that
// happened automatically (see markJobPaid). Idempotent: replaces the job's
// one paid_invoice document.
export const POST = withApiErrors(async (
  req: NextRequest,
  { params }: { params: { id: string } }
) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const result = await savePaidInvoiceDocument(params.id);
  if (!result.saved) return NextResponse.json({ error: result.reason ?? "Couldn't save the paid invoice" }, { status: 400 });
  return NextResponse.json({ ok: true });
});
