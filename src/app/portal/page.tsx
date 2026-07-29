import { redirect } from "next/navigation";
import { getContractorSession } from "@/lib/contractor-api";

// Always per-session — never statically prerendered. Without this, Next
// tries to prerender the page at build time, where getContractorSession()
// throws on the missing Supabase env vars before it ever touches cookies()
// (which is normally what signals a route needs dynamic rendering).
export const dynamic = "force-dynamic";

export default async function PortalIndexPage() {
  const session = await getContractorSession();
  if (!session) redirect("/portal/login");
  if (!session.customer) redirect("/portal/onboarding");
  redirect("/portal/dashboard");
}
