import path from "path";
import { Document, Page, Text, View, Image, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import type { Style } from "@react-pdf/types";
import { splitAddress } from "@/lib/address";
import type { Job, Customer, Settings } from "@/lib/types";

const LETTERHEAD_PATH = path.join(process.cwd(), "public", "letterhead.png");
const SIGNATURE_PATH = path.join(process.cwd(), "public", "signature.png");

// Matches the real FLI letter (measured off an actual exported PDF: 10pt
// Times New Roman body text, ~12.8pt line-to-line spacing, 69pt left/right
// margins, two tiers of paragraph spacing — a wide ~12pt gap between most
// blocks and a tight ~4pt gap between a section title and its own content).
// The header keeps Helvetica branding, styled separately rather than
// inheriting the body font.
const STANDARD_GAP = 12;
const TIGHT_GAP = 4;

const styles = StyleSheet.create({
  page: { paddingTop: 30, paddingBottom: 32, paddingHorizontal: 69, fontSize: 10, fontFamily: "Times-Roman", color: "#16213a", lineHeight: 1.28 },
  header: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 18, paddingBottom: 12, borderBottomWidth: 2, borderBottomColor: "#193466" },
  headerLeft: { flexDirection: "row", alignItems: "center" },
  letterhead: { width: 210, height: 39 },
  headerRight: { alignItems: "flex-end" },
  headerRightLine: { fontFamily: "Helvetica", fontSize: 8.5, color: "#193466", marginBottom: 2 },
  recipientRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 0 },
  recipient: { marginBottom: 0 },
  recipientBlock: { marginBottom: STANDARD_GAP },
  dateLine: {},
  reBlock: { marginBottom: STANDARD_GAP },
  reRow: { flexDirection: "row" },
  reLabel: { width: 27 },
  reProjectLabel: { width: 75 },
  reValue: { flex: 1 },
  salutation: { marginBottom: STANDARD_GAP },
  paragraph: { marginBottom: STANDARD_GAP, textAlign: "justify" },
  sectionTitle: { fontWeight: 700, marginBottom: STANDARD_GAP, textDecoration: "underline" },
  sectionTitleTight: { fontWeight: 700, marginBottom: TIGHT_GAP, textDecoration: "underline" },
  summaryBlock: { marginBottom: STANDARD_GAP },
  summaryRow: { flexDirection: "row", marginLeft: 101 },
  summaryLabel: { width: 123, textAlign: "right", marginRight: 21, color: "#334155" },
  summaryValue: { flex: 1 },
  blankLine: { flex: 0, minWidth: 130, borderBottomWidth: 1, borderBottomColor: "#94a3b8" },
  blankLineInline: { flex: 0, minWidth: 70, borderBottomWidth: 1, borderBottomColor: "#94a3b8" },
  listBlock: { marginBottom: STANDARD_GAP - TIGHT_GAP },
  listItem: { flexDirection: "row", marginBottom: TIGHT_GAP, paddingLeft: 4 },
  listIndex: { width: 16 },
  listText: { flex: 1, textAlign: "justify" },
  // The positive/negative sentence both wrap to ~2 lines at this width;
  // "NO RESULTS YET." on its own is one short line. Reserving 2 lines'
  // worth of height for this one remark specifically keeps the letter's
  // overall shape identical before and after lab results come in — the
  // page shouldn't visibly reflow just because this one line got longer.
  resultRemarkText: { flex: 1, textAlign: "justify", minHeight: 10 * 1.28 * 2 },
  signatureBlock: { marginTop: 0 },
  // Matches the extracted signature's own 475x164 aspect ratio (~2.9:1).
  signatureImage: { width: 85, height: 29.3, marginTop: 3, marginBottom: 1 },
  signatureLine: { marginBottom: 1 },
  signatureName: { fontWeight: 700, fontStyle: "italic", marginBottom: 1 },
});

export interface ProjectReportData {
  job: Job;
  customer: Customer;
  settings: Settings;
}

