import { describe, it, expect } from "vitest";
import { parseMercuryPaymentText, isMercuryPaymentText } from "@/lib/parse-mercury-payment";

// Real plain-text body (see parse-mercury-payment.ts's own comment) —
// captured 2026-09-28 via debug-gmail-search from the actual Mercury
// notification for the payment that restored 26-0040.
const REAL_MERCURY_TEXT =
  "Fast Mold Testing, Inc. sent you $1,313.24\r\n" +
  "The funds will be posted to your account ending in 8178 in 1 business day.\r\n" +
  "ACH transfer\r\n" +
  "Amount Received: $1,313.24\r\n" +
  "Sent on: Monday September 28, 2026\r\n" +
  "Sender: My Duong on behalf of Fast Mold Testing, Inc.\r\n" +
  "To: AMERICAN EXPRESS NATIONAL BANK ••8178\r\n" +
  "ETA: 1 business day\r\n" +
  "Memo: From Fast Mold Testing, Inc. via mercury.com for invoice FMT-LQCDHD-2026\r\n" +
  "\r\n" +
  "Sent with care from\r\n" +
  "Mercury Technologies, Inc.\r\n" +
  "2261 Market Street, Suite 86807, San Francisco, CA 94114";

describe("isMercuryPaymentText", () => {
  it("recognizes the real email", () => {
    expect(isMercuryPaymentText(REAL_MERCURY_TEXT)).toBe(true);
  });

  it("rejects unrelated text", () => {
    expect(isMercuryPaymentText("Crystal Analytical weekly summary")).toBe(false);
  });
});

describe("parseMercuryPaymentText", () => {
  it("parses every field off the real email", () => {
    expect(parseMercuryPaymentText(REAL_MERCURY_TEXT)).toEqual({
      payerCompany: "Fast Mold Testing, Inc.",
      amountCents: 131324,
      sentDate: "2026-09-28",
      invoiceNumber: "FMT-LQCDHD-2026",
    });
  });

  it("still parses when there's no invoice reference in the memo", () => {
    const withoutInvoice = REAL_MERCURY_TEXT.replace(/Memo:.*\r\n/, "");
    const parsed = parseMercuryPaymentText(withoutInvoice);
    expect(parsed?.invoiceNumber).toBeNull();
    expect(parsed?.amountCents).toBe(131324);
  });

  it("returns null for text that isn't a Mercury payment notification", () => {
    expect(parseMercuryPaymentText("Some other email entirely")).toBeNull();
  });
});
