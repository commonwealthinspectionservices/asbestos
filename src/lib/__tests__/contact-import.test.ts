import { describe, it, expect } from "vitest";
import { guessCompanyNameFromDomain, isAutomatedSender } from "@/lib/contact-import";

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

describe("isAutomatedSender", () => {
  it("catches a leading no-reply address, same as before", () => {
    expect(isAutomatedSender("no-reply@example.com")).toBe(true);
  });

  it("catches 'noreply' when it's not the first thing in the local part", () => {
    expect(isAutomatedSender("ads-account-noreply@google.com")).toBe(true);
    expect(isAutomatedSender("ads-noreply@google.com")).toBe(true);
    expect(isAutomatedSender("noreply-analytics@google.com")).toBe(true);
  });

  it("catches a known automated-notification domain with no keyword in the local part", () => {
    expect(isAutomatedSender("quickbooks@notification.intuit.com")).toBe(true);
    expect(isAutomatedSender("americanexpress@welcome.americanexpress.com")).toBe(true);
    expect(isAutomatedSender("americanexpress@member.americanexpress.com")).toBe(true);
    expect(isAutomatedSender("invoice+statements@supabase.com")).toBe(true);
  });

  it("catches a package-return address", () => {
    expect(isAutomatedSender("return@amazon.com")).toBe(true);
  });

  it("does not flag a real person, including one on a job-board relay domain", () => {
    expect(isAutomatedSender("marco.rancourt@cbre.com")).toBe(false);
    expect(isAutomatedSender("conversation-martinphillip-koj1c@indeedemail.com")).toBe(false);
  });
});
