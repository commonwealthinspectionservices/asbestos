import { redirect } from "next/navigation";
import { getSessionRole } from "@/lib/auth";
import AdminNav, { AdminFooter } from "@/components/admin/AdminNav";
import RevenueMarginSummaryView from "@/components/admin/RevenueMarginSummaryView";

// Per Tim, 2026-09-15 — "they should each be their own page... links at
// the top right... just linking to their own page each": Revenue & Margin
// Summary moved out of BillingView's own collapsed dropdown into its own
// route, same owner-only gate as Billing itself (real financial data).
export default function AdminRevenueSummaryPage() {
  const role = getSessionRole();
  if (!role) redirect("/admin/login");
  if (role !== "owner") redirect("/admin/dashboard");

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <AdminNav role={role} />
      <div className="flex-1">
        <div className="mx-auto max-w-3xl px-4 py-6">
          <RevenueMarginSummaryView />
        </div>
      </div>
      <AdminFooter />
    </div>
  );
}
