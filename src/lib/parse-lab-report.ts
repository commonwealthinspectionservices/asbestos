// EMSL's bulk-material asbestos PLM reports (the lab format currently in
// use) list one row per physical sample, each carrying both a field code
// (e.g. "01A") and a unique lab ID built from the report's own EMSL Order
// number (e.g. "132605192-0001"). Counting how many of those unique IDs
// share the same order-number prefix is a reliable stand-in for the sample
// count without needing to parse the whole table layout.
//
// PDF text extraction doesn't preserve on-page reading order — labels and
// values can come out in either order ("EMSL Order:\n132605192" or
// "132605192\nEMSL Order:") depending on how the PDF's content stream was
// authored — so rather than anchoring on the "EMSL Order:" label at all,
// this groups every "digits-dash-4digits" match by its digit prefix and
// takes the largest group. The sample IDs all share one prefix (this
// report's order number) and repeat many times; any other coincidental
// match elsewhere in the document is a one-off and won't win.
//
// A row only counts as a completed sample if the lab actually reported a
// result for it — "None Detected" or a positive percentage of one of the
// six regulated asbestos minerals. A row can carry a field code and lab ID
// without ever being analyzed (not enough material submitted, the expected
// layer wasn't present, etc.) — those come back with something else
// entirely instead of a result, so this allow-lists the two real outcomes
// rather than trying to enumerate every phrasing a "not analyzed" row
// might use.
const ASBESTOS_MINERALS = "chrysotile|amosite|crocidolite|tremolite|anthophyllite|actinolite";
const POSITIVE_PATTERN = new RegExp(`\\d+%\\s*(?:${ASBESTOS_MINERALS})|(?:${ASBESTOS_MINERALS})\\s*\\d+%`, "i");
const RESULT_PATTERN = new RegExp(`none detected|${POSITIVE_PATTERN.source}`, "i");

// Crystal Analytical's "Asbestos %" and "Physical Attributes" columns can
// land in different, non-adjacent stretches of the linearized text for the
// same row (confirmed against a real positive report: one row's "25%" and
// "Chrysotile" ended up separated by the whole next row's physical-
// attributes text, while another row's "10% Chrysotile" stayed together) —
// so a bare mineral name with no percentage anywhere nearby is still
// treated as a positive result for that lab's rows specifically, rather
// than requiring the percentage to be adjacent the way EMSL's own layout
// reliably keeps it. No \b boundary before the mineral name — the same
// report confirmed the preceding word can run straight into it with zero
// space ("...On Concrete BaseChrysotile"), which a leading \b can't cross
// since both neighboring characters are word characters.
const BARE_MINERAL_PATTERN = new RegExp(`(?:${ASBESTOS_MINERALS})\\b`, "i");

export interface SampleResult {
  /** The lab's field code for this sample (e.g. "01A") — falls back to the lab ID itself if the report's layout doesn't put one on its own line right before it. */
  fieldCode: string;
  /** The result text, in whatever casing the report used, spaced for readability (e.g. "None Detected", "15% Chrysotile"). */
  result: string;
}

// The real reports don't reliably put a space between a percentage and the
// mineral name either side of it ("15%Chrysotile") — insert one for display
// without touching anything else about the report's own wording/casing.
function normalizeResultText(raw: string): string {
  // Crystal Analytical's percentage and mineral name can land with a line
  // break between them rather than no space at all — collapse any run of
  // whitespace between them down to one space the same way the no-space
  // case gets one inserted, so the display is a single clean line either way.
  return raw
    .replace(/(\d+%)\s*([A-Za-z])/, "$1 $2")
    .replace(/([A-Za-z])\s*(\d+%)/, "$1 $2");
}

