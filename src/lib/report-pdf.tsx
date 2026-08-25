import path from "path";
import { Document, Page, Text, View, Image, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import type { Style } from "@react-pdf/types";
import { splitAddress } from "@/lib/address";
import { primaryInspector } from "@/lib/settings";
import { formatDateMDY } from "@/lib/date-format";
import type { Job, Customer, Settings } from "@/lib/types";
import {
  ASBESTOS_POSITIVE_REMARK, ASBESTOS_NEGATIVE_REMARK, LEAD_POSITIVE_REMARK, LEAD_NEGATIVE_REMARK,
  moldScopeOfWorkItems, moldServiceTypeFlags, MOLD_SCOPE_CLOSING_LINE, MOLD_ACGIH_PARAGRAPH, MOLD_INDOOR_AIR_QUALITY_PARAGRAPH, MOLD_AIR_INVESTIGATION_GOAL_PARAGRAPH,
  NEWTON_FIRE_FLOOD_COMPANY_ID, NEWTON_FIRE_FLOOD_STANDARD_MOLD_CONCLUSION,
  jobReportDomains, domainForServiceTypeLabel, type ReportDomain,
  isFullInspectionAsbestosJob, FULL_INSPECTION_SCOPE_PARAGRAPH, FULL_INSPECTION_NON_SUSPECT_PARAGRAPH,
  FULL_INSPECTION_WALLS_PARAGRAPH, FULL_INSPECTION_BULK_SAMPLING_PARAGRAPH, FULL_INSPECTION_ACM_CATEGORY_PARAGRAPH,
  FULL_INSPECTION_NON_ACM_CATEGORY_PARAGRAPH, FULL_INSPECTION_ADDITIONAL_SUSPECT_REMARK,
  FULL_INSPECTION_ACM_ABATEMENT_REMARK, FULL_INSPECTION_ACM_PLAN_DISCLAIMER_REMARK,
} from "@/lib/report-findings";

// The site header's own text wordmark (see AdminNav.tsx's "boxed brand
// button"), not the circular badge logo — matches the site's actual
// branding language rather than introducing a different mark.
const LOGO_PATH = path.join(process.cwd(), "public", "letterhead.png");
const SIGNATURE_PATH = path.join(process.cwd(), "public", "signature.png");

// Spelled-out sample counts for the mold Discussion of Results sentence
// ("Six (6) samples were collected...", matching real report wording) —
// limited assessments don't run past a handful of samples, so this range
// covers it; anything beyond just falls back to the digit alone.
const NUMBER_WORDS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen", "Twenty"];

// Standard size is Times New Roman 12 — used everywhere except asbestos's
// own cover letter, which is the one document that must always fit one
// page (mold, lead, and everything else is free to run longer). Asbestos
// instead gets the largest size that still holds one page under realistic
// worst-case content (see ASBESTOS_FONT_SIZE below and its own Page
// override in AsbestosReportDocument).
const STANDARD_GAP = 10;
const TIGHT_GAP = 3;
const BODY_FONT_SIZE = 12;
// Tuned by testing, not guessed: the largest size (in 0.1pt steps) that
// still keeps a worst-case-realistic asbestos letter — 20 samples, plus
// both report_summary and report_notes filled in — on one page.
const ASBESTOS_FONT_SIZE = 10.8;

const styles = StyleSheet.create({
  // paddingBottom matches the real letters this template is modeled on —
  // measured directly off several actual sent reports (58pt average
  // across their genuinely-full pages, i.e. every page except a letter's
  // last, which naturally ends early regardless of margin). Asbestos
  // overrides it back down further via pageAsbestos below — its bottom
  // margin is tightly tuned to hold worst-case content to exactly one
  // page and can't afford to give any of that back.
  page: { paddingTop: 26, paddingBottom: 58, paddingHorizontal: 69, fontSize: BODY_FONT_SIZE, fontFamily: "Times-Roman", color: "#000000", lineHeight: 1.35 },
  // lineHeight held back to the original 1.22 here, not inherited at 1.35 —
  // asbestos's one-page fit above is tuned against that exact value; giving
  // it the same bump as mold/lead (free to run longer) risks pushing a
  // realistic worst-case letter onto a second page.
  pageAsbestos: { fontSize: ASBESTOS_FONT_SIZE, paddingBottom: 26, lineHeight: 1.22 },
  // Full-inspection only — extra breathing room at the very top of the page.
  pageFullInspection: { paddingTop: 58 },
  header: { flexDirection: "row", alignItems: "center", marginBottom: 22, paddingBottom: 12, borderBottomWidth: 2, borderBottomColor: "#193466" },
  // Logo and email size to their own natural width; the phone number sits
  // centered in whatever's left between them via two equal flexGrow
  // spacers, rather than a fixed-ratio column — that's what actually
  // centers it between the logo and the email address (a fixed 1:2.4
  // column split centered phone within its own narrow column instead,
  // biased toward the logo rather than centered in the true remaining
  // space). Shrinking the logo and the contact fontSize both matter here:
  // at the original sizes, logo + phone + email already filled ~100% of
  // the row on their own, leaving nothing for the spacers to grow into.
  headerSpacer: { flexGrow: 1 },
  // Matches letterhead.png's own 968x178 aspect ratio (~5.44:1).
  logo: { width: 165, height: 30.3 },
  // lineHeight:1 is deliberate, not a stylistic choice — react-pdf's fixed +
  // render (used for the continuation header below) silently fails to
  // render any Text inside it that inherits styles.page's lineHeight:1.22.
  // An explicit override on the Text itself is the fix; moving lineHeight
  // off the Page and onto a wrapper View instead was tried first and
  // visibly loosened the whole body's spacing (confirmed side-by-side) —
  // this is the only fix that leaves body text untouched.
  headerContact: { color: "#000000", lineHeight: 1, fontSize: 10 },
  // Continuation pages (2+) swap the logo/phone letterhead for this compact
  // plain-text identification block instead — matches real multi-page
  // letters (subject/customer/address on the left, project #/date/page
  // number on the right), so a page is still identifiable if separated
  // from the rest of the packet.
  continuationHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 14, paddingBottom: 8 },
  continuationHeaderLeft: { flex: 1 },
  continuationHeaderRight: { alignItems: "flex-end" },
  // fontSize and color both live here, on the Text style itself, not on
  // continuationHeader above — react-pdf's line-height calculation under
  // fixed+render ignored fontSize set on an ancestor View, using the
  // Page's own 12pt as the line box height regardless (confirmed
  // empirically: produced a consistent ~6pt gap between every line, i.e.
  // what actually looked like "double spacing") — color gets the same
  // direct treatment on principle, not chancing the same class of bug.
  continuationHeaderLine: { fontSize: 9, lineHeight: 1, color: "#999999" },
  recipient: { marginBottom: 0 },
  recipientRow: { flexDirection: "row", justifyContent: "space-between" },
  recipientBlock: { marginBottom: STANDARD_GAP },
  // Full-inspection only — slightly more room between the recipient block,
  // RE block, salutation, and intro paragraph than the other 3 templates use.
  recipientBlockFullInspection: { marginBottom: STANDARD_GAP + 6 },
  dateLine: {},
  reBlock: { marginBottom: STANDARD_GAP },
  reBlockFullInspection: { marginBottom: STANDARD_GAP + 6 },
  salutationFullInspection: { marginBottom: STANDARD_GAP + 6 },
  reRow: { flexDirection: "row" },
  // The RE block's first line carries the subject ("RE: ... at") on the
  // left and the date on the right, on one shared row — not its own
  // flex:1 reValue box (which would claim the whole row width, leaving no
  // room for the date). reTopLeft sizes to its own text naturally; the
  // date lands in the leftover space via justifyContent: "space-between"
  // on the row.
  reRowTop: { flexDirection: "row", justifyContent: "space-between" },
  reTopLeft: { flexDirection: "row" },
  reLabel: { width: 27 },
  reProjectLabel: { width: 75 },
  reValue: { flex: 1 },
  salutation: { marginBottom: STANDARD_GAP },
  paragraph: { marginBottom: STANDARD_GAP, textAlign: "justify" },
  sectionTitle: { fontWeight: 700, marginBottom: STANDARD_GAP, textDecoration: "underline" },
  sectionTitleTight: { fontWeight: 700, marginBottom: TIGHT_GAP, textDecoration: "underline" },
  // Full-inspection-only variants with extra marginTop, so consecutive
  // section titles ("Scope and Approach:" right after "Inspection Summary:",
  // etc) get real breathing room above them, not just below. Kept separate
  // from sectionTitle/sectionTitleTight above rather than adding marginTop
  // there directly — those are also used by the Limited Asbestos letter,
  // whose page margin is deliberately tuned to hold worst-case content to
  // exactly one page and can't afford extra vertical space.
  // Same value above and below every underlined section title, throughout
  // the whole document — no separate "tight" variant for Inspection
  // Summary specifically, so spacing stays visually consistent everywhere.
  sectionTitleFullInspection: { fontWeight: 700, marginTop: 22, marginBottom: 22, textDecoration: "underline" },
  summaryBlock: { marginBottom: STANDARD_GAP },
  summaryRow: { flexDirection: "row", marginLeft: 101 },
  summaryLabel: { width: 155, textAlign: "right", marginRight: 21, color: "#000000" },
  summaryValue: { flex: 1 },
  blankLine: { flex: 0, minWidth: 130, borderBottomWidth: 1, borderBottomColor: "#94a3b8" },
  blankLineInline: { flex: 0, minWidth: 70, borderBottomWidth: 1, borderBottomColor: "#94a3b8" },
  listBlock: { marginBottom: STANDARD_GAP },
  // Was TIGHT_GAP (3) — read as cramped for full-sentence bullets like
  // Conclusions & Recommendations (confirmed live on 26-0002's mold
  // report). Same STANDARD_GAP every paragraph already uses.
  listItem: { flexDirection: "row", marginBottom: STANDARD_GAP, paddingLeft: 4 },
  // Full-inspection Remarks and Limitations only — a full paragraph-style
  // gap between each numbered remark instead of the tight list spacing
  // used for other templates' shorter lists.
  listItemFullInspection: { flexDirection: "row", marginBottom: STANDARD_GAP + 6, paddingLeft: 4 },
  listIndex: { width: 16 },
  listText: { flex: 1, textAlign: "justify" },
  // The positive/negative sentence both wrap to ~2 lines at this width;
  // "NO RESULTS YET." on its own is one short line. Reserving 2 lines'
  // worth of height for this one remark specifically keeps the letter's
  // overall shape identical before and after lab results come in — the
  // page shouldn't visibly reflow just because this one line got longer.
  // Lead's own variant, at the standard 12pt size (lead isn't held to
  // asbestos's one-page rule, but the reserved-height trick still applies).
  resultRemarkText: { flex: 1, textAlign: "justify", minHeight: BODY_FONT_SIZE * 1.28 * 2 },
  resultRemarkTextAsbestos: { flex: 1, textAlign: "justify", minHeight: ASBESTOS_FONT_SIZE * 1.28 * 2 },
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
  // Full-inspection asbestos report's Appendix A/B tables — react-pdf has
  // no native table primitive, so these are plain flexbox rows. Shared
  // between both appendices; column widths differ per appendix (A has 4
  // wider columns, B has 5 narrower ones for its 3 location sub-columns).
  appendixTable: { marginTop: 4, marginBottom: STANDARD_GAP },
  appendixHeaderRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#193466", paddingBottom: 4, marginBottom: 4 },
  appendixRow: { flexDirection: "row", paddingVertical: 3, borderBottomWidth: 0.5, borderBottomColor: "#cbd5e1" },
  appendixHeaderText: { fontWeight: 700, fontSize: 9.5 },
  appendixCellText: { fontSize: 9.5 },
  appendixColMaterialA: { width: "30%", paddingRight: 4 },
  appendixColLocationA: { width: "34%", paddingRight: 4 },
  appendixColQuantityA: { width: "18%", paddingRight: 4 },
  appendixColSamplesA: { width: "18%" },
  appendixColSamplesB: { width: "14%", paddingRight: 4 },
  appendixColMaterialB: { width: "24%", paddingRight: 4 },
  appendixColLocB: { width: "20.66%", paddingRight: 4 },
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

type TextBlock = { type: "paragraph"; text: string } | { type: "list"; ordered: boolean; items: string[] };

// Same line-splitting as paragraphsFromText, but a line starting with
// "- "/"* "/"• " or "1. "/"1) " (as the admin's own list-format toolbar
// buttons insert — see JobsDashboard.tsx's applyMoldNotesListFormat)
// becomes part of an actual rendered bulleted/numbered list instead of a
// plain paragraph containing a literal dash or digit. Consecutive lines of
// the same list type group into one list; anything else stays exactly the
// one-paragraph-per-line behavior paragraphsFromText already had.
function blocksFromText(text: string | null | undefined): TextBlock[] {
  const blocks: TextBlock[] = [];
  for (const line of paragraphsFromText(text)) {
    const bullet = line.match(/^[-*•]\s+(.*)$/);
    const numbered = line.match(/^\d+[.)]\s+(.*)$/);
    const last = blocks[blocks.length - 1];
    if (bullet) {
      if (last?.type === "list" && !last.ordered) last.items.push(bullet[1]);
      else blocks.push({ type: "list", ordered: false, items: [bullet[1]] });
    } else if (numbered) {
      if (last?.type === "list" && last.ordered) last.items.push(numbered[1]);
      else blocks.push({ type: "list", ordered: true, items: [numbered[1]] });
    } else {
      blocks.push({ type: "paragraph", text: line });
    }
  }
  return blocks;
}

function RenderTextBlocks({ blocks, emptyText }: { blocks: TextBlock[]; emptyText?: string }) {
  if (blocks.length === 0) {
    return emptyText ? <Text style={styles.paragraph}>{emptyText}</Text> : null;
  }
  return (
    <>
      {blocks.map((block, i) =>
        block.type === "paragraph" ? (
          <Text style={styles.paragraph} key={i}>{block.text}</Text>
        ) : (
          <View style={styles.listBlock} key={i}>
            {block.items.map((item, j) => (
              <View style={styles.listItem} key={j}>
                <Text style={styles.listIndex}>{block.ordered ? `${j + 1}.` : "•"}</Text>
                <Text style={styles.listText}>{item}</Text>
              </View>
            ))}
          </View>
        )
      )}
    </>
  );
}

// One report per domain actually on the job — a job combining service
// types from more than one domain (e.g. "Limited Asbestos Inspection,
// Mold Air Sampling") used to pick a single winner here (mold > lead >
// asbestos) and silently drop whichever type lost. Each domain gets its
// own separate document now; jobReportDomains decides which domains apply.
function ReportDocumentForDomain({ job, customer, settings, domain }: ProjectReportData & { domain: ReportDomain }) {
  if (domain === "mold") {
    return <MoldReportDocument job={job} customer={customer} settings={settings} />;
  }
  if (domain === "lead") {
    return <LeadReportDocument job={job} customer={customer} settings={settings} />;
  }
  // Pre-Renovation/Pre-Demolition are a full, inspector-directed survey —
  // a genuinely different report from Limited's short, client-directed
  // sampling letter. See isFullInspectionAsbestosJob's own comment.
  if (isFullInspectionAsbestosJob(job.service_type)) {
    return <FullInspectionAsbestosReportDocument job={job} customer={customer} settings={settings} />;
  }
  return <AsbestosReportDocument job={job} customer={customer} settings={settings} />;
}

function AsbestosReportDocument({ job, customer, settings }: ProjectReportData) {
  // Lab report uploads populate sample_counts (one entry per service type on
  // the job), not the older single sample_count field — sum only this
  // report's own domain's entries for the letter's total, since a job
  // combining e.g. asbestos with mold has sample_counts entries for both and
  // each domain gets its own separate report. Falls back to sample_count
  // only for jobs from before per-type tracking existed.
  const sampleCountsTotal = Object.entries(job.sample_counts ?? {})
    .filter(([label]) => domainForServiceTypeLabel(label) === "asbestos")
    .reduce((sum, [, n]) => sum + (n || 0), 0);
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
  // report_notes deliberately NOT included here — asbestos Remarks and
  // Limitations is always exactly the boilerplate + the result-based
  // canned remark (2 items), or that plus a genuinely custom finding
  // typed into the Result field instead of picking a canned option (3).
  // report_notes has no UI to reach in the admin dashboard at all, so
  // any 3rd/4th remark it would add could only ever come from something
  // set directly in the database — never a real admin edit.

  const { knownCustomerName, dateText, billingStreet, billing, serviceStreet, service } = commonLetterFields(job, customer, settings);

  return (
    <Document title={`Bulk Sample Analytical Results — ${job.service_address}`}>
      <Page size="LETTER" style={[styles.page, styles.pageAsbestos]}>
        <LetterHeader
          settings={settings}
          reTitle="Bulk Sample Analytical Results"
          knownCustomerName={knownCustomerName}
          serviceAddress={job.service_address}
          projectNumber={job.project_number}
          dateText={dateText}
        />

        <View style={styles.reBlock}>
          <View style={styles.reRowTop}>
            <View style={styles.reTopLeft}>
              <Text style={styles.reLabel}>RE:</Text>
              <Text>Bulk Sample Analytical Results</Text>
            </View>
            <Text style={styles.dateLine}>{dateText}</Text>
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

        <RecipientBlock
          knownCustomerName={knownCustomerName}
          customer={customer}
          billingStreet={billingStreet}
          billingCityStateZip={billing.cityStateZip}
        />

        <Text style={styles.salutation}>Dear <ValueOrBlank style={styles.salutation} value={knownCustomerName} inline />:</Text>

        <Text style={styles.paragraph}>
          {settings.business_name} collected samples of specific materials from the address noted above. Samples were
          transported under chain-of-custody protocol to an accredited laboratory for analysis.
        </Text>

        <Text style={styles.sectionTitleTight}>Sampling Summary:</Text>
        <View style={styles.summaryBlock}>
          <View style={styles.summaryRow}><Text style={styles.summaryLabel}>Date of Sampling:</Text><ValueOrBlank style={styles.summaryValue} value={formatDateMDY(job.lab_date_sampled ?? job.requested_date)} /></View>
          <View style={styles.summaryRow}><Text style={styles.summaryLabel}>Total # of Samples:</Text><ValueOrBlank style={styles.summaryValue} value={totalSamples} /></View>
          <View style={styles.summaryRow}><Text style={styles.summaryLabel}>Samples Analyzed At:</Text><ValueOrBlank style={styles.summaryValue} value={job.lab_name} /></View>
          <View style={styles.summaryRow}><Text style={styles.summaryLabel}>NIST/NVLAP Certification#:</Text><ValueOrBlank style={styles.summaryValue} value={job.lab_nist_cert} /></View>
          <View style={styles.summaryRow}><Text style={styles.summaryLabel}>MassDLS Lab Certification#:</Text><ValueOrBlank style={styles.summaryValue} value={job.lab_massdls_cert} /></View>
        </View>

        <Text style={styles.paragraph}>
          Bulk samples were collected and submitted via chain of custody to the analytical laboratory by {settings.business_name}{settings.business_name.endsWith(".") ? "" : "."}{" "}
          The samples were analyzed by Polarized Light Microscopy per EPA Method 600/R-93-116, July 1993. Any homogeneous material having
          at least one (1) sample analyzed to contain greater than one percent (1%) asbestos is categorized as an
          asbestos containing material. Any homogeneous material having at least one (1) sample analyzed to contain any amount
          of asbestos is categorized as an asbestos containing waste material. Homogeneous materials where each sample analyzed
          was determined not to contain asbestos are categorized as non-asbestos. Laboratory Analytical Data Sheets are attached
          and provide details about each sample collected.
        </Text>

        <Text style={styles.sectionTitle}>Remarks and Limitations:</Text>
        <View style={styles.listBlock}>
          {remarks.map((text, i) => (
            <View style={styles.listItem} key={i}>
              <Text style={styles.listIndex}>{i + 1}.</Text>
              <Text style={i === resultRemarkIndex ? styles.resultRemarkTextAsbestos : styles.listText}>{text}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.paragraph}>
          Should you have any questions or need additional information, please contact our office at {settings.business_phone}. Thank you for the
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
// SanAir don't carry a MassDLS cert). Uses its own lead_report_summary/
// lead_report_notes/lead_lab_name/lead_lab_cert fields rather than
// asbestos's report_summary/report_notes/lab_name/lab_nist_cert — a job
// combining asbestos and lead used to leak content (and overwrite lab
// info) between the two domains' reports before this split existed.
// Neither real example showed a
// license # under the signature, so this omits it like the mold letter
// does. No "Field Technician" row — both real letters leave it blank and
// nothing in this app tracks who was on site, so there's no value to show.
function LeadReportDocument({ job, customer, settings }: ProjectReportData) {
  // See AsbestosReportDocument's identical comment — only this report's own
  // domain's sample_counts entries count toward its total.
  const sampleCountsTotal = Object.entries(job.sample_counts ?? {})
    .filter(([label]) => domainForServiceTypeLabel(label) === "lead")
    .reduce((sum, [, n]) => sum + (n || 0), 0);
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
  // lead_report_summary AND the matching lead_result together (they're the
  // same determination) — skip re-adding it here when it just repeats the
  // remark above verbatim.
  if (job.lead_report_summary && job.lead_report_summary !== LEAD_POSITIVE_REMARK && job.lead_report_summary !== LEAD_NEGATIVE_REMARK) {
    remarks.push(job.lead_report_summary);
  }
  if (job.lead_report_notes) remarks.push(job.lead_report_notes);

  const { knownCustomerName, dateText, billingStreet, billing, serviceStreet, service } = commonLetterFields(job, customer, settings);

  return (
    <Document title={`Bulk Paint Chip Sample Analytical Results — ${job.service_address}`}>
      <Page size="LETTER" style={styles.page}>
        <LetterHeader
          settings={settings}
          reTitle="Bulk Paint Chip Sample Analytical Results"
          knownCustomerName={knownCustomerName}
          serviceAddress={job.service_address}
          projectNumber={job.project_number}
          dateText={dateText}
        />

        <View style={styles.reBlock}>
          <View style={styles.reRowTop}>
            <View style={styles.reTopLeft}>
              <Text style={styles.reLabel}>RE:</Text>
              <Text>Bulk Paint Chip Sample Analytical Results</Text>
            </View>
            <Text style={styles.dateLine}>{dateText}</Text>
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

        <RecipientBlock
          knownCustomerName={knownCustomerName}
          customer={customer}
          billingStreet={billingStreet}
          billingCityStateZip={billing.cityStateZip}
        />

        <Text style={styles.salutation}>Dear <ValueOrBlank style={styles.salutation} value={knownCustomerName} inline />:</Text>

        <Text style={styles.paragraph}>
          {settings.business_name} collected paint chip samples as directed from the address noted above. Samples were
          transported under chain-of-custody protocol to an accredited laboratory for analysis.
        </Text>

        <Text style={styles.sectionTitleTight}>Sampling Summary:</Text>
        <View style={styles.summaryBlock}>
          <View style={styles.summaryRow}><Text style={styles.summaryLabel}>Date of Sampling:</Text><ValueOrBlank style={styles.summaryValue} value={formatDateMDY(job.lead_date_sampled ?? job.requested_date)} /></View>
          <View style={styles.summaryRow}><Text style={styles.summaryLabel}>Total # of Samples:</Text><ValueOrBlank style={styles.summaryValue} value={totalSamples} /></View>
          <View style={styles.summaryRow}><Text style={styles.summaryLabel}>Samples Analyzed At:</Text><ValueOrBlank style={styles.summaryValue} value={job.lead_lab_name} /></View>
          <View style={styles.summaryRow}><Text style={styles.summaryLabel}>AIHA Certification#:</Text><ValueOrBlank style={styles.summaryValue} value={job.lead_lab_cert} /></View>
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

// Pre-Renovation/Pre-Demolition — a full, inspector-directed survey of the
// whole property, structurally and substantively different from Limited's
// short client-directed sampling letter above. Modeled verbatim on 12 real
// past reports (all "Inspection for Asbestos Containing Materials" format,
// all the same structure regardless of address/findings). One <Page> — like
// MoldReportDocument, not AsbestosReportDocument — since this always runs
// multiple physical pages (Appendix A/B tables), unlike the simple letter
// which is deliberately held to one page.
function FullInspectionAsbestosReportDocument({ job, customer, settings }: ProjectReportData) {
  const inspector = primaryInspector(settings);
  const materials = job.full_inspection_materials ?? [];
  const acmMaterials = materials.filter((m) => m.is_acm);
  const nonAcmMaterials = materials.filter((m) => !m.is_acm);

  const remarks = [FULL_INSPECTION_ADDITIONAL_SUSPECT_REMARK];
  if (job.asbestos_result === "positive") {
    remarks.push(FULL_INSPECTION_ACM_ABATEMENT_REMARK, FULL_INSPECTION_ACM_PLAN_DISCLAIMER_REMARK);
  } else if (job.asbestos_result === "negative") {
    remarks.push(ASBESTOS_NEGATIVE_REMARK);
  } else {
    remarks.push("NO RESULTS YET.");
  }
  // Further per-finding narrative the admin writes by hand (e.g. "Areas
  // where damaged Textured Skim Coating... considered contaminated...") —
  // one line per remark, continuing the numbering. Reuses report_notes,
  // the same field AsbestosReportDocument's own comment calls out as
  // existing specifically for this and never having a UI to reach it.
  remarks.push(...paragraphsFromText(job.report_notes));

  const { knownCustomerName, dateText, billingStreet, billing, serviceStreet, service } = commonLetterFields(job, customer, settings);

  return (
    <Document title={`Inspection for Asbestos Containing Materials — ${job.service_address}`}>
      <Page size="LETTER" style={[styles.page, styles.pageFullInspection]}>
        <LetterHeader
          settings={settings}
          reTitle="Inspection for Asbestos Containing Materials"
          knownCustomerName={knownCustomerName}
          serviceAddress={job.service_address}
          projectNumber={job.project_number}
          dateText={dateText}
        />

        {/* Recipient block leads with the date paired against the customer
            name, top-right — then RE: (with Project # as RE's own first
            line, not its last), not the date-shares-the-RE-line layout the
            other 3 templates use. */}
        <RecipientBlock
          knownCustomerName={knownCustomerName}
          customer={customer}
          billingStreet={billingStreet}
          billingCityStateZip={billing.cityStateZip}
          dateText={dateText}
          style={styles.recipientBlockFullInspection}
        />

        <View style={styles.reBlockFullInspection}>
          <View style={styles.reRow}>
            <Text style={styles.reLabel}>RE:</Text>
            <Text style={styles.reProjectLabel}>Project #:</Text>
            <ValueOrBlank style={styles.reValue} value={job.project_number} inline />
          </View>
          <View style={styles.reRow}>
            <Text style={styles.reLabel} />
            <Text style={styles.reValue}>Inspection for Asbestos Containing Materials at</Text>
          </View>
          <View style={styles.reRow}>
            <Text style={styles.reLabel} />
            <ValueOrBlank style={styles.reValue} value={serviceStreet} inline />
          </View>
          <View style={styles.reRow}>
            <Text style={styles.reLabel} />
            <ValueOrBlank style={styles.reValue} value={service.cityStateZip} inline />
          </View>
        </View>

        <Text style={styles.salutationFullInspection}>Dear <ValueOrBlank style={styles.salutationFullInspection} value={knownCustomerName} inline />:</Text>

        <Text style={styles.paragraph}>
          {settings.business_name} performed an inspection for asbestos containing materials (ACMs) at the property
          located at the address noted above. This report outlines the initial visual survey, sample collection and
          summary of analytical results provided by {settings.business_name}.
        </Text>

        <Text style={styles.sectionTitleFullInspection}>Inspection Summary:</Text>
        <View style={styles.summaryBlock}>
          <View style={styles.summaryRow}><Text style={styles.summaryLabel}>Asbestos Inspector:</Text><ValueOrBlank style={styles.summaryValue} value={inspector.name} /></View>
          <View style={styles.summaryRow}><Text style={styles.summaryLabel}>License #:</Text><ValueOrBlank style={styles.summaryValue} value={inspector.license_number} /></View>
          <View style={styles.summaryRow}><Text style={styles.summaryLabel}>Date of Inspection:</Text><ValueOrBlank style={styles.summaryValue} value={formatDateMDY(job.lab_date_sampled ?? job.requested_date)} /></View>
          <View style={styles.summaryRow}><Text style={styles.summaryLabel}>Total Materials Sampled:</Text><ValueOrBlank style={styles.summaryValue} value={materials.length} /></View>
          <View style={styles.summaryRow}><Text style={styles.summaryLabel}>Samples Analyzed At:</Text><ValueOrBlank style={styles.summaryValue} value={job.lab_name} /></View>
          <View style={styles.summaryRow}><Text style={styles.summaryLabel}>NIST/NVLAP Certification#:</Text><ValueOrBlank style={styles.summaryValue} value={job.lab_nist_cert} /></View>
          <View style={styles.summaryRow}><Text style={styles.summaryLabel}>MassDLS Lab Certification#:</Text><ValueOrBlank style={styles.summaryValue} value={job.lab_massdls_cert} /></View>
        </View>

        <Text style={styles.sectionTitleFullInspection}>Scope and Approach:</Text>
        <Text style={styles.paragraph}>{settings.business_name} {FULL_INSPECTION_SCOPE_PARAGRAPH}</Text>
        <Text style={styles.paragraph}>{FULL_INSPECTION_NON_SUSPECT_PARAGRAPH}</Text>
        <Text style={styles.paragraph}>{FULL_INSPECTION_WALLS_PARAGRAPH}</Text>

        <Text style={styles.sectionTitleFullInspection}>Bulk Sampling:</Text>
        <Text style={styles.paragraph}>{FULL_INSPECTION_BULK_SAMPLING_PARAGRAPH}</Text>

        <Text style={styles.sectionTitleFullInspection}>Asbestos Containing Materials:</Text>
        <Text style={styles.paragraph}>{FULL_INSPECTION_ACM_CATEGORY_PARAGRAPH}</Text>

        <Text style={styles.sectionTitleFullInspection}>Non-Asbestos Containing Materials:</Text>
        <Text style={styles.paragraph}>{FULL_INSPECTION_NON_ACM_CATEGORY_PARAGRAPH}</Text>

        <Text style={styles.sectionTitleFullInspection}>Remarks and Limitations:</Text>
        <View style={styles.listBlock}>
          {remarks.map((text, i) => (
            <View style={styles.listItemFullInspection} key={i}>
              <Text style={styles.listIndex}>{i + 1}.</Text>
              <Text style={styles.listText}>{text}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.paragraph}>
          Should you have any questions or need additional information, please contact our office at {settings.business_phone}. Thank you for the
          opportunity to provide you with our services and we look forward to working together in the future.
        </Text>

        <SignatureBlock settings={settings} showLicense />

        <Text style={styles.sectionTitleFullInspection} break>Appendix A</Text>
        <Text style={styles.paragraph}>Asbestos Containing Materials Summary Table</Text>
        <View style={styles.appendixTable}>
          <View style={styles.appendixHeaderRow}>
            <Text style={[styles.appendixColMaterialA, styles.appendixHeaderText]}>Material</Text>
            <Text style={[styles.appendixColLocationA, styles.appendixHeaderText]}>Location</Text>
            <Text style={[styles.appendixColQuantityA, styles.appendixHeaderText]}>Estimated Quantity</Text>
            <Text style={[styles.appendixColSamplesA, styles.appendixHeaderText]}>Sample #(&apos;s)</Text>
          </View>
          {acmMaterials.map((m, i) => (
            <View style={styles.appendixRow} key={i}>
              <Text style={[styles.appendixColMaterialA, styles.appendixCellText]}>{m.material}</Text>
              <Text style={[styles.appendixColLocationA, styles.appendixCellText]}>{m.locations.join(", ")}</Text>
              <Text style={[styles.appendixColQuantityA, styles.appendixCellText]}>{m.estimated_quantity ?? ""}</Text>
              <Text style={[styles.appendixColSamplesA, styles.appendixCellText]}>{m.sample_numbers}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.sectionTitleFullInspection} break>Appendix B</Text>
        <Text style={styles.paragraph}>Suspect Materials Found Not to Contain Asbestos</Text>
        <View style={styles.appendixTable}>
          <View style={styles.appendixHeaderRow}>
            <Text style={[styles.appendixColSamplesB, styles.appendixHeaderText]}>Sample #(&apos;s)</Text>
            <Text style={[styles.appendixColMaterialB, styles.appendixHeaderText]}>Material</Text>
            <Text style={[styles.appendixColLocB, styles.appendixHeaderText]}>Sample Location A</Text>
            <Text style={[styles.appendixColLocB, styles.appendixHeaderText]}>Sample Location B</Text>
            <Text style={[styles.appendixColLocB, styles.appendixHeaderText]}>Sample Location C</Text>
          </View>
          {nonAcmMaterials.map((m, i) => (
            <View style={styles.appendixRow} key={i}>
              <Text style={[styles.appendixColSamplesB, styles.appendixCellText]}>{m.sample_numbers}</Text>
              <Text style={[styles.appendixColMaterialB, styles.appendixCellText]}>{m.material}</Text>
              <Text style={[styles.appendixColLocB, styles.appendixCellText]}>{m.locations[0] ?? ""}</Text>
              <Text style={[styles.appendixColLocB, styles.appendixCellText]}>{m.locations[1] ?? ""}</Text>
              <Text style={[styles.appendixColLocB, styles.appendixCellText]}>{m.locations[2] ?? ""}</Text>
            </View>
          ))}
        </View>
      </Page>
    </Document>
  );
}

// Modeled directly on two real final mold reports (letterhead cover letter +
// EMSL Air-O-Cell/bulk lab reports as an appendix) — see the "MOLD 26-2641"
// and "FINAL MOLD REPORT 14 Rawson Road" letters. Scope of Work, Sampling
// Methodology, and Limitations are fixed boilerplate matched to those
// letters; Discussion of Results and Conclusions & Recommendations are
// exactly what the admin enters in mold_report_summary/mold_report_notes
// (separate from asbestos/lead's report_summary/report_notes, since a job
// combining mold with either produces two separate final reports) — this
// letter doesn't try to auto-structure that text,
// since the real letters are themselves free-form prose written per job.
function MoldReportDocument({ job, customer, settings }: ProjectReportData) {
  const { knownCustomerName, dateText, billingStreet, billing, serviceStreet, service } = commonLetterFields(job, customer, settings);

  // Which methodology sections apply — driven by job.service_type (known
  // from booking, see moldServiceTypeFlags), same source as Scope of Work,
  // rather than sample_counts which stays empty until lab results come in.
  const { hasAir, hasBulk, hasSwab } = moldServiceTypeFlags(job.service_type);

  const scopeItems = [...moldScopeOfWorkItems(job.service_type), MOLD_SCOPE_CLOSING_LINE];

  const rawLabName = job.mold_lab_name || "an accredited laboratory";
  const labCity = settings.labs.find((l) => l.name === job.mold_lab_name)?.city?.trim();
  // Only strip the lab name's own trailing period when it's about to sit at
  // the end of the sentence — followed by "located in [city]" it needs its
  // natural punctuation kept (e.g. "EMSL Analytical, Inc. located in...",
  // not "...Inc located in...").
  const labNameWithCity = labCity ? `${rawLabName} located in ${labCity}` : rawLabName.replace(/\.+$/, "");
  // Confirmed word-for-word identical across two independent real reports —
  // one air+bulk combo, one bulk-only — so it's attached to both Air's and
  // Bulk's own paragraphs below. A real swab-only report confirmed this
  // caveat does NOT appear there, so swab's paragraph stays without it.
  const SPORE_ID_CAVEAT =
    "This method does not differentiate between viable and non-viable fungal spores. In addition, this technique does not allow for the differentiation between Aspergillus and Penicillium spores. Other non-distinctive spores are reported in categories such as Ascospores or Basidiospores.";
  // Air and swab share one section when both are present — confirmed
  // verbatim against real air+swab combo reports, which merge both
  // collection tools into a single paragraph rather than giving swab its
  // own sub-section. Bulk uses a physically different collection method
  // (excising a material sample vs. an air pump or surface swab) so it
  // keeps its own section. Each section's own heading names its type
  // ("Airborne"/"Bulk"/"Swab") — confirmed against real air+bulk combo and
  // bulk-only reports, which both use type-specific headings here (not the
  // generic "Sampling for Mold:" an earlier pass wrongly assumed from a
  // single swab-only counterexample).
  const methodologySections = [
    ...(hasAir
      ? [
          {
            title: "Airborne Sampling for Mold:",
            paragraphs: [
              `The concentration and identification of the genera of airborne mold was performed through the use of Air-O-Cell cassettes${hasSwab ? " and swabs" : ""}. This method utilizes an air pump to draw air at a predetermined flow rate through a spore trap cassette containing a slide coated with an optically-transparent adhesive. Airborne particulate, including spores is impacted onto the slide, and then submitted to the laboratory where it is stained and analyzed by optical microscopy at magnifications between 200X and 1000X. Samples collected at the above referenced location were enumerated and speciated by ${labNameWithCity}.`,
              SPORE_ID_CAVEAT,
            ],
          },
        ]
      : hasSwab
      ? [
          {
            title: "Swab Sampling for Mold:",
            paragraphs: [
              // Confirmed against a real swab-only report: unlike air and
              // bulk, swab's own paragraph does NOT get the spore-ID caveat.
              `Swab samples of suspected mold growth were collected from the affected surfaces to identify the genera of mold, if present. Upon receipt at the laboratory, a sub-sample is prepared and applied directly to a microscopic slide, where it is stained and analyzed by optical microscopy at magnifications between 200X and 1000X. The swabs collected at the above referenced address were enumerated and speciated by ${labNameWithCity}.`,
            ],
          },
        ]
      : []),
    ...(hasBulk
      ? [
          {
            title: "Bulk Sampling for Mold:",
            paragraphs: [
              // Confirmed verbatim (aside from lab name/city) against two
              // independent real reports — never assume the old, invented
              // wording this replaced without a real example to check against.
              `Bulk samples of building materials suspected mold growth were collected to identify the genera of mold, if present. Upon receipt at the laboratory, a sub-sample is prepared and applied directly to a microscopic slide, where it is stained and analyzed by optical microscopy at magnifications between 200X and 1000X. The bulk samples were enumerated and speciated by ${labNameWithCity}.`,
              SPORE_ID_CAVEAT,
            ],
          },
        ]
      : []),
  ];

  const conclusionBlocks = blocksFromText(job.mold_report_notes);
  const discussionParagraphs = paragraphsFromText(job.mold_report_summary);
  const isNewtonFireFlood = customer.company_id === NEWTON_FIRE_FLOOD_COMPANY_ID;
  const standardConclusionBlocks = isNewtonFireFlood ? blocksFromText(NEWTON_FIRE_FLOOD_STANDARD_MOLD_CONCLUSION) : [];

  // "[N] samples were collected on [date] inside the building. An ambient
  // sample was collected outside..." — the air total in sample_counts
  // includes the always-present, always-invoiced ambient sample, so
  // subtracting 1 gives the indoor-only count (confirmed). Falls back to
  // the outline's own bracketed placeholders when there's no lab data yet
  // rather than showing a nonsensical "Zero (0) samples."
  const airSampleTotal = Object.entries(job.sample_counts ?? {})
    .filter(([label]) => label.toLowerCase().includes("air"))
    .reduce((sum, [, n]) => sum + (n || 0), 0);
  const indoorAirSampleCount = airSampleTotal > 0 ? airSampleTotal - 1 : 0;
  const moldSampledDate = job.mold_date_sampled ?? job.requested_date;
  const samplingDateText = moldSampledDate
    ? new Date(`${moldSampledDate}T00:00:00`).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
    : null;
  const airSampleCountSentence =
    indoorAirSampleCount > 0 && samplingDateText
      ? `${NUMBER_WORDS[indoorAirSampleCount] ?? indoorAirSampleCount} (${indoorAirSampleCount}) samples were collected on ${samplingDateText} inside the building. An ambient sample was collected outside for comparison with the indoor sample.`
      : "[Number of samples] samples were collected on [Date of Sampling] inside the building. An ambient sample was collected outside for comparison with the indoor sample.";

  return (
    <Document title={`Limited Mold Assessment & Sampling — ${job.service_address}`}>
      <Page size="LETTER" style={styles.page}>
        <LetterHeader
          settings={settings}
          reTitle="Limited Mold Assessment & Sampling"
          knownCustomerName={knownCustomerName}
          serviceAddress={job.service_address}
          projectNumber={job.project_number}
          dateText={dateText}
        />

        <View style={styles.reBlock}>
          <View style={styles.reRowTop}>
            <View style={styles.reTopLeft}>
              <Text style={styles.reLabel}>RE:</Text>
              <Text>Limited Mold Assessment & Sampling</Text>
            </View>
            <Text style={styles.dateLine}>{dateText}</Text>
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

        <RecipientBlock
          knownCustomerName={knownCustomerName}
          customer={customer}
          billingStreet={billingStreet}
          billingCityStateZip={billing.cityStateZip}
        />

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
        {hasAir && (
          <>
            <Text style={styles.subHeading}>1. Airborne Sampling for Mold:</Text>
            <Text style={styles.paragraph}>{MOLD_ACGIH_PARAGRAPH}</Text>
            <Text style={styles.paragraph}>{airSampleCountSentence}</Text>
          </>
        )}
        {discussionParagraphs.length > 0
          ? discussionParagraphs.map((p, i) => <Text style={styles.paragraph} key={i}>{p}</Text>)
          : !hasAir && <Text style={styles.paragraph}>NO RESULTS YET.</Text>}

        <Text style={styles.romanTitle} minPresenceAhead={30}>IV.  CONCLUSIONS & RECOMMENDATIONS</Text>
        {hasAir && (
          <>
            <Text style={styles.paragraph}>{MOLD_INDOOR_AIR_QUALITY_PARAGRAPH}</Text>
            <Text style={styles.paragraph}>{MOLD_AIR_INVESTIGATION_GOAL_PARAGRAPH}</Text>
          </>
        )}
        {standardConclusionBlocks.length > 0 && <RenderTextBlocks blocks={standardConclusionBlocks} />}
        {conclusionBlocks.length > 0
          ? <RenderTextBlocks blocks={conclusionBlocks} />
          : !hasAir && !isNewtonFireFlood && <Text style={styles.paragraph}>NO RECOMMENDATIONS YET.</Text>}

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

// Page 1 gets the full logo/phone letterhead; page 2+ swaps to a compact
// plain-text identification block instead (subject, customer, address on
// the left; project #, date, page number on the right) — matches real
// multi-page letters, and lets a page stand on its own if separated from
// the rest of the packet. Only the continuation header is `fixed` (it must
// repeat identically on every page 2+); the page-1 header is a plain child
// since it only ever needs to render once, at the top of the flow — see the
// note above it. For the continuation header, style must live on the View
// returned FROM render(), never on the outer fixed View itself — putting it
// there silently broke rendering entirely on every page but the first
// (confirmed empirically against several isolated repros before finding
// this).
function LetterHeader({
  settings, reTitle, knownCustomerName, serviceAddress, projectNumber, dateText,
}: {
  settings: Settings;
  reTitle: string;
  knownCustomerName: string | null;
  serviceAddress: string;
  projectNumber: string | null;
  dateText: string;
}) {
  return (
    <>
      {/* Not `fixed` — this only ever needs to appear once, at the top of
          page 1's normal document flow, which is exactly where it lands
          without repeating. */}
      <View style={styles.header}>
        <Image src={LOGO_PATH} style={styles.logo} />
        {settings.business_phone && (
          <>
            <View style={styles.headerSpacer} />
            <Text style={styles.headerContact}>{settings.business_phone}</Text>
          </>
        )}
        {settings.business_email && (
          <>
            <View style={styles.headerSpacer} />
            <Text style={styles.headerContact}>{settings.business_email}</Text>
          </>
        )}
      </View>
      <View fixed render={({ pageNumber }) => pageNumber === 1 ? null : (
        <View style={styles.continuationHeader}>
          <View style={styles.continuationHeaderLeft}>
            <Text style={styles.continuationHeaderLine}>{reTitle}</Text>
            <Text style={styles.continuationHeaderLine}>{knownCustomerName}</Text>
            <Text style={styles.continuationHeaderLine}>{serviceAddress}</Text>
          </View>
          <View style={styles.continuationHeaderRight}>
            {projectNumber && <Text style={styles.continuationHeaderLine}>Project #: {projectNumber}</Text>}
            <Text style={styles.continuationHeaderLine}>{dateText}</Text>
            <Text style={styles.continuationHeaderLine}>Page {pageNumber}</Text>
          </View>
        </View>
      )} />
    </>
  );
}

// Shared across all 4 letter templates. For the 3 templates whose RE block
// carries the date on its own top line, dateText is omitted here and this
// is just name/company/billing address. Full-inspection instead passes
// dateText through — its RE block leads with Project #, not the date — so
// the date pairs with the customer name on this block's own top line
// instead, top-right, matching the real FLI letters' recipient block. Each
// line only rendered when there's real content for it. A billing address
// that's entirely missing renders nothing at all (not even a blank
// fill-in line): unlike the customer name, which every letter needs some
// line for, an absent billing address is just... absent.
function RecipientBlock({
  knownCustomerName, customer, billingStreet, billingCityStateZip, dateText, style,
}: {
  knownCustomerName: string | null;
  customer: Customer;
  billingStreet: string;
  billingCityStateZip: string;
  dateText?: string;
  style?: Style;
}) {
  return (
    <View style={style ?? styles.recipientBlock}>
      {dateText ? (
        <View style={styles.recipientRow}>
          <ValueOrBlank style={styles.recipient} value={knownCustomerName} inline />
          <Text style={styles.dateLine}>{dateText}</Text>
        </View>
      ) : (
        <ValueOrBlank style={styles.recipient} value={knownCustomerName} />
      )}
      {customer.company && <Text style={styles.recipient}>{customer.company}</Text>}
      {billingStreet && <Text style={styles.recipient}>{billingStreet}</Text>}
      {billingCityStateZip && <Text style={styles.recipient}>{billingCityStateZip}</Text>}
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

  // Town/state/zip always gets its own line under the street, matching the
  // real FLI letter's recipient block and RE: block — both the customer's
  // billing address and the job site address get the same treatment.
  const billing = splitAddress(customer.billing_address);
  const billingStreet = billing.locationName ? `${billing.locationName} ${billing.street}` : billing.street;
  const service = splitAddress(job.service_address);
  const serviceStreet = service.locationName ? `${service.locationName} ${service.street}` : service.street;

  return { knownCustomerName, dateText, billingStreet, billing, serviceStreet, service };
}

// Renders exactly one domain's letter — used directly wherever the caller
// already knows which domain it wants (the ?type= download routes, the
// per-domain email attachments).
export async function renderProjectReportPdfForDomain(data: ProjectReportData, domain: ReportDomain): Promise<Buffer> {
  return renderToBuffer(<ReportDocumentForDomain {...data} domain={domain} />);
}

// One buffer per domain actually present on the job (see jobReportDomains)
// — a job combining domains produces one entry per domain here, not one
// combined document.
export async function renderProjectReportPdfsByDomain(
  data: ProjectReportData
): Promise<{ domain: ReportDomain; buffer: Buffer }[]> {
  const domains = jobReportDomains(data.job.service_type);
  return Promise.all(domains.map(async (domain) => ({ domain, buffer: await renderProjectReportPdfForDomain(data, domain) })));
}
