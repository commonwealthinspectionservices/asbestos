import { redirect } from "next/navigation";
import { getSessionRole } from "@/lib/auth";
import AdminNav, { AdminFooter } from "@/components/admin/AdminNav";
import WeeklyRevenueView from "@/components/admin/WeeklyRevenueView";

// Owner-only, same gate as Billing itself (real financial data).
export default function AdminWeeklyRevenuePage() {
  const role = getSessionRole();
  if (!role) redirect("/admin/login");
  if (role !== "owner") redirect("/admin/dashboard");

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <AdminNav role={role} />
      <div className="flex-1">
        <div className="mx-auto max-w-3xl px-4 py-6">
          <WeeklyRevenueView />
        </div>
      </div>
      <AdminFooter />
    </div>
  );
}
