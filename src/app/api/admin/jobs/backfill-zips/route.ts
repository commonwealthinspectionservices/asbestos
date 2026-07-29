import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireAdminApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";
import { geocodeAddress } from "@/lib/geocode";

const HAS_ZIP_RE = /\b\d{5}(-\d{4})?\s*$/;

// One-time (or occasionally-rerun) data-quality fixup: a lot of historical
// jobs were entered with a service_address that never got a zip (typed by
// hand, not picked from Places autocomplete). Geocodes and appends the zip
// in place rather than replacing the address, so the existing display
// parsing (splitAddress) keeps working on the address exactly as entered.
// `limit` caps how many addresses get geocoded per call, to stay well
// under a serverless function's request timeout — call again to keep
// going if `remaining` comes back above 0.
export const POST = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const limit = Number(new URL(req.url).searchParams.get("limit") ?? "60");

  const supabase = getSupabaseAdmin();
  const { data: jobs, error } = await supabase.from("jobs").select("id, service_address");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const needsZip = (jobs ?? []).filter((j) => {
    const address = j.service_address?.trim();
    return address && !HAS_ZIP_RE.test(address);
  });

  const batch = needsZip.slice(0, limit);
  let updated = 0;
  const failed: { id: string; address: string }[] = [];

  for (const job of batch) {
    const address = job.service_address.trim();
    try {
      const geo = await geocodeAddress(address);
      if (!geo.zip) {
        failed.push({ id: job.id, address });
        continue;
      }
      const { error: updateError } = await supabase
        .from("jobs")
        .update({ service_address: `${address} ${geo.zip}` })
        .eq("id", job.id);
      if (updateError) {
        failed.push({ id: job.id, address });
      } else {
        updated++;
      }
    } catch {
      failed.push({ id: job.id, address });
    }
  }

  return NextResponse.json({
    updated,
    failed,
    remaining: Math.max(0, needsZip.length - batch.length),
  });
});
