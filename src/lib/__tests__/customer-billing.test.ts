import { describe, it, expect } from "vitest";
import { withCompanyBillingAddress } from "@/lib/customer-billing";
import type { Customer, Company } from "@/lib/types";

const customer: Customer = {
  id: "cust-1",
  name: "Joe Kline",
  company: "Boston Harbor Water Restoration",
  company_id: "co-1",
  email: "joe@example.com",
  phone: "617-555-0100",
  billing_address: null,
  stripe_customer_id: null,
  auth_user_id: null,
  is_homeowner: false,
  created_at: new Date().toISOString(),
};

const company: Company = {
  id: "co-1",
  name: "Boston Harbor Water Restoration",
  billing_address: "36 Finnell Drive Suite #1, Weymouth, MA 02188",
  phone: null,
  email: null,
  billing_contact_id: null,
  created_at: new Date().toISOString(),
};

describe("withCompanyBillingAddress", () => {
  it("falls back to the company's billing address when the contact has none", () => {
    expect(withCompanyBillingAddress(customer, company).billing_address).toBe(
      "36 Finnell Drive Suite #1, Weymouth, MA 02188"
    );
  });

  it("keeps the contact's own billing address when they have one", () => {
    const withOwn = { ...customer, billing_address: "1 Own Street, Boston, MA 02108" };
    expect(withCompanyBillingAddress(withOwn, company).billing_address).toBe("1 Own Street, Boston, MA 02108");
  });

  it("stays null when there's no company at all", () => {
    expect(withCompanyBillingAddress(customer, null).billing_address).toBeNull();
  });

  it("stays null when the company itself has no billing address on file", () => {
    expect(withCompanyBillingAddress(customer, { ...company, billing_address: null }).billing_address).toBeNull();
  });
});
