import type { Customer, Company } from "@/lib/types";

// Billing address lives with the company, not each individual contact —
// multiple customer rows can share one company, and typing the same address
// into every contact is exactly the duplication companies (src/lib/types.ts)
// exists to avoid. A contact's own billing_address only matters when they
// have no company on file at all.
export function withCompanyBillingAddress(customer: Customer, company: Company | null | undefined): Customer {
  if (customer.billing_address || !company?.billing_address) return customer;
  return { ...customer, billing_address: company.billing_address };
}
