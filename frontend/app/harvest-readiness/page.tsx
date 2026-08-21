"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  Send,
  Info,
  Loader2,
  Scissors,
  Leaf,
  Sun,
  Package,
  RefreshCw,
  Sprout,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";

import ProtectedRoute from "@/app/components/ProtectedRoute";
import { apiGet, apiPost } from "@/app/lib/api";

type DiseaseStatus = "Healthy" | "Diseased";

type HarvestSeasonStatus =
  | "best"
  | "limited"
  | "poor";

type GrowthHistoryRecord = {
  plant_id?: string;
  plant_age_months?: number;
  growth_value?: number;
  bark_thickness_mm?: number;
  bark_thickness?: number;
  prediction_time?: string;
};

type HarvestResult = {
  readiness_score?: number;
  readiness_status?: string;
  recommendation?: string;
  robotic_action?: string;
  quality_average?: number;
  database_saved?: boolean;
  csv_saved?: boolean;
};

type HarvestForm = {
  plantId: string;
  age: string;
  growthRate: string;
  barkThickness: string;
  diseaseStatus: DiseaseStatus;
  currentMonth: string;
  barkQuality: string;
  maturityLevel: string;
  healthStatus: string;
  barkColor: string;
  newShoots: string;
  harvestCutAngle: string;
};

const HARVEST_SEASONS = [
  {
    months: ["March", "April", "May"],
    label: "Primary Season",
    status: "best" as HarvestSeasonStatus,
  },
  {
    months: ["July", "August", "September"],
    label: "Secondary Season",
    status: "best" as HarvestSeasonStatus,
  },
  {
    months: ["October", "November"],
    label: "Limited (Region-Dependent)",
    status: "limited" as HarvestSeasonStatus,
  },
  {
    months: [
      "December",
      "January",
      "February",
      "June",
    ],
    label: "Low Harvest Period",
    status: "poor" as HarvestSeasonStatus,
  },
];

const MONTH_LIST = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function getMonthHarvestInfo(
  month: string
): {
  status: HarvestSeasonStatus;
  label: string;
  tip: string;
} {
  for (const season of HARVEST_SEASONS) {
    if (!season.months.includes(month)) {
      continue;
    }

    if (season.status === "best") {
      return {
        status: "best",
        label: season.label,
        tip:
          month === "March" ||
          month === "April" ||
          month === "May"
            ? "Primary harvest season (March–May). Bark separates easily from the wood — ideal conditions for peeling."
            : "Secondary harvest season (July–September). Good conditions for quality bark production.",
      };
    }

    if (season.status === "limited") {
      return {
        status: "limited",
        label: season.label,
        tip: "Limited harvest window. Suitability varies by region and local rainfall patterns.",
      };
    }

    return {
      status: "poor",
      label: season.label,
      tip: "Low harvest period. Bark peeling is generally difficult; avoid harvesting if possible.",
    };
  }

  return {
    status: "poor",
    label: "Unknown",
    tip: "",
  };
}

