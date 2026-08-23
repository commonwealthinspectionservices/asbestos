import path from "path";
import { Document, Page, Text, View, Image, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import { primaryInspector } from "@/lib/settings";
import { formatDateMDY } from "@/lib/date-format";
import type { Job, Customer, Settings } from "@/lib/types";

const LETTERHEAD_PATH = path.join(process.cwd(), "public", "letterhead.png");
const BLANK_ROW_COUNT = 18;
const PAGE_TWO_ROW_COUNT = 20;

const styles = StyleSheet.create({
  page: { padding: 28, fontSize: 9, fontFamily: "Helvetica", color: "#16213a" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14, paddingBottom: 8, borderBottomWidth: 2, borderBottomColor: "#193466" },
  headerLeft: { flexDirection: "row", alignItems: "center" },
  letterhead: { width: 170, height: 31 },
  title: { fontSize: 11, fontWeight: 700 },
  metaGrid: { marginBottom: 10 },
  metaRow: { flexDirection: "row", marginBottom: 8, alignItems: "flex-end" },
  metaLabel: { fontWeight: 700, marginRight: 4 },
  metaValue: { flex: 1, borderBottomWidth: 1, borderBottomColor: "#16213a", marginRight: 16 },
  metaValueLast: { flex: 1, borderBottomWidth: 1, borderBottomColor: "#16213a" },
  metaValueWide: { flex: 1, borderBottomWidth: 1, borderBottomColor: "#16213a" },
  // flex: 1 (with a following sibling — footer below) so the table's rows
  // stretch to fill the page's remaining height, same proven pattern as
  // page2Table. Confirmed live: flex-grow on a *trailing* element (no
  // sibling after it) is unreliable in react-pdf's pagination pass — it
  // only reliably claims space when something follows it, which is why
  // this grows the table (before the footer) rather than the footer itself.
  table: { flex: 1, borderWidth: 1, borderColor: "#16213a" },
  tableHeaderRow: { flexDirection: "row", backgroundColor: "#f1f5f9", borderBottomWidth: 1, borderBottomColor: "#16213a" },
  tableHeaderCell: { fontSize: 8, fontWeight: 700, textAlign: "center", padding: 3, borderRightWidth: 1, borderRightColor: "#16213a" },
  tableRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#cbd5e1", minHeight: 25, flexGrow: 1 },
  colSample: { width: 60, borderRightWidth: 1, borderRightColor: "#16213a" },
  colMaterial: { flex: 1, borderRightWidth: 1, borderRightColor: "#16213a" },
  colLocation: { flex: 1 },
  footer: { marginTop: 16 },
  footerTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  turnaroundLine: { fontSize: 9, fontWeight: 700 },
  turnaroundOption: { fontWeight: 400 },
  notes: { fontSize: 8, fontStyle: "italic", textAlign: "right", lineHeight: 1.4 },
  dateNeededRow: { flexDirection: "row", alignItems: "flex-end", marginTop: 14 },
  dateNeededLabel: { fontSize: 9, fontWeight: 700, marginRight: 4 },
  dateNeededValue: { width: 220, borderBottomWidth: 1, borderBottomColor: "#16213a" },
  signatureRow: { flexDirection: "row", alignItems: "flex-end", marginTop: 26 },
  signatureLabel: { fontSize: 9, fontWeight: 700, marginRight: 4 },
  // Fixed width, not flex — RECEIVED BY's row has extra trailing content
  // (the date/time field, then PAGE) competing for space, which used to
  // leave its line shorter than RELINQUISHED BY's. A fixed width sized to
  // fit RECEIVED BY's more crowded row keeps both lines identical.
  signatureLine: { width: 330, borderBottomWidth: 1, borderBottomColor: "#16213a" },
  pageLabel: { fontSize: 9, fontWeight: 700, marginLeft: 16 },
  // marginBottom pulls the whole block down relative to the row's shared
  // flex-end baseline, so the slashes (top of this block) land AT that
  // baseline — level with the label text and underline — instead of
  // floating above it, and "date / time" hangs below the baseline instead.
  dateTimeWrap: { alignItems: "center", marginLeft: 10, marginBottom: -9 },
  dateTimeSlashes: { fontSize: 9, letterSpacing: 6 },
  dateTimeCaption: { fontSize: 6.5, color: "#64748b", marginTop: 2 },
  page2Table: { flex: 1, borderWidth: 1, borderColor: "#16213a", marginTop: 4 },
  page2Footer: { flexDirection: "row", justifyContent: "flex-end", alignItems: "flex-end", marginTop: 10 },
  page2FieldLabel: { fontSize: 9, fontWeight: 700, marginRight: 4 },
  page2FieldValue: { width: 120, borderBottomWidth: 1, borderBottomColor: "#16213a", marginRight: 20 },
});

// A pre-slashed date/time fill-in to the right of a signature line, exactly
// matching the owner's own real form (two bare "/" marks over a "date /
// time" caption — nothing fancier, no per-digit blanks).
function DateTimeField() {
  return (
    <View style={styles.dateTimeWrap}>
      <Text style={styles.dateTimeSlashes}>/  /</Text>
      <Text style={styles.dateTimeCaption}>date / time</Text>
    </View>
  );
}

export interface BlankCocData {
  // null for a generic, job-independent blank template — printed ahead of
  // time to keep on hand, filled in entirely by hand on-site rather than
  // pre-populated from a real job.
  job: Job | null;
  customer: Customer | null;
  settings: Settings;
}

function BlankCocDocument({ job, customer, settings }: BlankCocData) {
  const inspector = primaryInspector(settings);
  const clientLabel = customer ? customer.company || customer.name : "";
  return (
    <Document title={job ? `Chain of Custody — ${job.service_address}` : "Chain of Custody — Blank"}>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Image src={LETTERHEAD_PATH} style={styles.letterhead} />
          </View>
          <Text style={styles.title}>ASBESTOS BULK SAMPLE CHAIN OF CUSTODY</Text>
        </View>

        <View style={styles.metaGrid}>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>CLIENT</Text>
            <Text style={styles.metaValue}>{clientLabel}</Text>
            <Text style={styles.metaLabel}>PROJECT #</Text>
            <Text style={styles.metaValue}>{job?.project_number ?? ""}</Text>
            <Text style={styles.metaLabel}>DATE</Text>
            <Text style={styles.metaValueLast}>{formatDateMDY(job?.requested_date) ?? ""}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>SITE</Text>
            <Text style={styles.metaValueWide}>{job?.service_address ?? ""}</Text>
          </View>
        </View>

        <View style={styles.table}>
          <View style={styles.tableHeaderRow}>
            <Text style={[styles.tableHeaderCell, styles.colSample]}>SAMPLE #</Text>
            <Text style={[styles.tableHeaderCell, styles.colMaterial]}>MATERIAL</Text>
            <Text style={[styles.tableHeaderCell, styles.colLocation, { borderRightWidth: 0 }]}>LOCATION</Text>
          </View>
          {Array.from({ length: BLANK_ROW_COUNT }).map((_, i) => (
            <View style={styles.tableRow} key={i}>
              <View style={styles.colSample} />
              <View style={styles.colMaterial} />
              <View style={styles.colLocation} />
            </View>
          ))}
        </View>

        <View style={styles.footer}>
          <View style={styles.footerTopRow}>
            <Text style={styles.turnaroundLine}>
              TURNAROUND  <Text style={styles.turnaroundOption}>RUSH   24HR</Text>
            </Text>
            <View>
              <Text style={styles.notes}>*Samples for analysis by Polarized Light Microscopy</Text>
              <Text style={styles.notes}>
                *Sampled by {inspector.name} MA Asbestos Inspector License {inspector.license_number}
              </Text>
            </View>
          </View>

          <View style={styles.dateNeededRow}>
            <Text style={styles.dateNeededLabel}>DATE NEEDED</Text>
            <Text style={styles.dateNeededValue}>{job?.lab_date_needed ?? ""}</Text>
          </View>

          <View style={styles.signatureRow}>
            <Text style={styles.signatureLabel}>RELINQUISHED BY</Text>
            <Text style={styles.signatureLine} />
            <DateTimeField />
          </View>

          <View style={styles.signatureRow}>
            <Text style={styles.signatureLabel}>RECEIVED BY</Text>
            <Text style={styles.signatureLine} />
            <DateTimeField />
            <Text style={styles.pageLabel}>PAGE</Text>
            <Text style={[styles.signatureLine, { width: 70, marginLeft: 4 }]} />
          </View>
        </View>
      </Page>

      {/* Continuation sheet — same real form as page 1, for when a job has
          more samples than fit on the first page's table. No meta/signature
          fields here, just more rows plus the project #/page # a loose
          second sheet needs to stay identifiable. */}
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Image src={LETTERHEAD_PATH} style={styles.letterhead} />
          </View>
          <Text style={styles.title}>ASBESTOS BULK SAMPLE CHAIN OF CUSTODY</Text>
        </View>

        <View style={styles.page2Table}>
          <View style={styles.tableHeaderRow}>
            <Text style={[styles.tableHeaderCell, styles.colSample]}>SAMPLE #</Text>
            <Text style={[styles.tableHeaderCell, styles.colMaterial]}>MATERIAL</Text>
            <Text style={[styles.tableHeaderCell, styles.colLocation, { borderRightWidth: 0 }]}>LOCATION</Text>
          </View>
          {Array.from({ length: PAGE_TWO_ROW_COUNT }).map((_, i) => (
            <View style={styles.tableRow} key={i}>
              <View style={styles.colSample} />
              <View style={styles.colMaterial} />
              <View style={styles.colLocation} />
            </View>
          ))}
        </View>

        <View style={styles.page2Footer}>
          <Text style={styles.page2FieldLabel}>PROJECT #</Text>
          <Text style={styles.page2FieldValue}>{job?.project_number ?? ""}</Text>
          <Text style={styles.pageLabel}>PAGE</Text>
          <Text style={[styles.dateNeededValue, { width: 60, marginLeft: 4 }]} />
        </View>
      </Page>
    </Document>
  );
}

export async function renderBlankCocPdf(data: BlankCocData): Promise<Buffer> {
  return renderToBuffer(<BlankCocDocument {...data} />);
}
