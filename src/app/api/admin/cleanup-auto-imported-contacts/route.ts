import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";
import { getSupabaseAdmin } from "@/lib/supabase";

// One-off, 2026-09-11 — not a route anything else calls. Delete after use.
//
// Per Tim: "delete all of the companys and individuals we auto created
// today i dont like that feature i just want the people i had like as of
// this time morning" — the Gmail contact-import feature (shipped and run
// for the first time today) created far more noise than the narrower
// backfill-contact-companies cleanup earlier caught: it auto-created a
// company for essentially every domain it ever saw an email from/to,
// plus an "individual" contact for every address with no display name
// (including automated senders that slipped past the filter before it
// was tightened).
//
// A customer/company is only ever deleted here if it's SAFE to assume it
// came from that pipeline and nothing else — never a blanket "created
// today" sweep, since real jobs and real portal signups (Dave MacDonald,
// today) also create customer/company rows today and must survive this.
// A customer is deletable only if ALL of these hold:
//   - created today (the import feature didn't exist before today)
//   - auth_user_id is null (a real portal signup always has one — the
//     import pipeline never sets this)
//   - phone is blank (the import pipeline always inserts '' — a real
//     admin-entered or portal customer essentially never has this)
//   - zero jobs reference this customer (a real customer from a real
//     booking always has at least one)
// A company is deletable only if it was created today AND, after the
// customer sweep above, it has zero customers left referencing it at all
// (real companies always keep at least one real customer).
export const maxDuration = 60;

const TODAY_CUTOFF = "2026-09-11T00:00:00Z";

export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const confirm = req.nextUrl.searchParams.get("confirm") === "1";
  const supabase = getSupabaseAdmin();

  const { data: candidateCustomers } = await supabase
    .from("customers")
    .select("id, name, email, company_id, created_at")
    .gte("created_at", TODAY_CUTOFF)
    .is("auth_user_id", null)
    .eq("phone", "");

  const { data: jobRows } = await supabase.from("jobs").select("customer_id");
  const customerIdsWithJobs = new Set((jobRows ?? []).map((j) => j.customer_id));

  const deletableCustomers = (candidateCustomers ?? []).filter((c) => !customerIdsWithJobs.has(c.id));
  const deletableCustomerIds = new Set(deletableCustomers.map((c) => c.id));

  const { data: candidateCompanies } = await supabase
    .from("companies")
    .select("id, name, created_at")
    .gte("created_at", TODAY_CUTOFF);

  const { data: allCustomersWithCompany } = await supabase
    .from("customers")
    .select("id, company_id")
    .not("company_id", "is", null);

  const deletableCompanies = (candidateCompanies ?? []).filter((company) => {
    const customersUnderIt = (allCustomersWithCompany ?? []).filter((c) => c.company_id === company.id);
    return customersUnderIt.length > 0 && customersUnderIt.every((c) => deletableCustomerIds.has(c.id));
  });

  if (!confirm) {
    return NextResponse.json({
      preview: true,
      customersToDelete: deletableCustomers.map((c) => ({ name: c.name, email: c.email })),
      companiesToDelete: deletableCompanies.map((c) => c.name),
      note: "Call again with ?confirm=1 to actually delete these.",
    });
  }

  for (const c of deletableCustomers) {
    await supabase.from("customers").delete().eq("id", c.id);
  }
  for (const c of deletableCompanies) {
    await supabase.from("companies").delete().eq("id", c.id);
  }

  return NextResponse.json({
    deleted: true,
    customersDeleted: deletableCustomers.map((c) => ({ name: c.name, email: c.email })),
    companiesDeleted: deletableCompanies.map((c) => c.name),
  });
});
