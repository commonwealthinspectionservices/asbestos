import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireAdminApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";
import { parseLineItems, lineItemsTotalCents } from "@/lib/invoice-line-items";
import { parseSampleItems, parseSampleCounts } from "@/lib/sample-items";

const EDITABLE_FIELDS = [
  "project_number",
  "requested_date",
  "confirmed_date",
  "confirmed_time",
  "schedule_visible_to_customer",
  "end_date",
  "paid_date",
  "payment_due_date",
  "requested_time",
  "notes",
  "duration_minutes",
  "status",
  "site_contact_name",
  "site_contact_phone",
  "project_name",
  "job_classification",
  "payment_method",
  "payment_type",
  "po_number",
  "invoice_number",
  "service_address",
  "service_type",
  "scope_of_work",
  "customer_id",
  "sample_count",
  "report_emails",
  "invoice_emails",
  "asbestos_result",
  "lead_result",
  "invoice_auto",
  "lab_turnaround",
  "lab_name",
  "lab_nist_cert",
  "lab_massdls_cert",
  "lab_cost_cents",
  "report_summary",
  "report_notes",
  "mold_report_summary",
  "mold_report_notes",
  "mold_lab_name",
  "is_individual",
  "report_release_override",
] as const;

export const PATCH = withApiErrors(async (
  req: NextRequest,
  { params }: { params: { id: string } }
) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  for (const field of EDITABLE_FIELDS) {
    if (field in body) patch[field] = body[field];
  }

  // Invoice line items are admin-editable directly from the Invoicing tab,
  // independent of the "Enter lab results" flow — validated the same way
  // .../complete/route.ts does, with the total always derived server-side
  // rather than trusted from the client.
  if ("invoice_line_items" in body) {
    const parsed = parseLineItems(body.invoice_line_items);
    if ("error" in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    patch.invoice_line_items = parsed.items;
    patch.invoice_total_cents = lineItemsTotalCents(parsed.items);
  }

  // sample_count is its own editable field (see EDITABLE_FIELDS) — settable
  // by hand from the lab's results, independent of how many rows are
  // logged in sample_items — so only default it to the row count here when
  // the admin isn't setting it explicitly in the same request.
  if ("sample_items" in body) {
    const parsed = parseSampleItems(body.sample_items);
    if ("error" in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    patch.sample_items = parsed.items;
    if (!("sample_count" in body)) {
      patch.sample_count = parsed.items.length;
    }
  }

  // One sample count per service type label (e.g. "Mold Air Sampling": 3),
  // shown as its own cell per service type on the Samples tab.
  if ("sample_counts" in body) {
    const parsed = parseSampleCounts(body.sample_counts);
    if ("error" in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    patch.sample_counts = parsed.counts;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No editable fields provided" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  // confirmed_date/confirmed_time/status are only ever advanced by a
  // deliberate action now — either AcceptScheduleControl (sends status,
  // confirmed_date, confirmed_time, and schedule_visible_to_customer
  // together) or the schedule_visible_to_customer toggle on JobRow (mirrors
  // from requested_date/requested_time, see below). A bare requested_date/
  // requested_time edit no longer silently promotes status — that used to
  // happen here, but it stood in for the accept step before one existed.
  // Set below once we know confirmed_date is genuinely going from empty to
  // set in this same request — sendJobConfirmedEmailIfDue re-checks
  // confirmation_sent_at itself before actually sending, so this is just a
  // cheap way to skip the extra fetch/import on every unrelated PATCH.
  let justConfirmedJobId: string | null = null;
  if ("requested_date" in patch || "requested_time" in patch || "schedule_visible_to_customer" in patch || "confirmed_date" in patch || "confirmed_time" in patch) {
    let current: { status?: string; requested_date?: string | null; requested_time?: string | null; schedule_visible_to_customer?: boolean; confirmed_date?: string | null } | null = null;
    const { data, error: selectError } = await supabase
      .from("jobs")
      .select("status, requested_date, requested_time, schedule_visible_to_customer, confirmed_date")
      .eq("id", params.id)
      .single();
    if (!selectError) {
      current = data;
    } else {
      // schedule_visible_to_customer not migrated onto this database yet —
      // fall back to without it so the save doesn't hard-fail; the visibility
      // sync below just no-ops until the migration runs.
      current = (await supabase.from("jobs").select("status, requested_date, requested_time").eq("id", params.id).single()).data;
    }

    // Only ever reaches the client when schedule_visible_to_customer is on
    // (see the toggle on JobRow) — defaults off, so a date is never shown
    // until the admin explicitly flips it. An explicit confirmed_date/
    // confirmed_time in this same patch (AcceptScheduleControl's own path,
    // whether or not it's also turning visibility on) always wins;
    // otherwise it stays live-mirrored to requested_date/requested_time as
    // the admin keeps editing, so a plain reschedule doesn't need a
    // separate confirm click. Flipping visibility off with no explicit
    // confirmed_date/time in the same patch (the plain JobRow toggle) hides
    // the date again — but an explicit confirmed_date/time takes
    // precedence even then, so "accept but keep hidden" doesn't silently
    // discard the date it just set.
    const willBeVisible = "schedule_visible_to_customer" in patch ? patch.schedule_visible_to_customer : current?.schedule_visible_to_customer;
    if (willBeVisible) {
      if (!("confirmed_date" in patch)) {
        patch.confirmed_date = "requested_date" in patch ? patch.requested_date : current?.requested_date ?? null;
      }
      if (!("confirmed_time" in patch)) {
        patch.confirmed_time = "requested_time" in patch ? patch.requested_time : current?.requested_time ?? null;
      }
    } else if ("schedule_visible_to_customer" in patch && !("confirmed_date" in patch) && !("confirmed_time" in patch)) {
      patch.confirmed_date = null;
      patch.confirmed_time = null;
    }

    // confirmed_date can only ever go from empty to set at the moment
    // schedule_visible_to_customer becomes true (see above) — there's no
    // other path to a real value, so this doubles as "is this job's
    // schedule newly visible to the customer" without needing a second,
    // separate check for that.
    if (!current?.confirmed_date && patch.confirmed_date) {
      justConfirmedJobId = params.id;
    }
  }

  // Records when a job first lands on "paid" — doesn't overwrite a date
  // that was already set (e.g. re-saving the job after it's paid) or one
  // the admin is explicitly backfilling in the same request. Tolerates the
  // paid_date column not existing yet (pending migration) rather than
  // failing the whole save over it. Also the trigger for auto-drafting the
  // final report (see autoDraftReportIfJustPaid below) — the report is
  // deliberately held back until payment, this is what releases it — so
  // this needs to know whether the job is newly becoming paid even when
  // paid_date itself is being explicitly backfilled in the same request.
  let justBecamePaid = false;
  if (patch.status === "paid") {
    const { data: current, error: selectError } = await supabase.from("jobs").select("status, paid_date, source").eq("id", params.id).single();
    // A subcontracted job reuses "paid" as its terminal "Done" status (see
    // SUBCONTRACTOR_PIPELINE_STATUSES in JobsDashboard.tsx) — that's the
    // site visit being complete, not an invoice being paid. Skipped here so
    // it never picks up a paid_date or triggers autoDraftReportIfJustPaid,
    // neither of which apply — these jobs have no invoice or report of
    // their own at all (the subcontracting company handles both).
    if (!selectError && current?.status !== "paid" && current?.source !== "subcontractor") {
      justBecamePaid = true;
      if (!("paid_date" in patch) && !current?.paid_date) {
        patch.paid_date = new Date().toISOString().slice(0, 10);
      }
    }
  }

  // Columns added after this route was first written — tolerated in case
  // the migration adding them hasn't been run against this database yet,
  // so a save never hard-fails over one of them being missing.
  const TOLERATED_MISSING_COLUMNS = ["paid_date", "sample_counts", "report_emails", "invoice_emails", "scope_of_work", "payment_due_date", "asbestos_result", "lead_result", "invoice_auto", "confirmed_date", "confirmed_time", "schedule_visible_to_customer", "report_release_override"];

  let currentPatch = patch;
  let data: Record<string, unknown> | null = null;
  let error: { message?: string } | null = null;
  for (let attempt = 0; attempt <= TOLERATED_MISSING_COLUMNS.length; attempt++) {
    if (Object.keys(currentPatch).length === 0) {
      return NextResponse.json(
        { error: "This field isn't available yet — its database migration hasn't been run." },
        { status: 409 }
      );
    }
    ({ data, error } = await supabase
      .from("jobs")
      .update(currentPatch)
      .eq("id", params.id)
      .select("*")
      .single());
    if (!error) break;
    const missingColumn = TOLERATED_MISSING_COLUMNS.find(
      (col) => col in currentPatch && new RegExp(col, "i").test(error?.message ?? "")
    );
    if (!missingColumn) break;
    const { [missingColumn]: _omit, ...rest } = currentPatch;
    currentPatch = rest;
  }

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Project not found" }, { status: 404 });
  }

  if (justConfirmedJobId) {
    const { sendJobConfirmedEmailIfDue } = await import("@/lib/booking-notify");
    await sendJobConfirmedEmailIfDue(justConfirmedJobId).catch((e) =>
      console.error(`Failed to send confirmation email for job ${justConfirmedJobId}:`, e)
    );
  }

  if (justBecamePaid) {
    // Dynamic import: lab-email.ts statically imports pdf-parse, which
    // corrupts state @react-pdf/renderer depends on if the two ever load
    // in the same module graph before pdf-parse is used — see the comment
    // at the top of lab-email.ts. Best-effort; must never fail the save
    // that already succeeded above.
    const { autoDraftReportIfJustPaid } = await import("@/lib/lab-email");
    await autoDraftReportIfJustPaid(params.id).catch((e) =>
      console.error(`Failed to auto-draft report for job ${params.id}:`, e)
    );
  }

  return NextResponse.json({ job: data });
});

export const DELETE = withApiErrors(async (
  req: NextRequest,
  { params }: { params: { id: string } }
) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const supabase = getSupabaseAdmin();

  // Deleting the row alone leaves every uploaded lab report, chain of
  // custody, invoice, and photo behind in Storage forever — nothing else
  // ever references a job's storage_paths once its row is gone, so this
  // is the only chance to clean them up. Best effort: a failed remove
  // shouldn't block the actual delete the admin asked for.
  const { data: job } = await supabase
    .from("jobs")
    .select("documents, photos")
    .eq("id", params.id)
    .maybeSingle();
  if (job) {
    const documentPaths = (job.documents ?? []).map((d: { storage_path: string }) => d.storage_path);
    const photoPaths = (job.photos ?? []).map((p: { storage_path: string }) => p.storage_path);
    if (documentPaths.length > 0) {
      await supabase.storage.from("job-documents").remove(documentPaths).catch(() => {});
    }
    if (photoPaths.length > 0) {
      await supabase.storage.from("job-photos").remove(photoPaths).catch(() => {});
    }
  }

  const { error } = await supabase.from("jobs").delete().eq("id", params.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
});
