"use client";

import {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  Search,
  Download,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Inbox,
  TrendingUp,
  Microscope,
  AlertTriangle,
  Sprout,
} from "lucide-react";

import ProtectedRoute from "@/app/components/ProtectedRoute";
import { useAuth } from "@/app/context/AuthContext";
import { apiGet } from "@/app/lib/api";

const ITEMS_PER_PAGE = 10;

type GrowthHistoryRecord = {
  id?: string;
  plant_id?: string;
  plant_age_months?: number;
  temperature?: number;
  humidity?: number;
  moisture?: number;
  growth_value?: number;
  harvest_status?: string;
  status?: string;
  alert?: string;
  prediction_time?: string;
  timestamp?: string;
  created_at?: string;
  user_id?: string;
  user_email?: string;
  user_name?: string;
};

type DiseaseHistoryRecord = {
  id?: string;
  prediction?: string;
  confidence?: number | string;
  severity?: string;
  diagnosis?: string;
  symptoms?: string;
  prediction_time?: string;
  timestamp?: string;
  created_at?: string;
  user_id?: string;
  user_email?: string;
  user_name?: string;
};

type HarvestHistoryRecord = {
  id?: string;
  record_id?: string;
  plant_id?: string;
  age?: number;
  plant_age_months?: number;
  growth_rate?: number;
  bark_thickness?: number;
  disease_status?: string;
  current_month?: string;
  bark_quality?: number;
  maturity_level?: number;
  health_status?: number;
  quality_average?: number;
  readiness_score?: number;
  readiness_status?: string;
  recommendation?: string;
  robotic_action?: string;
  prediction_time?: string;
  timestamp?: string;
  created_at?: string;
  user_id?: string;
  user_email?: string;
  user_name?: string;
};

function getStatus(
  growth: number | string | undefined
): string {
  const value = Number(growth);

  if (value >= 80) {
    return "Ready to Harvest";
  }

  if (value >= 50) {
    return "Growing";
  }

  return "Initial Stage";
}

function getAlert(
  growth: number | string | undefined
): string {
  const value = Number(growth);

  if (value >= 80) {
    return "🚨 Harvest Recommended";
  }

  if (value >= 50) {
    return "✅ Normal Growth";
  }

  return "⚠️ Low Growth";
}

function getRecordTime(
  item:
    | GrowthHistoryRecord
    | DiseaseHistoryRecord
    | HarvestHistoryRecord
): string {
  return (
    item.prediction_time ||
    item.timestamp ||
    item.created_at ||
    ""
  );
}

function getTimeValue(
  item:
    | GrowthHistoryRecord
    | DiseaseHistoryRecord
    | HarvestHistoryRecord
): number {
  const rawTime = getRecordTime(item);

  if (!rawTime) {
    return 0;
  }

  const parsedTime =
    new Date(rawTime).getTime();

  return Number.isNaN(parsedTime)
    ? 0
    : parsedTime;
}

function sortGrowthByLatest(
  data: GrowthHistoryRecord[]
): GrowthHistoryRecord[] {
  return [...data].sort(
    (first, second) =>
      getTimeValue(second) -
      getTimeValue(first)
  );
}

function sortDiseaseByLatest(
  data: DiseaseHistoryRecord[]
): DiseaseHistoryRecord[] {
  return [...data].sort(
    (first, second) =>
      getTimeValue(second) -
      getTimeValue(first)
  );
}

function sortHarvestByLatest(
  data: HarvestHistoryRecord[]
): HarvestHistoryRecord[] {
  return [...data].sort(
    (first, second) =>
      getTimeValue(second) -
      getTimeValue(first)
  );
}

function statusBadgeClass(
  status: string
): string {
  const normalizedStatus =
    status.toLowerCase();

  if (
    normalizedStatus.includes("ready") ||
    normalizedStatus.includes("harvest")
  ) {
    return "badge-healthy";
  }

  if (
    normalizedStatus.includes("growing") ||
    normalizedStatus.includes("normal")
  ) {
    return "badge-info";
  }

  if (
    normalizedStatus.includes("initial") ||
    normalizedStatus.includes("low")
  ) {
    return "badge-warning";
  }

  return "badge-info";
}

