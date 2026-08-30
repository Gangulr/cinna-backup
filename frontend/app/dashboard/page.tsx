"use client";

import { useEffect, useState } from "react";
import ProtectedRoute from "@/app/components/ProtectedRoute";

import {
  Thermometer,
  Droplets,
  Sprout,
  Activity,
  AlertTriangle,
  ScanLine,
  TrendingUp,
  Loader2,
  Inbox,
} from "lucide-react";

type DiseaseData = {
  name: string;
  value: number;
};

export default function Dashboard() {
  const [sensor, setSensor] = useState({
    temperature: 0,
    humidity: 0,
    moisture: 0,
  });

  const [totalGrowth, setTotalGrowth] = useState(0);
  const [totalDisease, setTotalDisease] = useState(0);
  const [lastStatus, setLastStatus] = useState("No data");
  const [latestAlert, setLatestAlert] = useState("No alerts yet");

  const [recentGrowth, setRecentGrowth] = useState<any[]>([]);
  const [recentDisease, setRecentDisease] = useState<any[]>([]);

  const [diseaseChartData, setDiseaseChartData] = useState<
    DiseaseData[]
  >([]);

  const [chartLoading, setChartLoading] = useState(true);

  const colors = [
    "#059669",
    "#3b82f6",
    "#e11d48",
    "#d97706",
    "#6366f1",
    "#0891b2",
    "#db2777",
    "#0d9488",
  ];

  const apiUrl =
    process.env.NEXT_PUBLIC_API_URL ||
    "http://localhost:8001";

  // ================= LIVE IOT SENSOR DATA =================
  useEffect(() => {
    const fetchSensorData = async () => {
      try {
        const response = await fetch(
          `${apiUrl}/latest-iot-data/`,
          {
            cache: "no-store",
          }
        );

        if (!response.ok) {
          throw new Error(
            `IoT request failed: ${response.status}`
          );
        }

        const data = await response.json();

        if (!data.error) {
          setSensor({
            temperature: Number(data.temperature || 0),
            humidity: Number(data.humidity || 0),
            moisture: Number(data.moisture || 0),
          });
        }
      } catch (error) {
        console.error("IoT fetch error:", error);
      }
    };

    fetchSensorData();

    const interval = window.setInterval(
      fetchSensorData,
      5000
    );

    return () => {
      window.clearInterval(interval);
    };
  }, [apiUrl]);

  // ================= DASHBOARD DATA =================
  useEffect(() => {
    const fetchDashboardData = async () => {
      try {
        setChartLoading(true);

        const [growthResponse, diseaseResponse] =
          await Promise.all([
            fetch(`${apiUrl}/growth-history/`, {
              cache: "no-store",
            }),
            fetch(`${apiUrl}/disease-history/`, {
              cache: "no-store",
            }),
          ]);

        if (!growthResponse.ok) {
          throw new Error(
            `Growth history request failed: ${growthResponse.status}`
          );
        }

        if (!diseaseResponse.ok) {
          throw new Error(
            `Disease history request failed: ${diseaseResponse.status}`
          );
        }

        const growthJson =
          await growthResponse.json();

        const diseaseJson =
          await diseaseResponse.json();

        const growthData = Array.isArray(growthJson)
          ? growthJson
          : [];

        const diseaseData = Array.isArray(diseaseJson)
          ? diseaseJson
          : [];

        setTotalGrowth(growthData.length);
        setTotalDisease(diseaseData.length);

        const sortedGrowth = [...growthData].sort(
          (a, b) => {
            const timeA = new Date(
              a.prediction_time ||
                a.timestamp ||
                0
            ).getTime();

            const timeB = new Date(
              b.prediction_time ||
                b.timestamp ||
                0
            ).getTime();

            return timeB - timeA;
          }
        );

        const sortedDisease = [...diseaseData].sort(
          (a, b) => {
            const timeA = new Date(
              a.prediction_time ||
                a.timestamp ||
                0
            ).getTime();

            const timeB = new Date(
              b.prediction_time ||
                b.timestamp ||
                0
            ).getTime();

            return timeB - timeA;
          }
        );

        const latestGrowth = sortedGrowth[0];

        if (latestGrowth) {
          setLastStatus(
            latestGrowth.harvest_status ||
              latestGrowth.status ||
              "No data"
          );

          setLatestAlert(
            latestGrowth.alert || "No alerts yet"
          );
        } else {
          setLastStatus("No data");
          setLatestAlert("No alerts yet");
        }

        setRecentGrowth(sortedGrowth.slice(0, 5));
        setRecentDisease(
          sortedDisease.slice(0, 5)
        );

        const counts: Record<string, number> = {};

        diseaseData.forEach((item: any) => {
          const diseaseName =
            item.prediction || "Unknown";

          counts[diseaseName] =
            (counts[diseaseName] || 0) + 1;
        });

        const chartData = Object.entries(
          counts
        ).map(([name, value]) => ({
          name,
          value,
        }));

        setDiseaseChartData(chartData);
      } catch (error) {
        console.error(
          "Dashboard fetch error:",
          error
        );

        setTotalGrowth(0);
        setTotalDisease(0);
        setRecentGrowth([]);
        setRecentDisease([]);
        setDiseaseChartData([]);
      } finally {
        setChartLoading(false);
      }
    };

    fetchDashboardData();
  }, [apiUrl]);

  const totalDiseaseChart =
    diseaseChartData.reduce(
      (sum, item) => sum + item.value,
      0
    );

  let cumulativePercent = 0;

  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-slate-50">
        <div className="page-shell">
          <div>
            <h1 className="page-title">
              Research Analytics Overview
            </h1>

            <p className="page-subtitle">
              Live IoT sensor data, disease
              analytics, and cinnamon growth
              insights.
            </p>
          </div>

          {/* ================= LIVE SENSOR CARDS ================= */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="card border-l-4 border-l-rose-500 p-5">
              <div className="flex items-start justify-between">
                <p className="kpi-label">
                  Temperature
                </p>

                <span className="rounded-lg bg-rose-50 p-2 text-rose-600">
                  <Thermometer className="h-4 w-4" />
                </span>
              </div>

              <h2 className="kpi-value">
                {sensor.temperature}

                <span className="ml-1 text-base font-semibold text-slate-500">
                  °C
                </span>
              </h2>

              <span className="mt-3 badge-info">
                Live · 5s poll
              </span>
            </div>

            <div className="card border-l-4 border-l-sky-500 p-5">
              <div className="flex items-start justify-between">
                <p className="kpi-label">
                  Humidity
                </p>

                <span className="rounded-lg bg-sky-50 p-2 text-sky-600">
                  <Droplets className="h-4 w-4" />
                </span>
              </div>

              <h2 className="kpi-value">
                {sensor.humidity}

                <span className="ml-1 text-base font-semibold text-slate-500">
                  %
                </span>
              </h2>

              <span className="mt-3 badge-info">
                Live · 5s poll
              </span>
            </div>

            <div className="card border-l-4 border-l-emerald-600 p-5">
              <div className="flex items-start justify-between">
                <p className="kpi-label">
                  Soil Moisture
                </p>

                <span className="rounded-lg bg-emerald-50 p-2 text-emerald-700">
                  <Sprout className="h-4 w-4" />
                </span>
              </div>

              <h2 className="kpi-value">
                {sensor.moisture}

                <span className="ml-1 text-base font-semibold text-slate-500">
                  %
                </span>
              </h2>

              <span className="mt-3 badge-healthy">
                Optimal range
              </span>
            </div>
          </div>

          {/* ================= SUMMARY CARDS ================= */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="card p-5">
              <div className="flex items-start justify-between">
                <p className="kpi-label">
                  Total Growth Predictions
                </p>

                <TrendingUp className="h-4 w-4 text-emerald-600" />
              </div>

              <h2 className="kpi-value">
                {totalGrowth}
              </h2>

              <span className="mt-3 badge-healthy">
                Records
              </span>
            </div>

            <div className="card p-5">
              <div className="flex items-start justify-between">
                <p className="kpi-label">
                  Total Disease Scans
                </p>

                <ScanLine className="h-4 w-4 text-rose-600" />
              </div>

              <h2 className="kpi-value">
                {totalDisease}
              </h2>

              <span className="mt-3 badge-danger">
                Scans
              </span>
            </div>

            <div className="card p-5">
              <div className="flex items-start justify-between">
                <p className="kpi-label">
                  Last Prediction Status
                </p>

                <Activity className="h-4 w-4 text-slate-500" />
              </div>

              <h2 className="mt-2 line-clamp-2 text-lg font-bold text-slate-900">
                {lastStatus}
              </h2>

              <span className="mt-3 badge-info">
                Latest
              </span>
            </div>

            <div className="card p-5">
              <div className="flex items-start justify-between">
                <p className="kpi-label">
                  Latest Alert
                </p>

                <AlertTriangle className="h-4 w-4 text-amber-600" />
              </div>

              <h2 className="mt-2 line-clamp-2 text-lg font-bold text-slate-900">
                {latestAlert}
              </h2>

              <span className="mt-3 badge-warning">
                Alert
              </span>
            </div>
          </div>

          {/* ================= RECENT TABLES ================= */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="card overflow-hidden">
              <div className="border-b border-slate-100 px-5 py-4">
                <h3 className="text-base font-semibold text-slate-900">
                  Recent Growth Predictions
                </h3>
              </div>

              {recentGrowth.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 px-5 py-12 text-center">
                  <Inbox className="h-8 w-8 text-slate-300" />

                  <p className="text-sm font-medium text-slate-500">
                    No growth prediction records
                  </p>
                </div>
              ) : (
                <div className="overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="table-header">
                      <tr>
                        <th className="px-5 py-3">
                          Growth
                        </th>

                        <th className="px-5 py-3">
                          Status
                        </th>

                        <th className="px-5 py-3">
                          Alert
                        </th>

                        <th className="px-5 py-3">
                          Time
                        </th>
                      </tr>
                    </thead>

                    <tbody className="divide-y divide-slate-100">
                      {recentGrowth.map(
                        (item, index) => (
                          <tr
                            key={
                              item.id || index
                            }
                            className="hover:bg-slate-50/80"
                          >
                            <td className="px-5 py-3 font-medium text-slate-900">
                              {item.growth_value ??
                                "-"}
                            </td>

                            <td className="px-5 py-3">
                              <span className="badge-healthy">
                                {item.harvest_status ||
                                  item.status ||
                                  "-"}
                              </span>
                            </td>

                            <td className="px-5 py-3 text-slate-600">
                              {item.alert || "-"}
                            </td>

                            <td className="px-5 py-3 text-slate-500">
                              {item.prediction_time ||
                                item.timestamp ||
                                "-"}
                            </td>
                          </tr>
                        )
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="card overflow-hidden">
              <div className="border-b border-slate-100 px-5 py-4">
                <h3 className="text-base font-semibold text-slate-900">
                  Recent Disease Predictions
                </h3>
              </div>

              {recentDisease.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 px-5 py-12 text-center">
                  <Inbox className="h-8 w-8 text-slate-300" />

                  <p className="text-sm font-medium text-slate-500">
                    No disease prediction records
                  </p>
                </div>
              ) : (
                <div className="overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="table-header">
                      <tr>
                        <th className="px-5 py-3">
                          Prediction
                        </th>

                        <th className="px-5 py-3">
                          Confidence
                        </th>

                        <th className="px-5 py-3">
                          Severity
                        </th>

                        <th className="px-5 py-3">
                          Time
                        </th>
                      </tr>
                    </thead>

                    <tbody className="divide-y divide-slate-100">
                      {recentDisease.map(
                        (item, index) => {
                          const severity =
                            String(
                              item.severity || ""
                            ).toLowerCase();

                          const severityClass =
                            severity.includes(
                              "high"
                            )
                              ? "badge-danger"
                              : severity.includes(
                                    "none"
                                  )
                                ? "badge-healthy"
                                : "badge-warning";

                          return (
                            <tr
                              key={
                                item.id || index
                              }
                              className="hover:bg-slate-50/80"
                            >
                              <td className="px-5 py-3 font-medium text-slate-900">
                                {item.prediction ||
                                  "-"}
                              </td>

                              <td className="px-5 py-3 text-slate-600">
                                {item.confidence ||
                                  "-"}
                              </td>

                              <td className="px-5 py-3">
                                <span
                                  className={
                                    severityClass
                                  }
                                >
                                  {item.severity ||
                                    "-"}
                                </span>
                              </td>

                              <td className="px-5 py-3 text-slate-500">
                                {item.prediction_time ||
                                  item.timestamp ||
                                  "-"}
                              </td>
                            </tr>
                          );
                        }
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* ================= PIE CHART + INSIGHTS ================= */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="card p-6">
              <div className="mb-6">
                <h3 className="text-base font-semibold text-slate-900">
                  Distribution of Detected
                  Diseases
                </h3>

                <p className="mt-1 text-sm text-slate-500">
                  Disease prediction analytics
                  overview
                </p>
              </div>

              {chartLoading ? (
                <div className="flex h-[320px] flex-col items-center justify-center gap-3">
                  <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />

                  <p className="text-sm text-slate-500">
                    Loading analytics…
                  </p>
                </div>
              ) : diseaseChartData.length ===
                0 ? (
                <div className="flex h-[320px] flex-col items-center justify-center gap-2">
                  <Inbox className="h-10 w-10 text-slate-300" />

                  <p className="text-base font-medium text-slate-600">
                    No disease data available
                  </p>

                  <p className="text-sm text-slate-400">
                    Run disease predictions to
                    generate analytics
                  </p>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center gap-10 xl:flex-row xl:items-start">
                  <div className="relative h-[280px] w-[280px]">
                    <svg
                      viewBox="0 0 36 36"
                      className="h-full w-full rotate-[-90deg]"
                    >
                      <circle
                        cx="18"
                        cy="18"
                        r="15.9155"
                        fill="transparent"
                        stroke="#f1f5f9"
                        strokeWidth="3.5"
                      />

                      {diseaseChartData.map(
                        (item, index) => {
                          const percent =
                            totalDiseaseChart > 0
                              ? (item.value /
                                  totalDiseaseChart) *
                                100
                              : 0;

                          const dashArray = `${percent} ${
                            100 - percent
                          }`;

                          const dashOffset =
                            -cumulativePercent;

                          cumulativePercent +=
                            percent;

                          return (
                            <circle
                              key={item.name}
                              cx="18"
                              cy="18"
                              r="15.9155"
                              fill="transparent"
                              stroke={
                                colors[
                                  index %
                                    colors.length
                                ]
                              }
                              strokeWidth="3.5"
                              strokeDasharray={
                                dashArray
                              }
                              strokeDashoffset={
                                dashOffset
                              }
                              strokeLinecap="round"
                              className="transition-all duration-700"
                            />
                          );
                        }
                      )}
                    </svg>

                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <h2 className="text-4xl font-bold text-slate-900">
                        {totalDiseaseChart}
                      </h2>

                      <p className="mt-1 text-xs uppercase tracking-wider text-slate-500">
                        Total Scans
                      </p>

                      <span className="mt-3 badge-healthy">
                        AI Monitoring Active
                      </span>
                    </div>
                  </div>

                  <div className="w-full max-w-[360px] space-y-3">
                    {diseaseChartData.map(
                      (item, index) => {
                        const percent =
                          totalDiseaseChart > 0
                            ? (
                                (item.value /
                                  totalDiseaseChart) *
                                100
                              ).toFixed(1)
                            : "0.0";

                        return (
                          <div
                            key={item.name}
                            className="flex items-center justify-between rounded-lg border border-slate-200/60 bg-white px-4 py-3 transition hover:shadow-sm"
                          >
                            <div className="flex items-center gap-3">
                              <div
                                className="h-3 w-3 shrink-0 rounded-full"
                                style={{
                                  backgroundColor:
                                    colors[
                                      index %
                                        colors.length
                                    ],
                                }}
                              />

                              <div>
                                <p
                                  title={item.name}
                                  className="max-w-[180px] truncate text-sm font-semibold text-slate-800"
                                >
                                  {item.name}
                                </p>

                                <p className="text-xs text-slate-500">
                                  {percent}% of total
                                </p>
                              </div>
                            </div>

                            <span className="rounded-md bg-slate-50 px-2.5 py-1 text-sm font-bold text-slate-800">
                              {item.value}
                            </span>
                          </div>
                        );
                      }
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="card p-6">
              <h3 className="mb-2 text-base font-semibold text-slate-900">
                Quick Insights
              </h3>

              <p className="text-sm leading-relaxed text-slate-600">
                Based on collected data, monitor soil
                moisture regularly and maintain proper
                environmental conditions for healthy
                cinnamon growth.
              </p>


            </div>
          </div>
        </div>
      </div>
    </ProtectedRoute>
  );
}