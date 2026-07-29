// One-off historical data import — NOT part of the deployed app.
// Imports the owner's real job history from his FLI Environmental tracking
// spreadsheet as reference/seed data. Run once:
//   node scripts/import-fli-jobs.mjs /path/to/jobs.xlsx
//
// Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY as env vars (or edit
// the constants below), and the `openpyxl`-equivalent npm package `xlsx`
// is NOT used here — this script shells out to nothing; it expects the
// caller to have already exported the sheet to JSON via the accompanying
// Python step (see README note below) OR you can adapt it to read xlsx
// directly with a JS library. As actually run this session, rows were
// extracted with a short Python/openpyxl script and passed in as JSON —
// see the -e invocation in the session transcript for the exact filter
// (project-number-shaped first column, "Sheet1", explicit exclusion of the
// COMMISSIONS/subtotal rows).

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

/**
 * @param {Array<{projectNumber: string, company: string, address: string, date: string, serviceType: string, priceCents: number, paid: boolean}>} rows
 */
export async function importJobs(rows) {
  let imported = 0;
  let skipped = 0;
  const skippedRows = [];

  for (const row of rows) {
    if (!row.projectNumber || !row.company || !row.address || !row.date) {
      skipped++;
      skippedRows.push(row);
      continue;
    }

    // customer = whoever pays (99% a referring company, occasionally an
    // individual homeowner directly) — matches src/app/api/book/route.ts's
    // upsert-by-email pattern, but historical rows have no email, so match
    // by name instead (case-sensitive exact match is fine for a one-time
    // import of ~130 rows; dedupes companies that recur across many jobs).
    const { data: existingCustomer } = await supabase
      .from("customers")
      .select("id")
      .eq("name", row.company)
      .is("auth_user_id", null)
      .maybeSingle();

    let customerId = existingCustomer?.id;
    if (!customerId) {
      const { data: newCustomer, error: customerError } = await supabase
        .from("customers")
        .insert({
          name: row.company,
          email: `historical+${row.company.toLowerCase().replace(/[^a-z0-9]+/g, "-")}@placeholder.local`,
          phone: "",
        })
        .select("id")
        .single();
      if (customerError) {
        console.error(`Failed to create customer "${row.company}":`, customerError.message);
        skipped++;
        skippedRows.push(row);
        continue;
      }
      customerId = newCustomer.id;
    }

    const { error: jobError } = await supabase.from("jobs").insert({
      project_number: row.projectNumber,
      customer_id: customerId,
      service_address: row.address,
      requested_date: row.date,
      service_type: row.serviceType,
      invoice_total_cents: row.priceCents,
      status: row.paid ? "paid" : "invoiced",
      notes: "Imported from FLI Environmental historical records.",
    });

    if (jobError) {
      // project_number is unique — a duplicate just means it was already imported; not a real failure.
      if (jobError.message.includes("duplicate key")) {
        skipped++;
      } else {
        console.error(`Failed to create job ${row.projectNumber}:`, jobError.message);
        skipped++;
        skippedRows.push(row);
      }
      continue;
    }
    imported++;
  }

  console.log(`Imported ${imported} jobs, skipped ${skipped}.`);
  if (skippedRows.length) {
    console.log("Skipped rows:", JSON.stringify(skippedRows, null, 2));
  }
  return { imported, skipped };
}
