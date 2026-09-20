import { redirect } from "next/navigation";
import { getSessionRole } from "@/lib/auth";
import AdminNav, { AdminFooter } from "@/components/admin/AdminNav";
import MileageView from "@/components/admin/MileageView";

// Per Tim, 2026-09-20 — daily mileage routes; owner-only like the other
// financial pages.
export default function AdminMileagePage() {
  const role = getSessionRole();
  if (!role) redirect("/admin/login");
  if (role !== "owner") redirect("/admin/dashboard");

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <AdminNav role={role} />
      <div className="flex-1">
        <div className="mx-auto max-w-3xl px-4 py-6">
          <MileageView />
        </div>
      </div>
      <AdminFooter />
    </div>
  );
}
