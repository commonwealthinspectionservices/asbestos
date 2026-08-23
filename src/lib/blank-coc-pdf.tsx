import path from "path";
import { Document, Page, Text, View, Image, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import { primaryInspector } from "@/lib/settings";
import { formatDateMDY } from "@/lib/date-format";
import type { Job, Customer, Settings } from "@/lib/types";

// The owner's own real asbestos bulk sample form, deliberately kept as an
// exact pixel-level match — extracted the real letterhead image (own blue,
// not the app's navy brand color used everywhere else) and every spacing/
// font/row-count value straight from the owner's reference PDF, rather
// than the app's usual document styling. This form and the app's other
// documents are meant to look different; that's not a bug.
const LETTERHEAD_PATH = path.join(process.cwd(), "public", "letterhead-blue.png");
const BLANK_ROW_COUNT = 20;
const PAGE_TWO_ROW_COUNT = 24;
const LINE_COLOR = "#000000";

const styles = StyleSheet.create({
  page: { paddingTop: 15, paddingLeft: 12, paddingRight: 13, paddingBottom: 17, fontSize: 11, fontFamily: "Helvetica", color: "#000000" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  headerLeft: { flexDirection: "row", alignItems: "center" },
  letterhead: { width: 283, height: 55 },
  title: { fontSize: 11, fontWeight: 700 },
  metaGrid: { marginBottom: 14 },
  metaRow: { flexDirection: "row", marginBottom: 12, alignItems: "flex-end" },
  metaLabel: { fontWeight: 700, marginRight: 4 },
  metaValue: { flex: 1, borderBottomWidth: 1, borderBottomColor: LINE_COLOR, marginRight: 17 },
  metaValueLast: { flex: 1, borderBottomWidth: 1, borderBottomColor: LINE_COLOR },
  metaValueWide: { flex: 1, borderBottomWidth: 1, borderBottomColor: LINE_COLOR },
  // flex: 1 (with a following sibling — footer below) so the table's rows
  // stretch to fill the page's remaining height, same proven pattern as
  // page2Table. Confirmed live: flex-grow on a *trailing* element (no
  // sibling after it) is unreliable in react-pdf's pagination pass — it
  // only reliably claims space when something follows it, which is why
  // this grows the table (before the footer) rather than the footer itself.
  table: { flex: 1, borderWidth: 1, borderColor: LINE_COLOR },
  tableHeaderRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: LINE_COLOR },
  tableHeaderCell: { fontSize: 11, fontWeight: 700, textAlign: "center", padding: 5, borderRightWidth: 1, borderRightColor: LINE_COLOR },
  tableRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: LINE_COLOR, minHeight: 24, flexGrow: 1 },
  colSample: { width: 66, borderRightWidth: 1, borderRightColor: LINE_COLOR },
  colMaterial: { flex: 1, borderRightWidth: 1, borderRightColor: LINE_COLOR },
  colLocation: { flex: 1 },
  // One shared gap used below the table and between every footer row
  // (turnaround/notes, date needed, relinquished, received) — evenly
  // spaced rather than each row carrying its own hand-tuned margin.
  footer: { marginTop: 14 },
  footerTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  turnaroundLine: { flexDirection: "row", alignItems: "baseline" },
  turnaroundLabel: { fontSize: 11, fontWeight: 700 },
  turnaroundOption: { fontSize: 11, fontWeight: 400, marginLeft: 20 },
  notes: { fontSize: 11, fontStyle: "italic", textAlign: "right", lineHeight: 1.3 },
  dateNeededRow: { flexDirection: "row", alignItems: "flex-end", marginTop: 14 },
  dateNeededLabel: { fontSize: 11, fontWeight: 700, marginRight: 4 },
  // Short enough to stay clear of the right-aligned "*Sampled by..." note
  // sitting above it — the full 220pt width used to run underneath it.
  dateNeededValue: { width: 160, borderBottomWidth: 1, borderBottomColor: LINE_COLOR },
  signatureRow: { flexDirection: "row", alignItems: "flex-end", marginTop: 14 },
  signatureSubRow: { flexDirection: "row", alignItems: "flex-end" },
  // Fixed width (not auto-sized to the text) so "RELINQUISHED BY" and the
  // shorter "RECEIVED BY" both hand off to their line at the same x — the
  // two lines then start and end at identical points, and the date/time
  // overlaid on each (right-anchored within the line) lines up directly
  // above/below between the two rows instead of drifting with label length.
  signatureLabel: { fontSize: 11, fontWeight: 700, width: 112 },
  // Fixed width, not flex — RECEIVED BY's row has extra trailing content
  // (PAGE) competing for space, which used to leave its line shorter than
  // RELINQUISHED BY's. A fixed width sized to fit RECEIVED BY's more
  // crowded row keeps both lines identical.
  signatureLineWrap: { position: "relative", width: 320 },
  signatureLine: { borderBottomWidth: 1, borderBottomColor: LINE_COLOR },
  pageLabel: { fontSize: 11, fontWeight: 700, marginLeft: 16 },
  // The date/time sits ON the line itself — right-anchored inside the same
  // box the line occupies — rather than as its own element appended after
  // the line, matching the owner's real form exactly. bottom:-11 drops the
  // "date / time" caption below the line while the slashes above it land
  // right at the line.
  dateTimeOverlay: { position: "absolute", right: 4, bottom: -13, alignItems: "center" },
  dateTimeSlashes: { fontSize: 11, letterSpacing: 6 },
  dateTimeCaption: { fontSize: 7, color: "#000000", marginTop: 10 },
  page2Table: { flex: 1, borderWidth: 1, borderColor: LINE_COLOR, marginTop: 4 },
  page2Footer: { flexDirection: "row", justifyContent: "flex-end", alignItems: "flex-end", marginTop: 10 },
  page2FieldLabel: { fontSize: 11, fontWeight: 700, marginRight: 4 },
  page2FieldValue: { width: 120, borderBottomWidth: 1, borderBottomColor: LINE_COLOR, marginRight: 20 },
});

