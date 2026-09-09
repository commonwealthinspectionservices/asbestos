import { redirect } from "next/navigation";
import { hasAdminSession } from "@/lib/auth";
import AdminNav, { AdminFooter } from "@/components/admin/AdminNav";
import ProspectingView from "@/components/admin/ProspectingView";

// Deliberately not in AdminNav's top-level tabs (per Tim's own "delete
// Ray's Library from the tabs... just make it a small link" precedent) —
// this is early/experimental ("we're not gonna be using this bot for a
// long time until it's fully developed"), reachable by URL only until
// it's proven out enough to earn a permanent spot in the nav.
export default function AdminProspectingPage() {
  if (!hasAdminSession()) redirect("/admin/login");

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <AdminNav />
      <div className="flex-1">
        <ProspectingView />
      </div>
      <AdminFooter />
    </div>
  );
}
