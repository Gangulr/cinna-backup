"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { RefreshCw, Sprout } from "lucide-react";
import { apiGet, apiPost } from "@/app/lib/api";
import { useAuth } from "@/app/context/AuthContext";
import {
  conditionLabel,
  conditionTime,
  HealthObservation,
  Plant,
  PlantCondition,
} from "@/app/lib/plant-condition";

export default function PlantConditionMonitor({
  compact = false,
}: {
  compact?: boolean;
}) {
  const { firebaseUser } = useAuth();
  const [plants, setPlants] = useState<Plant[]>([]);
  const [selected, setSelected] = useState("");
  const [condition, setCondition] = useState<PlantCondition | null>(null);
  const [history, setHistory] = useState<PlantCondition[]>([]);
  const [observations, setObservations] = useState<HealthObservation[]>([]);
  const [error, setError] = useState("");
  const [monitorError, setMonitorError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState("");
  const generation = useRef(0);
  const historyGeneration = useRef(0);

  useEffect(() => {
    if (!firebaseUser) return;
    let cancelled = false;
    apiGet<Plant[]>("/plants")
      .then((data) => {
        if (cancelled) return;
        setPlants(data);
        setSelected((previous) =>
          data.some((p) => p.plant_id === previous)
            ? previous
            : (data[0]?.plant_id ?? ""),
        );
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setPlants([]);
        setCondition(null);
        setError(
          err instanceof Error
            ? err.message
            : "Unable to load registered plants.",
        );
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [firebaseUser]);

  const loadHistory = useCallback(
    async (plantId: string) => {
      if (compact) return;
      const request = ++historyGeneration.current;
      try {
        const [records, inspections] = await Promise.all([
          apiGet<PlantCondition[]>(
            `/plants/${encodeURIComponent(plantId)}/condition-history`,
          ),
          apiGet<HealthObservation[]>(
            `/plants/${encodeURIComponent(plantId)}/health-observations`,
          ),
        ]);
        if (request !== historyGeneration.current) return;
        setHistory(records);
        setObservations(inspections);
      } catch (err: unknown) {
        if (request !== historyGeneration.current) return;
        setHistory([]);
        setObservations([]);
        setError(
          err instanceof Error
            ? err.message
            : "Unable to load condition history.",
        );
      }
    },
    [compact],
  );

  const refresh = useCallback(async (plantId: string) => {
    const request = ++generation.current;
    try {
      const result = await apiGet<PlantCondition>(
        `/plants/${encodeURIComponent(plantId)}/condition`,
      );
      if (request !== generation.current) return;
      setCondition(result);
      setMonitorError("");
      setLoading(false);
    } catch (err: unknown) {
      if (request !== generation.current) return;
      setCondition(null);
      setMonitorError(
        err instanceof Error ? err.message : "Plant assessment is unavailable.",
      );
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selected || !firebaseUser) return;
    void refresh(selected);
    void loadHistory(selected);
    const interval = window.setInterval(() => {
      void refresh(selected);
    }, 5000);
    return () => {
      generation.current += 1;
      historyGeneration.current += 1;
      window.clearInterval(interval);
    };
  }, [selected, firebaseUser, refresh, loadHistory]);

  useEffect(() => {
    if (condition?.plant_id === selected && condition.assessment_id)
      void loadHistory(selected);
  }, [condition?.assessment_id, condition?.plant_id, selected, loadHistory]);

  async function submitInspection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setSaving(true);
    setSuccess("");
    try {
      const time = new Date(String(data.get("inspected_at")));
      if (Number.isNaN(time.getTime()))
        throw new Error("Enter a valid inspection time.");
      await apiPost(
        `/plants/${encodeURIComponent(selected)}/health-observations`,
        {
          inspected_at: time.toISOString(),
          assessment_id: data.get("assessment_id") || null,
          reported_label: data.get("reported_label"),
          symptoms: data.get("symptoms") || "",
          interventions: data.get("interventions") || "",
          inspection_kind: data.get("inspection_kind"),
        },
      );
      setSuccess("Inspection saved for review.");
      form.reset();
      await loadHistory(selected);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Unable to save the inspection.",
      );
    } finally {
      setSaving(false);
    }
  }

  const visible = condition?.plant_id === selected ? condition : null;
  const records = history.filter((item) => item.plant_id === selected);
  const inspections = observations.filter((item) => item.plant_id === selected);
  const style =
    visible?.status === "OK"
      ? "border-emerald-200 bg-emerald-50"
      : visible?.status === "ATTENTION"
        ? "border-amber-300 bg-amber-50"
        : "border-slate-200 bg-slate-50";

  return (
    <section
      className="card space-y-5 p-6"
      aria-label="Plant condition monitoring"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
          <Sprout className="h-5 w-5 text-emerald-700" />
          Plant Condition
        </h2>
        <div className="flex items-center gap-3">
          <label className="text-sm text-slate-700">
            Plant
            <select
              value={selected}
              onChange={(event) => {
                setSelected(event.target.value);
                setSuccess("");
              }}
              className="ml-2 rounded-lg border border-slate-300 bg-white px-3 py-2"
              disabled={!plants.length}
            >
              {!plants.length && <option value="">No registered plants</option>}
              {plants.map((plant) => (
                <option key={plant.plant_id} value={plant.plant_id}>
                  {plant.plant_id}
                  {plant.active ? "" : " (inactive)"}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            aria-label="Refresh plant assessment"
            disabled={!selected}
            onClick={() => {
              void refresh(selected);
              void loadHistory(selected);
            }}
            className="btn-secondary"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>
      {(error || monitorError) && (
        <p role="alert" className="text-sm text-rose-700">
          {error || monitorError}
        </p>
      )}
      {!plants.length ? (
        <p className="text-sm text-slate-600">
          {loading
            ? "Loading plants…"
            : "Ask an administrator to register your plant and assign its sensor device."}
        </p>
      ) : (
        <>
          <div className={`rounded-xl border p-4 ${style}`} aria-live="polite">
            <p className="font-semibold text-slate-900">
              {visible ? conditionLabel(visible.status) : "Unable to assess"}
            </p>
            <p className="mt-1 text-sm text-slate-700">
              {visible?.reason ?? "Waiting for this plant’s assessment."}
            </p>
            <p className="mt-2 text-xs text-slate-600">
              Reading: {conditionTime(visible?.observed_at ?? null)}
            </p>
          </div>
          <p className="text-sm text-slate-600">
            This checks sensor conditions against observations from healthy
            plants. It does not confirm whether a plant is healthy or
            disease-free.
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Temperature", visible?.reading?.temperature, "°C"],
              ["Humidity", visible?.reading?.humidity, "%"],
              ["Soil moisture", visible?.reading?.moisture, "%"],
              ["Battery", visible?.reading?.battery, "%"],
            ].map(([label, value, unit]) => (
              <div
                key={String(label)}
                className="rounded-lg border border-slate-200 p-3"
              >
                <p className="text-xs text-slate-600">{label}</p>
                <p className="mt-1 font-semibold text-slate-900">
                  {value ?? "—"}
                  {value == null ? "" : unit}
                </p>
              </div>
            ))}
          </div>
          {compact ? (
            <Link
              href="/iot-monitoring"
              className="inline-block text-sm font-semibold text-emerald-700"
            >
              View condition history and record an inspection →
            </Link>
          ) : (
            <>
              <div className="overflow-x-auto">
                <h3 className="mb-3 font-semibold text-slate-900">
                  Condition history
                </h3>
                {!records.length ? (
                  <p className="text-sm text-slate-600">
                    No saved assessments yet.
                  </p>
                ) : (
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b text-slate-600">
                        <th className="py-2 pr-4">Reading time</th>
                        <th className="pr-4">Condition</th>
                        <th>Explanation</th>
                      </tr>
                    </thead>
                    <tbody>
                      {records.map((record) => (
                        <tr
                          key={record.assessment_id}
                          className="border-b border-slate-100"
                        >
                          <td className="py-3 pr-4">
                            {conditionTime(record.observed_at)}
                          </td>
                          <td className="pr-4">
                            {conditionLabel(record.status)}
                          </td>
                          <td>{record.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <form
                onSubmit={submitInspection}
                className="space-y-4 rounded-xl border border-slate-200 p-4"
                key={selected}
              >
                <h3 className="font-semibold text-slate-900">
                  Record a plant inspection
                </h3>
                <p className="text-sm text-slate-600">
                Include routine inspections when readings appear normal. Record
                what you observed independently of the sensor assessment. An
                administrator will review your observations.
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="text-sm text-slate-700">
                    Inspection time
                    <input
                      required
                      type="datetime-local"
                      name="inspected_at"
                      className="mt-1 block w-full rounded-lg border p-2"
                    />
                  </label>
                  <label className="text-sm text-slate-700">
                    Observed plant health
                    <select
                      name="reported_label"
                      defaultValue="unknown"
                      className="mt-1 block w-full rounded-lg border p-2"
                    >
                      <option value="unknown">Unknown / unsure</option>
                      <option value="healthy">Healthy</option>
                      <option value="unhealthy">Unhealthy</option>
                    </select>
                  </label>
                  <label className="text-sm text-slate-700">
                    Inspection type
                    <select
                      name="inspection_kind"
                      className="mt-1 block w-full rounded-lg border p-2"
                    >
                      <option value="routine">Routine inspection</option>
                      <option value="alert_triggered">
                        Following a sensor alert
                      </option>
                    </select>
                  </label>
                  <label className="text-sm text-slate-700">
                    Related sensor reading
                    <select
                      name="assessment_id"
                      className="mt-1 block w-full rounded-lg border p-2"
                    >
                      <option value="">No matching reading available</option>
                      {records.map((record) => (
                        <option
                          key={record.assessment_id}
                          value={record.assessment_id}
                        >
                          {conditionTime(record.observed_at)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="block text-sm text-slate-700">
                  Observed symptoms
                  <textarea
                    name="symptoms"
                    maxLength={2000}
                    rows={2}
                    className="mt-1 block w-full rounded-lg border p-2"
                  />
                </label>
                <label className="block text-sm text-slate-700">
                  Interventions, such as watering
                  <textarea
                    name="interventions"
                    maxLength={2000}
                    rows={2}
                    className="mt-1 block w-full rounded-lg border p-2"
                  />
                </label>
                <button disabled={saving} className="btn-primary" type="submit">
                  {saving ? "Saving…" : "Save inspection"}
                </button>
                {success && (
                  <p role="status" className="text-sm text-emerald-700">
                    {success}
                  </p>
                )}
              </form>
              <div>
                <h3 className="mb-3 font-semibold text-slate-900">
                  Inspection records
                </h3>
                {!inspections.length ? (
                  <p className="text-sm text-slate-600">
                    No inspections recorded yet.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {inspections.map((inspection) => (
                      <li
                        key={inspection.observation_id}
                        className="rounded-lg border p-3 text-sm"
                      >
                        <p>
                          {conditionTime(inspection.inspected_at)} ·{" "}
                          {inspection.inspection_kind === "routine"
                            ? "Routine"
                            : "Following alert"}
                        </p>
                        <p className="mt-1">
                          Reported: {inspection.reported_label} ·{" "}
                          {inspection.review_status === "pending"
                            ? "Awaiting review"
                            : `Reviewed: ${inspection.confirmed_label}`}
                        </p>
                        <p className="mt-1 text-slate-600">
                          {inspection.symptoms || "No symptoms recorded."}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
