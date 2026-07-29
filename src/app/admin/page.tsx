import { redirect } from "next/navigation";
import { hasAdminSession } from "@/lib/auth";

export default function AdminIndexPage() {
  redirect(hasAdminSession() ? "/admin/dashboard" : "/admin/login");
}
