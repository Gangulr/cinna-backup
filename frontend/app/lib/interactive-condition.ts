import type { PlantCondition } from "./plant-condition";

export const sensorFields = ["temperature", "humidity", "moisture"] as const;
export type SensorField = (typeof sensorFields)[number];
export type InputOrigins = Record<SensorField, "iot" | "manual">;
export type SensorForm = Record<SensorField, string> & { plant_id: string };
export type LiveSnapshot = Record<SensorField, number | null> & {
  battery: number | null;
  timestamp: string;
  observed_at: string | null;
  fetched_at: string;
  source: string;
  source_record_id: string;
  freshness: "fresh" | "stale" | "unknown" | "future";
  age_seconds: number | null;
  stale_after_seconds: number | null;
  missing_fields: SensorField[];
  warnings: string[];
};
export type ConditionCheck = Record<SensorField, number> & {
  record_id: string | null;
  request_id: string;
  plant_id: string;
  status: PlantCondition["status"];
  reason: string;
  assessed_at: string;
  observed_at: string | null;
  input_origins: InputOrigins;
  input_mode: "iot" | "mixed" | "manual";
  live_snapshot: LiveSnapshot | null;
  freshness: LiveSnapshot["freshness"] | "manual";
  source_age_seconds: number | null;
  assessment_scope: string;
  warnings: string[];
  database_saved?: boolean;
  save_message?: string;
  sensor_findings?: SensorFinding[];
  basic_guidance?: CareGuidance;
  care_guidance?: CareGuidance;
};

export type SensorFinding = {
  feature: SensorField;
  label: string;
  value: number;
  unit: string;
  baseline_min: number | null;
  baseline_max: number | null;
  comparison: "within_baseline" | "below_baseline" | "above_baseline" | "unavailable";
};
export type CareGuidance = {
  summary: string;
  recommended_actions: { action_id: string; instruction: string }[];
  follow_up: string;
  source: "basic" | "ai";
  provider?: string;
  model?: string;
  version?: string;
  generated_at?: string;
};
export type GuidanceResponse = {
  status: "ready" | "unavailable";
  guidance: CareGuidance | null;
  message?: string;
};
export function assessmentTitle(status: ConditionCheck["status"]) {
  return { OK: "Favourable Sensor Conditions", ATTENTION: "Sensor Conditions Require Attention",
    UNKNOWN: "Unable to Assess These Conditions Reliably" }[status];
}

export const manualOrigins: InputOrigins = {
  temperature: "manual", humidity: "manual", moisture: "manual",
};

export function mergeLiveInputs(form: SensorForm, snapshot: LiveSnapshot, previousOrigins: InputOrigins = manualOrigins) {
  const next = { ...form };
  const origins = { ...manualOrigins };
  // Preserve manual measurements; never silently relabel a previous IoT value as manual.
  for (const name of sensorFields) {
    const value = snapshot[name];
    if (typeof value === "number" && Number.isFinite(value)) {
      next[name] = String(value);
      origins[name] = "iot";
    } else if (previousOrigins[name] === "iot") {
      next[name] = "";
    }
  }
  return { form: next, origins };
}

export function validateSensorForm(form: SensorForm) {
  if (!form.plant_id.trim() || form.plant_id.trim().length > 100) {
    return "Enter a Plant ID of 1–100 characters.";
  }
  for (const name of sensorFields) {
    const label = name === "moisture" ? "Soil moisture" : name[0].toUpperCase() + name.slice(1);
    if (!form[name].trim()) return `Enter ${label.toLowerCase()}.`;
    const value = Number(form[name]);
    const lower = name === "temperature" ? -50 : 0;
    if (!Number.isFinite(value) || value < lower || value > 100) {
      return `${label} must be a finite number from ${lower} to 100.`;
    }
  }
  return "";
}

export function freshnessLabel(freshness: ConditionCheck["freshness"]) {
  return {
    fresh: "Recent sensor snapshot",
    stale: "Older sensor snapshot",
    unknown: "Sensor measurement time unknown",
    future: "Sensor clock needs checking",
    manual: "Manually entered readings",
  }[freshness];
}