// Walks every unique sample ID in the report and pulls out its field code
// and result text. Shared by extractSampleCount, detectAsbestosResult, and
// extractSampleResults so all three walk the report exactly the same way.
function bestReportSamples(pdfText: string): SampleResult[] {
  const idPattern = /\d{6,}-\d{4}/g;
  const matches = [...pdfText.matchAll(idPattern)];
  if (matches.length === 0) return [];

  const byPrefix = new Map<string, SampleResult[]>();
  const seen = new Set<string>();
  for (let i = 0; i < matches.length; i++) {
    const idMatch = matches[i];
    const labId = idMatch[0];
    if (seen.has(labId)) continue;
    seen.add(labId);

    const start = idMatch.index! + labId.length;
    const end = i + 1 < matches.length ? matches[i + 1].index! : pdfText.length;
    const followingText = pdfText.slice(start, end);
    const resultMatch = followingText.match(RESULT_PATTERN);
    if (!resultMatch) continue;

    // The field code sits alone on the line right before the lab ID in
    // every real report seen so far (e.g. "01A\n132605194-0001\n...").
    const beforeText = pdfText.slice(0, idMatch.index).trimEnd();
    const fieldCode = beforeText.slice(beforeText.lastIndexOf("\n") + 1).trim() || labId;

    const prefix = labId.split("-")[0];
    const samples = byPrefix.get(prefix) ?? [];
    samples.push({ fieldCode, result: normalizeResultText(resultMatch[0]) });
    byPrefix.set(prefix, samples);
  }

  let best: SampleResult[] = [];
  for (const samples of byPrefix.values()) {
    if (samples.length > best.length) best = samples;
  }
  return best;
}

// Crystal Analytical's reports have no per-sample lab ID to anchor on at
// all (unlike EMSL's "132605194-0001") — the only reliable per-row marker
// is the "Client ID" field code itself (e.g. "01A", or "02B.1"/"02B.2" when
// a sample gets split into sub-items), which the report's own layout
// always puts at the very start of that row's line. Same windowing
// approach as bestReportSamples: everything between one field code and the
// next is that row's own material/result text.
// No required whitespace after the code — real reports sometimes run the
// code straight into the next word with no space at all ("01BWhite Mastic,
// Kitchen- On Concrete Base...").
// Not anchored to line-start: confirmed against a real report where two
// rows share identical material text, and the second one's code came out
// *after* the description ("Plaster Ceiling Base, Kitchen01B") instead of
// before it like every other row in the same document. But dropping the
// anchor opens a real false-positive: the "Item ID" column's own 4-digit
// codes run straight into the physical-attribute color word with no space
// ("0001Gray"), and the trailing "01G" looks exactly like a field code.
// The distinguishing signal is what follows — a genuine code is followed
// by whitespace/punctuation (end of that token), while the Item ID false
// match is followed by more lowercase letters continuing the color word
// ("01G" + "ray"). Excluding a lowercase follower clears that up without
// needing to know in advance which layout a given report uses.
//
// A second false positive confirmed in the wild: some materials'
// descriptions reference a *different* sample by code as part of their own
// text ("Assoc Adhesive 04B, Kitchen...", "Mastic 02A, Kitchen..."), which
// looks exactly like a real row start. The distinguishing signal there is
// what comes *before* — a genuine code sits at the very start of the
// window (start of text, right after a newline, or glued straight onto a
// letter with no space at all), while an in-description reference always
// has a plain space right before it (" 04B"). Excluding a space-preceded
// match clears that up too.
const FIELD_CODE_LINE_PATTERN = /(?<! )(\d{2}[A-Z](?:\.\d+)?)(?![a-z])/g;
const CRYSTAL_RESULT_PATTERN = new RegExp(`none detected|${POSITIVE_PATTERN.source}|${BARE_MINERAL_PATTERN.source}`, "i");