function severityBadgeClass(
  severity: string | undefined
): string {
  const normalizedSeverity =
    String(severity || "").toLowerCase();

  if (
    normalizedSeverity.includes("high")
  ) {
    return "badge-danger";
  }

  if (
    normalizedSeverity.includes(
      "moderate"
    )
  ) {
    return "badge-warning";
  }

  if (
    normalizedSeverity.includes("none")
  ) {
    return "badge-healthy";
  }

  return "badge-info";
}

function readinessBadgeClass(
  status: string | undefined
): string {
  const normalizedStatus = String(
    status || ""
  ).toLowerCase();

  if (
    normalizedStatus.includes("ready") &&
    !normalizedStatus.includes("not") &&
    !normalizedStatus.includes("almost")
  ) {
    return "badge-healthy";
  }

  if (
    normalizedStatus.includes("almost")
  ) {
    return "badge-warning";
  }

  if (
    normalizedStatus.includes("not")
  ) {
    return "badge-danger";
  }

  return "badge-info";
}

function roboticActionBadgeClass(
  action: string | undefined
): string {
  const normalizedAction = String(
    action || ""
  ).toLowerCase();

  if (
    normalizedAction.includes("approved") ||
    normalizedAction.includes("start") ||
    normalizedAction.includes("proceed")
  ) {
    return "badge-healthy";
  }

  if (
    normalizedAction.includes("wait") ||
    normalizedAction.includes("hold")
  ) {
    return "badge-warning";
  }

  if (
    normalizedAction.includes("blocked") ||
    normalizedAction.includes("stop")
  ) {
    return "badge-danger";
  }

  return "badge-info";
}

