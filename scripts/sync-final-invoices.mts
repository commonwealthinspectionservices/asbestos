import fs from "fs";
import path from "path";
import os from "os";

// Run every 15 min by the com.commonwealthinspection.sync-final-invoices
// LaunchAgent (see sync-final-invoices.sh) — the invoice counterpart to
// sync-final-reports.mts, same structure and same reasoning: a local,
// always-current copy of every job's sent invoice on the Desktop, named
// exactly like the emailed attachment ("26-0007 Invoice.pdf") so a file
// here is recognizable as the same document a customer received. Only
// jobs whose invoice has actually been sent (invoice_sent_at set).

const { getSupabaseAdmin } = await import("../src/lib/supabase");
const { renderInvoicePdf } = await import("../src/lib/invoice-pdf");
const { withCompanyBillingAddress } = await import("../src/lib/customer-billing");
const { getSettings } = await import("../src/lib/settings");
import type { Company, Customer, Job } from "../src/lib/types";

const supabase = getSupabaseAdmin();
const settings = await getSettings();

const { data: jobs, error } = await supabase
  .from("jobs")
  .select("*, customers!customer_id(*, companies!company_id(*))")
  .not("invoice_sent_at", "is", null);

if (error) {
  console.error("Failed to load jobs:", error.message);
  process.exit(1);
}

const folder = path.join(os.homedir(), "Desktop", "Final Invoices");
fs.mkdirSync(folder, { recursive: true });

let synced = 0;
let skipped = 0;

for (const jobRow of jobs ?? []) {
  const job = jobRow as unknown as Job & { customers: Customer & { companies: Company | null } };
  try {
    const customer = withCompanyBillingAddress(job.customers, job.customers.companies);
    const buffer = await renderInvoicePdf({ job, customer, company: job.customers.companies, settings });
    const fileName = `${job.project_number ?? job.id} Invoice.pdf`;
    fs.writeFileSync(path.join(folder, fileName), buffer);
    synced++;
  } catch (e) {
    console.error(`Skipped ${job.project_number ?? job.id}:`, e);
    skipped++;
  }
}

console.log(`Synced ${synced} invoice file(s), skipped ${skipped} job(s) with an error.`);
