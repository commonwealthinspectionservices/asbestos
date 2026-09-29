import path from "path";
import { Document, Page, Text, View, Image, StyleSheet, Font, renderToBuffer } from "@react-pdf/renderer";
// react-pdf hyphenates long words at line wraps by default — per Tim, a
// wrapped word should always move to the next line whole, never split with
// a hyphen. Same fix as report-pdf.tsx/invoice-pdf.tsx's own copies of this.
Font.registerHyphenationCallback((word) => [word]);
import { primaryInspector } from "@/lib/settings";
import { formatDateMDY } from "@/lib/date-format";
import { expandAddress } from "@/lib/address";
import type { Job, Customer, Settings, SampleItem } from "@/lib/types";

// The owner's own real asbestos bulk sample form, deliberately kept as an
// exact pixel-level match — extracted the real letterhead image (own blue,
// not the app's navy brand color used everywhere else) and every spacing/
// font/row-count value straight from the owner's reference PDF, rather
// than the app's usual document styling. This form and the app's other
// documents are meant to look different; that's not a bug.
const LETTERHEAD_PATH = path.join(process.cwd(), "public", "letterhead-blue.png");
// Same real signature already used on the report PDF (report-pdf.tsx's
// own SignatureBlock) — per Tim, 2026-09-28: "instead of typing my name
// in text can you use my signature from my report." 475x164 real aspect
// ratio (~2.9:1), same as there, just much smaller here to fit the
// RELINQUISHED BY line's tight space ("fit it small into that area").
const SIGNATURE_PATH = path.join(process.cwd(), "public", "signature.png");
const BLANK_ROW_COUNT = 20;
const PAGE_TWO_ROW_COUNT = 20;
const LINE_COLOR = "#000000";
// Single-side borders (borderBottomWidth/borderRightWidth used alone, as
// almost every line on this form is) render roughly 2x their declared
// width in react-pdf — confirmed by comparing rendered stroke width against
// the table's own all-sides borderWidth, which renders at its literal
// value. Declaring those at 0.5 here makes every line on the page the same
// visual weight instead of the table's outer box looking thinner than
// everything inside it.

