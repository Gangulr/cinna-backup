"use client";

import React, {
  useEffect,
  useState,
} from "react";
import Image from "next/image";

import {
  Upload,
  Loader2,
  ShieldCheck,
  AlertTriangle,
  Ban,
  Sparkles,
  Leaf,
} from "lucide-react";

import ProtectedRoute from "@/app/components/ProtectedRoute";
import { apiPostFormData } from "@/app/lib/api";

type DiseaseStatus =
  | "healthy"
  | "rejected"
  | "disease_detected"
  | "uncertain";

type TopPrediction = {
  class: string;
  confidence: number;
};

type DiseasePredictionResult = {
  status?: DiseaseStatus;
  prediction?: string;
  display_prediction?: string;
  detected_class?: string;
  confidence?: string | number;
  confidence_score?: number;
  confidence_margin?: number;
  top_predictions?: TopPrediction[];
  message?: string;
  severity?: string;
  diagnosis?: string;
  symptoms?: string;
  solutions?: string[];
  prevention?: string[];
  decision_source?: "efficientnet";
  hybrid_used?: boolean;
  low_confidence?: boolean;
  review_recommended?: boolean;
};

const diseaseLabels: Record<string, string> = {
  healthy_cinnamon: "Healthy Cinnamon",
  leaf_blight: "Leaf Blight",
  leaf_miner_attack: "Leaf Miner Attack",
  leaf_patches_fungal:
    "Leaf Patches – Fungal Disease",
  lower_leaf_gall: "Lower Leaf Gall",
  non_cinnamon: "Non-Cinnamon",
  upper_leaf_gall: "Upper Leaf Gall",
  unknown: "Unknown",
};

function formatConfidence(
  value: string | number | undefined,
  score: number | undefined
): string {
  if (typeof score === "number") {
    return `${(score * 100).toFixed(2)}%`;
  }

  if (typeof value === "number") {
    return value <= 1
      ? `${(value * 100).toFixed(2)}%`
      : `${value.toFixed(2)}%`;
  }

  return value || "-";
}