export default function HarvestReadinessPage() {
  const [loading, setLoading] =
    useState(false);

  const [growthLoading, setGrowthLoading] =
    useState(false);

  const [sentMessage, setSentMessage] =
    useState("");

  const [error, setError] =
    useState("");

  const [result, setResult] =
    useState<HarvestResult | null>(null);

  const [form, setForm] =
    useState<HarvestForm>({
      plantId: "P-001",
      age: "18",
      growthRate: "0",
      barkThickness: "0",
      diseaseStatus: "Healthy",
      currentMonth: "June",
      barkQuality: "92",
      maturityLevel: "87",
      healthStatus: "95",
      barkColor: "brown",
      newShoots: "no",
      harvestCutAngle: "45",
    });

  const monthInfo = useMemo(
    () =>
      getMonthHarvestInfo(
        form.currentMonth
      ),
    [form.currentMonth]
  );

  const loadLatestGrowth =
    useCallback(async () => {
      try {
        setGrowthLoading(true);
        setError("");

        const data =
          await apiGet<
            GrowthHistoryRecord[]
          >("/growth-history/");

        if (
          !Array.isArray(data) ||
          data.length === 0
        ) {
          setError(
            "No previous growth prediction records were found."
          );
          return;
        }

        const sortedRecords = [
          ...data,
        ].sort((a, b) => {
          const timeA = new Date(
            a.prediction_time || 0
          ).getTime();

          const timeB = new Date(
            b.prediction_time || 0
          ).getTime();

          return timeB - timeA;
        });

        const latest =
          sortedRecords[0];

        setForm((previous) => ({
          ...previous,
          plantId:
            latest.plant_id ||
            previous.plantId,
          age: String(
            latest.plant_age_months ??
              previous.age
          ),
          growthRate: String(
            latest.growth_value ?? 0
          ),
          barkThickness: String(
            latest.bark_thickness_mm ??
              latest.bark_thickness ??
              previous.barkThickness
          ),
        }));

        setResult(null);
        setSentMessage("");
      } catch (requestError) {
        console.error(
          "Growth history loading error:",
          requestError
        );

        setError(
          requestError instanceof Error
            ? requestError.message
            : "Unable to load the latest growth prediction."
        );
      } finally {
        setGrowthLoading(false);
      }
    }, []);

  useEffect(() => {
    void loadLatestGrowth();
  }, [loadLatestGrowth]);

  const handleChange = (
    event: React.ChangeEvent<
      HTMLInputElement | HTMLSelectElement
    >
  ) => {
    const { name, value } =
      event.target;

    setSentMessage("");
    setError("");
    setResult(null);

    setForm((previous) => ({
      ...previous,
      [name]: value,
    }));
  };

  const cddWarnings =
    useMemo(() => {
      const warnings: string[] = [];

      if (
        monthInfo.status === "poor"
      ) {
        warnings.push(
          "Current month is outside recommended harvest seasons (March–May, July–September)."
        );
      }

      if (
        monthInfo.status ===
        "limited"
      ) {
        warnings.push(
          "Current month has limited harvest potential — check local rainfall patterns."
        );
      }

      if (
        form.barkColor !== "brown"
      ) {
        warnings.push(
          "Bark outer surface has not fully turned brown — tree may not be mature enough for peeling."
        );
      }

      if (
        form.newShoots === "yes"
      ) {
        warnings.push(
          "New shoots, flowers, or fruits are present — avoid harvesting because bark peeling may be difficult."
        );
      }

      if (
        Number(form.age) < 24
      ) {
        warnings.push(
          "Tree is under 24 months old. CDD guidelines recommend waiting 2–3 years after planting for the first harvest."
        );
      }

      if (
        Number(
          form.barkThickness
        ) <= 0
      ) {
        warnings.push(
          "Bark thickness has not been recorded — please measure it before harvesting."
        );
      }

      if (
        form.diseaseStatus ===
        "Diseased"
      ) {
        warnings.push(
          "The plant is marked as diseased — review plant health before harvesting."
        );
      }

      return warnings;
    }, [form, monthInfo.status]);

  const cddReady =
    cddWarnings.length === 0;

  const calculateHarvestReadiness =
    async () => {
      const age = Number(form.age);
      const growthRate = Number(
        form.growthRate
      );
      const barkThickness = Number(
        form.barkThickness
      );
      const barkQuality = Number(
        form.barkQuality
      );
      const maturityLevel = Number(
        form.maturityLevel
      );
      const healthStatus = Number(
        form.healthStatus
      );

      if (!form.plantId.trim()) {
        setError(
          "Plant ID is required."
        );
        return;
      }

      if (
        !Number.isFinite(age) ||
        age < 0
      ) {
        setError(
          "Please enter a valid plant age."
        );
        return;
      }

      if (
        !Number.isFinite(
          growthRate
        ) ||
        growthRate < 0
      ) {
        setError(
          "Please enter a valid growth rate."
        );
        return;
      }

      if (
        !Number.isFinite(
          barkThickness
        ) ||
        barkThickness < 0
      ) {
        setError(
          "Please enter a valid bark thickness."
        );
        return;
      }

      try {
        setLoading(true);
        setError("");
        setSentMessage("");
        setResult(null);

        const data =
          await apiPost<HarvestResult>(
            "/harvest-readiness/",
            {
              plant_id:
                form.plantId.trim(),
              age,
              growth_rate:
                growthRate,
              bark_thickness:
                barkThickness,
              disease_status:
                form.diseaseStatus,
              current_month:
                form.currentMonth,
              bark_quality:
                barkQuality,
              maturity_level:
                maturityLevel,
              health_status:
                healthStatus,
            }
          );

        console.log(
          "HARVEST RESULT:",
          data
        );

        setResult(data);
      } catch (requestError) {
        console.error(
          "Harvest prediction error:",
          requestError
        );

        setError(
          requestError instanceof Error
            ? requestError.message
            : "Harvest prediction failed. Please try again."
        );
      } finally {
        setLoading(false);
      }
    };

  const readiness = useMemo(() => {
    if (!result) {
      return {
        score: 0,
        status: "Not Calculated",
        recommendation:
          "Click Calculate Harvest Readiness",
        robotic_action: "-",
      };
    }

    return {
      score: Number(
        result.readiness_score ?? 0
      ),
      status:
        result.readiness_status ||
        "-",
      recommendation:
        result.recommendation || "-",
      robotic_action:
        result.robotic_action || "-",
    };
  }, [result]);

  const handleSendToRobot = () => {
    if (!result) {
      setSentMessage(
        "Please calculate harvest readiness first."
      );
      return;
    }

    if (!cddReady) {
      setSentMessage(
        "CDD guideline checks failed. Resolve the warnings before dispatching robotic harvesting."
      );
      return;
    }

    if (
      readiness.score >= 80
    ) {
      setSentMessage(
        "Harvest data is ready to send to the robotic harvesting module."
      );
    } else {
      setSentMessage(
        "Plant is not ready for robotic harvesting."
      );
    }
  };

  const seasonBannerClass =
    monthInfo.status === "best"
      ? "border-emerald-200 bg-white"
      : monthInfo.status ===
          "limited"
        ? "border-amber-200 bg-white"
        : "border-rose-200 bg-white";

  const seasonBadgeClass =
    monthInfo.status === "best"
      ? "badge-healthy"
      : monthInfo.status ===
          "limited"
        ? "badge-warning"
        : "badge-danger";

  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-slate-50">
        <div className="page-shell">
          <div>
            <h1 className="page-title">
              Harvest Readiness Prediction
            </h1>

            <p className="page-subtitle">
              Guidelines based on Sri
              Lanka Cinnamon Development
              Department — Post Harvest
              Technology
            </p>
          </div>

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

          <div
            className={`flex items-start gap-3 rounded-xl border px-5 py-4 shadow-sm ${seasonBannerClass}`}
          >
            <Info
              size={18}
              className={`mt-0.5 shrink-0 ${
                monthInfo.status ===
                "best"
                  ? "text-emerald-600"
                  : monthInfo.status ===
                      "limited"
                    ? "text-amber-600"
                    : "text-rose-600"
              }`}
            />

            <div className="flex-1">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <span className="text-sm font-bold text-slate-900">
                  {form.currentMonth} —{" "}
                  {monthInfo.label}
                </span>

                <span
                  className={
                    seasonBadgeClass
                  }
                >
                  {monthInfo.status ===
                  "best"
                    ? "Optimal"
                    : monthInfo.status ===
                        "limited"
                      ? "Limited"
                      : "Off-season"}
                </span>
              </div>

              <p className="text-sm text-slate-600">
                {monthInfo.tip}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() =>
                void loadLatestGrowth()
              }
              disabled={
                growthLoading ||
                loading
              }
              className="btn-secondary disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw
                className={`h-4 w-4 ${
                  growthLoading
                    ? "animate-spin"
                    : ""
                }`}
              />

              {growthLoading
                ? "Loading Growth Data…"
                : "Load Latest Growth Data"}
            </button>

            <button
              type="button"
              onClick={
                calculateHarvestReadiness
              }
              disabled={
                loading ||
                growthLoading
              }
              className="btn-primary disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}

              {loading
                ? "Calculating…"
                : "Calculate Harvest Readiness"}
            </button>
          </div>

          <section className="card p-6">
            <h3 className="mb-5 text-base font-semibold text-slate-900">
              Enter Harvest Readiness
              Data
            </h3>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
              <InputField
                label="Plant ID"
                name="plantId"
                type="text"
                value={form.plantId}
                onChange={handleChange}
              />

              <InputField
                label="Age (Months)"
                name="age"
                type="number"
                value={form.age}
                onChange={handleChange}
              />

              <InputField
                label="Growth Rate (%)"
                name="growthRate"
                type="number"
                value={
                  form.growthRate
                }
                onChange={handleChange}
              />

              <InputField
                label="Bark Thickness (mm)"
                name="barkThickness"
                type="number"
                value={
                  form.barkThickness
                }
                onChange={handleChange}
              />

              <InputField
                label="Bark Quality (%)"
                name="barkQuality"
                type="number"
                value={
                  form.barkQuality
                }
                onChange={handleChange}
              />

              <InputField
                label="Maturity Level (%)"
                name="maturityLevel"
                type="number"
                value={
                  form.maturityLevel
                }
                onChange={handleChange}
              />

              <InputField
                label="Health Status (%)"
                name="healthStatus"
                type="number"
                value={
                  form.healthStatus
                }
                onChange={handleChange}
              />

              <div>
                <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-slate-500">
                  Disease Status
                </label>

                <select
                  name="diseaseStatus"
                  value={
                    form.diseaseStatus
                  }
                  onChange={handleChange}
                  className="input-field"
                >
                  <option value="Healthy">
                    Healthy
                  </option>

                  <option value="Diseased">
                    Diseased
                  </option>
                </select>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-slate-500">
                  Current Month
                </label>

                <select
                  name="currentMonth"
                  value={
                    form.currentMonth
                  }
                  onChange={handleChange}
                  className="input-field"
                >
                  {MONTH_LIST.map(
                    (month) => (
                      <option
                        key={month}
                        value={month}
                      >
                        {month}
                      </option>
                    )
                  )}
                </select>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-slate-500">
                  Outer Bark Color{" "}
                  <span className="normal-case tracking-normal text-slate-400">
                    (CDD)
                  </span>
                </label>

                <select
                  name="barkColor"
                  value={form.barkColor}
                  onChange={handleChange}
                  className="input-field"
                >
                  <option value="brown">
                    Fully Brown (Mature)
                  </option>

                  <option value="green">
                    Light / Dark Green
                    (Immature)
                  </option>

                  <option value="mixed">
                    Mixed Green-Brown
                    (Transitioning)
                  </option>
                </select>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-slate-500">
                  New Shoots / Flowers{" "}
                  <span className="normal-case tracking-normal text-slate-400">
                    (CDD)
                  </span>
                </label>

                <select
                  name="newShoots"
                  value={form.newShoots}
                  onChange={handleChange}
                  className="input-field"
                >
                  <option value="no">
                    No – Safe to Harvest
                  </option>

                  <option value="yes">
                    Yes – Avoid
                    Harvesting
                  </option>
                </select>
              </div>
            </div>

            <div className="mt-5 rounded-xl border border-slate-200/60 bg-slate-50 p-4">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
                Recommended Harvest
                Seasons (CDD — Sri Lanka)
              </p>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-4">
                <span className="badge-healthy justify-center px-3 py-2">
                  March – May (Primary)
                </span>

                <span className="badge-healthy justify-center px-3 py-2">
                  July – September
                  (Secondary)
                </span>

                <span className="badge-warning justify-center px-3 py-2">
                  Oct – Nov (Limited)
                </span>

                <span className="badge-danger justify-center px-3 py-2">
                  Dec – Feb / Jun (Low)
                </span>
              </div>
            </div>
          </section>

          {cddWarnings.length > 0 && (
            <section className="card border-amber-200 p-6">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-amber-800">
                <AlertTriangle size={16} />
                CDD Guideline Warnings
              </h3>

              <ul className="space-y-2">
                {cddWarnings.map(
                  (warning, index) => (
                    <li
                      key={`${warning}-${index}`}
                      className="flex gap-2 text-sm text-slate-700"
                    >
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />

                      {warning}
                    </li>
                  )
                )}
              </ul>
            </section>
          )}

          {cddReady && result && (
            <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-white px-5 py-3 text-sm font-medium text-emerald-800 shadow-sm">
              <CheckCircle2 className="h-4 w-4 shrink-0" />

              All CDD guideline checks
              passed for this harvest
              assessment.
            </div>
          )}

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_360px]">
            <div className="space-y-6">
              <section className="card p-6">
                <h3 className="mb-5 text-base font-semibold text-slate-900">
                  Plant Details
                </h3>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <InfoCard
                    title="Plant ID"
                    value={
                      form.plantId || "-"
                    }
                  />

                  <InfoCard
                    title="Age"
                    value={`${
                      form.age || 0
                    } months`}
                  />

                  <InfoCard
                    title="Growth Rate"
                    value={`${
                      form.growthRate || 0
                    }%`}
                  />

                  <InfoCard
                    title="Bark Thickness"
                    value={`${
                      form.barkThickness ||
                      0
                    } mm`}
                  />

                  <InfoCard
                    title="Harvest Month"
                    value={
                      form.currentMonth
                    }
                  />

                  <InfoCard
                    title="Quality Average"
                    value={`${
                      result?.quality_average ??
                      "-"
                    }%`}
                  />

                  <InfoCard
                    title="Outer Bark Color"
                    value={
                      form.barkColor ===
                      "brown"
                        ? "Fully Brown"
                        : form.barkColor ===
                            "green"
                          ? "Green (Immature)"
                          : "Mixed (Transitioning)"
                    }
                    green={
                      form.barkColor ===
                      "brown"
                    }
                  />

                  <InfoCard
                    title="New Shoots / Flowers"
                    value={
                      form.newShoots ===
                      "no"
                        ? "None – Safe to Harvest"
                        : "Present – Avoid Harvesting"
                    }
                    green={
                      form.newShoots ===
                      "no"
                    }
                  />

                  <div className="rounded-lg border border-slate-200/60 bg-white p-4 md:col-span-2">
                    <p className="kpi-label">
                      Disease Status
                    </p>

                    <p className="mt-2">
                      <span
                        className={
                          form.diseaseStatus ===
                          "Healthy"
                            ? "badge-healthy"
                            : "badge-danger"
                        }
                      >
                        {
                          form.diseaseStatus
                        }
                      </span>
                    </p>
                  </div>
                </div>
              </section>

              <section className="card p-6">
                <h3 className="mb-5 text-base font-semibold text-slate-900">
                  CDD Post-Harvest Best
                  Practices
                </h3>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {[
                    {
                      icon: Scissors,
                      title: "Cut Angle",
                      desc: "Cut stem at a 45° angle, 1½–2 inches above ground level.",
                    },
                    {
                      icon: Leaf,
                      title:
                        "Remove Waste",
                      desc: "Remove leaves, side branches, and unripe portions before peeling.",
                    },
                    {
                      icon: Sun,
                      title: "Drying",
                      desc: "Dry bark in shade for 4–7 days until moisture content drops below 14%.",
                    },
                    {
                      icon: Package,
                      title:
                        "Expected Yield",
                      desc: "Good management yields 300–450 kg/acre/year; improved varieties may reach 600 kg.",
                    },
                    {
                      icon: RefreshCw,
                      title:
                        "Harvest Frequency",
                      desc: "Two to three harvests per year are achievable with good crop management.",
                    },
                    {
                      icon: Sprout,
                      title:
                        "First Harvest",
                      desc: "The first harvest is possible 2–3 years after planting when the bark is fully mature.",
                    },
                  ].map((item) => {
                    const Icon =
                      item.icon;

                    return (
                      <div
                        key={
                          item.title
                        }
                        className="flex gap-3 rounded-lg border border-slate-200/60 bg-white p-4"
                      >
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-700">
                          <Icon className="h-4 w-4" />
                        </span>

                        <div>
                          <p className="text-sm font-semibold text-slate-800">
                            {
                              item.title
                            }
                          </p>

                          <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
                            {item.desc}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="card p-6">
                <h3 className="mb-5 text-base font-semibold text-slate-900">
                  Readiness Assessment
                </h3>

                <div className="rounded-xl border border-slate-200/60 bg-white p-6">
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <h4 className="text-xl font-bold text-slate-900">
                      {readiness.status}
                    </h4>

                    <span
                      className={
                        readiness.score >=
                        80
                          ? "badge-healthy"
                          : readiness.score >=
                              60
                            ? "badge-warning"
                            : "badge-danger"
                      }
                    >
                      {readiness.score}%
                      score
                    </span>
                  </div>

                  <p className="max-w-3xl text-sm leading-relaxed text-slate-600">
                    {
                      readiness.recommendation
                    }
                  </p>
                </div>

                <button
                  type="button"
                  onClick={
                    handleSendToRobot
                  }
                  className="btn-primary mt-5 w-full py-3"
                >
                  <Send size={18} />

                  Prepare Robotic
                  Harvesting Output
                </button>

                {sentMessage && (
                  <div
                    className={`mt-4 rounded-lg border p-4 text-sm font-medium ${
                      sentMessage.includes(
                        "not ready"
                      ) ||
                      sentMessage.includes(
                        "failed"
                      )
                        ? "border-rose-200 bg-rose-50 text-rose-700"
                        : "border-emerald-200 bg-emerald-50 text-emerald-800"
                    }`}
                  >
                    {sentMessage}
                  </div>
                )}
              </section>

              {result && (
                <section className="card p-6">
                  <h3 className="mb-5 text-base font-semibold text-slate-900">
                    Save Status
                  </h3>

                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <InfoCard
                      title="Firebase Status"
                      value={
                        result.database_saved
                          ? "Saved Successfully"
                          : "Not Saved"
                      }
                      green={Boolean(
                        result.database_saved
                      )}
                    />

                    <InfoCard
                      title="CSV Dataset Status"
                      value={
                        result.csv_saved
                          ? "Saved Successfully"
                          : "Not Saved"
                      }
                      green={Boolean(
                        result.csv_saved
                      )}
                    />
                  </div>
                </section>
              )}
            </div>

            <div className="space-y-6">
              <section className="card flex min-h-[340px] items-center justify-center p-6">
                <div className="space-y-4 text-center">
                  <div
                    className={`mx-auto flex h-[160px] w-[160px] flex-col items-center justify-center rounded-full border-[6px] bg-white ${
                      readiness.score >=
                      80
                        ? "border-emerald-600"
                        : readiness.score >=
                            60
                          ? "border-amber-500"
                          : "border-rose-500"
                    }`}
                  >
                    <p
                      className={`text-4xl font-bold ${
                        readiness.score >=
                        80
                          ? "text-emerald-700"
                          : readiness.score >=
                              60
                            ? "text-amber-700"
                            : "text-rose-700"
                      }`}
                    >
                      {readiness.score}%
                    </p>

                    <p className="mt-1 text-xs font-medium uppercase tracking-wider text-slate-500">
                      Readiness
                    </p>
                  </div>

                  <div
                    className={`inline-flex items-center gap-2 ${seasonBadgeClass}`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        monthInfo.status ===
                        "best"
                          ? "bg-emerald-600"
                          : monthInfo.status ===
                              "limited"
                            ? "bg-amber-500"
                            : "bg-rose-500"
                      }`}
                    />

                    {monthInfo.label}
                  </div>
                </div>
              </section>

              <section className="card p-6">
                <h3 className="mb-5 text-base font-semibold text-slate-900">
                  Robotic Harvesting Data
                </h3>

                <div className="space-y-3">
                  <InfoCard
                    title="Robotic Action"
                    value={
                      readiness.robotic_action
                    }
                    green={
                      readiness.robotic_action ===
                      "APPROVED"
                    }
                  />

                  <InfoCard
                    title="Plant ID"
                    value={form.plantId}
                  />

                  <InfoCard
                    title="Readiness Score"
                    value={`${readiness.score}%`}
                    green={
                      readiness.score >=
                      80
                    }
                  />

                  <InfoCard
                    title="Bark Thickness"
                    value={`${form.barkThickness} mm`}
                  />

                  <InfoCard
                    title="Disease Status"
                    value={
                      form.diseaseStatus
                    }
                    green={
                      form.diseaseStatus ===
                      "Healthy"
                    }
                  />

                  <InfoCard
                    title="CDD Season Check"
                    value={
                      monthInfo.status ===
                      "best"
                        ? "Optimal Season"
                        : monthInfo.status ===
                            "limited"
                          ? "Limited Season"
                          : "Off-Season"
                    }
                    green={
                      monthInfo.status ===
                      "best"
                    }
                  />

                  <InfoCard
                    title="CDD Plant Check"
                    value={
                      cddReady
                        ? "All Checks Passed"
                        : `${cddWarnings.length} Warning(s)`
                    }
                    green={cddReady}
                  />
                </div>
              </section>
            </div>
          </div>
        </div>
      </div>
    </ProtectedRoute>
  );
}

function InputField({
  label,
  name,
  type,
  value,
  onChange,
}: {
  label: string;
  name: string;
  type: string;
  value: string;
  onChange: (
    event: React.ChangeEvent<HTMLInputElement>
  ) => void;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-slate-500">
        {label}
      </label>

      <input
        type={type}
        name={name}
        value={value}
        onChange={onChange}
        min={
          type === "number"
            ? "0"
            : undefined
        }
        step={
          type === "number"
            ? "any"
            : undefined
        }
        className="input-field"
      />
    </div>
  );
}

function InfoCard({
  title,
  value,
  green = false,
}: {
  title: string;
  value: string;
  green?: boolean;
}) {
  return (
    <div className="rounded-lg border border-slate-200/60 bg-white p-4">
      <p className="kpi-label">
        {title}
      </p>

      <p
        className={`mt-2 text-base font-bold ${
          green
            ? "text-emerald-700"
            : "text-slate-900"
        }`}
      >
        {value}
      </p>
    </div>
  );
}