function formatRecordTime(
  value: string
): string {
  if (!value) {
    return "-";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

function escapeHtml(
  value: unknown
): string {
  return String(value ?? "-")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export default function HistoryPage() {
  const {
    firebaseUser,
    loading: authLoading,
  } = useAuth();

  const [growthData, setGrowthData] =
    useState<GrowthHistoryRecord[]>([]);

  const [diseaseData, setDiseaseData] =
    useState<DiseaseHistoryRecord[]>([]);

  const [harvestData, setHarvestData] =
    useState<HarvestHistoryRecord[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState("");

  const [growthSearch, setGrowthSearch] =
    useState("");

  const [
    diseaseSearch,
    setDiseaseSearch,
  ] = useState("");

  const [
    harvestSearch,
    setHarvestSearch,
  ] = useState("");

  const [
    growthStatusFilter,
    setGrowthStatusFilter,
  ] = useState("All");

  const [
    diseaseSeverityFilter,
    setDiseaseSeverityFilter,
  ] = useState("All");

  const [
    harvestStatusFilter,
    setHarvestStatusFilter,
  ] = useState("All");

  const [growthPage, setGrowthPage] =
    useState(1);

  const [diseasePage, setDiseasePage] =
    useState(1);

  const [harvestPage, setHarvestPage] =
    useState(1);

  useEffect(() => {
    if (authLoading) {
      return;
    }

    if (!firebaseUser) {
      setGrowthData([]);
      setDiseaseData([]);
      setHarvestData([]);
      setLoading(false);
      return;
    }

    async function loadHistory() {
      try {
        setLoading(true);
        setError("");

        const [
          growthResponse,
          diseaseResponse,
          harvestResponse,
        ] = await Promise.all([
          apiGet<GrowthHistoryRecord[]>(
            "/growth-history/"
          ),
          apiGet<DiseaseHistoryRecord[]>(
            "/disease-history/"
          ),
          apiGet<HarvestHistoryRecord[]>(
            "/harvest-history/"
          ),
        ]);

        setGrowthData(
          sortGrowthByLatest(
            Array.isArray(growthResponse)
              ? growthResponse
              : []
          )
        );

        setDiseaseData(
          sortDiseaseByLatest(
            Array.isArray(diseaseResponse)
              ? diseaseResponse
              : []
          )
        );

        setHarvestData(
          sortHarvestByLatest(
            Array.isArray(harvestResponse)
              ? harvestResponse
              : []
          )
        );
      } catch (requestError) {
        console.error(
          "History fetch error:",
          requestError
        );

        setGrowthData([]);
        setDiseaseData([]);
        setHarvestData([]);

        setError(
          requestError instanceof Error
            ? requestError.message
            : "Unable to load prediction history."
        );
      } finally {
        setLoading(false);
      }
    }

    void loadHistory();
  }, [authLoading, firebaseUser]);

  const filteredGrowthData =
    useMemo(() => {
      const normalizedSearch =
        growthSearch
          .trim()
          .toLowerCase();

      const filtered =
        growthData.filter((item) => {
          const status =
            item.harvest_status ||
            item.status ||
            getStatus(
              item.growth_value
            );

          const alert =
            item.alert ||
            getAlert(
              item.growth_value
            );

          const time =
            getRecordTime(item);

          const searchableValues = [
            item.plant_id,
            item.plant_age_months,
            item.temperature,
            item.humidity,
            item.moisture,
            item.growth_value,
            status,
            alert,
            time,
            item.user_name,
            item.user_email,
          ];

          const matchesSearch =
            normalizedSearch.length ===
              0 ||
            searchableValues.some(
              (value) =>
                String(value ?? "")
                  .toLowerCase()
                  .includes(
                    normalizedSearch
                  )
            );

          const matchesStatus =
            growthStatusFilter ===
              "All" ||
            status ===
              growthStatusFilter;

          return (
            matchesSearch &&
            matchesStatus
          );
        });

      return sortGrowthByLatest(
        filtered
      );
    }, [
      growthData,
      growthSearch,
      growthStatusFilter,
    ]);

  const filteredDiseaseData =
    useMemo(() => {
      const normalizedSearch =
        diseaseSearch
          .trim()
          .toLowerCase();

      const filtered =
        diseaseData.filter((item) => {
          const time =
            getRecordTime(item);

          const searchableValues = [
            item.prediction,
            item.confidence,
            item.severity,
            item.diagnosis,
            item.symptoms,
            time,
            item.user_name,
            item.user_email,
          ];

          const matchesSearch =
            normalizedSearch.length ===
              0 ||
            searchableValues.some(
              (value) =>
                String(value ?? "")
                  .toLowerCase()
                  .includes(
                    normalizedSearch
                  )
            );

          const matchesSeverity =
            diseaseSeverityFilter ===
              "All" ||
            String(
              item.severity || ""
            ).toLowerCase() ===
              diseaseSeverityFilter.toLowerCase();

          return (
            matchesSearch &&
            matchesSeverity
          );
        });

      return sortDiseaseByLatest(
        filtered
      );
    }, [
      diseaseData,
      diseaseSearch,
      diseaseSeverityFilter,
    ]);

  const filteredHarvestData =
    useMemo(() => {
      const normalizedSearch =
        harvestSearch
          .trim()
          .toLowerCase();

      const filtered =
        harvestData.filter((item) => {
          const time =
            getRecordTime(item);

          const status = String(
            item.readiness_status || ""
          );

          const searchableValues = [
            item.plant_id,
            item.age,
            item.plant_age_months,
            item.growth_rate,
            item.bark_thickness,
            item.disease_status,
            item.current_month,
            item.bark_quality,
            item.maturity_level,
            item.health_status,
            item.quality_average,
            item.readiness_score,
            item.readiness_status,
            item.recommendation,
            item.robotic_action,
            time,
            item.user_name,
            item.user_email,
          ];

          const matchesSearch =
            normalizedSearch.length ===
              0 ||
            searchableValues.some(
              (value) =>
                String(value ?? "")
                  .toLowerCase()
                  .includes(
                    normalizedSearch
                  )
            );

          const matchesStatus =
            harvestStatusFilter ===
              "All" ||
            status.toLowerCase() ===
              harvestStatusFilter.toLowerCase();

          return (
            matchesSearch &&
            matchesStatus
          );
        });

      return sortHarvestByLatest(
        filtered
      );
    }, [
      harvestData,
      harvestSearch,
      harvestStatusFilter,
    ]);

  const growthTotalPages = Math.max(
    1,
    Math.ceil(
      filteredGrowthData.length /
        ITEMS_PER_PAGE
    )
  );

  const diseaseTotalPages = Math.max(
    1,
    Math.ceil(
      filteredDiseaseData.length /
        ITEMS_PER_PAGE
    )
  );

  const harvestTotalPages = Math.max(
    1,
    Math.ceil(
      filteredHarvestData.length /
        ITEMS_PER_PAGE
    )
  );

  useEffect(() => {
    if (
      growthPage >
      growthTotalPages
    ) {
      setGrowthPage(
        growthTotalPages
      );
    }
  }, [
    growthPage,
    growthTotalPages,
  ]);

  useEffect(() => {
    if (
      diseasePage >
      diseaseTotalPages
    ) {
      setDiseasePage(
        diseaseTotalPages
      );
    }
  }, [
    diseasePage,
    diseaseTotalPages,
  ]);

  useEffect(() => {
    if (
      harvestPage >
      harvestTotalPages
    ) {
      setHarvestPage(
        harvestTotalPages
      );
    }
  }, [
    harvestPage,
    harvestTotalPages,
  ]);

  const paginatedGrowth =
    filteredGrowthData.slice(
      (growthPage - 1) *
        ITEMS_PER_PAGE,
      growthPage *
        ITEMS_PER_PAGE
    );

  const paginatedDisease =
    filteredDiseaseData.slice(
      (diseasePage - 1) *
        ITEMS_PER_PAGE,
      diseasePage *
        ITEMS_PER_PAGE
    );

  const paginatedHarvest =
    filteredHarvestData.slice(
      (harvestPage - 1) *
        ITEMS_PER_PAGE,
      harvestPage *
        ITEMS_PER_PAGE
    );

  const downloadPDF = (
    type: "growth" | "disease" | "harvest"
  ) => {
    const title =
      type === "growth"
        ? "Growth Prediction History"
        : type === "disease"
          ? "Disease Prediction History"
          : "Harvest Readiness History";

    const rows =
      type === "growth"
        ? filteredGrowthData
            .map((item) => {
              const status =
                item.harvest_status ||
                item.status ||
                getStatus(
                  item.growth_value
                );

              const alert =
                item.alert ||
                getAlert(
                  item.growth_value
                );

              const time =
                getRecordTime(item);

              return `
                <tr>
                  <td>${escapeHtml(item.plant_id)}</td>
                  <td>${escapeHtml(item.plant_age_months)}</td>
                  <td>${escapeHtml(item.temperature)}</td>
                  <td>${escapeHtml(item.humidity)}</td>
                  <td>${escapeHtml(item.moisture)}</td>
                  <td>${escapeHtml(item.growth_value)}</td>
                  <td>${escapeHtml(status)}</td>
                  <td>${escapeHtml(alert)}</td>
                  <td>${escapeHtml(formatRecordTime(time))}</td>
                </tr>
              `;
            })
            .join("")
        : type === "disease"
          ? filteredDiseaseData
              .map((item) => {
                const time =
                  getRecordTime(item);

                return `
                  <tr>
                    <td>${escapeHtml(item.prediction)}</td>
                    <td>${escapeHtml(item.confidence)}</td>
                    <td>${escapeHtml(item.severity)}</td>
                    <td>${escapeHtml(formatRecordTime(time))}</td>
                  </tr>
                `;
              })
              .join("")
          : filteredHarvestData
              .map((item) => {
                const time =
                  getRecordTime(item);

                return `
                  <tr>
                    <td>${escapeHtml(item.plant_id)}</td>
                    <td>${escapeHtml(item.readiness_score)}</td>
                    <td>${escapeHtml(item.readiness_status)}</td>
                    <td>${escapeHtml(item.recommendation)}</td>
                    <td>${escapeHtml(item.robotic_action)}</td>
                    <td>${escapeHtml(formatRecordTime(time))}</td>
                  </tr>
                `;
              })
              .join("");

    const headers =
      type === "growth"
        ? `
          <tr>
            <th>Plant ID</th>
            <th>Age</th>
            <th>Temp</th>
            <th>Humidity</th>
            <th>Moisture</th>
            <th>Growth</th>
            <th>Status</th>
            <th>Alert</th>
            <th>Time</th>
          </tr>
        `
        : type === "disease"
          ? `
            <tr>
              <th>Prediction</th>
              <th>Confidence</th>
              <th>Severity</th>
              <th>Time</th>
            </tr>
          `
          : `
            <tr>
              <th>Plant ID</th>
              <th>Readiness Score</th>
              <th>Status</th>
              <th>Recommendation</th>
              <th>Robot Action</th>
              <th>Time</th>
            </tr>
          `;

    const totalRecords =
      type === "growth"
        ? filteredGrowthData.length
        : type === "disease"
          ? filteredDiseaseData.length
          : filteredHarvestData.length;

    const columnCount =
      type === "growth"
        ? 9
        : type === "disease"
          ? 4
          : 6;

          const printWindow = window.open("", "_blank");

          if (!printWindow) {
            alert(
              "Please allow pop-ups for this website and try again."
            );
            return;
          }

    printWindow.document.write(`
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta
            name="viewport"
            content="width=device-width, initial-scale=1.0"
          />
          <title>${escapeHtml(title)}</title>

          <style>
            body {
              font-family: Inter, Arial, sans-serif;
              padding: 24px;
              color: #0f172a;
            }

            h1 {
              color: #047857;
              font-size: 20px;
              margin-bottom: 8px;
            }

            p {
              color: #64748b;
              font-size: 12px;
            }

            table {
              width: 100%;
              border-collapse: collapse;
              margin-top: 20px;
            }

            th,
            td {
              border: 1px solid #e2e8f0;
              padding: 10px;
              text-align: left;
              font-size: 11px;
              vertical-align: top;
            }

            th {
              background: #f8fafc;
              color: #475569;
              text-transform: uppercase;
              letter-spacing: 0.04em;
              font-size: 10px;
            }

            @media print {
              body {
                padding: 0;
              }

              table {
                page-break-inside: auto;
              }

              tr {
                page-break-inside: avoid;
                page-break-after: auto;
              }
            }
          </style>
        </head>

        <body>
          <h1>${escapeHtml(title)}</h1>

          <p>
            Generated on:
            ${escapeHtml(new Date().toLocaleString())}
          </p>

          <p>
            Total records:
            ${totalRecords}
          </p>

          <table>
            <thead>
              ${headers}
            </thead>

            <tbody>
              ${
                rows ||
                `
                  <tr>
                    <td colspan="${columnCount}">
                      No records available.
                    </td>
                  </tr>
                `
              }
            </tbody>
          </table>

          <script>
            window.onload = function () {
              window.print();
            };
          </script>
        </body>
      </html>
    `);

    printWindow.document.close();
  };

  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-slate-50">
        <div className="page-shell">
          <div>
            <h1 className="page-title">
              Prediction History
            </h1>

            <p className="page-subtitle">
              Enterprise records of growth,
              disease, and harvest readiness
              prediction runs.
            </p>
          </div>

          {loading && (
            <div className="flex items-center gap-3 rounded-xl border border-slate-200/60 bg-white px-5 py-4 shadow-sm">
              <Loader2 className="h-5 w-5 animate-spin text-emerald-600" />

              <p className="text-sm font-medium text-slate-600">
                Loading history…
              </p>
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" />

                <p className="text-sm font-medium text-rose-700">
                  {error}
                </p>
              </div>
            </div>
          )}

          <div className="card overflow-hidden">
            <div className="flex flex-col gap-4 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <span className="rounded-lg bg-emerald-50 p-2 text-emerald-700">
                  <TrendingUp className="h-4 w-4" />
                </span>

                <div>
                  <h2 className="text-base font-semibold text-slate-900">
                    Growth Predictions
                  </h2>

                  <p className="text-xs text-slate-500">
                    {
                      filteredGrowthData.length
                    }{" "}
                    records
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() =>
                  downloadPDF("growth")
                }
                disabled={
                  filteredGrowthData.length ===
                  0
                }
                className="btn-primary disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Download className="h-4 w-4" />
                Download PDF
              </button>
            </div>

            <div className="grid gap-3 border-b border-slate-100 px-5 py-4 md:grid-cols-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />

                <input
                  type="text"
                  placeholder="Search growth records…"
                  value={growthSearch}
                  onChange={(event) => {
                    setGrowthSearch(
                      event.target.value
                    );

                    setGrowthPage(1);
                  }}
                  className="input-field pl-9"
                />
              </div>

              <select
                value={
                  growthStatusFilter
                }
                onChange={(event) => {
                  setGrowthStatusFilter(
                    event.target.value
                  );

                  setGrowthPage(1);
                }}
                className="input-field"
              >
                <option value="All">
                  All Status
                </option>

                <option value="Ready to Harvest">
                  Ready to Harvest
                </option>

                <option value="Growing">
                  Growing
                </option>

                <option value="Initial Stage">
                  Initial Stage
                </option>
              </select>
            </div>

            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead className="table-header">
                  <tr>
                    <th className="px-5 py-3">
                      Plant ID
                    </th>

                    <th className="px-5 py-3">
                      Age
                    </th>

                    <th className="px-5 py-3">
                      Temp
                    </th>

                    <th className="px-5 py-3">
                      Humidity
                    </th>

                    <th className="px-5 py-3">
                      Moisture
                    </th>

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
                  {!loading &&
                  paginatedGrowth.length ===
                    0 ? (
                    <tr>
                      <td
                        colSpan={9}
                        className="px-5 py-12 text-center"
                      >
                        <div className="flex flex-col items-center gap-2">
                          <Inbox className="h-8 w-8 text-slate-300" />

                          <p className="text-sm font-medium text-slate-500">
                            No growth
                            prediction history
                            available.
                          </p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    paginatedGrowth.map(
                      (item, index) => {
                        const status =
                          item.harvest_status ||
                          item.status ||
                          getStatus(
                            item.growth_value
                          );

                        const alert =
                          item.alert ||
                          getAlert(
                            item.growth_value
                          );

                        const time =
                          getRecordTime(
                            item
                          );

                        return (
                          <tr
                            key={
                              item.id ||
                              `${item.plant_id}-${time}-${index}`
                            }
                            className="hover:bg-slate-50/80"
                          >
                            <td className="px-5 py-3 font-medium text-slate-900">
                              {item.plant_id ??
                                "-"}
                            </td>

                            <td className="px-5 py-3 text-slate-600">
                              {item.plant_age_months ??
                                "-"}
                            </td>

                            <td className="px-5 py-3 text-slate-600">
                              {item.temperature ??
                                "-"}
                            </td>

                            <td className="px-5 py-3 text-slate-600">
                              {item.humidity ??
                                "-"}
                            </td>

                            <td className="px-5 py-3 text-slate-600">
                              {item.moisture ??
                                "-"}
                            </td>

                            <td className="px-5 py-3 font-semibold text-slate-900">
                              {item.growth_value ??
                                "-"}
                            </td>

                            <td className="px-5 py-3">
                              <span
                                className={statusBadgeClass(
                                  String(
                                    status
                                  )
                                )}
                              >
                                {status}
                              </span>
                            </td>

                            <td className="px-5 py-3 text-slate-600">
                              {alert}
                            </td>

                            <td className="px-5 py-3 text-slate-500">
                              {formatRecordTime(
                                time
                              )}
                            </td>
                          </tr>
                        );
                      }
                    )
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3">
              <button
                type="button"
                disabled={
                  growthPage <= 1
                }
                onClick={() =>
                  setGrowthPage(
                    (currentPage) =>
                      Math.max(
                        1,
                        currentPage -
                          1
                      )
                  )
                }
                className="btn-secondary px-3 py-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ChevronLeft className="h-4 w-4" />
                Previous
              </button>

              <span className="text-sm text-slate-600">
                Page{" "}
                <span className="font-semibold text-slate-900">
                  {growthPage}
                </span>{" "}
                of {growthTotalPages}
              </span>

              <button
                type="button"
                disabled={
                  growthPage >=
                  growthTotalPages
                }
                onClick={() =>
                  setGrowthPage(
                    (currentPage) =>
                      Math.min(
                        growthTotalPages,
                        currentPage +
                          1
                      )
                  )
                }
                className="btn-secondary px-3 py-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="card overflow-hidden">
            <div className="flex flex-col gap-4 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <span className="rounded-lg bg-rose-50 p-2 text-rose-600">
                  <Microscope className="h-4 w-4" />
                </span>

                <div>
                  <h2 className="text-base font-semibold text-slate-900">
                    Disease Predictions
                  </h2>

                  <p className="text-xs text-slate-500">
                    {
                      filteredDiseaseData.length
                    }{" "}
                    records
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() =>
                  downloadPDF("disease")
                }
                disabled={
                  filteredDiseaseData.length ===
                  0
                }
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-rose-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-all duration-200 hover:bg-rose-700 hover:shadow disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Download className="h-4 w-4" />
                Download PDF
              </button>
            </div>

            <div className="grid gap-3 border-b border-slate-100 px-5 py-4 md:grid-cols-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />

                <input
                  type="text"
                  placeholder="Search disease records…"
                  value={
                    diseaseSearch
                  }
                  onChange={(event) => {
                    setDiseaseSearch(
                      event.target.value
                    );

                    setDiseasePage(1);
                  }}
                  className="input-field pl-9"
                />
              </div>

              <select
                value={
                  diseaseSeverityFilter
                }
                onChange={(event) => {
                  setDiseaseSeverityFilter(
                    event.target.value
                  );

                  setDiseasePage(1);
                }}
                className="input-field"
              >
                <option value="All">
                  All Severity
                </option>

                <option value="None">
                  None
                </option>

                <option value="Moderate">
                  Moderate
                </option>

                <option value="High">
                  High
                </option>

                <option value="Unknown">
                  Unknown
                </option>
              </select>
            </div>

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
                  {!loading &&
                  paginatedDisease.length ===
                    0 ? (
                    <tr>
                      <td
                        colSpan={4}
                        className="px-5 py-12 text-center"
                      >
                        <div className="flex flex-col items-center gap-2">
                          <Inbox className="h-8 w-8 text-slate-300" />

                          <p className="text-sm font-medium text-slate-500">
                            No disease
                            prediction history
                            available.
                          </p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    paginatedDisease.map(
                      (item, index) => {
                        const time =
                          getRecordTime(
                            item
                          );

                        return (
                          <tr
                            key={
                              item.id ||
                              `${item.prediction}-${time}-${index}`
                            }
                            className="hover:bg-slate-50/80"
                          >
                            <td className="px-5 py-3 font-medium text-slate-900">
                              {item.prediction ??
                                "-"}
                            </td>

                            <td className="px-5 py-3 text-slate-600">
                              {item.confidence ??
                                "-"}
                            </td>

                            <td className="px-5 py-3">
                              <span
                                className={severityBadgeClass(
                                  item.severity
                                )}
                              >
                                {item.severity ??
                                  "-"}
                              </span>
                            </td>

                            <td className="px-5 py-3 text-slate-500">
                              {formatRecordTime(
                                time
                              )}
                            </td>
                          </tr>
                        );
                      }
                    )
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3">
              <button
                type="button"
                disabled={
                  diseasePage <= 1
                }
                onClick={() =>
                  setDiseasePage(
                    (currentPage) =>
                      Math.max(
                        1,
                        currentPage -
                          1
                      )
                  )
                }
                className="btn-secondary px-3 py-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ChevronLeft className="h-4 w-4" />
                Previous
              </button>

              <span className="text-sm text-slate-600">
                Page{" "}
                <span className="font-semibold text-slate-900">
                  {diseasePage}
                </span>{" "}
                of {diseaseTotalPages}
              </span>

              <button
                type="button"
                disabled={
                  diseasePage >=
                  diseaseTotalPages
                }
                onClick={() =>
                  setDiseasePage(
                    (currentPage) =>
                      Math.min(
                        diseaseTotalPages,
                        currentPage +
                          1
                      )
                  )
                }
                className="btn-secondary px-3 py-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="card overflow-hidden">
            <div className="flex flex-col gap-4 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <span className="rounded-lg bg-amber-50 p-2 text-amber-700">
                  <Sprout className="h-4 w-4" />
                </span>

                <div>
                  <h2 className="text-base font-semibold text-slate-900">
                    Harvest Readiness
                  </h2>

                  <p className="text-xs text-slate-500">
                    {filteredHarvestData.length}{" "}
                    records
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() =>
                  downloadPDF("harvest")
                }
                disabled={
                  filteredHarvestData.length ===
                  0
                }
                className="btn-primary disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Download className="h-4 w-4" />
                Download PDF
              </button>
            </div>

            <div className="grid gap-3 border-b border-slate-100 px-5 py-4 md:grid-cols-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />

                <input
                  type="text"
                  placeholder="Search harvest records…"
                  value={harvestSearch}
                  onChange={(event) => {
                    setHarvestSearch(
                      event.target.value
                    );

                    setHarvestPage(1);
                  }}
                  className="input-field pl-9"
                />
              </div>

              <select
                value={
                  harvestStatusFilter
                }
                onChange={(event) => {
                  setHarvestStatusFilter(
                    event.target.value
                  );

                  setHarvestPage(1);
                }}
                className="input-field"
              >
                <option value="All">
                  All Status
                </option>

                <option value="Ready for Harvest">
                  Ready for Harvest
                </option>

                <option value="Almost Ready">
                  Almost Ready
                </option>

                <option value="Not Ready">
                  Not Ready
                </option>
              </select>
            </div>

            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead className="table-header">
                  <tr>
                    <th className="px-5 py-3">
                      Plant ID
                    </th>

                    <th className="px-5 py-3">
                      Score
                    </th>

                    <th className="px-5 py-3">
                      Status
                    </th>

                    <th className="px-5 py-3">
                      Recommendation
                    </th>

                    <th className="px-5 py-3">
                      Robot Action
                    </th>

                    <th className="px-5 py-3">
                      Time
                    </th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-100">
                  {!loading &&
                  paginatedHarvest.length ===
                    0 ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-5 py-12 text-center"
                      >
                        <div className="flex flex-col items-center gap-2">
                          <Inbox className="h-8 w-8 text-slate-300" />

                          <p className="text-sm font-medium text-slate-500">
                            No harvest readiness
                            history available.
                          </p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    paginatedHarvest.map(
                      (item, index) => {
                        const time =
                          getRecordTime(
                            item
                          );

                        return (
                          <tr
                            key={
                              item.id ||
                              item.record_id ||
                              `${item.plant_id}-${time}-${index}`
                            }
                            className="hover:bg-slate-50/80"
                          >
                            <td className="px-5 py-3 font-medium text-slate-900">
                              {item.plant_id ??
                                "-"}
                            </td>

                            <td className="px-5 py-3 font-semibold text-slate-900">
                              {item.readiness_score ??
                                "-"}
                            </td>

                            <td className="px-5 py-3">
                              <span
                                className={readinessBadgeClass(
                                  item.readiness_status
                                )}
                              >
                                {item.readiness_status ??
                                  "-"}
                              </span>
                            </td>

                            <td className="max-w-xs px-5 py-3 text-slate-600">
                              {item.recommendation ??
                                "-"}
                            </td>

                            <td className="px-5 py-3">
                              <span
                                className={roboticActionBadgeClass(
                                  item.robotic_action
                                )}
                              >
                                {item.robotic_action ??
                                  "-"}
                              </span>
                            </td>

                            <td className="px-5 py-3 text-slate-500">
                              {formatRecordTime(
                                time
                              )}
                            </td>
                          </tr>
                        );
                      }
                    )
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3">
              <button
                type="button"
                disabled={
                  harvestPage <= 1
                }
                onClick={() =>
                  setHarvestPage(
                    (currentPage) =>
                      Math.max(
                        1,
                        currentPage -
                          1
                      )
                  )
                }
                className="btn-secondary px-3 py-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ChevronLeft className="h-4 w-4" />
                Previous
              </button>

              <span className="text-sm text-slate-600">
                Page{" "}
                <span className="font-semibold text-slate-900">
                  {harvestPage}
                </span>{" "}
                of {harvestTotalPages}
              </span>

              <button
                type="button"
                disabled={
                  harvestPage >=
                  harvestTotalPages
                }
                onClick={() =>
                  setHarvestPage(
                    (currentPage) =>
                      Math.min(
                        harvestTotalPages,
                        currentPage +
                          1
                      )
                  )
                }
                className="btn-secondary px-3 py-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </ProtectedRoute>
  );
}