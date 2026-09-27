import { describe, it, expect } from "vitest";
import { knownStripeFeeCentsForJob, stripeInvoicingFeeCents, totalStripeFeeCents } from "@/lib/pricing";

describe("knownStripeFeeCentsForJob", () => {
  it("is always known-zero for a check-paid job, real fee or not", () => {
    expect(knownStripeFeeCentsForJob({ stripe_fee_cents: null, payment_type: "check" })).toBe(0);
    expect(knownStripeFeeCentsForJob({ stripe_fee_cents: 500, payment_type: "check" })).toBe(0);
  });

  it("is null for an online job not yet charged", () => {
    expect(knownStripeFeeCentsForJob({ stripe_fee_cents: null, payment_type: "online" })).toBeNull();
  });

  it("is the captured processing fee plus the estimated Invoicing fee for an online job that's been charged", () => {
    // $525 invoice: 0.4% = $2.10, + 6.25% tax = $2.23 → $15.23 + $2.23
    expect(knownStripeFeeCentsForJob({ stripe_fee_cents: 1523, payment_type: "online", invoice_total_cents: 52500 })).toBe(1523 + 223);
  });
});

// Per Tim, 2026-09-26 — Stripe's Invoicing Starter fee (0.4% per paid invoice,
// + 6.25% MA sales tax on the fee) folded into the one "Stripe fee" number.
// Checked against his real ledger: 26-0007 ($1,500) + 26-0008 ($1,116) on
// 9/26 were charged $10.46 + $0.65 tax = $11.11 in one bundled line.
describe("stripeInvoicingFeeCents", () => {
  it("is 0.4% of the invoice plus 6.25% tax on that", () => {
    expect(stripeInvoicingFeeCents(150000)).toBe(638); // $6.00 + $0.375 tax
    expect(stripeInvoicingFeeCents(111600)).toBe(474); // $4.464 + $0.279 tax
  });

  it("matches Stripe's real 9/26 line within a cent when the two jobs are added", () => {
    expect(Math.abs(stripeInvoicingFeeCents(150000) + stripeInvoicingFeeCents(111600) - 1111)).toBeLessThanOrEqual(1);
  });

  it("is zero without a real invoice total", () => {
    expect(stripeInvoicingFeeCents(null)).toBe(0);
    expect(stripeInvoicingFeeCents(0)).toBe(0);
  });
});

describe("totalStripeFeeCents", () => {
  it("adds the Invoicing fee to the processing fee (26-0007: $43.80 + $6.38)", () => {
    expect(totalStripeFeeCents({ stripe_fee_cents: 4380, invoice_total_cents: 150000 })).toBe(4380 + 638);
  });

  it("stays null until Stripe has actually processed the payment", () => {
    expect(totalStripeFeeCents({ stripe_fee_cents: null, invoice_total_cents: 150000 })).toBeNull();
  });
});
