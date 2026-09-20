import { NextRequest, NextResponse } from "next/server";
import { requireOwnerApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";
import { createEmptyMileageDay, resetMileageDay, saveMileageDay, type MileageStop } from "@/lib/mileage";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

// Saves an edited route. Body: { stops, legOverride?: { index, miles|null } }.
// Drive distances are recomputed for every leg except hand-entered ones.
export const PUT = withApiErrors(async (req: NextRequest, { params }: { params: { day: string } }) => {
  const unauthorized = requireOwnerApi(req);
  if (unauthorized) return unauthorized;
  if (!DAY.test(params.day)) return NextResponse.json({ error: "Bad day" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const stops: MileageStop[] | undefined = body?.stops;
  if (!Array.isArray(stops) || stops.length < 1 || stops.some((s) => !s?.id || !s?.address?.trim())) {
    return NextResponse.json({ error: "Every stop needs an address" }, { status: 400 });
  }
  const override = body?.legOverride;
  const day = await saveMileageDay(
    params.day,
    stops.map((s) => ({ id: String(s.id), kind: s.kind, label: String(s.label ?? s.address), address: String(s.address).trim(), job_id: s.job_id })),
    override && Number.isInteger(override.index) ? { index: override.index, miles: override.miles == null || override.miles === "" ? null : Number(override.miles) } : undefined,
    Number.isFinite(Number(body?.dayTotal)) && body?.dayTotal != null ? Number(body.dayTotal) : undefined
  );
  return NextResponse.json({ day });
});

// Throws away the saved route so the next load rebuilds it from that day's jobs.
export const DELETE = withApiErrors(async (req: NextRequest, { params }: { params: { day: string } }) => {
  const unauthorized = requireOwnerApi(req);
  if (unauthorized) return unauthorized;
  if (!DAY.test(params.day)) return NextResponse.json({ error: "Bad day" }, { status: 400 });
  await resetMileageDay(params.day);
  return NextResponse.json({ ok: true });
});

// Starts a blank day (home → home) so trips on days with no jobs can be logged.
export const POST = withApiErrors(async (req: NextRequest, { params }: { params: { day: string } }) => {
  const unauthorized = requireOwnerApi(req);
  if (unauthorized) return unauthorized;
  if (!DAY.test(params.day)) return NextResponse.json({ error: "Bad day" }, { status: 400 });
  return NextResponse.json({ day: await createEmptyMileageDay(params.day) });
});