// A pre-slashed date/time fill-in overlaid on a signature line, exactly
// matching the owner's own real form (two bare "/" marks over a "date /
// time" caption, sitting on the line itself rather than after it).
function DateTimeField() {
  return (
    <View style={styles.dateTimeOverlay}>
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
  // The owner's on-file license number has no internal space
  // ("AI901405"), but his own real form always writes it "AI 901405" —
  // matched here for this one form rather than changing the stored value
  // everywhere else it's used.
  const licenseDisplay = inspector.license_number.replace(/^([A-Za-z]+)(\d+)$/, "$1 $2");
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
            <View style={styles.turnaroundLine}>
              <Text style={styles.turnaroundLabel}>TURNAROUND</Text>
              <Text style={styles.turnaroundOption}>RUSH</Text>
              <Text style={styles.turnaroundOption}>24HR</Text>
            </View>
            <View>
              <Text style={styles.notes}>*Samples for analysis by Polarized Light Microscopy</Text>
              <Text style={styles.notes}>
                *Sampled by {inspector.name} MA Asbestos Inspector License {licenseDisplay}
              </Text>
            </View>
          </View>

          <View style={styles.dateNeededRow}>
            <Text style={styles.dateNeededLabel}>DATE NEEDED</Text>
            <Text style={styles.dateNeededValue}>{job?.lab_date_needed ?? ""}</Text>
          </View>

          <View style={styles.signatureRow}>
            <Text style={styles.signatureLabel}>RELINQUISHED BY</Text>
            <View style={styles.signatureLineWrap}>
              <Text style={styles.signatureLine} />
              <DateTimeField />
            </View>
          </View>

          <View style={[styles.signatureRow, { justifyContent: "space-between" }]}>
            <View style={styles.signatureSubRow}>
              <Text style={styles.signatureLabel}>RECEIVED BY</Text>
              <View style={styles.signatureLineWrap}>
                <Text style={styles.signatureLine} />
                <DateTimeField />
              </View>
            </View>
            <View style={styles.signatureSubRow}>
              <Text style={styles.pageLabel}>PAGE</Text>
              <Text style={[styles.signatureLine, { width: 70, marginLeft: 4 }]} />
            </View>
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
