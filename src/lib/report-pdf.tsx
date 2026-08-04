import path from "path";
import { Document, Page, Text, View, Image, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import type { Style } from "@react-pdf/types";
import { splitAddress } from "@/lib/address";
import { primaryInspector } from "@/lib/settings";
import type { Job, Customer, Settings } from "@/lib/types";
import { ASBESTOS_POSITIVE_REMARK, ASBESTOS_NEGATIVE_REMARK, LEAD_POSITIVE_REMARK, LEAD_NEGATIVE_REMARK } from "@/lib/report-findings";

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
  // Mold letter's own section format — bold roman-numeral titles (no
  // underline, unlike the asbestos letter's underlined titles) and bold
  // un-underlined sub-headings within Sampling Methodology / Discussion.
  romanTitle: { fontWeight: 700, marginBottom: STANDARD_GAP },
  subHeading: { fontWeight: 700, marginBottom: TIGHT_GAP },
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

// Splits admin-pasted free text into paragraphs — one per line, so a
// discussion written as several short paragraphs or bullet points (one per
// line, as the owner actually writes them) renders as separate justified
// blocks with normal paragraph spacing between them, matching the real
// letters this template is modeled on.
function paragraphsFromText(text: string | null | undefined): string[] {
  if (!text) return [];
  return text.split(/\n+/).map((p) => p.trim()).filter(Boolean);
}

function isMoldJob(job: Job): boolean {
  return (job.service_type ?? "").toLowerCase().includes("mold");
}

function isLeadJob(job: Job): boolean {
  return (job.service_type ?? "").toLowerCase().includes("lead");
}

function ProjectReportDocument({ job, customer, settings }: ProjectReportData) {
  if (isMoldJob(job)) {
    return <MoldReportDocument job={job} customer={customer} settings={settings} />;
  }
  if (isLeadJob(job)) {
    return <LeadReportDocument job={job} customer={customer} settings={settings} />;
  }
  return <AsbestosReportDocument job={job} customer={customer} settings={settings} />;
}

function AsbestosReportDocument({ job, customer, settings }: ProjectReportData) {
  // Lab report uploads populate sample_counts (one entry per service type on
  // the job), not the older single sample_count field — sum every entry for
  // the letter's one combined total, falling back to sample_count only for
  // jobs from before that per-type tracking existed.
  const sampleCountsTotal = Object.values(job.sample_counts ?? {}).reduce((sum, n) => sum + (n || 0), 0);
  const totalSamples = sampleCountsTotal > 0 ? sampleCountsTotal : job.sample_count ?? 0;
  // Reports go to the customer (whoever booked/pays), not the on-site
  // contact — site_contact is for scheduling coordination only.
  const remarks = [
    "Sampling was limited to the specific materials and areas identified by the client. Additional suspect materials may be present and if discovered during building renovation, maintenance, or demolition, should be sampled and analyzed for asbestos content prior to disturbing.",
  ];
  // Index of whichever remark depends on the (possibly still-pending) lab
  // result — always the 2nd item — so its render can reserve the same
  // vertical space regardless of which of the 3 possible messages it is.
  const resultRemarkIndex = remarks.length;
  if (job.asbestos_result === "positive") {
    remarks.push(ASBESTOS_POSITIVE_REMARK);
  } else if (job.asbestos_result === "negative") {
    remarks.push(ASBESTOS_NEGATIVE_REMARK);
  } else {
    remarks.push("NO RESULTS YET.");
  }
  // Selecting a canned Overall findings sentence in the admin UI now sets
  // report_summary AND the matching asbestos_result together (they're the
  // same determination) — skip re-adding it here when it just repeats the
  // remark above verbatim.
  if (job.report_summary && job.report_summary !== ASBESTOS_POSITIVE_REMARK && job.report_summary !== ASBESTOS_NEGATIVE_REMARK) {
    remarks.push(job.report_summary);
  }
  if (job.report_notes) remarks.push(job.report_notes);

  const { knownCustomerName, dateText, addressLines, billingStreet, billing, serviceStreet, service } = commonLetterFields(job, customer, settings);

  return (
    <Document title={`Bulk Sample Analytical Results — ${job.service_address}`}>
      <Page size="LETTER" style={styles.page}>
        <LetterHeader settings={settings} addressLines={addressLines} />

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

        <SignatureBlock settings={settings} showLicense />
      </Page>
    </Document>
  );
}

// Modeled directly on two real final lead reports ("LEAD 26-2617 443 Moraine
// Street" and "LEAD 26-2711 64 Old Farm Road") — structurally almost
// identical to the asbestos letter (same Sampling Summary box, same
// Remarks-and-Limitations list shape), just paint-chip/lead wording and an
// AIHA accreditation # in place of NIST/NVLAP + MassDLS (lead labs like
// SanAir don't carry a MassDLS cert). Neither real example showed a
// license # under the signature, so this omits it like the mold letter
// does. No "Field Technician" row — both real letters leave it blank and
// nothing in this app tracks who was on site, so there's no value to show.
function LeadReportDocument({ job, customer, settings }: ProjectReportData) {
  const sampleCountsTotal = Object.values(job.sample_counts ?? {}).reduce((sum, n) => sum + (n || 0), 0);
  const totalSamples = sampleCountsTotal > 0 ? sampleCountsTotal : job.sample_count ?? 0;

  const remarks = [
    "Sampling was limited to the specific paints and areas identified by the client. Additional suspect materials may be present and if discovered during building renovation, maintenance or demolition, should be sampled independently.",
  ];
  const resultRemarkIndex = remarks.length;
  if (job.lead_result === "positive") {
    remarks.push(LEAD_POSITIVE_REMARK);
  } else if (job.lead_result === "negative") {
    remarks.push(LEAD_NEGATIVE_REMARK);
  } else {
    remarks.push("NO RESULTS YET.");
  }
  // Selecting a canned Overall findings sentence in the admin UI now sets
  // report_summary AND the matching lead_result together (they're the same
  // determination) — skip re-adding it here when it just repeats the
  // remark above verbatim.
  if (job.report_summary && job.report_summary !== LEAD_POSITIVE_REMARK && job.report_summary !== LEAD_NEGATIVE_REMARK) {
    remarks.push(job.report_summary);
  }
  if (job.report_notes) remarks.push(job.report_notes);

  const { knownCustomerName, dateText, addressLines, billingStreet, billing, serviceStreet, service } = commonLetterFields(job, customer, settings);

  return (
    <Document title={`Bulk Paint Chip Sample Analytical Results — ${job.service_address}`}>
      <Page size="LETTER" style={styles.page}>
        <LetterHeader settings={settings} addressLines={addressLines} />

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
            <Text style={styles.reValue}>Bulk Paint Chip Sample Analytical Results</Text>
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
          {settings.business_name} collected paint chip samples as directed from the address noted above. Samples were
          transported under chain-of-custody protocol to an accredited laboratory for analysis.
        </Text>

        <Text style={styles.sectionTitleTight}>Sampling Summary:</Text>
        <View style={styles.summaryBlock}>
          <View style={styles.summaryRow}><Text style={styles.summaryLabel}>Date of Sampling:</Text><ValueOrBlank style={styles.summaryValue} value={job.requested_date} /></View>
          <View style={styles.summaryRow}><Text style={styles.summaryLabel}>Total # of Samples:</Text><ValueOrBlank style={styles.summaryValue} value={totalSamples} /></View>
          <View style={styles.summaryRow}><Text style={styles.summaryLabel}>Samples Analyzed At:</Text><ValueOrBlank style={styles.summaryValue} value={job.lab_name} /></View>
          <View style={styles.summaryRow}><Text style={styles.summaryLabel}>AIHA Certification#:</Text><ValueOrBlank style={styles.summaryValue} value={job.lab_nist_cert} /></View>
        </View>

        <Text style={styles.paragraph}>
          Paint chip samples were collected in a random manner and submitted via chain of custody to the analytical
          laboratory. The samples were analyzed for Total Concentration of Lead by EPA Method SW846/3050B/7000B. Any
          sample containing detectable amounts of lead is considered lead containing paint. However, MassDPH and
          Federal HUD guidelines consider paint containing lead concentrations greater than or equal to 0.5% by
          weight (5,000 ppm) to be lead-based paint (LBP). Laboratory Analytical Data Sheets are attached and provide
          details about each sample collected.
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
          Should you have any questions or need additional information, please contact our office
          {settings.business_phone ? ` at ${settings.business_phone}` : ""}. Thank you for the opportunity to provide
          you with our services and we look forward to working together in the future.
        </Text>

        <SignatureBlock settings={settings} showLicense={false} />
      </Page>
    </Document>
  );
}

// Modeled directly on two real final mold reports (letterhead cover letter +
// EMSL Air-O-Cell/bulk lab reports as an appendix) — see the "MOLD 26-2641"
// and "FINAL MOLD REPORT 14 Rawson Road" letters. Scope of Work, Sampling
// Methodology, and Limitations are fixed boilerplate matched to those
// letters; Discussion of Results and Conclusions & Recommendations are
// exactly what the admin enters in report_summary/report_notes (Enter Lab
// Results dialog) — this letter doesn't try to auto-structure that text,
// since the real letters are themselves free-form prose written per job.
function MoldReportDocument({ job, customer, settings }: ProjectReportData) {
  const { knownCustomerName, dateText, addressLines, billingStreet, billing, serviceStreet, service } = commonLetterFields(job, customer, settings);

  // Which methodology sections apply — inferred from which mold sample
  // types actually have counts on this job. Falls back to showing both when
  // there's no sample data yet (e.g. previewing before lab results come in)
  // rather than guessing wrong and omitting one that turns out to apply.
  const sampleLabels = Object.keys(job.sample_counts ?? {});
  const hasAir = sampleLabels.length === 0 || sampleLabels.some((l) => l.toLowerCase().includes("air"));
  const hasBulk = sampleLabels.length === 0 || sampleLabels.some((l) => l.toLowerCase().includes("bulk") || l.toLowerCase().includes("swab"));

  const scopeItems = [
    ...(hasAir ? ["Collection of air samples within the subject area for mold;"] : []),
    ...(hasBulk ? ["Collection of bulk samples within the subject area for mold;"] : []),
    "Preparation of a summary report detailing the sampling methodology along with analytical results, a discussion of the results, and a conclusion.",
  ];

  const labName = (job.lab_name || "an accredited laboratory").replace(/\.+$/, "");
  const methodologySections = [
    ...(hasAir
      ? [
          {
            title: "Airborne Sampling for Mold:",
            paragraphs: [
              `The concentration and identification of the genera of airborne mold was performed through the use of Air-O-Cell cassettes and swabs. This method utilizes an air pump to draw air at a predetermined flow rate through a spore trap cassette containing a slide coated with an optically-transparent adhesive. Airborne particulate, including spores is impacted onto the slide, and then submitted to the laboratory where it is stained and analyzed by optical microscopy at magnifications between 200X and 1000X. Samples collected at the above referenced location were enumerated and speciated by ${labName}.`,
              "This method does not differentiate between viable and non-viable fungal spores. In addition, this technique does not allow for the differentiation between Aspergillus and Penicillium spores. Other non-distinctive spores are reported in categories such as Ascospores or Basidiospores.",
            ],
          },
        ]
      : []),
    ...(hasBulk
      ? [
          {
            title: "Bulk Sampling of Building Materials for Mold:",
            paragraphs: [
              `Bulk samples of building materials suspected mold growth were collected to identify the genera of mold, if present. Upon receipt at the laboratory, a sub-sample is prepared and applied directly to a microscopic slide, where it is stained and analyzed by optical microscopy at magnifications between 200X and 1000X. Samples collected at the above referenced location were enumerated and speciated by ${labName}.`,
              "This method does not differentiate between viable and non-viable fungal spores. In addition, this technique does not allow for the differentiation between Aspergillus and Penicillium spores. Other non-distinctive spores are reported in categories such as Ascospores or Basidiospores.",
            ],
          },
        ]
      : []),
  ];

  const discussionParagraphs = paragraphsFromText(job.report_summary);
  const conclusionParagraphs = paragraphsFromText(job.report_notes);

  return (
    <Document title={`Limited Mold Assessment & Sampling — ${job.service_address}`}>
      <Page size="LETTER" style={styles.page}>
        <LetterHeader settings={settings} addressLines={addressLines} />

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
            <Text style={styles.reValue}>Limited Mold Assessment & Sampling</Text>
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
          On {dateText} {settings.business_name} conducted a limited mold assessment and baseline sampling in limited
          areas within the above-mentioned address. The following letter summary represents the assessment including
          our scope of work, sampling methodology, discussion of results and conclusion.
        </Text>

        <Text style={styles.romanTitle} minPresenceAhead={30}>I.  SCOPE OF WORK</Text>
        <View style={styles.listBlock}>
          {scopeItems.map((text, i) => (
            <View style={styles.listItem} key={i}>
              <Text style={styles.listIndex}>{i + 1}.</Text>
              <Text style={styles.listText}>{text}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.romanTitle} minPresenceAhead={30}>II.  SAMPLING METHODOLOGY</Text>
        {methodologySections.map((section, i) => (
          <View key={i}>
            <Text style={styles.subHeading}>{i + 1}. {section.title}</Text>
            {section.paragraphs.map((p, j) => (
              <Text style={styles.paragraph} key={j}>{p}</Text>
            ))}
          </View>
        ))}

        <Text style={styles.romanTitle} minPresenceAhead={30}>III.  DISCUSSION OF RESULTS</Text>
        {discussionParagraphs.length > 0 ? (
          discussionParagraphs.map((p, i) => <Text style={styles.paragraph} key={i}>{p}</Text>)
        ) : (
          <Text style={styles.paragraph}>NO RESULTS YET.</Text>
        )}

        <Text style={styles.romanTitle} minPresenceAhead={30}>IV.  CONCLUSIONS & RECOMMENDATIONS</Text>
        {conclusionParagraphs.length > 0 ? (
          conclusionParagraphs.map((p, i) => <Text style={styles.paragraph} key={i}>{p}</Text>)
        ) : (
          <Text style={styles.paragraph}>NO RECOMMENDATIONS YET.</Text>
        )}

        <Text style={styles.romanTitle} minPresenceAhead={30}>V.  LIMITATIONS AND CONDITIONS OF THIS REPORT</Text>
        <Text style={styles.paragraph}>
          The recommendations and conclusions discussed herein are based solely and in reliance upon information
          collected as a result of the activities delineated in the Proposal. {settings.business_name} neither attests
          nor renders an opinion as to the accuracy or comprehensiveness of the analytical results. There is a limit
          to all investigations of this type in the sense that the researcher must draw conclusions and develop
          recommendations with information obtained from research, site evaluation and limited sampling and analysis.
          {" "}{settings.business_name} does not render any warranty, either express or implied, as to the conditions
          of the Site beyond that observed during the Site survey. The passage of time may also result in a change in
          the characteristics at the Site. {settings.business_name} does not render an opinion as to conditions which
          may change subsequent to the date of the Site reconnaissance. {settings.business_name} does not render an
          opinion as to conditions at uninspected or obstructed portions of the Site (e.g. ceiling plenums or air
          handling equipment), or those areas not sampled as part of this survey. {settings.business_name} performed
          professional services and rendered conclusions in accordance with generally accepted practices of other
          environmental consultants undertaking similar investigations at the same time in the same geographical
          area. {settings.business_name} exercised the degree of care and skill generally exercised by other
          environmental consultants under similar circumstances and conditions.
        </Text>

        <Text style={styles.paragraph}>
          Thank you for choosing {settings.business_name} to assist you on this project. I hope the information that
          we provide in this report fulfills your requirements. If you have any questions about the information
          contained herein, please do not hesitate to contact me{settings.business_phone ? ` at ${settings.business_phone}` : ""}.
        </Text>

        <SignatureBlock settings={settings} showLicense={false} />
      </Page>
    </Document>
  );
}

function LetterHeader({ settings, addressLines }: { settings: Settings; addressLines: string[] }) {
  return (
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
  );
}

function SignatureBlock({ settings, showLicense }: { settings: Settings; showLicense: boolean }) {
  const inspector = primaryInspector(settings);
  return (
    <View style={styles.signatureBlock}>
      <Text style={styles.signatureLine}>Sincerely,</Text>
      <Text style={styles.signatureName}>{settings.business_name}</Text>
      <Image src={SIGNATURE_PATH} style={styles.signatureImage} />
      <Text style={styles.signatureLine}>{inspector.name}</Text>
      <Text style={styles.signatureLine}>
        {inspector.title}{showLicense && inspector.license_number ? ` — Asbestos Inspector License #${inspector.license_number}` : ""}
      </Text>
    </View>
  );
}

// "Unknown contact" is the app's own fallback customer.name (see
// POST /api/admin/jobs) for a job created with no real contact given — a
// real, non-blank string, so ValueOrBlank's own null/empty check wouldn't
// catch it. Treated as blank everywhere it'd otherwise print that
// placeholder verbatim ("Dear Unknown contact:"). Shared between both
// letter templates since the recipient/address block is identical.
function commonLetterFields(job: Job, customer: Customer, settings: Settings) {
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

  return { knownCustomerName, dateText, addressLines, billingStreet, billing, serviceStreet, service };
}

export async function renderProjectReportPdf(data: ProjectReportData): Promise<Buffer> {
  return renderToBuffer(<ProjectReportDocument {...data} />);
}