function bestReportSamplesCrystalAnalytical(pdfText: string): SampleResult[] {
  const matches = [...pdfText.matchAll(FIELD_CODE_LINE_PATTERN)];
  if (matches.length === 0) return [];

  const seen = new Set<string>();
  const samples: SampleResult[] = [];
  for (let i = 0; i < matches.length; i++) {
    const fieldCode = matches[i][1];
    if (seen.has(fieldCode)) continue;
    seen.add(fieldCode);

    const start = matches[i].index! + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index! : pdfText.length;
    let resultMatch = pdfText.slice(start, end).match(CRYSTAL_RESULT_PATTERN);

    // Confirmed against a real 2-sample report: the first sample's result
    // was drawn into the text stream *before* its own field code instead of
    // after (the second sample's result followed its field code normally,
    // as usual) — column draw order for a given row isn't guaranteed to put
    // the result cell after the ID cell. Only the very first field code gets
    // this backward fallback (searching from document start up to its own
    // position) since that region can't overlap any other sample's already-
    // matched forward window, so it can't steal a result that legitimately
    // belongs to someone else.
    if (!resultMatch && i === 0) {
      resultMatch = pdfText.slice(0, matches[i].index!).match(CRYSTAL_RESULT_PATTERN);
    }
    if (!resultMatch) continue;

    samples.push({ fieldCode, result: normalizeResultText(resultMatch[0]) });
  }
  return samples;
}

// Tries every recognized report layout in turn and uses whichever actually
// finds samples — each lab's own function returns an empty array rather
// than throwing when its format doesn't match, so this is a safe waterfall
// rather than something that needs to know in advance which lab sent the
// report.
// positionOrderedText is pdf-position-text.ts's reading-order reconstruction
// of the same PDF — only the Crystal Analytical branch needs it (see that
// module's own comment for why); EMSL's extractor runs on the plain
// stream-order text exactly as before. Optional so every caller that
// predates this fix (or genuinely has no buffer to re-parse) still works,
// just without the Crystal Analytical accuracy fix.
function bestReportSamplesAnyLab(pdfText: string, positionOrderedText?: string): SampleResult[] {
  const emsl = bestReportSamples(pdfText);
  if (emsl.length > 0) return emsl;
  return bestReportSamplesCrystalAnalytical(positionOrderedText ?? pdfText);
}

export function extractSampleCount(pdfText: string, positionOrderedText?: string): number | null {
  const count = bestReportSamplesAnyLab(pdfText, positionOrderedText).length;
  return count > 0 ? count : null;
}

// EMSL's mold reports (Air-O-Cell and Swab) use a completely different
// table layout than the asbestos PLM format above — a genus/category
// matrix per sample rather than a single result cell, with each sample's
// counts spread across columns rather than one result per row — so
// reliably parsing out an actual finding (dominant genus, count level)
// isn't attempted here; only which samples were really collected. What
// both formats do share with the asbestos ones is the same lab-ID shape
// ("digits-dash-4digits", e.g. "132605556-0001") sitting right before each
// sample's own data, and the "Client Sample ID" (e.g. "SW01", "1") as the
// very next line. Confirmed against two real reports: unused reserved ID
// slots get a "99XX" suffix and the literal text "Dummy" (or, for a swab
// QC sample, "Field Blank") in that same position — never a real client
// sample ID — so excluding those is enough to find only the samples
// actually collected. Only the first line right after the ID is checked,
// not the whole window up to the next ID: a multi-page Air-O-Cell report's
// page footer ("No discernable field blank was submitted...") sits inside
// that later window for the last sample on each page, and checking the
// whole window would wrongly exclude it.
function moldSampleFieldCodes(pdfText: string): string[] {
  const idPattern = /\d{6,}-\d{4}/g;
  const matches = [...pdfText.matchAll(idPattern)];

  const seen = new Set<string>();
  const fieldCodes: string[] = [];
  for (const idMatch of matches) {
    const labId = idMatch[0];
    if (seen.has(labId)) continue;
    seen.add(labId);

    const afterId = pdfText.slice(idMatch.index! + labId.length);
    const firstLine = afterId.trim().split("\n")[0]?.trim() ?? "";
    if (!firstLine || /dummy|blank/i.test(firstLine)) continue;

    fieldCodes.push(firstLine);
  }
  return fieldCodes;
}

