import { redirect } from "next/navigation";
import { hasAdminSession } from "@/lib/auth";
import AdminNav, { AdminFooter } from "@/components/admin/AdminNav";
import CustomersDirectory from "@/components/admin/CustomersDirectory";

export default function AdminCustomersPage() {
  if (!hasAdminSession()) redirect("/admin/login");

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <AdminNav />
      <div className="flex-1">
        <CustomersDirectory />
      </div>
      <AdminFooter />
    </div>
  );
}