const styles = StyleSheet.create({
  // paddingBottom has to clear more than the last row's own text — the
  // date/time overlay on RECEIVED BY's line reaches ~14pt below it
  // (position:absolute, so it isn't counted in normal-flow layout at all),
  // and too little padding here let it get clipped by the page edge.
  page: { paddingTop: 10, paddingLeft: 12, paddingRight: 13, paddingBottom: 18, fontSize: 11, fontFamily: "Helvetica", color: "#000000" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 11 },
  headerLeft: { flexDirection: "row", alignItems: "center" },
  letterhead: { width: 283, height: 55 },
  title: { fontSize: 11, fontWeight: 700 },
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
  // Per Tim, 2026-09-28 — "let's make the text always in the middle of
  // the line, not aligned left on it... centered": same rule as the
  // sample table's own cells.
  metaLeftValue: { flex: 1, textAlign: "center", borderBottomWidth: 0.5, borderBottomColor: LINE_COLOR, marginRight: 20 },
  // PROJECT # sits directly under DATE — same fixed width both rows, so
  // their lines end up the exact same length; the label itself is right-
  // aligned within a shared fixed width so "DATE" and "PROJECT #" end at
  // the same x (their last letter/character lining up) regardless of the
  // two labels being different lengths.
  metaRightField: { width: 190, flexDirection: "row", alignItems: "flex-end" },
  metaLabelRight: { width: 65, textAlign: "right", fontWeight: 700, marginRight: 4 },
  metaValueRight: { flex: 1, textAlign: "center", borderBottomWidth: 0.5, borderBottomColor: LINE_COLOR },
  // flex: 1 (with a following sibling — footer below) so the table's rows
  // stretch to fill the page's remaining height, same proven pattern as
  // page2Table. Confirmed live: flex-grow on a *trailing* element (no
  // sibling after it) is unreliable in react-pdf's pagination pass — it
  // only reliably claims space when something follows it, which is why
  // this grows the table (before the footer) rather than the footer itself.
  table: { flex: 1, borderWidth: 1, borderColor: LINE_COLOR },
  tableHeaderRow: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: LINE_COLOR },
  tableHeaderCell: { fontSize: 11, fontWeight: 700, textAlign: "center", padding: 5, borderRightWidth: 0.5, borderRightColor: LINE_COLOR },
  tableRow: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: LINE_COLOR, minHeight: 20, flexGrow: 1 },
  // Per Tim, 2026-09-28 — "everything [should] always try and be in the
  // center, especially when there is a ton of extra space... that goes
  // for sample number and location... and just kind of every chain of
  // custody as well": each row is much taller than one line of text (20
  // fixed rows per page, most left blank), so a top-left-anchored value
  // left a lot of visibly empty space below/around it — centered both
  // ways instead. Applies to the header <Text> cells too (harmless
  // there — tableHeaderCell already centers its own text).
  colSample: { width: 66, borderRightWidth: 0.5, borderRightColor: LINE_COLOR, justifyContent: "center", alignItems: "center" },
  colMaterial: { flex: 1, borderRightWidth: 0.5, borderRightColor: LINE_COLOR, justifyContent: "center", alignItems: "center" },
  colLocation: { flex: 1, justifyContent: "center", alignItems: "center" },
  // Per Tim, 2026-09-28 — "the stuff should always be evenly spaced":
  // this is the very first gap in the footer (table bottom → TURNAROUND),
  // so it gets the exact same marginTop as every gap after it too.
  footer: { marginTop: 16 },
  footerTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
  turnaroundLine: { flexDirection: "row", alignItems: "baseline" },
  turnaroundLabel: { fontSize: 11, fontWeight: 700 },
  turnaroundOption: { fontSize: 11, fontWeight: 400, marginLeft: 20 },
  notes: { fontSize: 11, fontStyle: "italic" },
  // Per Tim, 2026-09-28 — "the stuff should always be evenly spaced, and
  // then turnaround, relinquished by, and received by should always be
  // evenly spaced as well": DATE NEEDED (its own row, between the notes
  // and RELINQUISHED BY) is gone — "let's just go ahead now and remove
  // the date needed line" — and every remaining gap in the footer (email
  // note under TURNAROUND, license line under that, RELINQUISHED BY under
  // that, RECEIVED BY under that) now shares this exact same marginTop,
  // so the whole footer reads as one consistent rhythm rather than a mix
  // of different gaps. Applied to two separate <Text> lines (not one
  // block with a manual line break) specifically so each gets this same
  // real, controlled marginTop instead of an uncontrolled bare line
  // advance — an earlier attempt at closing this gap with a negative
  // marginTop on signatureRow instead very nearly closed it to zero and
  // made "*Sampled by..." visually collide with RELINQUISHED BY's own
  // date/time.
  emailNote: { fontSize: 11, fontStyle: "italic", textAlign: "right", marginTop: 16 },
  // Still used by page 2's own "PAGE 2/2" field (see below) — the row/
  // label styles that used to sit alongside it are gone with DATE NEEDED.
  dateNeededValue: { width: 160, borderBottomWidth: 0.5, borderBottomColor: LINE_COLOR },
  signatureRow: { flexDirection: "row", alignItems: "flex-end", marginTop: 16 },
  signatureSubRow: { flexDirection: "row", alignItems: "flex-end" },
  // Fixed width (not auto-sized to the text) so "RELINQUISHED BY" and the
  // shorter "RECEIVED BY" both hand off to their line at the same x — the
  // two lines then start and end at identical points, and the date/time
  // overlaid on each (right-anchored within the line) lines up directly
  // above/below between the two rows instead of drifting with label length.
  signatureLabel: { fontSize: 11, fontWeight: 700, width: 112 },
  // Per Tim, 2026-09-28 — several rounds on this: first "too much wasted
  // space" (line way longer than its own content), then "still way too
  // much room between my signature and the time" (the real cause — time
  // and date were anchored well past the signature with a big empty gap
  // before either started), then "the whole point of removing the dead
  // space is so we can fit everything else down here... everything
  // should kind of have its own little space." Rebuilt from three
  // absolutely-positioned overlays sharing one long line into three
  // separate boxes — signature, time, date — sitting directly next to
  // each other as plain flex siblings, each with its own short underline
  // sized to its own content. No shared line to tune overlay offsets
  // against, so no dead space is possible by construction, and both
  // RELINQUISHED BY and RECEIVED BY use the exact same three fixed
  // widths, so their time/date columns land at the exact same x on both
  // rows regardless of RECEIVED BY's extra nesting (for its trailing
  // PAGE field).
  sigBox: { position: "relative", width: 65 },
  timeBox: { width: 55, marginLeft: 8 },
  dateBox: { width: 70, marginLeft: 8 },
  boxLine: { width: "100%", textAlign: "center", fontSize: 11, borderBottomWidth: 0.5, borderBottomColor: LINE_COLOR, paddingBottom: 1 },
  boxCaption: { fontSize: 8, color: "#000000", textAlign: "center", marginTop: 2 },
  signatureLine: { width: "100%", borderBottomWidth: 0.5, borderBottomColor: LINE_COLOR },
  // Real signature image, sat on sigBox's own line — small (55pt wide,
  // ~2.9:1 real aspect ratio) to fit the box's own tight space rather
  // than the report's own larger 85pt version.
  relinquishedSignature: { position: "absolute", left: 4, bottom: 0, width: 55, height: 19 },
  pageLabel: { fontSize: 11, fontWeight: 700, marginLeft: 16 },
  page2Table: { flex: 1, borderWidth: 1, borderColor: LINE_COLOR, marginTop: 4 },
  // Per Tim, 2026-09-28 — "I just want for when this is the case, to
  // have the project number aligned all the way left... the page number
  // is in a great spot now": PROJECT # anchors to the true left margin,
  // PAGE stays exactly where it already was, at the right.
  page2Footer: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginTop: 22 },
  page2FieldLabel: { fontSize: 11, fontWeight: 700, marginRight: 4 },
  page2FieldValue: { width: 120, borderBottomWidth: 0.5, borderBottomColor: LINE_COLOR, marginRight: 20 },
});

