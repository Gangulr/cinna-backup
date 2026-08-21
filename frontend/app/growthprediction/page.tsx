"use client";

import { useEffect, useState } from "react";
import {
  Thermometer,
  Droplets,
  Sprout,
  Radio,
  Loader2,
  Brain,
  Target,
  Database,
  AlertCircle,
  CheckCircle2,
  BarChart3,
} from "lucide-react";

import ProtectedRoute from "@/app/components/ProtectedRoute";
import { apiGet, apiPost } from "@/app/lib/api";

export default function GrowthPredictionPage() {
  const [form, setForm] = useState({
    plant_id: "P-001",
    plant_age_months: "18",
    temperature: "",
    humidity: "",
    moisture: "",
  });

  const [result, setResult] = useState<any>(null);
  const [metrics, setMetrics] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [sensorLoading, setSensorLoading] = useState(false);
  const [error, setError] = useState("");
  const [sensorTime, setSensorTime] = useState("");

  useEffect(() => {
    const loadMetrics = async () => {
      try {
        const data = await apiGet<any>(
          "/metrics/",
          false
        );

        setMetrics(data);
      } catch (err) {
        console.log(
          "Metrics load failed:",
          err
        );
      }
    };

    loadMetrics();
  }, []);

  const validateField = (
    name: string,
    value: string
  ) => {
    if (value === "") return "";

    if (name === "plant_id") return "";

    const numValue = Number(value);

    if (Number.isNaN(numValue)) {
      return "Please enter a valid number.";
    }

    if (numValue < 0) {
      return "Negative values are not allowed.";
    }

    if (
      name === "temperature" &&
      numValue > 60
    ) {
      return "Temperature must be below 60°C.";
    }

    if (
      (name === "humidity" ||
        name === "moisture") &&
      numValue > 100
    ) {
      return "Humidity and Soil Moisture must be below 100%.";
    }

    if (
      name === "plant_age_months" &&
      numValue > 120
    ) {
      return "Plant age must be realistic.";
    }

    return "";
  };

  const validateAllFields = () => {
    if (
      !form.plant_id ||
      !form.plant_age_months ||
      !form.temperature ||
      !form.humidity ||
      !form.moisture
    ) {
      return "Please enter all values.";
    }

    return (
      validateField(
        "plant_age_months",
        form.plant_age_months
      ) ||
      validateField(
        "temperature",
        form.temperature
      ) ||
      validateField(
        "humidity",
        form.humidity
      ) ||
      validateField(
        "moisture",
        form.moisture
      )
    );
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const { name, value } = e.target;

    const validationError = validateField(
      name,
      value
    );

    if (validationError) {
      setError(validationError);
      return;
    }

    setError("");

    setForm((previousForm) => ({
      ...previousForm,
      [name]: value,
    }));
  };

  const getSensorData = async () => {
    try {
      setSensorLoading(true);
      setError("");

      const data = await apiGet<any>(
        "/latest-iot-data/",
        false
      );

      console.log(
        "🔥 FRONTEND IOT DATA:",
        data
      );

      if (data.error) {
        setError(data.error);
        return;
      }

      setForm((previousForm) => ({
        ...previousForm,
        temperature: String(
          data.temperature ?? ""
        ),
        humidity: String(
          data.humidity ?? ""
        ),
        moisture: String(
          data.moisture ?? ""
        ),
      }));

      setSensorTime(
        data.timestamp || ""
      );
    } catch (err) {
      console.log(err);

      setError(
        err instanceof Error
          ? err.message
          : "Failed to fetch IoT data"
      );
    } finally {
      setSensorLoading(false);
    }
  };

  const predictGrowth = async () => {
    const validationError =
      validateAllFields();

    if (validationError) {
      setError(validationError);
      return;
    }

    const temperature = Number(
      form.temperature
    );

    const humidity = Number(
      form.humidity
    );

    const moisture = Number(
      form.moisture
    );

    const plantAge = Number(
      form.plant_age_months
    );

    if (
      temperature <= 0 ||
      humidity <= 0 ||
      moisture < 0 ||
      plantAge <= 0
    ) {
      setError(
        "Please enter valid sensor and plant values."
      );

      return;
    }

    try {
      setLoading(true);
      setError("");
      setResult(null);

      const data = await apiPost<any>(
        "/growth-predict/",
        {
          plant_id: form.plant_id,
          plant_age_months: plantAge,
          temperature,
          humidity,
          moisture,
        }
      );

      console.log(
        "PREDICTION:",
        data
      );

      setResult(data);
    } catch (err) {
      console.log(err);

      setError(
        err instanceof Error
          ? err.message
          : "Prediction failed. Please check backend server."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-slate-50">
        <div className="page-shell max-w-6xl">
          <div>
            <h1 className="page-title">
              Cinnamon Growth Prediction
            </h1>

            <p className="page-subtitle">
              AI-powered growth forecasting using Firebase
              IoT sensor values.
            </p>
          </div>

          {metrics && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="card p-5">
                <div className="flex items-start justify-between">
                  <p className="kpi-label">
                    Model
                  </p>

                  <Brain className="h-4 w-4 text-slate-400" />
                </div>

                <h2 className="mt-2 text-lg font-bold text-slate-900">
                  {metrics.model_name ??
                    "Random Forest Regressor"}
                </h2>
              </div>

              <div className="card p-5">
                <div className="flex items-start justify-between">
                  <p className="kpi-label">
                    Accuracy
                  </p>

                  <Target className="h-4 w-4 text-emerald-600" />
                </div>

                <h2 className="kpi-value">
                  {metrics.accuracy_percentage ??
                    "-"}

                  <span className="ml-1 text-base font-semibold text-slate-500">
                    %
                  </span>
                </h2>
              </div>

              <div className="card p-5">
                <div className="flex items-start justify-between">
                  <p className="kpi-label">
                    Training Samples
                  </p>

                  <Database className="h-4 w-4 text-slate-400" />
                </div>

                <h2 className="kpi-value">
                  {metrics.training_samples ??
                    "-"}
                </h2>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="card border-l-4 border-l-rose-500 p-5">
              <div className="flex items-start justify-between">
                <p className="kpi-label">
                  Temperature
                </p>

                <Thermometer className="h-4 w-4 text-rose-500" />
              </div>

              <h2 className="kpi-value">
                {form.temperature || "-"}

                <span className="ml-1 text-base font-semibold text-slate-500">
                  °C
                </span>
              </h2>
            </div>

            <div className="card border-l-4 border-l-sky-500 p-5">
              <div className="flex items-start justify-between">
                <p className="kpi-label">
                  Humidity
                </p>

                <Droplets className="h-4 w-4 text-sky-500" />
              </div>

              <h2 className="kpi-value">
                {form.humidity || "-"}

                <span className="ml-1 text-base font-semibold text-slate-500">
                  %
                </span>
              </h2>
            </div>

            <div className="card border-l-4 border-l-emerald-600 p-5">
              <div className="flex items-start justify-between">
                <p className="kpi-label">
                  Soil Moisture
                </p>

                <Sprout className="h-4 w-4 text-emerald-600" />
              </div>

              <h2 className="kpi-value">
                {form.moisture || "-"}

                <span className="ml-1 text-base font-semibold text-slate-500">
                  %
                </span>
              </h2>
            </div>
          </div>

          <div className="card p-6">
            <h2 className="mb-6 text-base font-semibold text-slate-900">
              Sensor Inputs
            </h2>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
              <div>
                <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-slate-500">
                  Plant ID
                </label>

                <input
                  type="text"
                  name="plant_id"
                  value={form.plant_id}
                  onChange={handleChange}
                  className="input-field"
                  placeholder="P-001"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-slate-500">
                  Plant Age
                </label>

                <input
                  type="number"
                  name="plant_age_months"
                  min="1"
                  value={
                    form.plant_age_months
                  }
                  onChange={handleChange}
                  className="input-field"
                  placeholder="18"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-slate-500">
                  Temperature
                </label>

                <input
                  type="number"
                  name="temperature"
                  min="0"
                  max="60"
                  value={form.temperature}
                  onChange={handleChange}
                  className="input-field"
                  placeholder="°C"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-slate-500">
                  Humidity
                </label>

                <input
                  type="number"
                  name="humidity"
                  min="0"
                  max="100"
                  value={form.humidity}
                  onChange={handleChange}
                  className="input-field"
                  placeholder="%"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-slate-500">
                  Soil Moisture
                </label>

                <input
                  type="number"
                  name="moisture"
                  min="0"
                  max="100"
                  value={form.moisture}
                  onChange={handleChange}
                  className="input-field"
                  placeholder="%"
                />
              </div>
            </div>

            {error && (
              <div className="mt-4 flex items-start gap-3 rounded-lg border border-rose-200 bg-white p-4">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />

                <p className="text-sm font-medium text-rose-700">
                  {error}
                </p>
              </div>
            )}

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={getSensorData}
                disabled={sensorLoading}
                className="btn-secondary"
              >
                {sensorLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Radio className="h-4 w-4" />
                )}

                {sensorLoading
                  ? "Loading IoT Data…"
                  : "Get Live IoT Data"}
              </button>

              <button
                type="button"
                onClick={predictGrowth}
                disabled={loading}
                className="btn-primary"
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <BarChart3 className="h-4 w-4" />
                )}

                {loading
                  ? "Predicting…"
                  : "Predict Growth"}
              </button>
            </div>

            {sensorTime && (
              <div className="mt-4 rounded-lg border border-slate-200/60 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                Latest IoT Update:{" "}
                <span className="font-medium text-slate-800">
                  {sensorTime}
                </span>
              </div>
            )}
          </div>

          {result && (
            <div className="space-y-5">
              <div className="grid gap-4 md:grid-cols-3">
                <div className="card border-l-4 border-l-emerald-600 p-5">
                  <p className="kpi-label">
                    Growth Value
                  </p>

                  <h2 className="kpi-value">
                    {result.growth_value ??
                      "-"}

                    <span className="ml-1 text-base font-semibold text-slate-500">
                      %
                    </span>
                  </h2>
                </div>

                <div className="card border-l-4 border-l-amber-500 p-5">
                  <p className="kpi-label">
                    Bark Thickness
                  </p>

                  <h2 className="kpi-value">
                    {result.bark_thickness_mm ??
                      result.bark_thickness ??
                      "-"}

                    <span className="ml-1 text-base font-semibold text-slate-500">
                      mm
                    </span>
                  </h2>
                </div>

                <div className="card border-l-4 border-l-sky-500 p-5">
                  <p className="kpi-label">
                    Status
                  </p>

                  <h2 className="mt-2 text-lg font-bold text-slate-900">
                    {result.harvest_status ??
                      result.status ??
                      "-"}
                  </h2>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="card p-5">
                  <p className="kpi-label">
                    Recommendation
                  </p>

                  <h2 className="mt-2 text-sm font-semibold leading-relaxed text-slate-800">
                    {result.recommendation ??
                      "-"}
                  </h2>
                </div>

                <div className="card border-l-4 border-l-rose-400 p-5">
                  <p className="kpi-label">
                    Alert
                  </p>

                  <h2 className="mt-2 text-sm font-semibold text-slate-800">
                    {result.alert ?? "-"}
                  </h2>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="card p-5">
                  <div className="flex items-center justify-between">
                    <p className="kpi-label">
                      Firebase Status
                    </p>

                    {result.database_saved ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    ) : (
                      <AlertCircle className="h-4 w-4 text-amber-500" />
                    )}
                  </div>

                  <h2 className="mt-2 text-sm font-semibold text-slate-900">
                    {result.database_saved
                      ? "Saved Successfully"
                      : "Not Saved"}
                  </h2>

                  <span
                    className={`mt-3 ${
                      result.database_saved
                        ? "badge-healthy"
                        : "badge-warning"
                    }`}
                  >
                    {result.database_saved
                      ? "Synced"
                      : "Pending"}
                  </span>
                </div>

                <div className="card p-5">
                  <div className="flex items-center justify-between">
                    <p className="kpi-label">
                      CSV Dataset Status
                    </p>

                    {result.csv_saved ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    ) : (
                      <AlertCircle className="h-4 w-4 text-rose-500" />
                    )}
                  </div>

                  <h2 className="mt-2 text-sm font-semibold text-slate-900">
                    {result.csv_saved
                      ? "Saved To Dataset CSV"
                      : "CSV Save Failed"}
                  </h2>

                  <span
                    className={`mt-3 ${
                      result.csv_saved
                        ? "badge-healthy"
                        : "badge-danger"
                    }`}
                  >
                    {result.csv_saved
                      ? "OK"
                      : "Failed"}
                  </span>
                </div>
              </div>

            </div>
          )}
        </div>
      </div>
    </ProtectedRoute>
  );
}
