import { redirect } from "next/navigation";
import { hasAdminSession } from "@/lib/auth";
import AdminNav, { AdminFooter } from "@/components/admin/AdminNav";
import ScheduleView from "@/components/admin/ScheduleView";

export default function AdminSchedulePage() {
  if (!hasAdminSession()) redirect("/admin/login");

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <AdminNav />
      <div className="flex-1">
        <ScheduleView />
      </div>
      <AdminFooter />
    </div>
  );
}
