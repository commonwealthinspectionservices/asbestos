import Link from "next/link";
import { redirect } from "next/navigation";
import { getContractorSession } from "@/lib/contractor-api";

// Always per-session — never statically prerendered. Without this, Next
// tries to prerender the page at build time, where getContractorSession()
// throws on the missing Supabase env vars before it ever touches cookies()
// (which is normally what signals a route needs dynamic rendering).
export const dynamic = "force-dynamic";

// The public "Client Portal" link on the marketing site (nav, homepage,
// service pages) always points here. A signed-in visitor still only ever
// has two destinations — dashboard, or the sign-in page if mid-onboarding
// (see /portal/login) — unchanged from before. A genuinely anonymous
// visitor used to get bounced straight to /portal/login, which meant even
// a brand-new homeowner had to create an account before describing the
// job they wanted. Individuals now go straight into the guest booking
// wizard instead (/portal/book handles having no session at all — see its
// own comment) and only make an account at the very end. Company/
// contractor bookings still need to sign in first — their signup has an
// extra "start a new company vs. join an existing one" branch that's
// harder to resolve after the fact — so that option here still points at
// today's /portal/login flow.
export default async function PortalIndexPage() {
  const session = await getContractorSession();
  if (session?.customer) redirect("/portal/dashboard");
  if (session) redirect("/portal/login");

  return (
    <div className="mx-auto max-w-sm px-4 py-24">
      <h1 className="text-xl font-semibold uppercase text-brand-700">Book a project</h1>
      <div className="mt-6 space-y-3">
        <Link
          href="/portal/book"
          className="block rounded-lg border border-slate-300 px-4 py-3 text-center font-medium text-slate-700"
        >
          I'm a homeowner
        </Link>
        <Link
          href="/portal/login"
          className="block rounded-lg border border-slate-300 px-4 py-3 text-center font-medium text-slate-700"
        >
          I'm booking for my company
        </Link>
      </div>
    </div>
  );
}
