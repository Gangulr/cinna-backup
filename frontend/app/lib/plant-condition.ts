export type Plant = {
  plant_id: string;
  owner_id: string;
  device_id: string;
  calibration_id: string;
  expected_interval_seconds: number;
  source_kind: "device" | "legacy";
  active: boolean;
};
export type ConditionReading = {
  temperature: number;
  humidity: number;
  moisture: number;
  battery: number | null;
  observed_at: string;
  source_record_id: string;
};
export type PlantCondition = {
  plant_id: string;
  device_id: string;
  assessment_id?: string;
  status: "OK" | "ATTENTION" | "UNKNOWN";
  reason: string;
  observed_at: string | null;
  assessed_at: string;
  reading: ConditionReading | null;
};
export type HealthObservation = {
  observation_id: string;
  plant_id: string;
  inspected_at: string;
  reported_label: "healthy" | "unhealthy" | "unknown";
  confirmed_label: "healthy" | "unhealthy" | "unknown" | null;
  review_status: "pending" | "reviewed";
  symptoms: string;
  interventions: string;
  inspection_kind: "routine" | "alert_triggered";
  device_id: string;
  sensor_reading: ConditionReading | null;
};
export function conditionLabel(status: PlantCondition["status"]): string {
  return {
    OK: "OK — readings match the healthy baseline",
    ATTENTION: "Needs inspection — unusual readings",
    UNKNOWN: "Unable to assess",
  }[status];
}
export function conditionTime(value: string | null): string {
  if (!value) return "No reading yet";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown time" : date.toLocaleString();
}
