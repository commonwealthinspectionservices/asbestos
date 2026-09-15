import { redirect } from "next/navigation";
import { getSessionRole } from "@/lib/auth";
import AdminNav, { AdminFooter } from "@/components/admin/AdminNav";
import LabInvoicesView from "@/components/admin/LabInvoicesView";

// Per Tim, 2026-09-15 — "one page that has... one copy of every single
// daily summary or weekly summary or any invoice that I've ever been
// sent by Crystal Analytical... make sure I have everything in one
// spot." Owner-only, same gate as Billing (this is real lab-cost/
// financial data) — this route used to just redirect there before this
// page existed (the old Invoices/Lab Costs/Margins consolidation).
export default function AdminLabInvoicesPage() {
  const role = getSessionRole();
  if (!role) redirect("/admin/login");
  if (role !== "owner") redirect("/admin/dashboard");

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <AdminNav role={role} />
      <div className="flex-1">
        <div className="mx-auto max-w-3xl px-4 py-6">
          <LabInvoicesView />
        </div>
      </div>
      <AdminFooter />
    </div>
  );
}
