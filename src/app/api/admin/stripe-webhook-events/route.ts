import { NextResponse } from "next/server";
import { NextRequest } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { getStripe } from "@/lib/stripe";
import { withApiErrors } from "@/lib/api-handler";

// Per Tim, 2026-09-18 — the pending-payment notification (see
// payment_intent.processing/payment_failed in webhooks/stripe/route.ts)
// depends on this app's live webhook endpoint actually being subscribed to
// those two event types, which is Stripe account configuration this
// codebase can't set from a deploy — it has to be done through Stripe's
// own API/Dashboard against the live endpoint. One-off, additive only:
// adds the two new event types to whatever the endpoint is already
// subscribed to, never removes or replaces anything already enabled.
const NEW_EVENT_TYPES = ["payment_intent.processing", "payment_intent.payment_failed"];

export const POST = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const stripe = getStripe();
  const endpoints = await stripe.webhookEndpoints.list({ limit: 10 });
  const endpoint = endpoints.data.find((e) => e.url.includes("/api/webhooks/stripe"));
  if (!endpoint) {
    return NextResponse.json({ error: "No webhook endpoint found matching /api/webhooks/stripe" }, { status: 404 });
  }

  const currentEvents = endpoint.enabled_events;
  if (currentEvents.includes("*" as never)) {
    return NextResponse.json({ ok: true, note: "Endpoint already subscribed to all events — nothing to add.", enabled_events: currentEvents });
  }

  const missing = NEW_EVENT_TYPES.filter((t) => !currentEvents.includes(t as never));
  if (missing.length === 0) {
    return NextResponse.json({ ok: true, note: "Both event types already enabled — nothing to add.", enabled_events: currentEvents });
  }

  const updated = await stripe.webhookEndpoints.update(endpoint.id, {
    enabled_events: [...currentEvents, ...missing] as never,
  });

  return NextResponse.json({ ok: true, endpointId: endpoint.id, added: missing, enabled_events: updated.enabled_events });
});
