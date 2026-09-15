import { redirect } from "next/navigation";
import { getSessionRole } from "@/lib/auth";
import AdminNav, { AdminFooter } from "@/components/admin/AdminNav";
import PaymentCalendarView from "@/components/admin/PaymentCalendarView";

// Per Tim, 2026-09-15 — "a full list of when I'm going to get paid or
// when jobs are officially due": its own page, linked from Billing
// alongside Lab Invoices and Revenue & Margin Summary, same owner-only
// gate (real financial data).
export default function AdminPaymentCalendarPage() {
  const role = getSessionRole();
  if (!role) redirect("/admin/login");
  if (role !== "owner") redirect("/admin/dashboard");

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <AdminNav role={role} />
      <div className="flex-1">
        <div className="mx-auto max-w-3xl px-4 py-6">
          <PaymentCalendarView />
        </div>
      </div>
      <AdminFooter />
    </div>
  );
}