// One small box: a value (or blank) centered on its own short underline,
// with its caption below. Shared by both RELINQUISHED BY and RECEIVED
// BY's time/date fields — see sigBox/timeBox/dateBox's own comment for
// why this replaced the old shared-line-plus-overlays design. `slashes`
// is only ever true for RELINQUISHED BY's own blank-template fallback
// (no relinquishedBy prop at all) — per Tim, 2026-09-28, RECEIVED BY
// itself never gets the pre-slashed date format, since that's filled in
// by hand by the lab rather than printed ahead of time.
function FieldBox({ box, value, slashes, caption }: { box: "time" | "date"; value?: string; slashes?: boolean; caption: string }) {
  return (
    <View style={box === "time" ? styles.timeBox : styles.dateBox}>
      <Text style={styles.boxLine}>{value ?? (slashes ? "/  /" : " ")}</Text>
      <Text style={styles.boxCaption}>{caption}</Text>
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
  // The three fields below are the electronic Chain of Custody feature
  // (ChainOfCustodyPanel.tsx, 2026-09-28) — every printed/downloaded blank
  // form still calls this with none of them set, which renders exactly as
  // it always has (blank rows, no circle, blank signature line).
  //
  // Real sample rows to fill into the table instead of leaving it blank —
  // caller is expected to have already filtered job.sample_items down to
  // this form's own coc_type (see filterSampleItemsForCoc below).
  sampleItems?: SampleItem[];
  turnaround?: "Rush" | "24-Hr" | null;
  // Electronic signature equivalent — printed name + the date/time the
  // draft was created, standing in for the owner's own handwritten
  // signature+date+time on a paper form (see RELINQUISHED BY below).
  // RECEIVED BY is deliberately never filled in here — that's the lab's
  // own field, filled out on their end once the samples arrive.
  relinquishedBy?: { name: string; date: string; time: string } | null;
}

function BlankCocDocument({ job, customer, settings, sampleItems, turnaround, relinquishedBy }: BlankCocData) {
  const inspector = primaryInspector(settings);
  const clientLabel = customer ? customer.company || customer.name : "";
  // The owner's on-file license number has no internal space
  // ("AI901405"), but his own real form always writes it "AI 901405" —
  // matched here for this one form rather than changing the stored value
  // everywhere else it's used.
  const licenseDisplay = inspector.license_number.replace(/^([A-Za-z]+)(\d+)$/, "$1 $2");
  const page1Items = (sampleItems ?? []).slice(0, BLANK_ROW_COUNT);
  const page2Items = (sampleItems ?? []).slice(BLANK_ROW_COUNT, BLANK_ROW_COUNT + PAGE_TWO_ROW_COUNT);
  return (
    <Document title={job ? `Chain of Custody — ${expandAddress(job.service_address)}` : "Chain of Custody — Blank"}>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Image src={LETTERHEAD_PATH} style={styles.letterhead} />
          </View>
          <Text style={styles.title}>ASBESTOS BULK SAMPLE CHAIN OF CUSTODY</Text>
        </View>

        <View style={styles.metaGrid}>
          <View style={styles.metaTopRow}>
            <View style={styles.metaLeftField}>
              <Text style={styles.metaLabel}>CLIENT</Text>
              <Text style={styles.metaLeftValue}>{clientLabel}</Text>
            </View>
            <View style={styles.metaRightField}>
              <Text style={styles.metaLabelRight}>DATE</Text>
              {/* confirmed_date first — Boston Harbor Water Restoration
                  never carries a real requested_date at all (see
                  JobsDashboard.tsx's own reportChecklist comment). */}
              <Text style={styles.metaValueRight}>{formatDateMDY(job?.confirmed_date ?? job?.requested_date) ?? ""}</Text>
            </View>
          </View>
          <View style={styles.metaBottomRow}>
            <View style={styles.metaLeftField}>
              <Text style={styles.metaLabel}>SITE</Text>
              <Text style={styles.metaLeftValue}>{expandAddress(job?.service_address)}</Text>
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
            <Text style={[styles.tableHeaderCell, styles.colMaterial]}>MATERIAL</Text>
            <Text style={[styles.tableHeaderCell, styles.colLocation, { borderRightWidth: 0 }]}>LOCATION</Text>
          </View>
          {Array.from({ length: BLANK_ROW_COUNT }).map((_, i) => (
            <View style={styles.tableRow} key={i}>
              <View style={[styles.colSample, { padding: 3 }]}><Text style={{ textAlign: "center" }}>{page1Items[i]?.sample_number ?? ""}</Text></View>
              <View style={[styles.colMaterial, { padding: 3 }]}><Text style={{ textAlign: "center" }}>{page1Items[i]?.material ?? ""}</Text></View>
              <View style={[styles.colLocation, { padding: 3 }]}><Text style={{ textAlign: "center" }}>{page1Items[i]?.location ?? ""}</Text></View>
            </View>
          ))}
        </View>

        <View style={styles.footer}>
          <View style={styles.footerTopRow}>
            <View style={styles.turnaroundLine}>
              <Text style={styles.turnaroundLabel}>TURNAROUND</Text>
              {/* Per Tim, 2026-09-28 — "the whole point of having to [print
                  both and] circle one of them [was for a hand-filled
                  form]... now that it's electronic... we can probably
                  just write 24-hour if it's a 24-hour or rush if it's a
                  rush": once turnaround is actually known (an electronic
                  draft, never the printed-ahead-of-time blank template),
                  print only the real one, plain text, no circle. The
                  blank template (turnaround null) still prints both
                  uncircled, ready to hand-circle on-site same as always. */}
              {turnaround ? (
                <Text style={styles.turnaroundOption}>{turnaround === "Rush" ? "RUSH" : "24 HOURS"}</Text>
              ) : (
                <>
                  <Text style={styles.turnaroundOption}>RUSH</Text>
                  <Text style={styles.turnaroundOption}>24HR</Text>
                </>
              )}
            </View>
            <Text style={styles.notes}>*Samples for analysis by Polarized Light Microscopy</Text>
          </View>

          <Text style={styles.emailNote}>Please email all results to tim@commonwealthinspectionservices.com</Text>
          {/* Per Tim, 2026-09-28 — "let's just go ahead now and remove the
              date needed line": the license note used to sit beside it,
              so it moves up to its own line here instead of losing a
              required disclosure — same emailNote style (and so the same
              marginTop rhythm as every other gap in this footer). */}
          <Text style={styles.emailNote}>
            *Sampled by {inspector.name} MA Asbestos Inspector License {licenseDisplay}
          </Text>

          <View style={styles.signatureRow}>
            <Text style={styles.signatureLabel}>RELINQUISHED BY</Text>
            <View style={styles.sigBox}>
              <Text style={styles.signatureLine} />
              {relinquishedBy && <Image src={SIGNATURE_PATH} style={styles.relinquishedSignature} />}
            </View>
            <FieldBox box="time" value={relinquishedBy?.time} caption="time" />
            <FieldBox box="date" value={relinquishedBy?.date} slashes={!relinquishedBy} caption="date" />
          </View>

          <View style={[styles.signatureRow, { justifyContent: "space-between" }]}>
            <View style={styles.signatureSubRow}>
              <Text style={styles.signatureLabel}>RECEIVED BY</Text>
              <View style={styles.sigBox}>
                <Text style={styles.signatureLine} />
              </View>
              <FieldBox box="time" caption="time" />
              <FieldBox box="date" caption="date" />
            </View>
            <View style={styles.signatureSubRow}>
              <Text style={styles.pageLabel}>PAGE</Text>
              {/* Per Tim, 2026-09-28 — "if there's just one page, I always
                  just write one slash one... if there's two pages and
                  this is the first page, I'd write one slash two, and on
                  the second page, two slash two": this form is always a
                  fixed 2-page document (a continuation sheet whether or
                  not it actually holds real rows — see the Page 2 comment
                  below), so page 1's field is always "1/2". */}
              <Text style={[styles.signatureLine, { width: 70, marginLeft: 4, textAlign: "center" }]}>1/2</Text>
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
              <View style={[styles.colSample, { padding: 3 }]}><Text style={{ textAlign: "center" }}>{page2Items[i]?.sample_number ?? ""}</Text></View>
              <View style={[styles.colMaterial, { padding: 3 }]}><Text style={{ textAlign: "center" }}>{page2Items[i]?.material ?? ""}</Text></View>
              <View style={[styles.colLocation, { padding: 3 }]}><Text style={{ textAlign: "center" }}>{page2Items[i]?.location ?? ""}</Text></View>
            </View>
          ))}
        </View>

        <View style={styles.page2Footer}>
          <View style={styles.signatureSubRow}>
            <Text style={styles.page2FieldLabel}>PROJECT #</Text>
            <Text style={styles.page2FieldValue}>{job?.project_number ?? ""}</Text>
          </View>
          <View style={styles.signatureSubRow}>
            <Text style={styles.pageLabel}>PAGE</Text>
            <Text style={[styles.dateNeededValue, { width: 60, marginLeft: 4, textAlign: "center" }]}>2/2</Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}

export async function renderBlankCocPdf(data: BlankCocData): Promise<Buffer> {
  return renderToBuffer(<BlankCocDocument {...data} />);
}
