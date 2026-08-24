import path from "path";
import { Document, Page, Text, View, Image, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import { formatDateMDY } from "@/lib/date-format";
import type { Job, Customer, Settings } from "@/lib/types";

// Same exact template as blank-coc-pdf.tsx's asbestos form — own blue
// letterhead, same spacing/font/row-count values, same footer layout —
// just three variants of the sample table's third column and notes, since
// a bulk material chunk and a surface swab don't have a "volume" the way
// an air sample does, and mold has no inspector-license line the way
// asbestos does.
const LETTERHEAD_PATH = path.join(process.cwd(), "public", "letterhead-blue.png");
const LINE_COLOR = "#000000";
// Single-side borders (borderBottomWidth/borderRightWidth used alone, as
// almost every line on this form is) render roughly 2x their declared
// width in react-pdf — confirmed by comparing rendered stroke width against
// the table's own all-sides borderWidth, which renders at its literal
// value. Declaring those at 0.5 here makes every line on the page the same
// visual weight instead of the table's outer box looking thinner than
// everything inside it.

export type MoldSampleType = "air_o_cell" | "bulk" | "swab";

// turnaroundNote (if any) sits beside TURNAROUND, dateNeededNote (if any)
// beside DATE NEEDED — same split blank-coc-pdf.tsx uses for its two
// notes. Air-O-Cell has both: Spore Trap Analysis beside TURNAROUND, and
// the fixed-75ml note beside DATE NEEDED (worth noting once rather than
// on every row regardless of how many samples an actual job has). Bulk
// and swab only have the one Direct Examination note, and it goes beside
// DATE NEEDED — TURNAROUND renders alone (see the signature row below).
//
// rowCount is 10 for every mold sample type — real mold jobs never pull
// anywhere near the 20 samples the asbestos form is sized for, so the
// table (flex:1, fills whatever's left on the page) stretches each row
// roughly twice as tall instead of leaving half the rows unused. No
// continuation page either — 10 rows is already more than a real mold
// job needs, unlike the asbestos form's own two-page design.
// thirdColumnLabel is null for Air-O-Cell — every sample is the same
// fixed 75ml (see dateNeededNote below), so a per-row VOLUME column would
// just repeat that on every line. Table collapses to SAMPLE #/LOCATION
// only, with LOCATION taking the full remaining width.
const SAMPLE_TYPE_CONFIG: Record<MoldSampleType, { title: string; thirdColumnLabel: string | null; turnaroundNote: string | null; dateNeededNote: string | null; rowCount: number }> = {
  air_o_cell: {
    title: "MOLD AIR-O-CELL SAMPLE CHAIN OF CUSTODY",
    thirdColumnLabel: null,
    turnaroundNote: "*Samples for analysis by Spore Trap Analysis",
    dateNeededNote: "*The volume for all Air-O-Cell samples is 75ml",
    rowCount: 10,
  },
  bulk: {
    title: "MOLD BULK SAMPLE CHAIN OF CUSTODY",
    thirdColumnLabel: "MATERIAL",
    turnaroundNote: null,
    dateNeededNote: "*Samples for analysis by Direct Examination",
    rowCount: 10,
  },
  swab: {
    title: "MOLD SWAB SAMPLE CHAIN OF CUSTODY",
    thirdColumnLabel: "SURFACE SWABBED",
    turnaroundNote: null,
    dateNeededNote: "*Samples for analysis by Direct Examination",
    rowCount: 10,
  },
};

const styles = StyleSheet.create({
  // paddingBottom has to clear more than the last row's own text — the
  // date/time overlay on RECEIVED BY's line reaches ~14pt below it
  // (position:absolute, so it isn't counted in normal-flow layout at all),
  // and too little padding here let it get clipped by the page edge.
  page: { paddingTop: 10, paddingLeft: 12, paddingRight: 13, paddingBottom: 18, fontSize: 11, fontFamily: "Helvetica", color: "#000000" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 11 },
  headerLeft: { flexDirection: "row", alignItems: "center" },
  letterhead: { width: 283, height: 55 },
  // Stacked under the title, not its own footer line — the header row's
  // height is set by the 55pt letterhead image, so this fits inside it
  // for free without shrinking the table (which claims whatever's left).
  titleBlock: { alignItems: "flex-end" },
  title: { fontSize: 11, fontWeight: 700 },
  emailNote: { fontSize: 8, fontStyle: "italic", marginTop: 3 },
  // Two rows: CLIENT+DATE, then SITE+PROJECT # directly under it. SITE
  // sits close under the table (small marginBottom here) but well clear
  // of the row above it (metaBottomRow carries its own marginTop instead).
  metaGrid: { marginBottom: 8 },
  metaTopRow: { flexDirection: "row", alignItems: "flex-end", marginBottom: 12 },
  metaBottomRow: { flexDirection: "row", alignItems: "flex-end", marginTop: 14 },
  // Fixed width + right-align so "CLIENT" and "SITE" end at the same x,
  // same trick as metaLabelRight for DATE/PROJECT #.
  metaLabel: { width: 50, textAlign: "right", fontWeight: 700, marginRight: 4 },
  // CLIENT/SITE share this — a flexible field that fills whatever's left
  // once the fixed-width DATE/PROJECT # column (metaRightField) is placed.
  metaLeftField: { flex: 1, flexDirection: "row", alignItems: "flex-end" },
  metaLeftValue: { flex: 1, borderBottomWidth: 0.5, borderBottomColor: LINE_COLOR, marginRight: 20 },
  // PROJECT # sits directly under DATE — same fixed width both rows, so
  // their lines end up the exact same length; the label itself is right-
  // aligned within a shared fixed width so "DATE" and "PROJECT #" end at
  // the same x (their last letter/character lining up) regardless of the
  // two labels being different lengths.
  metaRightField: { width: 190, flexDirection: "row", alignItems: "flex-end" },
  metaLabelRight: { width: 65, textAlign: "right", fontWeight: 700, marginRight: 4 },
  metaValueRight: { flex: 1, borderBottomWidth: 0.5, borderBottomColor: LINE_COLOR },
  // flex: 1 (with a following sibling — footer below) so the table's rows
  // stretch to fill the page's remaining height. Confirmed live: flex-grow
  // on a *trailing* element (no sibling after it) is unreliable in
  // react-pdf's pagination pass — it only reliably claims space when
  // something follows it, which is why this grows the table (before the
  // footer) rather than the footer itself.
  table: { flex: 1, borderWidth: 1, borderColor: LINE_COLOR },
  tableHeaderRow: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: LINE_COLOR },
  tableHeaderCell: { fontSize: 11, fontWeight: 700, textAlign: "center", padding: 5, borderRightWidth: 0.5, borderRightColor: LINE_COLOR },
  tableRow: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: LINE_COLOR, minHeight: 20, flexGrow: 1 },
  colSample: { width: 66, borderRightWidth: 0.5, borderRightColor: LINE_COLOR },
  colThird: { flex: 1, borderRightWidth: 0.5, borderRightColor: LINE_COLOR },
  colLocation: { flex: 1 },
  // Matches the asbestos form's own gaps below the table — not perfectly
  // uniform, that's genuinely how the real form is spaced.
  footer: { marginTop: 18 },
  footerTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
  turnaroundLine: { flexDirection: "row", alignItems: "baseline" },
  turnaroundLabel: { fontSize: 11, fontWeight: 700 },
  turnaroundOption: { fontSize: 11, fontWeight: 400, marginLeft: 20 },
  notes: { fontSize: 11, fontStyle: "italic" },
  dateNeededRow: { flexDirection: "row", alignItems: "flex-end", marginTop: 24 },
  dateNeededLabel: { fontSize: 11, fontWeight: 700, marginRight: 4 },
  dateNeededValue: { width: 220, borderBottomWidth: 0.5, borderBottomColor: LINE_COLOR },
  signatureRow: { flexDirection: "row", alignItems: "flex-end", marginTop: 24 },
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
  signatureLine: { borderBottomWidth: 0.5, borderBottomColor: LINE_COLOR },
  pageLabel: { fontSize: 11, fontWeight: 700, marginLeft: 16 },
  // The date/time sits ON the line itself — right-anchored inside the same
  // box the line occupies — rather than as its own element appended after
  // the line, matching the asbestos form exactly. bottom:-13 drops the
  // "date / time" caption below the line while the slashes above it hover
  // just clear of the line itself.
  dateTimeOverlay: { position: "absolute", right: 45, bottom: -13, alignItems: "center" },
  dateTimeSlashes: { fontSize: 11, letterSpacing: 6 },
  dateTimeCaption: { fontSize: 8, color: "#000000", marginTop: 10 },
});

