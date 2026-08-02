import { redirect } from "next/navigation";
import { getContractorSession } from "@/lib/contractor-api";

// Always per-session — never statically prerendered. Without this, Next
// tries to prerender the page at build time, where getContractorSession()
// throws on the missing Supabase env vars before it ever touches cookies()
// (which is normally what signals a route needs dynamic rendering).
export const dynamic = "force-dynamic";

// The public "Client Portal" link on the marketing site (nav, homepage,
// service pages) always points here — deliberately only two destinations,
// signed-in-with-a-profile or the sign-in page, never straight into
// onboarding. Landing mid-onboarding from a passive nav click (e.g. after
// starting signup, wandering off, then clicking the nav link again) was
// confusing; the sign-in page's own "Create account" link is the way back
// in for that case. A session that's mid-onboarding still reaches it
// normally via an explicit sign-in (see /portal/login).
export default async function PortalIndexPage() {
  const session = await getContractorSession();
  if (session?.customer) redirect("/portal/dashboard");
  redirect("/portal/login");
}