// Crystal Analytical's Air-O-Cell-equivalent spore-trap reports (their own
// "BIO-SOP-001, Inertial Impactor (Spore Trap)" method) have no per-sample
// lab ID at all — instead, right before the results table's column headers
// ("Count / Struct/m³ / % of Total", repeated once per sample), the report
// lists each sample's own zero-padded 4-digit index once (e.g.
// "0003\n0001\n0002" for a 3-sample report, or glued together with no
// separator as "0004000100020003" for a 4-sample one — PDF text extraction
// varies which). Confirmed against 5 real reports spanning 2, 3, and 4
// samples: counting how many complete 4-digit groups appear in that run
// gives the right sample count every time. The negative lookbehind for a
// preceding digit stops this from matching into the last 4 digits of an
// unrelated 5-digit ZIP code sitting on the line just above (confirmed
// false positive: "Dedham, MA 02026" followed immediately by the real digit
// run swallowed the "2026" into it, undercounting a 3-sample report as 4).
//
// The per-sample field code itself isn't reliably extractable this way —
// unlike EMSL's format, a sample's real-world location name (e.g. "Kitchen",
// "Basement Bathroom") doesn't sit in a fixed, unambiguous position relative
// to its index in the extracted text (columns interleave unpredictably
// between samples) — so this only reports the sample's own zero-padded
// index, leading zeros stripped and sorted, as a stand-in label. Good
// enough to confirm a count and mark each as collected; the real location
// is only in the uploaded report itself, same as EMSL's mold format above.
//
// Crystal's other mold format ("BIO-SOP-002, Direct Analysis" — swab/tape)
// isn't handled here yet: only one real example seen so far (a single-
// sample report), not enough to confirm a pattern against the way this one
// was confirmed against five. Revisit once more real examples come in.
const CRYSTAL_SPORE_TRAP_COUNT_PATTERN = /(?<!\d)((?:\d{4}\s*){2,})Count\s*\n?\s*Struct\s*\/\s*m/;

function crystalSporeTrapFieldCodes(pdfText: string): string[] {
  const match = pdfText.match(CRYSTAL_SPORE_TRAP_COUNT_PATTERN);
  if (!match) return [];
  const digits = match[1].replace(/\s/g, "");
  if (digits.length % 4 !== 0) return [];
  const codes: string[] = [];
  for (let i = 0; i < digits.length; i += 4) {
    codes.push(String(Number(digits.slice(i, i + 4))));
  }
  return [...new Set(codes)].sort((a, b) => Number(a) - Number(b));
}

// Tries EMSL's mold layout first, then Crystal's spore-trap layout — same
// safe-waterfall shape as bestReportSamplesAnyLab for the asbestos formats
// above, since each lab's own function returns empty rather than throwing
// when its format doesn't match.
function moldSampleFieldCodesAnyLab(pdfText: string): string[] {
  const emsl = moldSampleFieldCodes(pdfText);
  if (emsl.length > 0) return emsl;
  return crystalSporeTrapFieldCodes(pdfText);
}

export function extractMoldSampleCount(pdfText: string): number | null {
  const count = moldSampleFieldCodesAnyLab(pdfText).length;
  return count > 0 ? count : null;
}

// One entry per sample actually collected (field code only) — mirrors
// extractSampleResults' shape for the admin's "Sample Results" box, but
// without an asbestos-style finding to report (see moldSampleFieldCodes
// above for why): "Analyzed" just confirms the lab received and processed
// that sample, not what it found. The full genus-level breakdown is only
// in the uploaded report itself, viewable from its own thumbnail.
export function extractMoldSampleResults(pdfText: string): SampleResult[] {
  return moldSampleFieldCodesAnyLab(pdfText).map((fieldCode) => ({ fieldCode, result: "Analyzed" }));
}

// The lab itself makes the positive/negative call, not FLI — any sample
// result carrying a percentage + one of the six regulated minerals means
// the report as a whole is positive, full stop, regardless of how many
// other samples came back "None Detected". Only when every analyzed sample
// came back "None Detected" is the report negative. Returns null when no
// recognized sample results were found at all (not this report format, or
// an unreadable PDF) — left for the admin to set by hand.
export function detectAsbestosResult(pdfText: string, positionOrderedText?: string): "positive" | "negative" | null {
  const samples = bestReportSamplesAnyLab(pdfText, positionOrderedText);
  if (samples.length === 0) return null;
  return samples.some((s) => POSITIVE_PATTERN.test(s.result) || BARE_MINERAL_PATTERN.test(s.result))
    ? "positive"
    : "negative";
}

