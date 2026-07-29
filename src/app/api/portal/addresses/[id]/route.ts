import { NextRequest, NextResponse } from "next/server";
import { requireContractorApi } from "@/lib/contractor-api";
import { getSupabaseAdmin } from "@/lib/supabase";
import { withApiErrors } from "@/lib/api-handler";

export const DELETE = withApiErrors(async (
  req: NextRequest,
  { params }: { params: { id: string } }
) => {
  const auth = await requireContractorApi();
  if (auth.error) return auth.error;

  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("saved_addresses")
    .delete()
    .eq("id", params.id)
    .eq("customer_id", auth.customer.id); // scoped so a contractor can only delete their own

  if (error) throw new Error(error.message);
  return NextResponse.json({ ok: true });
});