export default function DiseasePredictor() {
  const [file, setFile] =
    useState<File | null>(null);

  const [preview, setPreview] =
    useState<string | null>(null);

  const [result, setResult] =
    useState<DiseasePredictionResult | null>(null);

  const [loading, setLoading] =
    useState(false);

  const [dragOver, setDragOver] =
    useState(false);

  const [error, setError] =
    useState("");

  useEffect(() => {
    return () => {
      if (preview) {
        URL.revokeObjectURL(preview);
      }
    };
  }, [preview]);

  function selectImage(selectedFile: File) {
    if (!selectedFile.type.startsWith("image/")) {
      setError(
        "Please select a valid image file."
      );
      return;
    }

    if (preview) {
      URL.revokeObjectURL(preview);
    }

    const previewUrl =
      URL.createObjectURL(selectedFile);

    setFile(selectedFile);
    setPreview(previewUrl);
    setResult(null);
    setError("");
  }

  const onFileChange = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const selectedFile =
      event.target.files?.[0];

    if (selectedFile) {
      selectImage(selectedFile);
    }

    event.target.value = "";
  };

  const onDrop = (
    event: React.DragEvent<HTMLLabelElement>
  ) => {
    event.preventDefault();
    setDragOver(false);

    const selectedFile =
      event.dataTransfer.files?.[0];

    if (selectedFile) {
      selectImage(selectedFile);
    }
  };

  const predictDisease = async () => {
    if (!file) {
      setError(
        "Please upload an image before starting the analysis."
      );
      return;
    }

    setLoading(true);
    setError("");
    setResult(null);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const data =
        await apiPostFormData<DiseasePredictionResult>(
          "/disease-predict/",
          formData
        );

      console.log(
        "DISEASE API RESPONSE:",
        data
      );

      setResult(data);
    } catch (requestError) {
      console.error(
        "Disease prediction error:",
        requestError
      );

      setError(
        requestError instanceof Error
          ? requestError.message
          : "Disease analysis failed. Please try again."
      );
    } finally {
      setLoading(false);
    }
  };

  const resultStatus = result?.status;

  const isRejected =
    resultStatus === "rejected";

  const isHealthy =
    resultStatus === "healthy";

  const isDisease =
    resultStatus === "disease_detected";

  const candidateClass =
    result?.detected_class ||
    result?.top_predictions?.[0]?.class;

  const candidateLabel = candidateClass
    ? diseaseLabels[candidateClass] ||
      candidateClass
    : "Unknown";

  const displayIsRejected =
    isRejected ||
    candidateClass === "non_cinnamon";

  const displayIsHealthy =
    isHealthy ||
    candidateClass === "healthy_cinnamon";

  const displayIsDisease =
    isDisease ||
    (Boolean(candidateClass) &&
      candidateClass !== "healthy_cinnamon" &&
      candidateClass !== "non_cinnamon");

  const diseaseStatus = result
    ? displayIsRejected
      ? "Unsupported Image"
      : displayIsHealthy
        ? "Healthy"
        : displayIsDisease
            ? "Disease Detected"
            : "Unknown Result"
    : "Waiting for image";

  const diseaseType = result
    ? result.display_prediction &&
      result.display_prediction !== "Uncertain Result"
      ? result.display_prediction
      : candidateLabel ||
        diseaseLabels[
          result.prediction || ""
        ] ||
        "Unknown"
    : "No image analyzed yet";

  const confidence = formatConfidence(
    result?.confidence,
    result?.confidence_score
  );

  const solutions = Array.isArray(
    result?.solutions
  )
    ? result.solutions
    : [];

  const prevention = Array.isArray(
    result?.prevention
  )
    ? result.prevention
    : [];

  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-slate-50">
        <div className="page-shell">
          <div>
            <h1 className="page-title">
              Cinnamon Disease Detection
            </h1>

            <p className="page-subtitle">
              Upload a cinnamon leaf image for
              AI-powered condition analysis.
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

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="card p-6">
              <h2 className="mb-4 text-base font-semibold text-slate-900">
                Upload Image
              </h2>

              <label
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() =>
                  setDragOver(false)
                }
                onDrop={onDrop}
                className={[
                  "flex min-h-[240px] cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 text-center transition-all duration-200",
                  dragOver
                    ? "border-emerald-500 bg-emerald-50"
                    : preview
                      ? "border-slate-200 bg-slate-50"
                      : "border-slate-300 bg-white hover:border-emerald-400 hover:bg-emerald-50/40",
                ].join(" ")}
              >
                <input
                  type="file"
                  accept="image/*"
                  onChange={onFileChange}
                  className="hidden"
                />

                {preview ? (
                  <div className="space-y-3">
                    <Image
                      src={preview}
                      alt="Uploaded cinnamon plant"
                      width={176}
                      height={176}
                      unoptimized
                      className="mx-auto h-44 w-44 rounded-xl object-cover shadow-sm ring-1 ring-slate-200"
                    />

                    <p className="text-xs text-slate-500">
                      Click or drop to replace image
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="mb-4 grid h-12 w-12 place-items-center rounded-xl bg-emerald-50 text-emerald-700">
                      <Upload className="h-6 w-6" />
                    </div>

                    <p className="text-sm font-semibold text-slate-800">
                      Upload cinnamon leaf image
                    </p>

                    <p className="mt-1.5 text-xs text-slate-500">
                      Drag and drop or click to browse ·
                      PNG, JPG
                    </p>
                  </>
                )}
              </label>

              <button
                type="button"
                onClick={predictDisease}
                disabled={loading || !file}
                className="btn-primary mt-5 w-full py-3 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Analyzing Image…
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    Analyze Image
                  </>
                )}
              </button>
            </div>

            <div className="card p-6">
              <h2 className="mb-4 text-base font-semibold text-slate-900">
                Detection Result
              </h2>

              <div className="space-y-3">
                <div className="rounded-xl border border-slate-200/60 bg-white p-5">
                  <p className="kpi-label">
                    Disease Status
                  </p>

                  <div className="mt-2 flex items-center gap-2">
                    {result ? (
                      displayIsRejected ? (
                        <Ban className="h-5 w-5 text-amber-600" />
                      ) : displayIsHealthy ? (
                        <ShieldCheck className="h-5 w-5 text-emerald-600" />
                      ) : (
                        <AlertTriangle className="h-5 w-5 text-rose-600" />
                      )
                    ) : (
                      <Leaf className="h-5 w-5 text-slate-400" />
                    )}

                    <h3
                      className={[
                        "text-xl font-bold",
                        displayIsRejected
                          ? "text-amber-700"
                          : displayIsHealthy && result
                            ? "text-emerald-700"
                            : result
                              ? "text-rose-700"
                              : "text-slate-500",
                      ].join(" ")}
                    >
                      {diseaseStatus}
                    </h3>
                  </div>

                  {result && (
                    <span
                      className={[
                        "mt-3 inline-flex",
                        displayIsRejected
                          ? "badge-warning"
                          : displayIsHealthy
                            ? "badge-healthy"
                            : "badge-danger",
                      ].join(" ")}
                    >
                      {displayIsRejected
                        ? "Upload a cinnamon leaf"
                        : displayIsHealthy
                          ? "No action required"
                          : "Review detection"}
                    </span>
                  )}
                </div>

                <div className="rounded-xl border border-slate-200/60 bg-white p-5">
                  <p className="kpi-label">
                    Disease Type
                  </p>

                  <h3 className="mt-2 text-lg font-bold text-slate-900">
                    {diseaseType}
                  </h3>

                  {result?.message && (
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      {result.message}
                    </p>
                  )}
                </div>

                
              </div>
            </div>
          </div>

          <div className="card p-6">
            <h2 className="mb-5 text-base font-semibold text-slate-900">
              Recommendations
            </h2>

            {result ? (
              <div className="space-y-3">
                {solutions.map(
                  (item, index) => (
                    <div
                      key={`solution-${index}`}
                      className="flex items-start gap-4 rounded-xl border border-emerald-200/60 bg-white p-4"
                    >
                      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-emerald-700 text-sm font-bold text-white">
                        {index + 1}
                      </div>

                      <div>
                        <p className="font-semibold text-slate-900">
                          {item}
                        </p>

                        <p className="mt-1 text-sm text-slate-500">
                          Recommended action based on AI
                          disease analysis.
                        </p>
                      </div>
                    </div>
                  )
                )}

                {prevention.map(
                  (item, index) => (
                    <div
                      key={`prevention-${index}`}
                      className="flex items-start gap-4 rounded-xl border border-slate-200/60 bg-white p-4"
                    >
                      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-700 text-sm font-bold text-white">
                        {index + 1}
                      </div>

                      <div>
                        <p className="font-semibold text-slate-900">
                          {item}
                        </p>

                        <p className="mt-1 text-sm text-slate-500">
                          Prevention guidance for future
                          plant health.
                        </p>
                      </div>
                    </div>
                  )
                )}

                {solutions.length === 0 &&
                  prevention.length === 0 && (
                    <div className="rounded-xl border border-slate-200/60 bg-white p-5">
                      <p className="font-semibold text-slate-900">
                        No recommendations available
                      </p>

                      <p className="mt-1 text-sm text-slate-500">
                        The analysis did not return any
                        treatment or prevention guidance.
                      </p>
                    </div>
                  )}
              </div>
            ) : (
              <div className="rounded-xl border border-slate-200/60 bg-white p-5">
                <p className="font-semibold text-slate-900">
                  Monitor humidity levels
                </p>

                <p className="mt-1 text-sm text-slate-500">
                  Keep humidity between 60–80% for
                  optimal health.
                </p>
              </div>
            )}
          </div>

          {result && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className="card p-5">
                <p className="kpi-label">
                  Diagnosis
                </p>

                <p className="mt-2 text-sm font-semibold text-slate-800">
                  {result.diagnosis || "-"}
                </p>
              </div>

              <div className="card p-5">
                <p className="kpi-label">
                  Symptoms
                </p>

                <p className="mt-2 text-sm font-semibold text-slate-800">
                  {result.symptoms || "-"}
                </p>
              </div>

              <div className="card p-5">
                <p className="kpi-label">
                  Severity
                </p>

                <p className="mt-2">
                  <span
                    className={
                      displayIsDisease
                        ? "badge-danger"
                        : displayIsHealthy
                          ? "badge-healthy"
                          : "badge-warning"
                    }
                  >
                    {result.severity || "-"}
                  </span>
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </ProtectedRoute>
  );
}
