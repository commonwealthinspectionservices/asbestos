import { describe, it, expect } from "vitest";
import { knownStripeFeeCentsForJob, knownInvoicingFeeCentsForJob, knownTotalStripeCostCentsForJob, stripeInvoicingFeeCents } from "@/lib/pricing";

describe("knownStripeFeeCentsForJob", () => {
  it("is always known-zero for a check-paid job, real fee or not", () => {
    expect(knownStripeFeeCentsForJob({ stripe_fee_cents: null, payment_type: "check" })).toBe(0);
    expect(knownStripeFeeCentsForJob({ stripe_fee_cents: 500, payment_type: "check" })).toBe(0);
  });

  it("is null for an online job not yet charged", () => {
    expect(knownStripeFeeCentsForJob({ stripe_fee_cents: null, payment_type: "online" })).toBeNull();
  });

  it("is just the captured processing fee for an online job that's been charged (the Invoicing fee is listed separately)", () => {
    expect(knownStripeFeeCentsForJob({ stripe_fee_cents: 1523, payment_type: "online" })).toBe(1523);
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

describe("knownInvoicingFeeCentsForJob / knownTotalStripeCostCentsForJob", () => {
  it("lists the Invoicing fee on its own (26-0007: $6.38) once the payment has been processed", () => {
    expect(knownInvoicingFeeCentsForJob({ stripe_fee_cents: 4380, payment_type: "online", invoice_total_cents: 150000 })).toBe(638);
  });

  it("is null until Stripe has processed the payment, and zero for a check", () => {
    expect(knownInvoicingFeeCentsForJob({ stripe_fee_cents: null, payment_type: "online", invoice_total_cents: 150000 })).toBeNull();
    expect(knownInvoicingFeeCentsForJob({ stripe_fee_cents: null, payment_type: "check", invoice_total_cents: 150000 })).toBe(0);
  });

  it("adds both together for margin math ($43.80 + $6.38)", () => {
    expect(knownTotalStripeCostCentsForJob({ stripe_fee_cents: 4380, payment_type: "online", invoice_total_cents: 150000 })).toBe(4380 + 638);
    expect(knownTotalStripeCostCentsForJob({ stripe_fee_cents: null, payment_type: "online", invoice_total_cents: 150000 })).toBeNull();
  });
});
