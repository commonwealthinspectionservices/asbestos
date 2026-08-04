import path from "path";
import { Document, Page, Text, View, Image, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import { primaryInspector } from "@/lib/settings";
import type { Job, Customer, Settings } from "@/lib/types";

const LETTERHEAD_PATH = path.join(process.cwd(), "public", "letterhead.png");
const BLANK_ROW_COUNT = 20;
const TURNAROUND_OPTIONS = ["Rush", "24-Hr", "48-Hr", "3-Day", "4-Day", "5-Day"];

const styles = StyleSheet.create({
  page: { padding: 28, fontSize: 9, fontFamily: "Helvetica", color: "#16213a" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10, paddingBottom: 8, borderBottomWidth: 2, borderBottomColor: "#193466" },
  headerLeft: { flexDirection: "row", alignItems: "center" },
  letterhead: { width: 170, height: 31 },
  title: { fontSize: 11, fontWeight: 700, textAlign: "center" },
  metaGrid: { marginBottom: 8 },
  metaRow: { flexDirection: "row", marginBottom: 3 },
  metaLabel: { width: 80, fontWeight: 700 },
  metaValue: { flex: 1, borderBottomWidth: 1, borderBottomColor: "#94a3b8", paddingBottom: 1 },
  table: { borderWidth: 1, borderColor: "#16213a" },
  tableHeaderRow: { flexDirection: "row", backgroundColor: "#f1f5f9", borderBottomWidth: 1, borderBottomColor: "#16213a" },
  tableHeaderCell: { fontSize: 8, fontWeight: 700, textAlign: "center", padding: 3, borderRightWidth: 1, borderRightColor: "#16213a" },
  tableRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#cbd5e1", minHeight: 16 },
  colSample: { width: 55, borderRightWidth: 1, borderRightColor: "#16213a" },
  colMaterial: { flex: 2, borderRightWidth: 1, borderRightColor: "#16213a" },
  colLocation: { flex: 2, borderRightWidth: 1, borderRightColor: "#16213a" },
  colAnalysis: { width: 40, borderRightWidth: 1, borderRightColor: "#16213a" },
  footer: { marginTop: 10 },
  footerRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 6 },
  signatureLine: { flex: 1, borderBottomWidth: 1, borderBottomColor: "#16213a", marginRight: 10, paddingBottom: 2, fontSize: 8 },
  turnaroundBox: { flexDirection: "row", alignItems: "center", gap: 6 },
  turnaroundOption: { fontSize: 8, marginRight: 8 },
  turnaroundOptionActive: { fontSize: 8, marginRight: 8, fontWeight: 700, textDecoration: "underline" },
});

export interface BlankCocData {
  job: Job;
  customer: Customer;
  settings: Settings;
}

function BlankCocDocument({ job, customer, settings }: BlankCocData) {
  const inspector = primaryInspector(settings);
  return (
    <Document title={`Chain of Custody — ${job.service_address}`}>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Image src={LETTERHEAD_PATH} style={styles.letterhead} />
          </View>
          <Text style={styles.title}>ASBESTOS BULK SAMPLE{"\n"}CHAIN OF CUSTODY RECORD</Text>
        </View>

        <View style={styles.metaGrid}>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Client:</Text>
            <Text style={styles.metaValue}>{customer.company || customer.name}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Site:</Text>
            <Text style={styles.metaValue}>{job.service_address}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Project #:</Text>
            <Text style={styles.metaValue}>{job.project_number ?? ""}</Text>
            <Text style={[styles.metaLabel, { marginLeft: 20 }]}>Date:</Text>
            <Text style={styles.metaValue}>{job.requested_date ?? ""}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Sampled by:</Text>
            <Text style={styles.metaValue}>{inspector.name}</Text>
            <Text style={[styles.metaLabel, { marginLeft: 20 }]}>License #:</Text>
            <Text style={styles.metaValue}>{inspector.license_number}</Text>
          </View>
        </View>

        <View style={styles.table}>
          <View style={styles.tableHeaderRow}>
            <Text style={[styles.tableHeaderCell, styles.colSample]}>Sample #(s)</Text>
            <Text style={[styles.tableHeaderCell, styles.colMaterial]}>Material</Text>
            <Text style={[styles.tableHeaderCell, styles.colLocation]}>Location</Text>
            <Text style={[styles.tableHeaderCell, styles.colAnalysis]}>PLM</Text>
            <Text style={[styles.tableHeaderCell, styles.colAnalysis]}>TEM</Text>
            <Text style={[styles.tableHeaderCell, styles.colAnalysis, { borderRightWidth: 0 }]}>Pt Ct</Text>
          </View>
          {Array.from({ length: BLANK_ROW_COUNT }).map((_, i) => (
            <View style={styles.tableRow} key={i}>
              <View style={styles.colSample} />
              <View style={styles.colMaterial} />
              <View style={styles.colLocation} />
              <View style={styles.colAnalysis} />
              <View style={styles.colAnalysis} />
              <View style={[styles.colAnalysis, { borderRightWidth: 0 }]} />
            </View>
          ))}
        </View>

        <View style={styles.footer}>
          <View style={styles.turnaroundBox}>
            <Text style={{ fontSize: 8, fontWeight: 700, marginRight: 6 }}>Turnaround:</Text>
            {TURNAROUND_OPTIONS.map((t) => (
              <Text key={t} style={job.lab_turnaround === t ? styles.turnaroundOptionActive : styles.turnaroundOption}>
                {t}
              </Text>
            ))}
            <Text style={{ fontSize: 8, fontWeight: 700, marginLeft: 20 }}>Date Needed:</Text>
            <Text style={{ fontSize: 8, marginLeft: 4 }}>{job.lab_date_needed ?? ""}</Text>
          </View>

          <View style={styles.footerRow}>
            <Text style={styles.signatureLine}>Relinquished by: _________________________  Date/Time: ___________</Text>
          </View>
          <View style={styles.footerRow}>
            <Text style={styles.signatureLine}>Received by: _________________________  Date/Time: ___________</Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}

export async function renderBlankCocPdf(data: BlankCocData): Promise<Buffer> {
  return renderToBuffer(<BlankCocDocument {...data} />);
}
