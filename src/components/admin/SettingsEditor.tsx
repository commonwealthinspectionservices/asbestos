"use client";

import { useEffect, useRef, useState } from "react";
import type { Settings, ServiceType, PricingZone, LabProfile, Inspector } from "@/lib/types";

type FormState = Omit<Settings, "id" | "updated_at" | "last_area_alert_sent_at">;

function centsToDollarsStr(cents: number): string {
  return (cents / 100).toFixed(2);
}

export default function SettingsEditor() {
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isFirstLoad = useRef(true);

  useEffect(() => {
    fetch("/api/admin/settings")
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error ?? "Failed to load settings");
        setForm({
          ...data.settings,
          // Older rows may predate rush_fee_cents — default it in rather
          // than letting the field render blank/NaN until first edited.
          service_types: (data.settings.service_types ?? []).map((s: ServiceType) => ({
            ...s,
            rush_fee_cents: s.rush_fee_cents ?? 0,
          })),
        });
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load settings"));
  }, []);

  // Autosaves on any change, debounced so a run of keystrokes lands one
  // request instead of one per character. Skips the very first form set
  // (the initial fetch above populating the form, not a user edit).
  useEffect(() => {
    if (!form) return;
    if (isFirstLoad.current) {
      isFirstLoad.current = false;
      return;
    }
    const timer = setTimeout(() => {
      save();
    }, 800);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => (f ? { ...f, [key]: value } : f));
  }

  function updateServiceType(index: number, patch: Partial<ServiceType>) {
    if (!form) return;
    const next = [...form.service_types];
    next[index] = { ...next[index], ...patch };
    update("service_types", next);
  }

  function addServiceType() {
    if (!form) return;
    update("service_types", [
      ...form.service_types,
      { key: `service_${form.service_types.length + 1}`, label: "New service", base_fee_cents: 0, per_sample_cents: 0, rush_fee_cents: 0 },
    ]);
  }

  function removeServiceType(index: number) {
    if (!form) return;
    update("service_types", form.service_types.filter((_, i) => i !== index));
  }

  // Array order here is also the pricing estimator's display order, and the
  // first entry is what it auto-selects by default — see PricingCalculator.
  function moveServiceType(index: number, direction: -1 | 1) {
    if (!form) return;
    const next = [...form.service_types];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    update("service_types", next);
  }

  function updatePricingZone(index: number, patch: Partial<PricingZone>) {
    if (!form) return;
    const next = [...form.pricing_zones];
    next[index] = { ...next[index], ...patch };
    update("pricing_zones", next);
  }

  function movePricingZone(index: number, direction: -1 | 1) {
    if (!form) return;
    const next = [...form.pricing_zones];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    update("pricing_zones", next);
  }

  function addPricingZone() {
    if (!form) return;
    update("pricing_zones", [...form.pricing_zones, { name: "New zone", base_fee_cents: 45000, towns: [] }]);
  }

  function removePricingZone(index: number) {
    if (!form) return;
    update("pricing_zones", form.pricing_zones.filter((_, i) => i !== index));
  }

  function updateLab(index: number, patch: Partial<LabProfile>) {
    if (!form) return;
    const next = [...form.labs];
    next[index] = { ...next[index], ...patch };
    update("labs", next);
  }

  function addLab() {
    if (!form) return;
    update("labs", [...form.labs, { name: "New lab", city: "", nist_cert: "", massdls_cert: "" }]);
  }

  function removeLab(index: number) {
    if (!form) return;
    update("labs", form.labs.filter((_, i) => i !== index));
  }

  function updateInspector(index: number, patch: Partial<Inspector>) {
    if (!form) return;
    const next = [...form.inspectors];
    next[index] = { ...next[index], ...patch };
    update("inspectors", next);
  }

  function addInspector() {
    if (!form) return;
    update("inspectors", [...form.inspectors, { name: "New inspector", title: "", license_number: "" }]);
  }

  function removeInspector(index: number) {
    if (!form) return;
    update("inspectors", form.inspectors.filter((_, i) => i !== index));
  }

  async function save() {
    if (!form) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      setMessage("Saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (!form) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-6 text-sm">
        {error ? (
          <div className="rounded-lg bg-red-50 px-4 py-2 text-red-700">{error}</div>
        ) : (
          <span className="text-slate-500">Loading…</span>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 pb-16">
      <h1 className="text-lg font-semibold text-slate-800">Settings</h1>
      {error && <div className="mt-3 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

      <Section title="Business">
        <Field label="Business name">
          <TextInput value={form.business_name} onChange={(v) => update("business_name", v)} />
        </Field>
        <Field label="Business phone">
          <TextInput value={form.business_phone} onChange={(v) => update("business_phone", v)} />
        </Field>
        <Field label="Business email">
          <TextInput value={form.business_email} onChange={(v) => update("business_email", v)} />
        </Field>
        <Field label="Business address">
          <TextInput value={form.base_address} onChange={(v) => update("base_address", v)} />
        </Field>
      </Section>

      <Section title="Inspectors">
        <div className="space-y-3">
          {form.inspectors.map((inspector, i) => (
            <div key={i} className="rounded-lg border border-slate-200 p-3">
              <div className="flex items-center justify-between gap-2">
                <TextInput value={inspector.name} onChange={(v) => updateInspector(i, { name: v })} placeholder="Name" />
                <button onClick={() => removeInspector(i)} className="shrink-0 text-sm text-red-600">Remove</button>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Field label="Title">
                  <TextInput value={inspector.title} onChange={(v) => updateInspector(i, { title: v })} />
                </Field>
                <Field label="License #">
                  <TextInput value={inspector.license_number} onChange={(v) => updateInspector(i, { license_number: v })} />
                </Field>
              </div>
            </div>
          ))}
          <button onClick={addInspector} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm">
            Add inspector
          </button>
        </div>
      </Section>

      <Section title="Labs">
        <p className="text-xs text-slate-500">
          Picking a lab in &quot;Enter lab results&quot; auto-fills its name and cert numbers instead of retyping them.
        </p>
        <div className="space-y-3">
          {form.labs.map((lab, i) => (
            <div key={i} className="rounded-lg border border-slate-200 p-3">
              <div className="flex items-center justify-between gap-2">
                <TextInput value={lab.name} onChange={(v) => updateLab(i, { name: v })} placeholder="Lab name" />
                <button onClick={() => removeLab(i)} className="shrink-0 text-sm text-red-600">Remove</button>
              </div>
              <div className="mt-2">
                <Field label="City (e.g. Woburn, Massachusetts) — printed in mold reports after the lab's name">
                  <TextInput value={lab.city ?? ""} onChange={(v) => updateLab(i, { city: v })} />
                </Field>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Field label="NIST/NVLAP cert #">
                  <TextInput value={lab.nist_cert} onChange={(v) => updateLab(i, { nist_cert: v })} />
                </Field>
                <Field label="MassDLS cert #">
                  <TextInput value={lab.massdls_cert} onChange={(v) => updateLab(i, { massdls_cert: v })} />
                </Field>
              </div>
            </div>
          ))}
          <button onClick={addLab} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm">
            Add lab
          </button>
        </div>
      </Section>

      <Section title="Gmail">
        <GmailConnection />
      </Section>

      <Section title="Price by service type">
        <p className="text-xs text-slate-500">
          Order matters: the pricing estimator lists these top to bottom and auto-selects
          whichever one is first.
        </p>
        <div className="space-y-3">
          {form.service_types.map((s, i) => (
            <div key={i} className="rounded-lg border border-slate-200 p-3">
              <div className="flex items-center justify-between gap-2">
                <TextInput value={s.label} onChange={(v) => updateServiceType(i, { label: v })} placeholder="Label" />
                <div className="flex shrink-0 gap-1">
                  <button onClick={() => moveServiceType(i, -1)} disabled={i === 0} className="text-sm text-slate-500 disabled:opacity-30">↑</button>
                  <button onClick={() => moveServiceType(i, 1)} disabled={i === form.service_types.length - 1} className="text-sm text-slate-500 disabled:opacity-30">↓</button>
                  <button onClick={() => removeServiceType(i)} className="text-sm text-red-600">Remove</button>
                </div>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2">
                <Field label="Base fee ($)">
                  <NumberInput value={Number(centsToDollarsStr(s.base_fee_cents))} onChange={(v) => updateServiceType(i, { base_fee_cents: Math.round(v * 100) })} step="1" />
                </Field>
                <Field label="Per-sample fee ($)">
                  <NumberInput value={Number(centsToDollarsStr(s.per_sample_cents))} onChange={(v) => updateServiceType(i, { per_sample_cents: Math.round(v * 100) })} step="1" />
                </Field>
                <Field label="Rush fee ($)">
                  <NumberInput value={Number(centsToDollarsStr(s.rush_fee_cents))} onChange={(v) => updateServiceType(i, { rush_fee_cents: Math.round(v * 100) })} step="1" />
                </Field>
              </div>
            </div>
          ))}
          <button onClick={addServiceType} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm">
            Add service type
          </button>
        </div>
      </Section>

      <CollapsibleSection title="Pricing zones">
        <p className="text-xs text-slate-500">
          Overrides a service&apos;s base fee by region — checked top to bottom, first matching town wins,
          falls back to the service&apos;s own base fee if nothing matches. Order matters: put more specific
          zones (e.g. islands) above broader ones.
        </p>
        <div className="space-y-3">
          {form.pricing_zones.map((z, i) => (
            <div key={i} className="rounded-lg border border-slate-200 p-3">
              <div className="flex items-center justify-between gap-2">
                <TextInput value={z.name} onChange={(v) => updatePricingZone(i, { name: v })} placeholder="Zone name" />
                <div className="flex shrink-0 gap-1">
                  <button onClick={() => movePricingZone(i, -1)} disabled={i === 0} className="text-sm text-slate-500 disabled:opacity-30">↑</button>
                  <button onClick={() => movePricingZone(i, 1)} disabled={i === form.pricing_zones.length - 1} className="text-sm text-slate-500 disabled:opacity-30">↓</button>
                  <button onClick={() => removePricingZone(i)} className="text-sm text-red-600">Remove</button>
                </div>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Field label="Base fee ($)">
                  <NumberInput value={Number(centsToDollarsStr(z.base_fee_cents))} onChange={(v) => updatePricingZone(i, { base_fee_cents: Math.round(v * 100) })} step="1" />
                </Field>
                <Field label="Towns (comma-separated)">
                  <TextInput
                    value={z.towns.join(", ")}
                    onChange={(v) => updatePricingZone(i, { towns: v.split(",").map((t) => t.trim()).filter(Boolean) })}
                    placeholder="Worcester, Fitchburg, Leominster"
                  />
                </Field>
              </div>
            </div>
          ))}
          <button onClick={addPricingZone} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm">
            Add pricing zone
          </button>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Advanced settings">
        <SubSection title="Service area">
          <Field label="Licensed states (comma-separated, e.g. MA)">
            <TextInput
              value={form.service_states.join(", ")}
              onChange={(v) => update("service_states", v.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean))}
            />
          </Field>
          <p className="text-xs text-slate-500">
            This is the actual booking-acceptance gate — a booking is accepted only if the address is in one
            of these states. The fields below feed the service-area health digest&apos;s distance metrics only;
            they no longer gate acceptance.
          </p>
          <Field label="Center latitude">
            <NumberInput value={form.service_area_center_lat} onChange={(v) => update("service_area_center_lat", v)} step="0.0001" />
          </Field>
          <Field label="Center longitude">
            <NumberInput value={form.service_area_center_lng} onChange={(v) => update("service_area_center_lng", v)} step="0.0001" />
          </Field>
          <Field label="Radius (miles, informational only)">
            <NumberInput value={form.service_radius_miles} onChange={(v) => update("service_radius_miles", v)} step="0.1" />
          </Field>
        </SubSection>

        <SubSection title="Route & schedule">
          <Field label="Timezone">
            <TextInput value={form.timezone} onChange={(v) => update("timezone", v)} />
          </Field>
          <Field label="Workday start">
            <TextInput value={form.workday_start} onChange={(v) => update("workday_start", v)} placeholder="08:00" />
          </Field>
          <Field label="Workday end">
            <TextInput value={form.workday_end} onChange={(v) => update("workday_end", v)} placeholder="17:00" />
          </Field>
          <Field label="Max projects per day">
            <NumberInput value={form.max_jobs_per_day} onChange={(v) => update("max_jobs_per_day", v)} step="1" />
          </Field>
          <Field label="Default service minutes">
            <NumberInput value={form.default_service_minutes} onChange={(v) => update("default_service_minutes", v)} step="1" />
          </Field>
          <Field label="Route email time (local)">
            <TextInput value={form.route_email_time_local} onChange={(v) => update("route_email_time_local", v)} placeholder="05:00" />
          </Field>
        </SubSection>

        <SubSection title="Service-area health alert thresholds">
          <Field label="Median inter-stop drive time (min)">
            <NumberInput value={form.alert_interstop_minutes} onChange={(v) => update("alert_interstop_minutes", v)} step="0.5" />
          </Field>
          <Field label="Avg project distance from center (mi)">
            <NumberInput value={form.alert_avg_distance_miles} onChange={(v) => update("alert_avg_distance_miles", v)} step="0.1" />
          </Field>
          <Field label="Near-miss count (per 4 wks)">
            <NumberInput value={form.alert_nearmiss_count} onChange={(v) => update("alert_nearmiss_count", v)} step="1" />
          </Field>
          <Field label="Centroid offset (mi)">
            <NumberInput value={form.alert_centroid_offset_miles} onChange={(v) => update("alert_centroid_offset_miles", v)} step="0.1" />
          </Field>
        </SubSection>
      </CollapsibleSection>

      <div className="mt-6 text-right text-sm text-slate-500">
        {saving ? "Saving…" : message ? "Saved." : ""}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-700">{title}</h2>
      <div className="mt-3 space-y-3">{children}</div>
    </div>
  );
}

function CollapsibleSection({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4">
      <button
        type="button"
        className="flex w-full items-center justify-between text-left"
        onClick={() => setOpen((o) => !o)}
      >
        <h2 className="text-sm font-semibold text-slate-700">{title}</h2>
        <span className="text-slate-400">{open ? "▲" : "▼"}</span>
      </button>
      {open && <div className="mt-3 space-y-6">{children}</div>}
    </div>
  );
}

function SubSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      <div className="mt-2 space-y-3">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-500">{label}</label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function TextInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function NumberInput({ value, onChange, step }: { value: number; onChange: (v: number) => void; step?: string }) {
  return (
    <input
      type="number"
      step={step}
      className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );
}

export function GmailConnection({ compact = false }: { compact?: boolean } = {}) {
  const [status, setStatus] = useState<{ connected: boolean; email: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  function load() {
    fetch("/api/admin/gmail/status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setError("Failed to load Gmail connection status"));
  }

  useEffect(() => {
    load();
    // The OAuth callback redirects back here with ?gmail_connected=1 or
    // ?gmail_error=... — read it once on mount, then scrub it from the URL
    // so a refresh doesn't re-show a stale banner.
    const params = new URLSearchParams(window.location.search);
    if (params.get("gmail_connected")) setNotice("Gmail connected.");
    if (params.get("gmail_error")) setError(`Gmail connection failed: ${params.get("gmail_error")}`);
    if (params.has("gmail_connected") || params.has("gmail_error")) {
      params.delete("gmail_connected");
      params.delete("gmail_error");
      const next = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ""}`;
      window.history.replaceState(null, "", next);
    }
  }, []);

  async function disconnect() {
    setDisconnecting(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/gmail/disconnect", { method: "POST" });
      if (!res.ok) throw new Error("Failed to disconnect");
      setNotice(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to disconnect");
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <div>
      {notice && <div className="mt-2 rounded bg-emerald-50 px-2 py-1 text-xs text-emerald-700">{notice}</div>}
      {error && <div className="mt-2 rounded bg-red-50 px-2 py-1 text-xs text-red-700">{error}</div>}
      <div className={`flex items-center gap-2 ${compact ? "" : "mt-2"}`}>
        {status?.connected ? (
          <>
            <span className="text-sm text-slate-700">Gmail connected as {status.email}</span>
            <button
              onClick={disconnect}
              disabled={disconnecting}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 disabled:opacity-50"
            >
              {disconnecting ? "Disconnecting…" : "Disconnect"}
            </button>
          </>
        ) : status ? (
          <a
            href="/api/admin/gmail/oauth-start"
            className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white"
          >
            Connect Gmail
          </a>
        ) : (
          <span className="text-sm text-slate-500">Loading…</span>
        )}
      </div>
    </div>
  );
}