import fs from "fs";
import path from "path";
import os from "os";

// Run every 15 min by the com.commonwealthinspection.sync-final-reports
// LaunchAgent (see sync-final-reports.sh, which exports .env.local into
// this process's environment before invoking it) — keeps a local,
// always-current copy of every job's final sent report(s) on the Desktop,
// one folder per domain ("Final Asbestos Reports", "Final Mold Reports",
// "Final Lead Reports"), named exactly like the emailed attachment
// (reportEmailAttachmentFilename) so a file here is recognizable as the
// same document a customer received. Only jobs whose report has actually
// been sent (report_sent_at set) — a job still in draft has nothing
// "final" to sync yet.

const { getSupabaseAdmin } = await import("../src/lib/supabase");
const { buildAllFinalReportPackets } = await import("../src/lib/report-packet");
const { reportEmailAttachmentFilename } = await import("../src/lib/report-findings");
const { withCompanyBillingAddress } = await import("../src/lib/customer-billing");
const { getSettings } = await import("../src/lib/settings");
import type { Company, Customer, Job } from "../src/lib/types";

const supabase = getSupabaseAdmin();
const settings = await getSettings();

const { data: jobs, error } = await supabase
  .from("jobs")
  .select("*, customers!customer_id(*, companies!company_id(*))")
  .not("report_sent_at", "is", null);

if (error) {
  console.error("Failed to load jobs:", error.message);
  process.exit(1);
}

let synced = 0;
let skipped = 0;

for (const jobRow of jobs ?? []) {
  const job = jobRow as unknown as Job & { customers: Customer & { companies: Company | null } };
  try {
    const customer = withCompanyBillingAddress(job.customers, job.customers.companies);
    const packets = await buildAllFinalReportPackets(job, customer, settings);
    for (const { domain, buffer } of packets) {
      const folderLabel = domain.charAt(0).toUpperCase() + domain.slice(1);
      const folder = path.join(os.homedir(), "Desktop", `Final ${folderLabel} Reports`);
      fs.mkdirSync(folder, { recursive: true });
      const fileName = reportEmailAttachmentFilename(job.project_number, job.id, domain);
      fs.writeFileSync(path.join(folder, fileName), buffer);
      synced++;
    }
  } catch (e) {
    console.error(`Skipped ${job.project_number ?? job.id}:`, e);
    skipped++;
  }
}

console.log(`Synced ${synced} report file(s), skipped ${skipped} job(s) with an error.`);
