import { describe, it, expect } from "vitest";
import { extractProjectNumberFromCocSubject } from "@/lib/lab-email";

describe("extractProjectNumberFromCocSubject", () => {
  it("extracts the project number from a real EMSL receipt-confirmation subject", () => {
    const subject =
      "EMSL receipt confirmation, COC for order(s) 132605381 (132605381 - 26-2806 - 11 Regent Circle; Unit 1; Brookline, MA)";
    expect(extractProjectNumberFromCocSubject(subject)).toBe("26-2806");
  });

  it("is case-insensitive on the gating phrase", () => {
    const subject = "coc for order(s) 12345 (12345 - 26-1302 - 545 Herman Street, Fall River, MA)";
    expect(extractProjectNumberFromCocSubject(subject)).toBe("26-1302");
  });

  it("returns null when the subject isn't a COC receipt email, even if it contains a project-number-shaped string", () => {
    const subject = "Re: 26-2806 - invoice question";
    expect(extractProjectNumberFromCocSubject(subject)).toBeNull();
  });

  it("returns null when the gating phrase is present but no project-number-shaped token is found", () => {
    const subject = "EMSL receipt confirmation, COC for order(s) 132605381 (no project number here)";
    expect(extractProjectNumberFromCocSubject(subject)).toBeNull();
  });
});
