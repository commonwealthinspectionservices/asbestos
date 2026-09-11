import { describe, it, expect } from "vitest";
import { guessCompanyNameFromDomain } from "@/lib/contact-import";

describe("guessCompanyNameFromDomain", () => {
  it("capitalizes a plain single-word domain", () => {
    expect(guessCompanyNameFromDomain("sanair.com")).toBe("Sanair");
  });

  it("splits a hyphenated domain into separate capitalized words", () => {
    expect(guessCompanyNameFromDomain("green-ocean.com")).toBe("Green Ocean");
  });

  it("takes the real domain label off a subdomain, not the subdomain itself", () => {
    expect(guessCompanyNameFromDomain("mail.crystalanalytical.com")).toBe("Crystalanalytical");
  });

  it("handles a .org TLD the same as .com", () => {
    expect(guessCompanyNameFromDomain("idiil.org")).toBe("Idiil");
  });
});
