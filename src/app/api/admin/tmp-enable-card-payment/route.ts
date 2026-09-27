import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { getStripe } from "@/lib/stripe";
import { withApiErrors } from "@/lib/api-handler";

// TEMPORARY — one-off for 26-0042 (Sarah Willson wants to pay by card, her
// invoice was created bank-transfer-only per the standard non-Newton rule).
// Delete this route after use.
export const POST = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const { invoiceId } = await req.json();
  if (!invoiceId) return NextResponse.json({ error: "invoiceId required" }, { status: 400 });

  const stripe = getStripe();
  const updated = await stripe.invoices.update(invoiceId, {
    payment_settings: { payment_method_types: ["card", "us_bank_account"] },
  });

  return NextResponse.json({
    id: updated.id,
    status: updated.status,
    payment_method_types: updated.payment_settings?.payment_method_types,
    hosted_invoice_url: updated.hosted_invoice_url,
  });
});
