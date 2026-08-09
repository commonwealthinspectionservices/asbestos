import path from "path";
import ExcelJS from "exceljs";
import type { Job, Customer } from "@/lib/types";
import { splitAddress } from "@/lib/address";
import { ASBESTOS_POSITIVE_REMARK, ASBESTOS_NEGATIVE_REMARK, domainForServiceTypeLabel } from "@/lib/report-findings";

const TEMPLATE_PATH = path.join(process.cwd(), "src", "lib", "templates", "asbestos-limited-template.xlsm");

// Matches the exact wording in the template's own "Dropdowns" sheet — the
// same two outcomes the PDF report's Remark #2 branches on (see
// report-pdf.tsx). Left untouched (whatever the template already has) when
// asbestos_result hasn't been determined yet, rather than guessing.
const POSITIVE_REMARK = ASBESTOS_POSITIVE_REMARK;
const NEGATIVE_REMARK = ASBESTOS_NEGATIVE_REMARK;

// The "RE:"/recipient block is a fixed 4-line grid (company, contact name,
// street, city/state/zip) — when there's no company on file, the remaining
// three lines shift up rather than leaving a blank line in the middle.
function recipientLines(customer: Customer): [string, string, string, string] {
  const { street, cityStateZip } = splitAddress(customer.billing_address);
  const lines = customer.company
    ? [customer.company, customer.name, street, cityStateZip]
    : [customer.name, street, cityStateZip, ""];
  return [lines[0] ?? "", lines[1] ?? "", lines[2] ?? "", lines[3] ?? ""];
}

export interface ProjectXlsmData {
  job: Job;
  customer: Customer;
}

// Fills in the same "Asbestos Limited Template.xlsm" the admin already uses
// day to day — job-specific fields only (customer, addresses, project #,
// lab info, sample rows, the positive/negative remark). The static company
// boilerplate (letterhead logo/address/phone, sign-off signature) is already
// Commonwealth's own — the template itself was rebranded from the original
// FLI Environmental source file, not something this function touches.
export async function renderProjectXlsm({ job, customer }: ProjectXlsmData): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(TEMPLATE_PATH);

  const report = workbook.getWorksheet("Report");
  const coc = workbook.getWorksheet("COC");
  if (!report || !coc) {
    throw new Error("Template is missing its Report or COC sheet");
  }

  const [line1, line2, line3, line4] = recipientLines(customer);
  report.getCell("B3").value = line1;
  report.getCell("B4").value = line2;
  report.getCell("B5").value = line3;
  report.getCell("B6").value = line4;
  report.getCell("C13").value = customer.name ? `${customer.name}:` : "";

  report.getCell("H21").value = job.lab_name ?? "";
  report.getCell("H22").value = job.lab_nist_cert ?? "";
  report.getCell("H23").value = job.lab_massdls_cert ?? "";

  if (job.asbestos_result === "positive") {
    report.getCell("C30").value = POSITIVE_REMARK;
  } else if (job.asbestos_result === "negative") {
    report.getCell("C30").value = NEGATIVE_REMARK;
  }

  coc.getCell("F4").value = job.project_number ?? "";
  coc.getCell("B5").value = customer.company || customer.name;
  if (job.requested_date) {
    coc.getCell("F5").value = new Date(`${job.requested_date}T00:00:00`);
  }
  const site = splitAddress(job.service_address);
  coc.getCell("B6").value = site.locationName ? `${site.locationName} ${site.street}` : site.street;
  coc.getCell("B7").value = site.cityStateZip;

  // One "x" placeholder per sample, same as the admin's own real completed
  // COC sheets — the Report sheet's Total # of Samples is a COUNTA over
  // B10:B29 regardless of what's actually typed in each row. This template
  // is asbestos-only, so a job that also has e.g. a mold component must not
  // count that domain's samples here.
  const sampleCountsTotal = Object.entries(job.sample_counts ?? {})
    .filter(([label]) => domainForServiceTypeLabel(label) === "asbestos")
    .reduce((sum, [, n]) => sum + (n || 0), 0);
  const totalSamples = sampleCountsTotal > 0 ? sampleCountsTotal : job.sample_count ?? 0;
  const rowCount = Math.min(totalSamples, 20);
  for (let i = 0; i < rowCount; i++) {
    coc.getCell(`B${10 + i}`).value = "x";
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