// A pre-slashed date/time fill-in overlaid on a signature line, exactly
// matching the asbestos form (two bare "/" marks over a "date / time"
// caption, sitting on the line itself rather than after it).
function DateTimeField() {
  return (
    <View style={styles.dateTimeOverlay}>
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

function MoldCocDocument({ job, customer, sampleType }: MoldCocData) {
  const config = SAMPLE_TYPE_CONFIG[sampleType];
  const clientLabel = customer ? customer.company || customer.name : "";
  return (
    <Document title={job ? `${config.title} — ${job.service_address}` : `${config.title} — Blank`}>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Image src={LETTERHEAD_PATH} style={styles.letterhead} />
          </View>
          <View style={styles.titleBlock}>
            <Text style={styles.title}>{config.title}</Text>
            <Text style={styles.emailNote}>Please email all results to tim@commonwealthinspectionservices.com</Text>
          </View>
        </View>

        <View style={styles.metaGrid}>
          <View style={styles.metaTopRow}>
            <View style={styles.metaLeftField}>
              <Text style={styles.metaLabel}>CLIENT</Text>
              <Text style={styles.metaLeftValue}>{clientLabel}</Text>
            </View>
            <View style={styles.metaRightField}>
              <Text style={styles.metaLabelRight}>DATE</Text>
              <Text style={styles.metaValueRight}>{formatDateMDY(job?.requested_date) ?? ""}</Text>
            </View>
          </View>
          <View style={styles.metaBottomRow}>
            <View style={styles.metaLeftField}>
              <Text style={styles.metaLabel}>SITE</Text>
              <Text style={styles.metaLeftValue}>{job?.service_address ?? ""}</Text>
            </View>
            <View style={styles.metaRightField}>
              <Text style={styles.metaLabelRight}>PROJECT #</Text>
              <Text style={styles.metaValueRight}>{job?.project_number ?? ""}</Text>
            </View>
          </View>
        </View>

        <View style={styles.table}>
          <View style={styles.tableHeaderRow}>
            <Text style={[styles.tableHeaderCell, styles.colSample]}>SAMPLE #</Text>
            {config.thirdColumnLabel && <Text style={[styles.tableHeaderCell, styles.colThird]}>{config.thirdColumnLabel}</Text>}
            <Text style={[styles.tableHeaderCell, styles.colLocation, { borderRightWidth: 0 }]}>LOCATION</Text>
          </View>
          {Array.from({ length: config.rowCount }).map((_, i) => (
            <View style={styles.tableRow} key={i}>
              <View style={styles.colSample} />
              {config.thirdColumnLabel && <View style={styles.colThird} />}
              <View style={styles.colLocation} />
            </View>
          ))}
        </View>

        <View style={styles.footer}>
          {/* No turnaroundNote for this sample type — TURNAROUND has
              nothing to sit across from up here, so it moves down onto
              the RELINQUISHED BY row instead of sitting alone with the
              rest of the row empty. */}
          {config.turnaroundNote && (
            <View style={styles.footerTopRow}>
              <View style={styles.turnaroundLine}>
                <Text style={styles.turnaroundLabel}>TURNAROUND</Text>
                <Text style={styles.turnaroundOption}>RUSH</Text>
                <Text style={styles.turnaroundOption}>24HR</Text>
              </View>
              <Text style={styles.notes}>{config.turnaroundNote}</Text>
            </View>
          )}

          {config.dateNeededNote ? (
            <View style={[styles.dateNeededRow, { justifyContent: "space-between" }, config.turnaroundNote ? {} : { marginTop: 0 }]}>
              <View style={styles.signatureSubRow}>
                <Text style={styles.dateNeededLabel}>DATE NEEDED</Text>
                <Text style={styles.dateNeededValue}>{job?.lab_date_needed ?? ""}</Text>
              </View>
              <Text style={styles.notes}>{config.dateNeededNote}</Text>
            </View>
          ) : (
            <View style={[styles.dateNeededRow, config.turnaroundNote ? {} : { marginTop: 0 }]}>
              <Text style={styles.dateNeededLabel}>DATE NEEDED</Text>
              <Text style={styles.dateNeededValue}>{job?.lab_date_needed ?? ""}</Text>
            </View>
          )}

          <View style={[styles.signatureRow, config.turnaroundNote ? {} : { justifyContent: "space-between" }]}>
            <View style={styles.signatureSubRow}>
              <Text style={styles.signatureLabel}>RELINQUISHED BY</Text>
              <View style={[styles.signatureLineWrap, config.turnaroundNote ? {} : { width: 240 }]}>
                <Text style={styles.signatureLine} />
                <DateTimeField />
              </View>
            </View>
            {!config.turnaroundNote && (
              <View style={[styles.turnaroundLine, { marginLeft: 16 }]}>
                <Text style={styles.turnaroundLabel}>TURNAROUND</Text>
                <Text style={styles.turnaroundOption}>RUSH</Text>
                <Text style={styles.turnaroundOption}>24HR</Text>
              </View>
            )}
          </View>

          <View style={[styles.signatureRow, { justifyContent: "space-between" }]}>
            <View style={styles.signatureSubRow}>
              <Text style={styles.signatureLabel}>RECEIVED BY</Text>
              <View style={[styles.signatureLineWrap, config.turnaroundNote ? {} : { width: 240 }]}>
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
    </Document>
  );
}

export async function renderMoldCocPdf(data: MoldCocData): Promise<Buffer> {
  return renderToBuffer(<MoldCocDocument {...data} />);
}
