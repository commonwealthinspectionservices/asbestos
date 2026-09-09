import { redirect } from "next/navigation";
import { getSessionRole } from "@/lib/auth";
import AdminNav, { AdminFooter } from "@/components/admin/AdminNav";
import CustomersDirectory from "@/components/admin/CustomersDirectory";

export default function AdminCustomersPage() {
  const role = getSessionRole();
  if (!role) redirect("/admin/login");

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <AdminNav role={role} />
      <div className="flex-1">
        <CustomersDirectory />
      </div>
      <AdminFooter />
    </div>
  );
}
