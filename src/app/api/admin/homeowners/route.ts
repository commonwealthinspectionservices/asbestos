import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireAdminApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";

// There's no homeowners table — site_contact_name/site_contact_phone are
// deliberately just plain text on each job (see job-intake.ts), so a
// subcontractor-referred homeowner never has to be entered as a real
// contact. This assembles a browsable list purely by scanning jobs and
// grouping same name+phone together, rather than reading from a table of
// its own — read-only, nothing to keep in sync with job records.
//
// Excludes anyone who's since become a real Directory contact (Companies/
// Individuals) — a job's site contact isn't always a homeowner (e.g. a
// business rep at the subcontracting company's own client), and once
// they're entered as a real contact they belong there instead, not here.
export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const supabase = getSupabaseAdmin();
  const [{ data, error }, { data: customers, error: customersError }] = await Promise.all([
    supabase
      .from("jobs")
      .select("id, project_number, site_contact_name, site_contact_phone, service_address, status, source, requested_date, confirmed_date, created_at")
      .not("site_contact_name", "is", null)
      .order("created_at", { ascending: false }),
    supabase.from("customers").select("name"),
  ]);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (customersError) {
    return NextResponse.json({ error: customersError.message }, { status: 500 });
  }

  // Per Tim, 2026-08-30 — Chris Bromley (Restoration 1's own rep, site
  // contact on a job subcontracted through FLI Environmental) showed up
  // here even after being entered as a real company contact: "he is not a
  // homeowner... I want them to be able to keep his info for future sales."
  // Once someone's a real Directory contact (linked to a company or not),
  // they're not a passively-captured site contact anymore — same name
  // match the jobs are already grouped by below, just against customers.
  const realContactNames = new Set((customers ?? []).map((c) => c.name.trim().toLowerCase()));

  type JobRow = {
    id: string;
    project_number: string | null;
    site_contact_name: string;
    site_contact_phone: string | null;
    service_address: string;
    status: string;
    source: string;
    requested_date: string | null;
    confirmed_date: string | null;
    created_at: string;
  };

  // Grouped by name+phone rather than name alone — two different
  // homeowners can share a common name, but not both a name and a phone
  // number. A job with a phone groups only with the same phone; a job
  // with no phone at all falls back to grouping by name only.
  const groups = new Map<string, { name: string; phone: string | null; jobs: JobRow[] }>();
  for (const job of (data ?? []) as JobRow[]) {
    const name = job.site_contact_name.trim();
    if (!name) continue;
    if (realContactNames.has(name.toLowerCase())) continue;
    const phone = job.site_contact_phone?.trim() || null;
    const key = `${name.toLowerCase()}|${phone ?? ""}`;
    const existing = groups.get(key);
    if (existing) {
      existing.jobs.push(job);
    } else {
      groups.set(key, { name, phone, jobs: [job] });
    }
  }

  const homeowners = Array.from(groups.values())
    .map((g) => ({ ...g, jobCount: g.jobs.length }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return NextResponse.json({ homeowners });
});
