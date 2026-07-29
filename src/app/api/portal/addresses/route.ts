import { NextRequest, NextResponse } from "next/server";
import { requireContractorApi } from "@/lib/contractor-api";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getSettings } from "@/lib/settings";
import { geocodeAddress, isWithinServiceStates } from "@/lib/geocode";
import { withApiErrors } from "@/lib/api-handler";

export const GET = withApiErrors(async () => {
  const auth = await requireContractorApi();
  if (auth.error) return auth.error;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("saved_addresses")
    .select("*")
    .eq("customer_id", auth.customer.id)
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  return NextResponse.json({ addresses: data });
});

export const POST = withApiErrors(async (req: NextRequest) => {
  const auth = await requireContractorApi();
  if (auth.error) return auth.error;

  const body = await req.json().catch(() => null);
  const address = body?.address?.trim();
  const label = body?.label?.trim() || null;
  if (!address) {
    return NextResponse.json({ error: "Address is required" }, { status: 400 });
  }

  // Same validation as the public booking form's address step — a saved
  // address is only useful if it's somewhere this business is licensed to go.
  const settings = await getSettings();
  const geo = await geocodeAddress(address);
  const withinArea = isWithinServiceStates(geo.state, settings.service_states);
  if (!withinArea) {
    return NextResponse.json(
      { error: "That address is outside our current service area and can't be saved." },
      { status: 400 }
    );
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("saved_addresses")
    .insert({
      customer_id: auth.customer.id,
      label,
      address: geo.formattedAddress,
      lat: geo.lat,
      lng: geo.lng,
    })
    .select("*")
    .single();

  if (error || !data) throw new Error(`Failed to save address: ${error?.message}`);
  return NextResponse.json({ address: data });
});
