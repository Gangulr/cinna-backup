"use client";

import { useEffect, useState } from "react";
import {
  Thermometer,
  Droplets,
  Sprout,
  Battery,
  RefreshCw,
  Wifi,
  Clock,
  Database,
  Activity,
  AlertCircle,
} from "lucide-react";

import ProtectedRoute from "@/app/components/ProtectedRoute";
import { apiGet } from "@/app/lib/api";

export default function IoTMonitoringPage() {
  const [iotData, setIotData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const fetchIoTData = async () => {
    try {
      setLoading(true);
      setError("");

      const data = await apiGet<any>(
        "/latest-iot-data/",
        false
      );

      console.log("🔥 IOT DATA:", data);

      if (data.error) {
        setError(data.error);
        setIotData(null);
        return;
      }

      setIotData(data);
    } catch (err) {
      console.log(err);
      setError("Failed to fetch IoT data");
      setIotData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchIoTData();

    const interval = setInterval(() => {
      fetchIoTData();
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  const gauges = [
    {
      key: "temperature",
      label: "Temperature",
      unit: "°C",
      value: iotData?.temperature,
      max: 50,
      icon: Thermometer,
      accent: "border-l-rose-500",
      bar: "bg-rose-500",
      track: "bg-rose-100",
      iconBg: "bg-rose-50 text-rose-600",
    },
    {
      key: "humidity",
      label: "Humidity",
      unit: "%",
      value: iotData?.humidity,
      max: 100,
      icon: Droplets,
      accent: "border-l-sky-500",
      bar: "bg-sky-500",
      track: "bg-sky-100",
      iconBg: "bg-sky-50 text-sky-600",
    },
    {
      key: "moisture",
      label: "Soil Moisture",
      unit: "%",
      value: iotData?.moisture,
      max: 100,
      icon: Sprout,
      accent: "border-l-emerald-600",
      bar: "bg-emerald-600",
      track: "bg-emerald-100",
      iconBg: "bg-emerald-50 text-emerald-700",
    },
    {
      key: "battery",
      label: "Battery",
      unit: "%",
      value: iotData?.battery,
      max: 100,
      icon: Battery,
      accent: "border-l-amber-500",
      bar: "bg-amber-500",
      track: "bg-amber-100",
      iconBg: "bg-amber-50 text-amber-700",
    },
  ];

  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-slate-50">
        <div className="page-shell">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="page-title">
                IoT Monitoring
              </h1>

              <p className="page-subtitle">
                Real-time environmental telemetry from Firebase RTDB sensors.
              </p>
            </div>

            <button
              type="button"
              onClick={fetchIoTData}
              disabled={loading}
              className="btn-primary"
            >
              <RefreshCw
                className={`h-4 w-4 ${
                  loading ? "animate-spin" : ""
                }`}
              />

              {loading
                ? "Refreshing…"
                : "Refresh Data"}
            </button>
          </div>

          {error && (
            <div className="flex items-start gap-3 rounded-xl border border-rose-200 bg-white p-4 shadow-sm">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" />

              <div>
                <p className="text-sm font-semibold text-rose-700">
                  Connection error
                </p>

                <p className="mt-0.5 text-sm text-rose-600">
                  {error}
                </p>
              </div>
            </div>
          )}

          {/* Telemetry gauges */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            {gauges.map((g) => {
              const Icon = g.icon;
              const numeric = Number(
                g.value ?? 0
              );

              const pct =
                g.key === "temperature"
                  ? Math.min(
                      (numeric / g.max) * 100,
                      100
                    )
                  : Math.min(numeric, 100);

              return (
                <div
                  key={g.key}
                  className={`card border-l-4 ${g.accent} p-5`}
                >
                  <div className="flex items-start justify-between">
                    <p className="kpi-label">
                      {g.label}
                    </p>

                    <span
                      className={`rounded-lg p-2 ${g.iconBg}`}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                  </div>

                  <h2 className="kpi-value">
                    {g.value ?? "-"}

                    <span className="ml-1 text-base font-semibold text-slate-500">
                      {g.unit}
                    </span>
                  </h2>

                  <div
                    className={`mt-4 h-1.5 overflow-hidden rounded-full ${g.track}`}
                  >
                    <div
                      className={`h-1.5 rounded-full transition-all duration-500 ${g.bar}`}
                      style={{
                        width: `${pct}%`,
                      }}
                    />
                  </div>

                  <p className="mt-2 text-[11px] font-medium uppercase tracking-wider text-slate-400">
                    Gauge · 0–{g.max}
                    {g.unit}
                  </p>
                </div>
              );
            })}
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="card p-6">
              <h2 className="mb-5 text-base font-semibold text-slate-900">
                Latest Sensor Information
              </h2>

              <div className="space-y-3">
                <div className="flex items-center gap-4 rounded-lg border border-slate-200/60 bg-white p-4">
                  <span className="rounded-lg bg-emerald-50 p-2.5 text-emerald-700">
                    <Clock className="h-4 w-4" />
                  </span>

                  <div>
                    <p className="kpi-label">
                      Last Updated
                    </p>

                    <h3 className="mt-1 text-sm font-semibold text-slate-900">
                      {iotData?.timestamp ??
                        "—"}
                    </h3>
                  </div>
                </div>

                <div className="flex items-center gap-4 rounded-lg border border-slate-200/60 bg-white p-4">
                  <span className="rounded-lg bg-slate-100 p-2.5 text-slate-600">
                    <Database className="h-4 w-4" />
                  </span>

                  <div>
                    <p className="kpi-label">
                      Data Source
                    </p>

                    <h3 className="mt-1 text-sm font-semibold text-slate-900">
                      {iotData?.source ??
                        "Firebase RTDB"}
                    </h3>
                  </div>
                </div>
              </div>
            </div>

            <div className="card p-6">
              <h2 className="mb-5 text-base font-semibold text-slate-900">
                System Status
              </h2>

              <div className="space-y-3">
                <div className="flex items-center justify-between rounded-lg border border-slate-200/60 p-4">
                  <div className="flex items-center gap-3">
                    <Activity className="h-4 w-4 text-emerald-600" />

                    <div>
                      <p className="kpi-label">
                        Monitoring
                      </p>

                      <p className="mt-0.5 text-sm font-semibold text-slate-900">
                        Active
                      </p>
                    </div>
                  </div>

                  <span className="badge-healthy">
                    Online
                  </span>
                </div>

                <div className="flex items-center justify-between rounded-lg border border-slate-200/60 p-4">
                  <div className="flex items-center gap-3">
                    <Wifi className="h-4 w-4 text-sky-600" />

                    <div>
                      <p className="kpi-label">
                        Connection
                      </p>

                      <p className="mt-0.5 text-sm font-semibold text-slate-900">
                        Firebase Connected
                      </p>
                    </div>
                  </div>

                  <span className="badge-info">
                    RTDB
                  </span>
                </div>

                <div className="flex items-center justify-between rounded-lg border border-slate-200/60 p-4">
                  <div className="flex items-center gap-3">
                    <RefreshCw className="h-4 w-4 text-slate-500" />

                    <div>
                      <p className="kpi-label">
                        Auto Refresh
                      </p>

                      <p className="mt-0.5 text-sm font-semibold text-slate-900">
                        Every 5 Seconds
                      </p>
                    </div>
                  </div>

                  <span className="badge-info">
                    Polling
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="card overflow-hidden">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="text-base font-semibold text-slate-900">
                Raw IoT JSON Data
              </h2>

              <p className="mt-0.5 text-xs text-slate-500">
                Debug payload from latest sensor reading
              </p>
            </div>

            <pre className="overflow-auto bg-slate-900 p-5 text-xs leading-relaxed text-emerald-300 sm:text-sm">
              {JSON.stringify(
                iotData,
                null,
                2
              ) || "// awaiting data…"}
            </pre>
          </div>
        </div>
      </div>
    </ProtectedRoute>
  );
}