// Renders a blank underline instead of a value when the underlying field
// hasn't been entered yet — a job with no lab results in yet still gets a
// complete, printable preview shape, with blanks that visibly still need
// filling rather than a "—" that reads as "confirmed nothing" or a line
// that's silently missing altogether.
function ValueOrBlank({ value, style, inline }: { value: string | number | null | undefined; style: Style; inline?: boolean }) {
  if (value === null || value === undefined || value === "" || value === 0) {
    return <Text style={[style, inline ? styles.blankLineInline : styles.blankLine]}> </Text>;
  }
  return <Text style={style}>{value}</Text>;
}

function ProjectReportDocument({ job, customer, settings }: ProjectReportData) {
  // Lab report uploads populate sample_counts (one entry per service type on
  // the job), not the older single sample_count field — sum every entry for
  // the letter's one combined total, falling back to sample_count only for
  // jobs from before that per-type tracking existed.
  const sampleCountsTotal = Object.values(job.sample_counts ?? {}).reduce((sum, n) => sum + (n || 0), 0);
  const totalSamples = sampleCountsTotal > 0 ? sampleCountsTotal : job.sample_count ?? 0;
  // Reports go to the contractor (whoever booked/pays), not the on-site
  // homeowner — site_contact is for scheduling coordination only.
  const remarks = [
    "Sampling was limited to the specific materials and areas identified by the client. Additional suspect materials may be present and if discovered during building renovation, maintenance, or demolition, should be sampled and analyzed for asbestos content prior to disturbing.",
  ];
  // Index of whichever remark depends on the (possibly still-pending) lab
  // result — always the 2nd item — so its render can reserve the same
  // vertical space regardless of which of the 3 possible messages it is.
  const resultRemarkIndex = remarks.length;
  if (job.asbestos_result === "positive") {
    remarks.push(
      "Each identified asbestos containing material must be removed by a licensed asbestos abatement contractor prior to being disturbed by building maintenance, renovation or demolition activities."
    );
  } else if (job.asbestos_result === "negative") {
    remarks.push(
      "None of the suspect materials sampled were determined to have asbestos fibers present when analyzed by Polarized Light Microscopy."
    );
  } else {
    remarks.push("NO RESULTS YET.");
  }
  if (job.report_summary) remarks.push(job.report_summary);
  if (job.report_notes) remarks.push(job.report_notes);

  // "Unknown contact" is the app's own fallback customer.name (see
  // POST /api/admin/jobs) for a job created with no real contact given —
  // a real, non-blank string, so ValueOrBlank's own null/empty check
  // wouldn't catch it. Treated as blank everywhere it'd otherwise print
  // that placeholder verbatim ("Dear Unknown contact:").
  const knownCustomerName = customer.name === "Unknown contact" ? null : customer.name;

  const dateText = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  // Street and "City, State Zip" on their own line — a naive comma-split
  // put city and state/zip on two separate short lines with no comma
  // between them ("Westwood" / "MA 02090"), which read as choppy and
  // cramped in the header's small right-aligned column.
  const baseAddress = splitAddress(settings.base_address);
  const addressLines = [baseAddress.street, baseAddress.cityStateZip].filter(Boolean);

  // Town/state/zip always gets its own line under the street, matching the
  // real FLI letter's recipient block and RE: block — both the customer's
  // billing address and the job site address get the same treatment.
  const billing = splitAddress(customer.billing_address);
  const billingStreet = billing.locationName ? `${billing.locationName} ${billing.street}` : billing.street;
  const service = splitAddress(job.service_address);
  const serviceStreet = service.locationName ? `${service.locationName} ${service.street}` : service.street;

  return (
    <Document title={`Bulk Sample Analytical Results — ${job.service_address}`}>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Image src={LETTERHEAD_PATH} style={styles.letterhead} />
          </View>
          <View style={styles.headerRight}>
            {addressLines.map((line, i) => (
              <Text key={i} style={styles.headerRightLine}>{line}</Text>
            ))}
            {settings.business_phone && <Text style={styles.headerRightLine}>Phone: {settings.business_phone}</Text>}
          </View>
        </View>

        <View style={styles.recipientBlock}>
          <View style={styles.recipientRow}>
            <ValueOrBlank style={styles.recipient} value={knownCustomerName} inline />
            <Text style={styles.dateLine}>{dateText}</Text>
          </View>
          {customer.company && <Text style={styles.recipient}>{customer.company}</Text>}
          <ValueOrBlank style={styles.recipient} value={billingStreet} inline />
          <ValueOrBlank style={styles.recipient} value={billing.cityStateZip} inline />
        </View>

        <View style={styles.reBlock}>
          <View style={styles.reRow}>
            <Text style={styles.reLabel}>RE:</Text>
            <Text style={styles.reValue}>Bulk Sample Analytical Results</Text>
          </View>
          <View style={styles.reRow}>
            <Text style={styles.reLabel} />
            <ValueOrBlank style={styles.reValue} value={serviceStreet} inline />
          </View>
          <View style={styles.reRow}>
            <Text style={styles.reLabel} />
            <ValueOrBlank style={styles.reValue} value={service.cityStateZip} inline />
          </View>
          <View style={styles.reRow}>
            <Text style={styles.reLabel} />
            <Text style={styles.reProjectLabel}>Project #:</Text>
            <ValueOrBlank style={styles.reValue} value={job.project_number} inline />
          </View>
        </View>

        <Text style={styles.salutation}>Dear <ValueOrBlank style={styles.salutation} value={knownCustomerName} inline />:</Text>

        <Text style={styles.paragraph}>
          {settings.business_name} collected samples of specific materials from the address noted above. Samples were
          transported under chain-of-custody protocol to an accredited laboratory for analysis.
        </Text>

        <Text style={styles.sectionTitleTight}>Sampling Summary:</Text>
        <View style={styles.summaryBlock}>
          <View style={styles.summaryRow}><Text style={styles.summaryLabel}>Date of Sampling:</Text><ValueOrBlank style={styles.summaryValue} value={job.requested_date} /></View>
          <View style={styles.summaryRow}><Text style={styles.summaryLabel}>Total # of Samples:</Text><ValueOrBlank style={styles.summaryValue} value={totalSamples} /></View>
          <View style={styles.summaryRow}><Text style={styles.summaryLabel}>Samples Analyzed At:</Text><ValueOrBlank style={styles.summaryValue} value={job.lab_name} /></View>
          <View style={styles.summaryRow}><Text style={styles.summaryLabel}>NIST/NVLAP Certification#:</Text><ValueOrBlank style={styles.summaryValue} value={job.lab_nist_cert} /></View>
          <View style={styles.summaryRow}><Text style={styles.summaryLabel}>MassDLS Lab Certification#:</Text><ValueOrBlank style={styles.summaryValue} value={job.lab_massdls_cert} /></View>
        </View>

        <Text style={styles.paragraph}>
          Bulk samples were collected and submitted via chain of custody to the analytical laboratory by {settings.business_name}.
          The samples were analyzed by Polarized Light Microscopy per EPA Method 600/R-93-116. Any homogeneous material having
          at least one sample analyzed to contain greater than one percent (1%) asbestos is categorized as an
          asbestos-containing material. Homogeneous materials where each sample analyzed was determined not to contain
          asbestos are categorized as non-asbestos. Laboratory Analytical Data Sheets are attached and provide details about
          each sample collected.
        </Text>

        <Text style={styles.sectionTitle}>Remarks and Limitations:</Text>
        <View style={styles.listBlock}>
          {remarks.map((text, i) => (
            <View style={styles.listItem} key={i}>
              <Text style={styles.listIndex}>{i + 1}.</Text>
              <Text style={i === resultRemarkIndex ? styles.resultRemarkText : styles.listText}>{text}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.paragraph}>
          Should you have any questions or need additional information, please contact our office. Thank you for the
          opportunity to provide you with our services and we look forward to working together in the future.
        </Text>

        <View style={styles.signatureBlock}>
          <Text style={styles.signatureLine}>Sincerely,</Text>
          <Text style={styles.signatureName}>{settings.business_name}</Text>
          <Image src={SIGNATURE_PATH} style={styles.signatureImage} />
          <Text style={styles.signatureLine}>{settings.owner_name}</Text>
          <Text style={styles.signatureLine}>{settings.owner_title}{settings.license_number ? ` — License #${settings.license_number}` : ""}</Text>
        </View>
      </Page>
    </Document>
  );
}

export async function renderProjectReportPdf(data: ProjectReportData): Promise<Buffer> {
  return renderToBuffer(<ProjectReportDocument {...data} />);
}
