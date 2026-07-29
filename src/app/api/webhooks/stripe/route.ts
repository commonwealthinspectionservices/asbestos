import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getSupabaseAdmin } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  const signature = req.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!signature || !webhookSecret || !stripeKey) {
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }

  const stripe = new Stripe(stripeKey);
  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    console.error("Stripe webhook signature verification failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  if (event.type === "invoice.paid") {
    const invoice = event.data.object as Stripe.Invoice;
    const supabase = getSupabaseAdmin();

    let jobId = invoice.metadata?.job_id ?? null;
    if (!jobId) {
      // Fall back to matching by stored invoice id if metadata is missing.
      const { data } = await supabase.from("jobs").select("id").eq("stripe_invoice_id", invoice.id).maybeSingle();
      jobId = data?.id ?? null;
    }

    if (jobId) {
      // Dynamic import (not static) — see the comment at the top of
      // lab-email.ts: it statically imports pdf-parse, which corrupts
      // state @react-pdf/renderer depends on if the two ever load in the
      // same module graph before pdf-parse is used.
      const { markJobPaid } = await import("@/lib/lab-email");
      await markJobPaid(jobId);
    }
  }

  return NextResponse.json({ received: true });
}
