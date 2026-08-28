import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireAdminApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";
import { getValidAccessToken, createDraft } from "@/lib/gmail";
import { getSettings } from "@/lib/settings";
import { getOrCreateStripeCustomer, createPaymentMethodSetupLink } from "@/lib/stripe";
import { NEWTON_FIRE_FLOOD_COMPANY_ID } from "@/lib/report-findings";
import type { Customer } from "@/lib/types";

// Per Tim, 2026-08-27 — Newton Fire & Flood (only, for now) wants a card
// on file that gets charged automatically 30 days after an invoice goes
// out, instead of waiting on a manual "Pay" click every time. This is the
// one-time step that gets that card on file: creates a Stripe-hosted
// Checkout Session (mode: setup) and drafts an email with the link, same
// draft-only-never-auto-sent convention as every other Gmail draft this
// app creates (see invite/route.ts, this route's own template). Once the
// contact finishes it, the webhook (checkout.session.completed) sets the
// resulting card as their Stripe customer's default payment method, and
// the net-30 cron (cron/charge-net30-invoices) takes it from there.
export const POST = withApiErrors(async (
  req: NextRequest,
  { params }: { params: { id: string } }
) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const supabase = getSupabaseAdmin();
  const { data: customer, error: customerError } = await supabase
    .from("customers")
    .select("*")
    .eq("id", params.id)
    .single();
  if (customerError || !customer) {
    return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  }
  const customerRow = customer as unknown as Customer;
  if (customerRow.company_id !== NEWTON_FIRE_FLOOD_COMPANY_ID) {
    return NextResponse.json({ error: "Card-on-file auto-billing is only set up for Newton Fire & Flood right now" }, { status: 400 });
  }
  if (!customerRow.email) {
    return NextResponse.json({ error: "This contact has no email on file" }, { status: 400 });
  }

  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return NextResponse.json({ error: "Gmail is not connected — connect it in Settings first" }, { status: 400 });
  }

  const stripeCustomerId = await getOrCreateStripeCustomer(customerRow);
  const returnUrl = `${req.nextUrl.origin}/portal/dashboard`;
  const setupLink = await createPaymentMethodSetupLink(stripeCustomerId, returnUrl);

  const settings = await getSettings();
  const firstName = customerRow.name && customerRow.name !== customerRow.email ? customerRow.name.split(" ")[0] : "there";

  const draft = await createDraft(accessToken, {
    to: customerRow.email,
    subject: `Set up automatic payment — ${settings.business_name}`,
    bodyText: [
      `Hi ${firstName},`,
      "",
      "To make invoicing easier going forward, you can save a card on file — once it's on file, your invoices will be charged automatically 30 days after they're sent, so there's nothing you need to do to pay each one.",
      "",
      `Click here to add your card: ${setupLink}`,
      "",
      `Should you have any questions, please contact our office at ${settings.business_phone}.`,
    ].join("\n"),
    attachments: [],
  });

  return NextResponse.json({ draftId: draft.id });
});
