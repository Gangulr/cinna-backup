"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Thermometer, Droplets, Sprout, Battery, RefreshCw, Wifi, Clock, Database, Activity, AlertCircle } from "lucide-react";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import { apiGet } from "@/app/lib/api";
import { LiveSnapshot } from "@/app/lib/interactive-condition";
import { conditionTime } from "@/app/lib/plant-condition";
import InteractiveConditionCheck from "@/app/components/InteractiveConditionCheck";
import PlantConditionMonitor from "@/app/components/PlantConditionMonitor";

export default function IoTMonitoringPage() {
  const [iotData, setIotData] = useState<LiveSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const mounted = useRef(true);
  const pendingFetch = useRef<Promise<LiveSnapshot> | null>(null);

  const fetchIoTData = useCallback((): Promise<LiveSnapshot> => {
    if (pendingFetch.current) return pendingFetch.current;
    if (mounted.current) { setLoading(true); setError(""); }
    const request = (async () => {
      try {
        const data = await apiGet<LiveSnapshot & { error?: string }>("/latest-iot-data", false);
        if (data.error) throw new Error(data.error);
        if (mounted.current) setIotData(data);
        return data;
      } catch (failure: unknown) {
        const message = failure instanceof Error ? failure.message : "Failed to fetch IoT data";
        if (mounted.current) { setError(message); setIotData(null); }
        throw failure;
      } finally {
        pendingFetch.current = null;
        if (mounted.current) setLoading(false);
      }
    })();
    pendingFetch.current = request;
    return request;
  }, []);

  useEffect(() => {
    mounted.current = true;
    const refresh = () => { void fetchIoTData().catch(() => {}); };
    refresh();
    const interval = window.setInterval(refresh, 5000);
    return () => { mounted.current = false; window.clearInterval(interval); };
  }, [fetchIoTData]);

  const freshness = iotData?.observed_at ? (() => {
    const age = (Date.now() - new Date(iotData.observed_at).getTime()) / 1000;
    if (!Number.isFinite(age)) return "unknown";
    if (age < -60) return "future";
    return age > (iotData.stale_after_seconds ?? 900) ? "stale" : "fresh";
  })() : "unknown";
  const measurementStatus = !iotData ? "No sensor reading" : freshness === "fresh" ? "Recent sensor reading" :
    freshness === "stale" ? "Older sensor reading" : freshness === "future" ? "Sensor clock needs checking" : "Measurement time unknown";
  const gauges = [
    { key: "temperature", label: "Temperature", unit: "°C", value: iotData?.temperature, max: 50, icon: Thermometer, accent: "border-l-rose-500", bar: "bg-rose-500", track: "bg-rose-100", iconBg: "bg-rose-50 text-rose-600" },
    { key: "humidity", label: "Humidity", unit: "%", value: iotData?.humidity, max: 100, icon: Droplets, accent: "border-l-sky-500", bar: "bg-sky-500", track: "bg-sky-100", iconBg: "bg-sky-50 text-sky-600" },
    { key: "moisture", label: "Soil Moisture", unit: "%", value: iotData?.moisture, max: 100, icon: Sprout, accent: "border-l-emerald-600", bar: "bg-emerald-600", track: "bg-emerald-100", iconBg: "bg-emerald-50 text-emerald-700" },
    { key: "battery", label: "Battery", unit: "%", value: iotData?.battery, max: 100, icon: Battery, accent: "border-l-amber-500", bar: "bg-amber-500", track: "bg-amber-100", iconBg: "bg-amber-50 text-amber-700" },
  ];

  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-slate-50">
        <div className="page-shell">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div><h1 className="page-title">IoT Monitoring</h1><p className="page-subtitle">Real-time environmental telemetry from Firebase RTDB sensors.</p></div>
            <button type="button" onClick={() => { void fetchIoTData().catch(() => {}); }} disabled={loading} className="btn-primary">
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />{loading ? "Refreshing…" : "Refresh Data"}
            </button>
          </div>
          {error && <div role="alert" className="flex items-start gap-3 rounded-xl border border-rose-200 bg-white p-4 shadow-sm">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" />
            <div><p className="text-sm font-semibold text-rose-700">Connection error</p><p className="mt-0.5 text-sm text-rose-600">{error}</p></div>
          </div>}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4" aria-label="Live sensor overview">
            {gauges.map((gauge) => {
              const Icon = gauge.icon;
              const available = typeof gauge.value === "number" && Number.isFinite(gauge.value);
              const percentage = available ? Math.max(0, Math.min((gauge.value! / gauge.max) * 100, 100)) : 0;
              return <div key={gauge.key} className={`card border-l-4 ${gauge.accent} p-5`}>
                <div className="flex items-start justify-between"><p className="kpi-label">{gauge.label}</p><span className={`rounded-lg p-2 ${gauge.iconBg}`}><Icon className="h-4 w-4" /></span></div>
                <h2 className="kpi-value">{available ? gauge.value : "Not available"}{available && <span className="ml-1 text-base font-semibold text-slate-500">{gauge.unit}</span>}</h2>
                <div className={`mt-4 h-1.5 overflow-hidden rounded-full ${gauge.track}`}><div className={`h-1.5 rounded-full transition-all duration-500 ${gauge.bar}`} style={{ width: `${percentage}%` }} /></div>
                <p className="mt-2 text-[11px] font-medium uppercase tracking-wider text-slate-400">Gauge · 0–{gauge.max}{gauge.unit}</p>
              </div>;
            })}
          </div>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <section className="card p-6">
              <h2 className="mb-5 text-base font-semibold text-slate-900">Latest Sensor Information</h2>
              <div className="space-y-3">
                <div className="flex items-center gap-4 rounded-lg border border-slate-200/60 bg-white p-4">
                  <span className="rounded-lg bg-emerald-50 p-2.5 text-emerald-700"><Clock className="h-4 w-4" /></span>
                  <div><p className="kpi-label">Last Updated</p><p className="mt-1 text-sm font-semibold text-slate-900">{iotData?.observed_at ? conditionTime(iotData.observed_at) : iotData?.timestamp || "Not available"}</p><p className="mt-1 text-xs text-slate-500">{measurementStatus}</p></div>
                </div>
                <div className="flex items-center gap-4 rounded-lg border border-slate-200/60 bg-white p-4">
                  <span className="rounded-lg bg-slate-100 p-2.5 text-slate-600"><Database className="h-4 w-4" /></span>
                  <div><p className="kpi-label">Data Source</p><p className="mt-1 text-sm font-semibold text-slate-900">{iotData?.source || "Firebase RTDB"}</p></div>
                </div>
              </div>
            </section>
            <section className="card p-6">
              <h2 className="mb-5 text-base font-semibold text-slate-900">System Status</h2>
              <div className="space-y-3">
                <div className="flex items-center justify-between rounded-lg border border-slate-200/60 p-4">
                  <div className="flex items-center gap-3"><Activity className="h-4 w-4 text-emerald-600" /><div><p className="kpi-label">Monitoring</p><p className="mt-0.5 text-sm font-semibold text-slate-900">{iotData ? "Active" : error ? "Feed unavailable" : "Connecting…"}</p></div></div>
                  <span className={iotData ? "badge-healthy" : "badge-info"}>{iotData ? "Feed reachable" : "Unavailable"}</span>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-slate-200/60 p-4">
                  <div className="flex items-center gap-3"><Wifi className="h-4 w-4 text-sky-600" /><div><p className="kpi-label">Connection</p><p className="mt-0.5 text-sm font-semibold text-slate-900">{iotData ? "Firebase Connected" : error ? "Connection failed" : "Waiting for connection"}</p></div></div><span className="badge-info">RTDB</span>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-slate-200/60 p-4">
                  <div className="flex items-center gap-3"><RefreshCw className="h-4 w-4 text-slate-500" /><div><p className="kpi-label">Auto Refresh</p><p className="mt-0.5 text-sm font-semibold text-slate-900">Every 5 Seconds</p></div></div><span className="badge-info">Polling</span>
                </div>
              </div>
            </section>
          </div>
          <InteractiveConditionCheck fetchLive={fetchIoTData} />
          <details className="card p-6" onToggle={(event) => setAdvanced(event.currentTarget.open)}>
            <summary className="cursor-pointer text-sm font-medium text-slate-600">Advanced: registered-device monitoring and inspections</summary>
            {advanced && <div className="mt-4"><PlantConditionMonitor /></div>}
          </details>
        </div>
      </div>
    </ProtectedRoute>
  );
}
