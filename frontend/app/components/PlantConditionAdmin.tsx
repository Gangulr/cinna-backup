"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { apiGet, apiPost } from "@/app/lib/api";
import {
  conditionTime,
  HealthObservation,
  Plant,
} from "@/app/lib/plant-condition";

type Owner = { uid: string; fullName: string };
const initial: Plant = {
  plant_id: "",
  owner_id: "",
  device_id: "",
  calibration_id: "client-moisture-percent-v1",
  expected_interval_seconds: 300,
  source_kind: "device",
  active: true,
};

export default function PlantConditionAdmin({ owners }: { owners: Owner[] }) {
  const [plants, setPlants] = useState<Plant[]>([]);
  const [form, setForm] = useState<Plant>(initial);
  const [selected, setSelected] = useState("");
  const [observations, setObservations] = useState<HealthObservation[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const load = useCallback(async () => {
    try {
      const rows = await apiGet<Plant[]>("/plants");
      setPlants(rows);
      setSelected((old) => old || rows[0]?.plant_id || "");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unable to load plants.");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const loadInspections = useCallback(async (plantId: string) => {
    try {
      setObservations(
        await apiGet<HealthObservation[]>(
          `/plants/${encodeURIComponent(plantId)}/health-observations`,
        ),
      );
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Unable to load inspections.",
      );
    }
  }, []);
  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    apiGet<HealthObservation[]>(
      `/plants/${encodeURIComponent(selected)}/health-observations`,
    )
      .then((rows) => {
        if (!cancelled) setObservations(rows);
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(
            err instanceof Error ? err.message : "Unable to load inspections.",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await apiPost("/admin/plants", form);
      setMessage("Plant and device assignment saved.");
      await load();
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Unable to register the plant.",
      );
    } finally {
      setSaving(false);
    }
  }
  async function review(
    event: FormEvent<HTMLFormElement>,
    inspection: HealthObservation,
  ) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setSaving(true);
    setError("");
    try {
      await apiPost(
        `/admin/plants/${encodeURIComponent(inspection.plant_id)}/health-observations/${encodeURIComponent(inspection.observation_id)}/review`,
        {
          confirmed_label: data.get("confirmed_label"),
          review_notes: data.get("review_notes"),
        },
      );
      setMessage("Inspection review saved.");
      await loadInspections(inspection.plant_id);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Unable to review the inspection.",
      );
    } finally {
      setSaving(false);
    }
  }
  function edit(plant: Plant) {
    setForm({
      plant_id: plant.plant_id,
      owner_id: plant.owner_id,
      device_id: plant.device_id,
      calibration_id: plant.calibration_id,
      expected_interval_seconds: plant.expected_interval_seconds,
      source_kind: plant.source_kind,
      active: plant.active,
    });
  }

  return (
    <section
      className="card mt-8 space-y-5 p-6"
      aria-label="Plant and device administration"
    >
      <h2 className="text-lg font-semibold text-slate-900">
        Plant devices and inspection reviews
      </h2>
      <p className="text-sm text-slate-600">
        Assign each sensor to one plant. Confirm that its moisture calibration
        matches the healthy dataset before enabling assessments.
      </p>
      {error && (
        <p role="alert" className="text-sm text-rose-700">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="text-sm text-emerald-700">
          {message}
        </p>
      )}
      <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm">
          Plant ID
          <input
            required
            pattern="[A-Za-z0-9][A-Za-z0-9_.-]{0,99}"
            value={form.plant_id}
            onChange={(e) => setForm({ ...form, plant_id: e.target.value })}
            className="mt-1 block w-full rounded-lg border p-2"
          />
        </label>
        <label className="text-sm">
          Owner
          <select
            required
            value={form.owner_id}
            onChange={(e) => setForm({ ...form, owner_id: e.target.value })}
            className="mt-1 block w-full rounded-lg border p-2"
          >
            <option value="">Select owner</option>
            {owners.map((owner) => (
              <option key={owner.uid} value={owner.uid}>
                {owner.fullName}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Sensor device ID
          <input
            required
            pattern="[A-Za-z0-9][A-Za-z0-9_.-]{0,99}"
            value={form.device_id}
            onChange={(e) => setForm({ ...form, device_id: e.target.value })}
            className="mt-1 block w-full rounded-lg border p-2"
          />
        </label>
        <label className="text-sm">
          Moisture calibration identifier
          <input
            required
            maxLength={100}
            value={form.calibration_id}
            onChange={(e) =>
              setForm({ ...form, calibration_id: e.target.value })
            }
            className="mt-1 block w-full rounded-lg border p-2"
          />
        </label>
        <label className="text-sm">
          Device reporting interval (seconds)
          <input
            required
            type="number"
            min={1}
            max={604800}
            value={form.expected_interval_seconds}
            onChange={(e) =>
              setForm({
                ...form,
                expected_interval_seconds: Number(e.target.value),
              })
            }
            className="mt-1 block w-full rounded-lg border p-2"
          />
        </label>
        <label className="text-sm">
          Sensor feed
          <select
            value={form.source_kind}
            onChange={(e) =>
              setForm({
                ...form,
                source_kind: e.target.value as Plant["source_kind"],
              })
            }
            className="mt-1 block w-full rounded-lg border p-2"
          >
            <option value="device">Dedicated device feed</option>
            <option value="legacy">Existing single-device feed</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.active}
            onChange={(e) => setForm({ ...form, active: e.target.checked })}
          />
          Active assignment
        </label>
        <div className="flex gap-3">
          <button disabled={saving} type="submit" className="btn-primary">
            {saving ? "Saving…" : "Save assignment"}
          </button>
          <button
            type="button"
            onClick={() => setForm(initial)}
            className="btn-secondary"
          >
            New plant
          </button>
        </div>
      </form>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b">
              <th className="py-2">Plant</th>
              <th>Device</th>
              <th>Assignment</th>
              <th>
                <span className="sr-only">Edit</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {plants.map((plant) => (
              <tr key={plant.plant_id} className="border-b">
                <td className="py-3">{plant.plant_id}</td>
                <td>{plant.device_id}</td>
                <td>{plant.active ? "Active" : "Inactive"}</td>
                <td>
                  <button
                    className="font-semibold text-emerald-700"
                    onClick={() => edit(plant)}
                    type="button"
                  >
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <label className="block text-sm">
        Review inspections for
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="ml-2 rounded-lg border p-2"
        >
          <option value="">Select plant</option>
          {plants.map((plant) => (
            <option key={plant.plant_id}>{plant.plant_id}</option>
          ))}
        </select>
      </label>
      {observations
        .filter((i) => i.plant_id === selected)
        .map((inspection) => (
          <form
            key={inspection.observation_id}
            onSubmit={(e) => {
              void review(e, inspection);
            }}
            className="space-y-3 rounded-xl border p-4"
          >
            <p className="font-medium">
              {conditionTime(inspection.inspected_at)} · Reported{" "}
              {inspection.reported_label} · {inspection.review_status}
            </p>
            <p className="text-sm">
              Symptoms: {inspection.symptoms || "None recorded"}
            </p>
            <p className="text-sm">
              Interventions: {inspection.interventions || "None recorded"}
            </p>
            <p className="text-sm text-slate-600">
              {inspection.sensor_reading
                ? `Related reading: ${conditionTime(inspection.sensor_reading.observed_at)} · ${inspection.sensor_reading.temperature}°C · humidity ${inspection.sensor_reading.humidity}% · moisture ${inspection.sensor_reading.moisture}%`
                : "No paired sensor reading. This observation cannot yet support sensor-model training."}
            </p>
            <label className="block text-sm">
              Confirmed observation
              <select
                name="confirmed_label"
                defaultValue={inspection.confirmed_label ?? "unknown"}
                className="ml-2 rounded-lg border p-2"
              >
                <option value="unknown">Unknown</option>
                <option value="healthy">Healthy</option>
                <option value="unhealthy">Unhealthy</option>
              </select>
            </label>
            <label className="block text-sm">
              Review evidence
              <textarea
                name="review_notes"
                required
                maxLength={2000}
                rows={2}
                className="mt-1 block w-full rounded-lg border p-2"
              />
            </label>
            <button disabled={saving} className="btn-primary" type="submit">
              Save review
            </button>
          </form>
        ))}
    </section>
  );
}
