import { redirect } from "next/navigation";
import { getSessionRole } from "@/lib/auth";
import AdminNav, { AdminFooter } from "@/components/admin/AdminNav";
import OpenInvoicesView from "@/components/admin/OpenInvoicesView";

// Per Tim, 2026-09-23 — real financial data straight from Stripe, owner-only like Billing.
export default function AdminOpenInvoicesPage() {
  const role = getSessionRole();
  if (!role) redirect("/admin/login");
  if (role !== "owner") redirect("/admin/dashboard");

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <AdminNav role={role} />
      <div className="flex-1">
        <div className="mx-auto max-w-3xl px-4 py-6">
          <OpenInvoicesView />
        </div>
      </div>
      <AdminFooter />
    </div>
  );
}