// One entry per analyzed sample (field code + result), for showing the
// admin the actual per-sample breakdown behind the auto-detected result —
// same allow-list as extractSampleCount, so a row only shows up here once
// it's actually been analyzed.
export function extractSampleResults(pdfText: string, positionOrderedText?: string): SampleResult[] {
  return bestReportSamplesAnyLab(pdfText, positionOrderedText);
}

// Each recognized lab's own identity and standing certification numbers
// never change between reports, so once a report is recognized, these are
// always the correct values for the letter's "Samples Analyzed At" /
// "NIST/NVLAP Certification#" / "MassDLS Lab Certification#" lines — no
// need to make the admin type them in by hand every time. Matches the same
// cert numbers already configured in Settings' saved lab profiles.
const KNOWN_LABS = [
  { match: /EMSL/i, labName: "EMSL Analytical, Inc.", nistCert: "101147-0", massdlsCert: "AA000188" },
  { match: /Crystal Analytical/i, labName: "Crystal Analytical, LLC.", nistCert: "600387-0", massdlsCert: "AA000259" },
];

export function detectLabInfo(pdfText: string): { labName: string; nistCert: string; massdlsCert: string } | null {
  const lab = KNOWN_LABS.find((l) => l.match.test(pdfText));
  return lab ? { labName: lab.labName, nistCert: lab.nistCert, massdlsCert: lab.massdlsCert } : null;
}

// EMSL echoes back the client's own project number on its "Project:" line
// (e.g. "Project:\n26-2760 - 184 Dedham Street; Canton, MA"). Crystal
// Analytical's report labels it "Project ID:" or "Project Name:" instead
// (both seen across real reports) — same idea, different label, and PDF
// text extraction can separate a label from its value entirely (a whole
// block of labels, then a whole block of values), so anchoring on the
// label text isn't reliable for that layout. The fallback instead looks
// for FLI's own project-number shape directly: "2" + one digit, a dash,
// three to six digits (e.g. "26-2765") — restricted to a 2020s-style year
// prefix rather than any two digits, since a plain \d{2}-\d{3,6} matches
// regulatory citations these reports also quote verbatim (confirmed false
// positive: "82-020" out of "EPA 600/M4-82-020"). Used to catch a report
// uploaded to the wrong job by mistake; returns null (not a mismatch) when
// neither pattern is found, rather than guessing. Revisit the "2"-prefix
// restriction once project numbers roll past the 2020s.
export function extractReportProjectNumber(pdfText: string): string | null {
  const emslMatch = pdfText.match(/Project:\s*\n?\s*(\S+)/i);
  if (emslMatch) return emslMatch[1];

  const genericMatch = pdfText.match(/(?<!\d)(2\d-\d{3,6})(?!\d)/);
  return genericMatch ? genericMatch[1] : null;
}

// The lab's own "date samples were physically collected" line — Crystal
// Analytical's asbestos PLM reports label it "Date(s) Sampled:", its mold
// reports label the same thing "Collected:" instead (both confirmed
// against real reports). Same label/value-split problem as the sample
// table (see pdf-position-text.ts): the label and its own date sit apart
// in the raw PDF stream, so this only works reliably against
// position-ordered text — pass pdfText itself only as a last-resort
// fallback for a caller with no buffer to re-parse. Returns an ISO
// yyyy-mm-dd string (for a Postgres `date` column) rather than the
// report's own mm/dd/yy, assuming a 2000s century for the 2-digit year
// every real report seen so far uses.
export function extractSampledDate(pdfText: string, positionOrderedText?: string): string | null {
  const text = positionOrderedText ?? pdfText;
  const match = text.match(/(?:Date\(s\)\s*Sampled|Collected)\s*:\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})/i);
  if (!match) return null;
  const [, month, day, yearRaw] = match;
  const year = yearRaw.length === 2 ? `20${yearRaw}` : yearRaw;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}
