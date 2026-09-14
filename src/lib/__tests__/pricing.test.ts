import { describe, it, expect } from "vitest";
import { knownStripeFeeCentsForJob } from "@/lib/pricing";

describe("knownStripeFeeCentsForJob", () => {
  it("is always known-zero for a check-paid job, real fee or not", () => {
    expect(knownStripeFeeCentsForJob({ stripe_fee_cents: null, payment_type: "check" })).toBe(0);
    expect(knownStripeFeeCentsForJob({ stripe_fee_cents: 500, payment_type: "check" })).toBe(0);
  });

  it("is null for an online job not yet charged", () => {
    expect(knownStripeFeeCentsForJob({ stripe_fee_cents: null, payment_type: "online" })).toBeNull();
  });

  it("is the real captured fee for an online job that's been charged", () => {
    expect(knownStripeFeeCentsForJob({ stripe_fee_cents: 1523, payment_type: "online" })).toBe(1523);
  });
});
