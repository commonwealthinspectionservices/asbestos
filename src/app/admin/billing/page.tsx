import { redirect } from "next/navigation";
import { getSessionRole } from "@/lib/auth";
import AdminNav, { AdminFooter } from "@/components/admin/AdminNav";
import BillingView from "@/components/admin/BillingView";

// Per Tim, 2026-09-09 — Billing is the one section Joe's staff login
// doesn't get, so this is the one admin page with a stricter gate than
// "any valid session": staff bounces to the dashboard instead of seeing
// the page at all, same redirect target the nav link itself points a
// staff user away from (AdminNav.tsx already hides this link for them —
// this catches anyone hitting the URL directly).
export default function AdminBillingPage() {
  const role = getSessionRole();
  if (!role) redirect("/admin/login");
  if (role !== "owner") redirect("/admin/dashboard");

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <AdminNav role={role} />
      <div className="flex-1">
        <BillingView />
      </div>
      <AdminFooter />
    </div>
  );
}
