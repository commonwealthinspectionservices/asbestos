import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";
import { getStripe } from "@/lib/stripe";

// One-off, read-only: checks a real Stripe invoice's current due_date and
// metadata — used to confirm whether the earlier mistaken tagInvoiceEmailed
// call (26-0029) left a stray due_date behind. Delete after use.
export const POST = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const { stripeInvoiceId } = await req.json();
  if (!stripeInvoiceId) return NextResponse.json({ error: "stripeInvoiceId required" }, { status: 400 });

  const stripe = getStripe();
  const invoice = await stripe.invoices.retrieve(stripeInvoiceId);

  return NextResponse.json({
    id: invoice.id,
    status: invoice.status,
    due_date: invoice.due_date,
    due_date_readable: invoice.due_date ? new Date(invoice.due_date * 1000).toISOString() : null,
    created: new Date(invoice.created * 1000).toISOString(),
    metadata: invoice.metadata,
  });
});
