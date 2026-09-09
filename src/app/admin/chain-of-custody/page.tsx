import { redirect } from "next/navigation";
import { getSessionRole } from "@/lib/auth";
import AdminNav, { AdminFooter } from "@/components/admin/AdminNav";
import ChainOfCustody from "@/components/admin/ChainOfCustody";

export default function AdminChainOfCustodyPage() {
  const role = getSessionRole();
  if (!role) redirect("/admin/login");

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <AdminNav role={role} />
      <div className="flex-1">
        <ChainOfCustody />
      </div>
      <AdminFooter />
    </div>
  );
}
