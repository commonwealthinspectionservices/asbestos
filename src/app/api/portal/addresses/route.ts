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

  // geo.formattedAddress is the canonical, geocoded form — comparing
  // against that (rather than the raw typed string) catches the same
  // address saved twice even if it was typed slightly differently.
  // .limit(1) + array-length check rather than .maybeSingle(), which
  // throws on more than one match — a real possibility here, since
  // duplicates from before this check existed may already be on file.
  const { data: existing } = await supabase
    .from("saved_addresses")
    .select("id")
    .eq("customer_id", auth.customer.id)
    .ilike("address", geo.formattedAddress)
    .limit(1);
  if (existing && existing.length > 0) {
    return NextResponse.json({ error: "That address is already saved." }, { status: 409 });
  }

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
