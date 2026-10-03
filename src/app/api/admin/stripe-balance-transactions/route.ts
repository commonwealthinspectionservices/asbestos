import { NextRequest, NextResponse } from "next/server";
import { requireOwnerApi } from "@/lib/admin-api";
import { getStripe } from "@/lib/stripe";
import { withApiErrors } from "@/lib/api-handler";

// Per Tim, 2026-10-03 — Stripe's available balance keeps dipping negative
// (-$38.91 available vs. $3,973.89 pending that day) and he wanted to know
// which fees/payouts/refunds are actually causing it. stripe-balance-check
// only reads per-job charges; it never shows the account's own balance
// transactions (fees, payouts, adjustments), which is where a negative
// available balance actually comes from. Read-only, owner-only. ?limit=
// defaults to 50, max 100. Nothing is written anywhere.
export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireOwnerApi(req);
  if (unauthorized) return unauthorized;

  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? "50") || 50, 100);
  const stripe = getStripe();
  const [balance, txns] = await Promise.all([
    stripe.balance.retrieve(),
    stripe.balanceTransactions.list({ limit }),
  ]);

  return NextResponse.json({
    balance: {
      available: balance.available.map((b) => ({ amount_cents: b.amount, currency: b.currency })),
      pending: balance.pending.map((b) => ({ amount_cents: b.amount, currency: b.currency })),
    },
    transactions: txns.data.map((t) => ({
      created: new Date(t.created * 1000).toISOString(),
      available_on: new Date(t.available_on * 1000).toISOString(),
      type: t.type,
      amount_cents: t.amount,
      fee_cents: t.fee,
      net_cents: t.net,
      status: t.status,
      description: t.description,
    })),
  });
});
