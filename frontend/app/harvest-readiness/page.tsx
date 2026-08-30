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
  final_score?: number;
  status?: string;
  action?: string;
  robotic_action?: string; // fallback
  status_message?: string;
  database_saved?: boolean;
  csv_saved?: boolean;
};

type HarvestForm = {
  plant_id: string;
  age_months: number;
  rainfall_index: number;
  phenology_stage: number;
  bark_browning_percent: number;
  
  // Legacy optional fields to prevent TS errors on old InfoCards
  plantId?: string;
  age?: string;
  growthRate?: string;
  barkThickness?: string;
  diseaseStatus?: DiseaseStatus;
  currentMonth?: string;
  barkQuality?: string;
  maturityLevel?: string;
  healthStatus?: string;
  barkColor?: string;
  newShoots?: string;
  harvestCutAngle?: string;
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
  const [loading, setLoading] = useState(false);
  const [growthLoading, setGrowthLoading] = useState(false);
  const [sentMessage, setSentMessage] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<HarvestResult | null>(null);

  const [formData, setFormData] = useState<HarvestForm>({
    plant_id: "P-001",
    age_months: 24,
    rainfall_index: 80,
    phenology_stage: 2,
    bark_browning_percent: 90,

    // Legacy default values
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

  useEffect(() => {
    setFormData(prev => ({
      ...prev,
      age_months: Math.floor(Math.random() * (48 - 18 + 1)) + 18,
      rainfall_index: Math.floor(Math.random() * 51) + 50,
      phenology_stage: 2,
      bark_browning_percent: Math.floor(Math.random() * 26) + 75
    }));
  }, []);

  const monthInfo = useMemo(
    () =>
      getMonthHarvestInfo(
        String(formData.currentMonth)
      ),
    [formData.currentMonth]
  );

  const handleInputChange = (
    e: React.ChangeEvent<
      HTMLInputElement | HTMLSelectElement
    >
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]:
        name === "phenology_stage" || name === "age_months" || name === "rainfall_index" || name === "bark_browning_percent"
          ? Number(value)
          : value,
    }));
    setResult(null);
    setSentMessage("");
    setError("");
  };

  const loadLatestGrowth = async () => {
    setGrowthLoading(true);
    setError("");
    try {
      const data = await apiGet<GrowthHistoryRecord[]>("/growth-history/");
      if (data && data.length > 0) {
        const latest = data[0];
        setFormData((previous) => ({
          ...previous,
          plant_id: latest.plant_id || previous.plant_id,
          age_months: Number(latest.plant_age_months ?? previous.age_months),
          barkThickness: String(
            latest.bark_thickness_mm ??
            latest.bark_thickness ??
            previous.barkThickness
          ),
        }));
      } else {
        throw new Error("No growth history found.");
      }
    } catch (err: any) {
      setError(
        err.message ||
          "Error loading growth data"
      );
    } finally {
      setGrowthLoading(false);
    }
  };

  const calculateHarvestReadiness =
    async () => {
      setLoading(true);
      setError("");
      setSentMessage("");
      try {
        const data = await apiPost<HarvestResult>(
          "/harvest-readiness",
          {
            plant_id: String(formData.plant_id).trim(),
            age_months: Number(formData.age_months),
            rainfall_index: Number(formData.rainfall_index),
            phenology_stage: Number(formData.phenology_stage),
            bark_browning_percent: Number(formData.bark_browning_percent)
          }
        );

        setResult(data);
      } catch (err: any) {
        setError(
          err.message ||
            "Failed to calculate harvest readiness."
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
        recommendation: "Click Calculate Harvest Readiness",
        robotic_action: "-",
      };
    }
    return {
      score: Number(result.final_score ?? 0),
      status: result.status || "-",
      recommendation: result.status_message || "-",
      robotic_action: result.action || result.robotic_action || "-",
    };
  }, [result]);

  const handleSendToRobot = () => {
    if (!result) {
      setSentMessage("Please calculate harvest readiness first.");
      return;
    }
    if (!cddReady) {
      setSentMessage("CDD guideline checks failed. Resolve the warnings before dispatching robotic harvesting.");
      return;
    }
    if (readiness.score >= 80) {
      setSentMessage("Harvest data is ready to send to the robotic harvesting module.");
    } else {
      setSentMessage(`Cannot dispatch robot. Readiness score is too low (${readiness.score}%).`);
    }
  };

  const cddWarnings: string[] = [];

  if (monthInfo.status === "poor") {
    cddWarnings.push(
      "Current month is outside recommended harvest seasons (March–May, July–September)."
    );
  }
  if (monthInfo.status === "limited") {
    cddWarnings.push(
      "Current month has limited harvest potential — check local rainfall patterns."
    );
  }
  if (formData.barkColor !== "brown") {
    cddWarnings.push(
      "Bark outer surface has not fully turned brown — tree may not be mature enough for peeling."
    );
  }
  if (formData.newShoots === "yes") {
    cddWarnings.push(
      "Tree is producing new shoots or flowers — peeling will be very difficult and bark will tear."
    );
  }

  const cddReady = cddWarnings.length === 0;

  const seasonBannerClass =
    monthInfo.status === "best"
      ? "border-emerald-200 bg-emerald-50"
      : monthInfo.status === "limited"
        ? "border-amber-200 bg-amber-50"
        : "border-rose-200 bg-rose-50";

  const seasonBadgeClass =
    monthInfo.status === "best"
      ? "badge-healthy"
      : monthInfo.status === "limited"
        ? "badge-warning"
        : "badge-danger";

  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-slate-50">
        <div className="page-shell">
          <div>
            <h1 className="page-title">Harvest Readiness Prediction</h1>
            <p className="page-subtitle">
              Guidelines based on Sri Lanka Cinnamon Development Department — Post Harvest Technology
            </p>
          </div>

          {error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600"/>
                <p className="text-sm font-medium text-rose-700">{error}</p>
              </div>
            </div>
          )}

          <div className={`flex items-start gap-3 rounded-xl border px-5 py-4 shadow-sm ${seasonBannerClass}`}>
            <Info className={`mt-0.5 shrink-0 h-[18px] w-[18px] ${monthInfo.status === "best" ? "text-emerald-600" : monthInfo.status === "limited" ? "text-amber-600" : "text-rose-600"}`}/>
            <div className="flex-1">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <span className="text-sm font-bold text-slate-900">{formData.currentMonth} — {monthInfo.label}</span>
                <span className={seasonBadgeClass}>
                  {monthInfo.status === "best" ? "Optimal" : monthInfo.status === "limited" ? "Limited" : "Off-season"}
                </span>
              </div>
              <p className="text-sm text-slate-600">{monthInfo.tip}</p>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={() => void loadLatestGrowth()} disabled={growthLoading || loading} className="btn-secondary disabled:cursor-not-allowed disabled:opacity-60">
              <RefreshCw className={`h-4 w-4 ${growthLoading ? "animate-spin" : ""}`}/>
              {growthLoading ? "Loading Growth Data…" : "Load Latest Growth Data"}
            </button>
            <button type="button" onClick={calculateHarvestReadiness} disabled={loading || growthLoading} className="btn-primary disabled:cursor-not-allowed disabled:opacity-60">
              {loading ? <Loader2 className="h-4 w-4 animate-spin"/> : <CheckCircle2 className="h-4 w-4"/>}
              {loading ? "Calculating…" : "Calculate Harvest Readiness"}
            </button>
          </div>

          <section className="card p-6">
            <h3 className="mb-5 text-base font-semibold text-slate-900">Enter Harvest Readiness Data</h3>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
              <InputField label="Plant ID" name="plant_id" onChange={handleInputChange} type="text" value={String(formData.plant_id)}/>
              <InputField label="Age (Months)" name="age_months" onChange={handleInputChange} type="number" value={String(formData.age_months)}/>
              <InputField label="Rainfall Index (0-100)" name="rainfall_index" onChange={handleInputChange} type="number" value={String(formData.rainfall_index)}/>
              <InputField label="Bark Browning (%)" name="bark_browning_percent" onChange={handleInputChange} type="number" value={String(formData.bark_browning_percent)}/>
              <InputField label="Bark Thickness (mm)" name="barkThickness" onChange={handleInputChange} type="number" value={String(formData.barkThickness)}/>
              
              <div>
                <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-slate-500">Phenological Stage</label>
                <select name="phenology_stage" value={formData.phenology_stage} onChange={handleInputChange} className="input-field">
                  <option value={0}>0 — Red Flush / New Shoots (Improper)</option>
                  <option value={1}>1 — Flowering / Fruiting (Improper)</option>
                  <option value={2}>2 — Mature Dark Green Leaves (Optimal)</option>
                </select>
              </div>
              
              <div>
                <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-slate-500">Disease Status</label>
                <select name="diseaseStatus" value={formData.diseaseStatus} onChange={handleInputChange} className="input-field">
                  <option value="Healthy">Healthy</option>
                  <option value="Diseased">Diseased</option>
                </select>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-slate-500">Current Month</label>
                <select name="currentMonth" value={formData.currentMonth} onChange={handleInputChange} className="input-field">
                  {MONTH_LIST.map((month) => <option key={month} value={month}>{month}</option>)}
                </select>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-slate-500">Outer Bark Color (CDD)</label>
                <select name="barkColor" value={formData.barkColor} onChange={handleInputChange} className="input-field">
                  <option value="brown">Fully Brown (Mature)</option>
                  <option value="green">Light / Dark Green (Immature)</option>
                  <option value="mixed">Mixed Green-Brown (Transitioning)</option>
                </select>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-slate-500">New Shoots / Flowers (CDD)</label>
                <select name="newShoots" value={formData.newShoots} onChange={handleInputChange} className="input-field">
                  <option value="no">No – Safe to Harvest</option>
                  <option value="yes">Yes – Avoid Harvesting</option>
                </select>
              </div>
            </div>

            <div className="mt-5 rounded-xl border border-slate-200/60 bg-slate-50 p-4">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Recommended Harvest Seasons (CDD — Sri Lanka)</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-4">
                <span className="badge-healthy justify-center px-3 py-2">March – May (Primary)</span>
                <span className="badge-healthy justify-center px-3 py-2">July – September (Secondary)</span>
                <span className="badge-warning justify-center px-3 py-2">Oct – Nov (Limited)</span>
                <span className="badge-danger justify-center px-3 py-2">Dec – Feb / Jun (Low)</span>
              </div>
            </div>
          </section>

          {cddWarnings.length > 0 && (
            <section className="card border-amber-200 p-6">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-amber-800">
                <AlertTriangle size={16}/> CDD Guideline Warnings
              </h3>
              <ul className="space-y-2">
                {cddWarnings.map((warning, index) => (
                  <li key={index} className="flex gap-2 text-sm text-slate-700">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" /> {warning}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {cddReady && result && (
            <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-white px-5 py-3 text-sm font-medium text-emerald-800 shadow-sm">
              <CheckCircle2 className="h-4 w-4 shrink-0"/> All CDD guideline checks passed for this harvest assessment.
            </div>
          )}

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_360px]">
            <div className="space-y-6">
              <section className="card p-6">
                <h3 className="mb-5 text-base font-semibold text-slate-900">Plant Details</h3>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <InfoCard title="Plant ID" value={String(formData.plant_id) || "-"} />
                  <InfoCard title="Age" value={`${formData.age_months || 0} months`} />
                  <InfoCard title="Rainfall Index" value={`${formData.rainfall_index || 0}`} />
                  <InfoCard title="Bark Browning" value={`${formData.bark_browning_percent || 0}%`} />
                  <InfoCard title="Phenological Stage" value={Number(formData.phenology_stage) === 0 ? "0 - Red Flush" : Number(formData.phenology_stage) === 1 ? "1 - Flowering" : "2 - Mature"} green={Number(formData.phenology_stage) === 2} />
                  <InfoCard title="Bark Thickness" value={`${formData.barkThickness || 0} mm`} />
                  <InfoCard title="Outer Bark Color" value={formData.barkColor === "brown" ? "Fully Brown" : formData.barkColor === "green" ? "Green (Immature)" : "Mixed (Transitioning)"} green={formData.barkColor === "brown"} />
                  <InfoCard title="New Shoots / Flowers" value={formData.newShoots === "no" ? "None - Safe" : "Present - Avoid Harvest"} green={formData.newShoots === "no"} />
                  
                  <div className="rounded-lg border border-slate-200/60 bg-white p-4 md:col-span-2">
                    <p className="kpi-label">Disease Status</p>
                    <p className="mt-2"><span className={formData.diseaseStatus === "Healthy" ? "badge-healthy" : "badge-danger"}>{formData.diseaseStatus}</span></p>
                  </div>
                </div>
              </section>

              <section className="card p-6">
                <h3 className="mb-5 text-base font-semibold text-slate-900">CDD Post-Harvest Best Practices</h3>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {[
                    { icon: Scissors, title: "Cut Angle", desc: "Cut stem at a 45° angle, 1½–2 inches above ground level." },
                    { icon: Leaf, title: "Remove Waste", desc: "Remove leaves, side branches, and unripe portions before peeling." },
                    { icon: Sun, title: "Drying", desc: "Dry bark in shade for 4–7 days until moisture content drops below 14%." },
                    { icon: Package, title: "Expected Yield", desc: "Good management yields 300–450 kg/acre/year; improved varieties may reach 600 kg." },
                    { icon: RefreshCw, title: "Harvest Frequency", desc: "Two to three harvests per year are achievable with good crop management." },
                    { icon: Sprout, title: "First Harvest", desc: "The first harvest is possible 2–3 years after planting when the bark is fully mature." },
                  ].map((item) => {
                    const Icon = item.icon;
                    return (
                      <div key={item.title} className="flex gap-3 rounded-lg border border-slate-200/60 bg-white p-4">
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-700"><Icon className="h-4 w-4"/></span>
                        <div>
                          <p className="text-sm font-semibold text-slate-800">{item.title}</p>
                          <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{item.desc}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="card p-6">
                <h3 className="mb-5 text-base font-semibold text-slate-900">Readiness Assessment</h3>
                <div className="rounded-xl border border-slate-200/60 bg-white p-6">
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <h4 className="text-xl font-bold text-slate-900">{readiness.status}</h4>
                    <span className={readiness.score >= 80 ? "badge-healthy" : readiness.score >= 60 ? "badge-warning" : "badge-danger"}>
                      {readiness.score}% score
                    </span>
                  </div>
                  <p className="max-w-3xl text-sm leading-relaxed text-slate-600">{readiness.recommendation}</p>
                </div>

                <button type="button" onClick={handleSendToRobot} className="btn-primary mt-5 w-full py-3">
                  <Send size={18}/> Prepare Robotic Harvesting Output
                </button>

                {sentMessage && (
                  <div className={`mt-4 rounded-lg border p-4 text-sm font-medium ${sentMessage.includes("not ready") || sentMessage.includes("failed") ? "border-rose-200 bg-rose-50 text-rose-700" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>
                    {sentMessage}
                  </div>
                )}
              </section>

              {result && (
                <section className="card p-6">
                  <h3 className="mb-5 text-base font-semibold text-slate-900">Save Status</h3>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <InfoCard title="Firebase Status" value={result.database_saved ? "Saved Successfully" : "Not Saved"} green={Boolean(result.database_saved)} />
                    <InfoCard title="CSV Dataset Status" value={result.csv_saved ? "Saved Successfully" : "Not Saved"} green={Boolean(result.csv_saved)} />
                  </div>
                </section>
              )}
            </div>

            <div className="space-y-6">
              <section className="card flex min-h-[340px] items-center justify-center p-6">
                <div className="space-y-4 text-center">
                  <div className={`mx-auto flex h-[160px] w-[160px] flex-col items-center justify-center rounded-full border-[6px] bg-white ${readiness.score >= 80 ? "border-emerald-600" : readiness.score >= 60 ? "border-amber-500" : "border-rose-500"}`}>
                    <p className={`text-4xl font-bold ${readiness.score >= 80 ? "text-emerald-700" : readiness.score >= 60 ? "text-amber-700" : "text-rose-700"}`}>
                      {readiness.score}%
                    </p>
                    <p className="mt-1 text-xs font-medium uppercase tracking-wider text-slate-500">Readiness</p>
                  </div>
                  <div className={`inline-flex items-center gap-2 ${seasonBadgeClass}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${monthInfo.status === "best" ? "bg-emerald-600" : monthInfo.status === "limited" ? "bg-amber-500" : "bg-rose-500"}`} />
                    {monthInfo.label}
                  </div>
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
