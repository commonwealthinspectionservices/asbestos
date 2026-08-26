import path from "path";
import { Document, Page, Text, View, Image, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import { formatCents } from "@/lib/pricing";
import { lineItemsTotalCents } from "@/lib/invoice-line-items";
import type { Job, Customer, Company, Settings, InvoiceLineItem } from "@/lib/types";
import { formatDateMDY } from "@/lib/date-format";
import { formatPhoneNumber } from "@/lib/phone";
import { expandAddress } from "@/lib/address";

const LETTERHEAD_PATH = path.join(process.cwd(), "public", "letterhead.png");

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 11, fontFamily: "Helvetica", color: "#16213a" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20, paddingBottom: 16, borderBottomWidth: 2, borderBottomColor: "#193466" },
  headerLeft: { flexDirection: "row", alignItems: "center" },
  letterhead: { width: 190, height: 35 },
  invoiceLabel: { fontSize: 9, color: "#64748b", marginTop: 2 },
  headerRight: { alignItems: "flex-end" },
  invoiceTitle: { fontSize: 14, fontWeight: 700, color: "#193466" },
  invoiceProjectNo: { fontSize: 11, fontWeight: 400, color: "#64748b" },
  meta: { fontSize: 10, color: "#334155", marginBottom: 2 },
  section: { marginBottom: 16 },
  sectionTitle: { fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", marginBottom: 6, letterSpacing: 0.5 },
  row: { flexDirection: "row", marginBottom: 4 },
  label: { width: 140, color: "#64748b" },
  value: { flex: 1 },
  table: { borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 4 },
  tableHeaderRow: { flexDirection: "row", backgroundColor: "#f8fafc", borderBottomWidth: 1, borderBottomColor: "#e2e8f0", padding: 6 },
  tableRow: { flexDirection: "row", padding: 6, borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  tableHeaderCell: { fontSize: 9, fontWeight: 700, color: "#64748b", textTransform: "uppercase" },
  colDescription: { flex: 3, paddingRight: 6 },
  colDescriptionSubtext: { fontSize: 9, color: "#64748b", marginTop: 1 },
  colQty: { flex: 0.6, textAlign: "right", paddingRight: 6 },
  colUnit: { flex: 1, paddingRight: 6 },
  colUnitCost: { flex: 1, textAlign: "right", paddingRight: 6 },
  colAmount: { flex: 1, textAlign: "right" },
  totalRow: { flexDirection: "row", padding: 8, backgroundColor: "#f0fdf4" },
  totalLabel: { flex: 4, fontSize: 11, fontWeight: 700, color: "#166534" },
  totalAmount: { flex: 1, fontSize: 11, fontWeight: 700, color: "#166534", textAlign: "right" },
  notesBlock: { fontSize: 10, lineHeight: 1.5, color: "#334155", marginTop: 16 },
  footer: { position: "absolute", bottom: 30, left: 40, right: 40, fontSize: 8, color: "#94a3b8", borderTopWidth: 1, borderTopColor: "#e2e8f0", paddingTop: 8 },
});

export interface InvoiceData {
  job: Job;
  customer: Customer;
  company?: Company | null;
  settings: Settings;
}

function InvoiceDocument({ job, customer, company, settings }: InvoiceData) {
  const serviceLabel =
    settings.service_types.find((s) => s.key === job.service_type)?.label ?? job.service_type ?? "Inspection";

  // Jobs invoiced before line items existed (or historical imports) have no
  // invoice_line_items — fall back to a single flat-fee line so the PDF
  // still renders something sensible instead of an empty table.
  const items: InvoiceLineItem[] =
    job.invoice_line_items && job.invoice_line_items.length > 0
      ? job.invoice_line_items
      : [{ description: `${serviceLabel} — ${expandAddress(job.service_address)}`, quantity: 1, billing_unit: "Base Fee", unit_cost_cents: job.invoice_total_cents ?? 0 }];

  const totalCents = job.invoice_total_cents ?? lineItemsTotalCents(items);

  return (
    <Document title={`Invoice — ${job.project_number ?? expandAddress(job.service_address)}`}>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Image src={LETTERHEAD_PATH} style={styles.letterhead} />
          </View>
          <View style={styles.headerRight}>
            <Text style={styles.invoiceTitle}>
              INVOICE{job.project_number && <Text style={styles.invoiceProjectNo}>   Project #{job.project_number}</Text>}
            </Text>
          </View>
        </View>

        {/* The company is who's actually being billed — a contractor job's
            invoice goes to the business, not the individual contact who
            happens to be on the job (e.g. "Boston Harbor Water Restoration",
            not "Joe Kline"). Per Tim: no Attn: line, ever — falls back to
            the contact's own name/phone only when there's no company on
            file at all. */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Bill to</Text>
          <Text style={styles.meta}>{company?.name || customer.company || customer.name}</Text>
          {customer.billing_address && <Text style={styles.meta}>{expandAddress(customer.billing_address)}</Text>}
          {(company?.phone || customer.phone) && <Text style={styles.meta}>{formatPhoneNumber(company?.phone || customer.phone || "")}</Text>}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Project</Text>
          {job.project_number && (
            <View style={styles.row}><Text style={styles.label}>Project #</Text><Text style={styles.value}>{job.project_number}</Text></View>
          )}
          <View style={styles.row}><Text style={styles.label}>Service address</Text><Text style={styles.value}>{expandAddress(job.service_address)}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Service</Text><Text style={styles.value}>{serviceLabel}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Date of service</Text><Text style={styles.value}>{formatDateMDY(job.requested_date) ?? "—"}</Text></View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Charges</Text>
          <View style={styles.table}>
            <View style={styles.tableHeaderRow}>
              <Text style={[styles.tableHeaderCell, styles.colDescription]}>Description</Text>
              <Text style={[styles.tableHeaderCell, styles.colQty]}>Qty</Text>
              <Text style={[styles.tableHeaderCell, styles.colUnit]}>Unit</Text>
              <Text style={[styles.tableHeaderCell, styles.colUnitCost]}>Unit Cost</Text>
              <Text style={[styles.tableHeaderCell, styles.colAmount]}>Amount</Text>
            </View>
            {items.map((item, i) => {
              const [mainLine, ...subLines] = item.description.split("\n");
              return (
              <View style={styles.tableRow} key={i}>
                <View style={styles.colDescription}>
                  <Text>{mainLine}</Text>
                  {subLines.map((line, j) => (
                    <Text key={j} style={styles.colDescriptionSubtext}>{line}</Text>
                  ))}
                </View>
                <Text style={styles.colQty}>{item.quantity}</Text>
                <Text style={styles.colUnit}>{item.billing_unit}</Text>
                <Text style={styles.colUnitCost}>{formatCents(item.unit_cost_cents)}</Text>
                <Text style={styles.colAmount}>{formatCents(Math.round(item.quantity * item.unit_cost_cents))}</Text>
              </View>
              );
            })}
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Total due</Text>
              <Text style={styles.totalAmount}>{formatCents(totalCents)}</Text>
            </View>
          </View>
        </View>

        <Text style={styles.notesBlock}>
          Please remit payment referencing Project #{job.project_number ?? "—"}.
        </Text>

        <View style={styles.footer}>
          <Text>{settings.business_name}</Text>
        </View>
      </Page>
    </Document>
  );
}

export async function renderInvoicePdf(data: InvoiceData): Promise<Buffer> {
  return renderToBuffer(<InvoiceDocument {...data} />);
}
