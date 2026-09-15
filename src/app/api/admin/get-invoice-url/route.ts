import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";
import { getStripe } from "@/lib/stripe";

// One-off, read-only: fetches a real Stripe invoice's hosted URL and
// payment_settings so it can be opened in the browser to visually confirm
// the ACH-only restriction. Delete after use.
export const POST = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const { stripeInvoiceId } = await req.json();
  if (!stripeInvoiceId) return NextResponse.json({ error: "stripeInvoiceId required" }, { status: 400 });

  const stripe = getStripe();
  const invoice = await stripe.invoices.retrieve(stripeInvoiceId);

  return NextResponse.json({
    hosted_invoice_url: invoice.hosted_invoice_url,
    payment_method_types: invoice.payment_settings?.payment_method_types,
    status: invoice.status,
  });
});
