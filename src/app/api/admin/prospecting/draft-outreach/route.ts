import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";
import { createDraft, deleteDraft, getValidAccessToken, getOrCreateLabelId, addLabelToMessage } from "@/lib/gmail";

// Reusable prospecting tool, 2026-09-08 — creates one Gmail draft per
// contact for cold sales outreach (restoration-company SDR work), same
// review-before-send pattern as every report/invoice draft this app
// already creates. Deliberately dumb: the caller supplies fully-written
// subject/body per contact rather than this route templating anything
// itself, so the actual copy stays reviewable in one place (the calling
// script) instead of buried in server code. Each draft gets a
// "Prospecting" Gmail label so they're easy to find/filter in Drafts
// alongside the report/invoice drafts, which use their own separate
// Sent Reports/Sent Invoices labels.
export const POST = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const body = await req.json().catch(() => null);
  const emails: { to?: string; subject?: string; bodyHtml?: string; company?: string }[] =
    Array.isArray(body?.emails) ? body.emails : [];
  if (emails.length === 0) {
    return NextResponse.json({ error: "emails[] required" }, { status: 400 });
  }

  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return NextResponse.json({ error: "Gmail is not connected — connect it in Settings first" }, { status: 400 });
  }
  const labelId = await getOrCreateLabelId(accessToken, "Prospecting");

  const drafted: { to: string; company?: string; draftId: string }[] = [];
  const failed: { to: string; error: string }[] = [];

  for (const e of emails) {
    if (!e.to || !e.subject || !e.bodyHtml) {
      failed.push({ to: e.to ?? "(missing)", error: "to/subject/bodyHtml all required" });
      continue;
    }
    try {
      const draft = await createDraft(accessToken, {
        to: e.to,
        subject: e.subject,
        bodyHtml: e.bodyHtml,
        attachments: [],
      });
      await addLabelToMessage(accessToken, draft.messageId, labelId);
      drafted.push({ to: e.to, company: e.company, draftId: draft.id });
    } catch (err) {
      failed.push({ to: e.to, error: err instanceof Error ? err.message : "Failed to create draft" });
    }
  }

  return NextResponse.json({ ok: true, drafted, failed });
});

// Undoes a batch created above — takes the draftId list straight back
// from that call's own response, so a batch drafted before the copy/
// targeting was actually right (or before the whole feature was ready
// to use) can be cleanly removed instead of left to delete by hand one
// at a time in Gmail.
export const DELETE = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const body = await req.json().catch(() => null);
  const draftIds: string[] = Array.isArray(body?.draftIds) ? body.draftIds : [];
  if (draftIds.length === 0) {
    return NextResponse.json({ error: "draftIds[] required" }, { status: 400 });
  }

  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return NextResponse.json({ error: "Gmail is not connected — connect it in Settings first" }, { status: 400 });
  }

  const deleted: string[] = [];
  const failed: { draftId: string; error: string }[] = [];
  for (const draftId of draftIds) {
    try {
      await deleteDraft(accessToken, draftId);
      deleted.push(draftId);
    } catch (err) {
      failed.push({ draftId, error: err instanceof Error ? err.message : "Failed to delete draft" });
    }
  }

  return NextResponse.json({ ok: true, deleted, failed });
});
