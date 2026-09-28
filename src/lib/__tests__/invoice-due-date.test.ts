import { describe, it, expect } from "vitest";
import { dueDateFor, paymentDueDate, localDateOnly } from "@/lib/invoice-due-date";
import type { JobWithCustomer } from "@/lib/types";

// dueDateFor only ever reads these five fields — a minimal cast avoids
// hand-filling every other column on Job/JobWithCustomer for a pure
// function test (see the report-xlsm.test.ts fixture's own struggle with
// that, which this sidesteps entirely).
function job(fields: {
  payment_due_date?: string | null;
  is_individual?: boolean;
  invoice_sent_at?: string | null;
  confirmed_date?: string | null;
  requested_date?: string | null;
}): JobWithCustomer {
  return {
    payment_due_date: fields.payment_due_date ?? null,
    is_individual: fields.is_individual ?? false,
    invoice_sent_at: fields.invoice_sent_at ?? null,
    confirmed_date: fields.confirmed_date ?? null,
    requested_date: fields.requested_date ?? null,
  } as unknown as JobWithCustomer;
}

describe("paymentDueDate", () => {
  it("adds 30 days to the given date", () => {
    expect(paymentDueDate("2026-09-01")).toBe("2026-10-01");
  });

  it("returns null for an empty/invalid date", () => {
    expect(paymentDueDate("")).toBeNull();
  });
});

describe("dueDateFor", () => {
  it("a manually-set payment_due_date always wins, individual or not", () => {
    expect(dueDateFor(job({ payment_due_date: "2026-11-15", is_individual: true, requested_date: "2026-09-01" }))).toBe("2026-11-15");
    expect(dueDateFor(job({ payment_due_date: "2026-11-15", is_individual: false, requested_date: "2026-09-01" }))).toBe("2026-11-15");
  });

  describe("repeat customer/contractor (is_individual: false) — net-30, unchanged", () => {
    it("30 days after the project date, before the invoice is sent", () => {
      expect(dueDateFor(job({ confirmed_date: "2026-09-01" }))).toBe("2026-10-01");
    });

    it("confirmed_date wins over requested_date", () => {
      expect(dueDateFor(job({ confirmed_date: "2026-09-01", requested_date: "2026-08-15" }))).toBe("2026-10-01");
    });

    it("falls back to requested_date when there's no confirmed_date", () => {
      expect(dueDateFor(job({ requested_date: "2026-09-01" }))).toBe("2026-10-01");
    });

    it("30 days after the real send date once the invoice went out", () => {
      expect(dueDateFor(job({ confirmed_date: "2026-09-01", invoice_sent_at: "2026-09-10T12:00:00Z" }))).toBe(
        paymentDueDate(localDateOnly("2026-09-10T12:00:00Z"))
      );
    });
  });

  describe("homeowner/individual (is_individual: true) — due right away, per Tim 2026-09-28", () => {
    it("the project date itself, no +30, before the invoice is sent", () => {
      expect(dueDateFor(job({ is_individual: true, confirmed_date: "2026-09-01" }))).toBe("2026-09-01");
    });

    it("confirmed_date wins over requested_date, same as the contractor branch", () => {
      expect(dueDateFor(job({ is_individual: true, confirmed_date: "2026-09-01", requested_date: "2026-08-15" }))).toBe("2026-09-01");
    });

    it("falls back to requested_date when there's no confirmed_date", () => {
      expect(dueDateFor(job({ is_individual: true, requested_date: "2026-09-01" }))).toBe("2026-09-01");
    });

    it("the real send date itself once the invoice went out, no +30", () => {
      expect(dueDateFor(job({ is_individual: true, confirmed_date: "2026-09-01", invoice_sent_at: "2026-09-10T12:00:00Z" }))).toBe(
        localDateOnly("2026-09-10T12:00:00Z")
      );
    });

    it("null when there's no date at all to fall back to", () => {
      expect(dueDateFor(job({ is_individual: true }))).toBeNull();
    });
  });
});
