"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { Loader2, Radio } from "lucide-react";
import ConditionAssessment from "./ConditionAssessment";
import { useAuth } from "@/app/context/AuthContext";
import { apiGet, apiPost } from "@/app/lib/api";
import { conditionTime } from "@/app/lib/plant-condition";
import {
  assessmentTitle, ConditionCheck, GuidanceResponse, InputOrigins, LiveSnapshot, manualOrigins,
  mergeLiveInputs, SensorField, SensorForm, sensorFields, validateSensorForm,
} from "@/app/lib/interactive-condition";

const fields = {
  temperature: { label: "Temperature", unit: "°C", min: -50 },
  humidity: { label: "Humidity", unit: "%", min: 0 },
  moisture: { label: "Soil moisture", unit: "%", min: 0 },
};

export default function InteractiveConditionCheck({ fetchLive }: { fetchLive?: () => Promise<LiveSnapshot> }) {
  const { firebaseUser } = useAuth();
  if (!firebaseUser) return null;
  return <ConditionPanel key={firebaseUser.uid} fetchLive={fetchLive} />;
}

function ConditionPanel({ fetchLive }: { fetchLive?: () => Promise<LiveSnapshot> }) {
  const [form, setForm] = useState<SensorForm>({ plant_id: "P-001", temperature: "", humidity: "", moisture: "" });
  const [origins, setOrigins] = useState<InputOrigins>({ ...manualOrigins });
  const [snapshot, setSnapshot] = useState<LiveSnapshot | null>(null);
  const [result, setResult] = useState<ConditionCheck | null>(null);
  const [records, setRecords] = useState<ConditionCheck[]>([]);
  const [error, setError] = useState("");
  const [historyError, setHistoryError] = useState("");
  const [historyLoading, setHistoryLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [checking, setChecking] = useState(false);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [guidanceState, setGuidanceState] = useState<"idle" | "loading" | "ready" | "unavailable">("idle");
  const [detailId, setDetailId] = useState<string | null>(null);
  const revision = useRef(0);
  const busy = useRef(false);
  const pendingSubmission = useRef<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setHistoryLoading(true);
      setHistoryError("");
      const query = `?plant_id=${encodeURIComponent(form.plant_id.trim())}&limit=20`;
      if (!form.plant_id.trim()) {
        setRecords([]);
        setHistoryLoading(false);
        return;
      }
      try {
        const rows = await apiGet<ConditionCheck[]>(`/plant-condition-history${query}`);
        if (!cancelled) setRecords(rows);
      } catch (err: unknown) {
        if (!cancelled) {
          setRecords([]);
          setHistoryError(err instanceof Error ? err.message : "Unable to load condition history.");
        }
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    }, 300);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [form.plant_id, historyVersion]);

  function change(name: keyof SensorForm, value: string) {
    revision.current += 1;
    setGuidanceState("idle");
    if (name === "plant_id") setDetailId(null);
    setForm((previous) => ({ ...previous, [name]: value }));
    if (name !== "plant_id") setOrigins((previous) => ({ ...previous, [name]: "manual" }));
    setResult(null);
    setError("");
    pendingSubmission.current = null;
  }

  async function fetchReadings() {
    if (busy.current) return;
    busy.current = true;
    setFetching(true);
    revision.current += 1;
    setGuidanceState("idle");
    setError("");
    setResult(null);
    pendingSubmission.current = null;
    try {
      const data = fetchLive ? await fetchLive() : await apiGet<LiveSnapshot & { error?: string }>("/latest-iot-data", false);
      if (!mounted.current) return;
      if ("error" in data && data.error) throw new Error(String(data.error));
      const merged = mergeLiveInputs(form, data, origins);
      setForm(merged.form);
      setOrigins(merged.origins);
      setSnapshot(data);
    } catch (err: unknown) {
      if (mounted.current) setError(err instanceof Error ? err.message : "Could not fetch readings. Enter measured values manually.");
    } finally {
      busy.current = false;
      if (mounted.current) setFetching(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    const validation = validateSensorForm(form);
    if (validation) { setError(validation); return; }
    busy.current = true;
    setChecking(true);
    setError("");
    const currentRevision = ++revision.current;
    setGuidanceState("idle");
    const requestId = pendingSubmission.current ?? crypto.randomUUID();
    pendingSubmission.current = requestId;
    try {
      const checked = await apiPost<ConditionCheck>("/plant-condition-check", {
        request_id: requestId, plant_id: form.plant_id.trim(),
        temperature: Number(form.temperature), humidity: Number(form.humidity), moisture: Number(form.moisture),
        input_origins: origins, live_snapshot: snapshot,
      });
      if (!mounted.current) return;
      setResult(checked);
      if (checked.database_saved) {
        pendingSubmission.current = null;
        setHistoryVersion((version) => version + 1);
        if (checked.care_guidance) setGuidanceState("ready");
        else void loadGuidance(checked, currentRevision);
      }
    } catch (err: unknown) {
      if (mounted.current) setError(err instanceof Error ? err.message : "Unable to assess these readings.");
    } finally {
      busy.current = false;
      if (mounted.current) setChecking(false);
    }
  }

  async function loadGuidance(checked: ConditionCheck, currentRevision: number) {
    if (!checked.record_id) return;
    setGuidanceState("loading");
    try {
      const response = await apiPost<GuidanceResponse>(`/plant-condition-checks/${checked.record_id}/guidance`);
      if (!mounted.current || revision.current !== currentRevision) return;
      if (response.status === "ready" && response.guidance) {
        setResult((previous) => previous?.record_id === checked.record_id ? { ...previous, care_guidance: response.guidance! } : previous);
        setGuidanceState("ready");
        setHistoryVersion((version) => version + 1);
      } else setGuidanceState("unavailable");
    } catch {
      if (mounted.current && revision.current === currentRevision) setGuidanceState("unavailable");
    }
  }

  const visibleRecords = records.filter((record) => record.plant_id === form.plant_id.trim());
  return (
    <div className="space-y-6">
      <section className="card space-y-4 p-6" aria-label="Sensor inputs">
        <h2 className="text-lg font-semibold">Sensor Inputs</h2>
        <p className="text-sm text-slate-600">Enter a Plant ID to label this check. Fetch the shared ESP32 feed or enter measured values. Soil moisture must use the calibrated percentage scale of the supplied dataset.</p>
        <form onSubmit={submit} className="space-y-4">
          <fieldset disabled={fetching || checking} className="grid gap-4 md:grid-cols-4">
            <label className="text-sm font-medium">Plant ID
              <input name="plant_id" required maxLength={100} value={form.plant_id} onChange={(event) => change("plant_id", event.target.value)} className="mt-2 block w-full rounded-lg border border-slate-300 p-3" />
            </label>
            {sensorFields.map((name: SensorField) => <label key={name} className="text-sm font-medium">{fields[name].label} ({fields[name].unit})
              <input name={name} type="number" step="any" required min={fields[name].min} max={100} value={form[name]} onChange={(event) => change(name, event.target.value)} className="mt-2 block w-full rounded-lg border border-slate-300 p-3" />
              {snapshot?.missing_fields.includes(name) && !form[name].trim() && <span className="mt-1 block text-xs text-amber-800">{fields[name].label} unavailable—enter a measured value.</span>}
            </label>)}
          </fieldset>
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={() => void fetchReadings()} disabled={fetching || checking} className="btn-secondary flex items-center gap-2">
              {fetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radio className="h-4 w-4" />}{fetching ? "Fetching readings…" : "Get Live IoT Data"}
            </button>
            <button type="submit" disabled={fetching || checking} className="btn-primary flex items-center gap-2">
              {checking && <Loader2 className="h-4 w-4 animate-spin" />}{checking ? "Checking conditions…" : result?.database_saved === false ? "Retry Save" : "Check Plant Condition"}
            </button>
          </div>
        </form>
        {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
      </section>

      {result && <ConditionAssessment result={result} guidanceState={guidanceState} />}
      <p className="text-sm text-slate-600">This assessment evaluates sensor conditions; it does not confirm plant health or diagnose disease.</p>

      <section className="card space-y-3 p-6" aria-label="Recent condition checks">
        <h2 className="text-lg font-semibold">Recent Checks {form.plant_id.trim() && `— ${form.plant_id.trim()}`}</h2>
        {historyError && <p role="alert" className="text-sm text-rose-700">{historyError}</p>}
        {historyLoading && <p className="text-sm text-slate-500">Loading checks…</p>}
        {!historyLoading && !historyError && !visibleRecords.length && <p className="text-sm text-slate-500">No saved checks for this Plant ID yet.</p>}
        {!!visibleRecords.length && <div className="overflow-x-auto"><table className="w-full text-left text-sm">
          <thead><tr className="border-b text-slate-500"><th className="p-2">Check time</th><th className="p-2">Inputs</th><th className="p-2">Result</th><th className="p-2"><span className="sr-only">Details</span></th></tr></thead>
          <tbody>{visibleRecords.map((record) => <tr key={record.record_id} className="border-b align-top">
            <td className="p-2">{conditionTime(record.assessed_at)}</td>
            <td className="p-2">{record.temperature}°C · {record.humidity}% RH · {record.moisture}% moisture</td>
            <td className="p-2">{assessmentTitle(record.status)}<p className="mt-1 text-slate-500">{record.reason}</p></td>
            <td className="p-2"><button type="button" onClick={() => setDetailId(detailId === record.record_id ? null : record.record_id)} className="whitespace-nowrap text-sm font-semibold text-emerald-700" aria-expanded={detailId === record.record_id}>{detailId === record.record_id ? "Hide details" : "View details"}</button></td>
          </tr>)}</tbody>
        </table></div>}
        {visibleRecords.find((record) => record.record_id === detailId) && <ConditionAssessment result={visibleRecords.find((record) => record.record_id === detailId)!} />}
      </section>
    </div>
  );
}
