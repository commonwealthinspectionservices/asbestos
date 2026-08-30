import { redirect } from "next/navigation";

// Per Tim, 2026-08-30 — merged Invoices/Lab Costs/Margins into one Billing
// page ("too many clicks... a lot of repeating information") — this route
// stays only as a redirect so any old bookmark/link still lands somewhere.
export default function AdminLabInvoicesPage() {
  redirect("/admin/billing");
}
