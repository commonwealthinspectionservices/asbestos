import path from "path";
import { Document, Page, Text, View, Image, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import { formatDateMDY } from "@/lib/date-format";
import type { Job, Customer, Settings } from "@/lib/types";

const LETTERHEAD_PATH = path.join(process.cwd(), "public", "letterhead.png");
const BLANK_ROW_COUNT = 18;
const PAGE_TWO_ROW_COUNT = 20;

export type MoldSampleType = "air_o_cell" | "bulk" | "swab";

// Same template as blank-coc-pdf.tsx's asbestos form, field-for-field —
// own letterhead, same meta/table/footer layout — just three variants of
// the sample table's third column, since a bulk material chunk and a
// surface swab don't have a "volume" the way an air sample does. Notes
// mirror the asbestos template's own "*Samples for analysis by..." line:
// Air-O-Cell samples are read by Spore Trap Analysis and are always a
// fixed 75ml (so that's a single note here rather than repeated down
// every one of BLANK_ROW_COUNT rows regardless of how many samples an
// actual job has); bulk and swab samples are both read by Direct
// Examination instead.
const SAMPLE_TYPE_CONFIG: Record<MoldSampleType, { title: string; thirdColumnLabel: string; notes: string[] }> = {
  air_o_cell: {
    title: "MOLD AIR-O-CELL SAMPLE CHAIN OF CUSTODY",
    thirdColumnLabel: "VOLUME",
    notes: ["*Samples for analysis by Spore Trap Analysis", "*Air-O-Cell samples are 75ml"],
  },
  bulk: {
    title: "MOLD BULK SAMPLE CHAIN OF CUSTODY",
    thirdColumnLabel: "MATERIAL",
    notes: ["*Samples for analysis by Direct Examination"],
  },
  swab: {
    title: "MOLD SWAB SAMPLE CHAIN OF CUSTODY",
    thirdColumnLabel: "SURFACE SWABBED",
    notes: ["*Samples for analysis by Direct Examination"],
  },
};

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
  // page2Table. flex-grow on a *trailing* element (no sibling after it) is
  // unreliable in react-pdf's pagination pass, confirmed live — it only
  // reliably claims space when something follows it.
  table: { flex: 1, borderWidth: 1, borderColor: "#16213a" },
  tableHeaderRow: { flexDirection: "row", backgroundColor: "#f1f5f9", borderBottomWidth: 1, borderBottomColor: "#16213a" },
  tableHeaderCell: { fontSize: 8, fontWeight: 700, textAlign: "center", padding: 3, borderRightWidth: 1, borderRightColor: "#16213a" },
  tableRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#cbd5e1", minHeight: 25, flexGrow: 1 },
  colSample: { width: 60, borderRightWidth: 1, borderRightColor: "#16213a" },
  colThird: { flex: 1, borderRightWidth: 1, borderRightColor: "#16213a" },
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

// Matches the owner's own real form exactly — two bare "/" marks over a
// "date / time" caption, not per-digit blanks.
function DateTimeField() {
  return (
    <View style={styles.dateTimeWrap}>
      <Text style={styles.dateTimeSlashes}>/  /</Text>
      <Text style={styles.dateTimeCaption}>date / time</Text>
    </View>
  );
}

export interface MoldCocData {
  // null for a generic, job-independent blank template — see
  // blank-coc-pdf.tsx's BlankCocData for the same pattern.
  job: Job | null;
  customer: Customer | null;
  settings: Settings;
  sampleType: MoldSampleType;
}

function MoldCocDocument({ job, customer, settings, sampleType }: MoldCocData) {
  const config = SAMPLE_TYPE_CONFIG[sampleType];
  const clientLabel = customer ? customer.company || customer.name : "";
  return (
    <Document title={job ? `${config.title} — ${job?.service_address ?? ""}` : `${config.title} — Blank`}>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Image src={LETTERHEAD_PATH} style={styles.letterhead} />
          </View>
          <Text style={styles.title}>{config.title}</Text>
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
            <Text style={[styles.tableHeaderCell, styles.colThird]}>{config.thirdColumnLabel}</Text>
            <Text style={[styles.tableHeaderCell, styles.colLocation, { borderRightWidth: 0 }]}>LOCATION</Text>
          </View>
          {Array.from({ length: BLANK_ROW_COUNT }).map((_, i) => (
            <View style={styles.tableRow} key={i}>
              <View style={styles.colSample} />
              <View style={styles.colThird} />
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
              {config.notes.map((note) => (
                <Text style={styles.notes} key={note}>{note}</Text>
              ))}
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

      {/* Continuation sheet, same as blank-coc-pdf.tsx's asbestos one — more
          rows, no meta/signature fields, just enough to stay identifiable. */}
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Image src={LETTERHEAD_PATH} style={styles.letterhead} />
          </View>
          <Text style={styles.title}>{config.title}</Text>
        </View>

        <View style={styles.page2Table}>
          <View style={styles.tableHeaderRow}>
            <Text style={[styles.tableHeaderCell, styles.colSample]}>SAMPLE #</Text>
            <Text style={[styles.tableHeaderCell, styles.colThird]}>{config.thirdColumnLabel}</Text>
            <Text style={[styles.tableHeaderCell, styles.colLocation, { borderRightWidth: 0 }]}>LOCATION</Text>
          </View>
          {Array.from({ length: PAGE_TWO_ROW_COUNT }).map((_, i) => (
            <View style={styles.tableRow} key={i}>
              <View style={styles.colSample} />
              <View style={styles.colThird} />
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

export async function renderMoldCocPdf(data: MoldCocData): Promise<Buffer> {
  return renderToBuffer(<MoldCocDocument {...data} />);
}
