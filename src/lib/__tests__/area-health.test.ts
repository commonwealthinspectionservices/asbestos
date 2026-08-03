import { describe, it, expect } from "vitest";
import { evaluateThresholds } from "@/lib/area-health";
import type { Settings } from "@/lib/types";

const baseSettings: Settings = {
  id: 1,
  service_states: ["MA"],
  service_area_center_lat: 42.3467,
  service_area_center_lng: -71.0823,
  service_radius_miles: 4,
  base_address: "118 Greenacre Rd, Westwood, MA 02090",
  timezone: "America/New_York",
  workday_start: "08:00",
  workday_end: "17:00",
  max_jobs_per_day: 8,
  default_service_minutes: 30,
  route_email_time_local: "05:00",
  alert_interstop_minutes: 12,
  alert_avg_distance_miles: 3.0,
  alert_nearmiss_count: 5,
  alert_centroid_offset_miles: 1.5,
  last_area_alert_sent_at: null,
  business_name: "Commonwealth Inspection Services, LLC.",
  business_phone: "617-390-4778",
  owner_name: "Timothy Hall",
  owner_title: "Project Manager",
  disclaimer_text: "",
  service_types: [],
  pricing_zones: [],
  labs: [],
  inspectors: [],
  license_number: "AI901405",
  credentials_document_path: null,
  updated_at: new Date().toISOString(),
};

describe("evaluateThresholds", () => {
  it("returns no crossings when jobs are tightly clustered (the ✅ case)", () => {
    const crossings = evaluateThresholds(baseSettings, {
      medianInterStopDriveMinutes: 8,
      avgJobDistanceMiles: 1.8,
      nearMissCount: 1,
      centroidDistanceMiles: 0.4,
    });
    expect(crossings).toEqual([]);
  });

  it("flags each threshold independently when crossed (the ⚠️ case)", () => {
    const crossings = evaluateThresholds(baseSettings, {
      medianInterStopDriveMinutes: 20, // > 12
      avgJobDistanceMiles: 3.5, // > 3.0
      nearMissCount: 7, // > 5
      centroidDistanceMiles: 2.0, // > 1.5
    });
    const keys = crossings.map((c) => c.key).sort();
    expect(keys).toEqual(["avg_distance", "centroid", "interstop", "nearmiss"]);
  });

  it("does not flag a metric sitting exactly at its threshold", () => {
    const crossings = evaluateThresholds(baseSettings, {
      medianInterStopDriveMinutes: 12,
      avgJobDistanceMiles: 3.0,
      nearMissCount: 5,
      centroidDistanceMiles: 1.5,
    });
    expect(crossings).toEqual([]);
  });

  it("ignores null metrics (no data yet) rather than treating them as crossings", () => {
    const crossings = evaluateThresholds(baseSettings, {
      medianInterStopDriveMinutes: null,
      avgJobDistanceMiles: null,
      nearMissCount: 0,
      centroidDistanceMiles: null,
    });
    expect(crossings).toEqual([]);
  });
});
