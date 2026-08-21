"use client";

import {
  ChangeEvent,
  FormEvent,
  useEffect,
  useState,
} from "react";

import {
  AlertCircle,
  Brain,
  Camera,
  CheckCircle2,
  ImagePlus,
  Leaf,
  Loader2,
  RefreshCcw,
  ScanLine,
  ShieldCheck,
  Upload,
} from "lucide-react";

import ProtectedRoute from "@/app/components/ProtectedRoute";

type VisionResult = {
  prediction: string;
  confidence: number;
  severity?: string;
  recommendation?: string;
};

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  "http://localhost:8001";

function formatConfidence(value: number) {
  if (value <= 1) {
    return Math.round(value * 100);
  }

  return Math.round(value);
}

function getSeverityStyles(severity?: string) {
  const normalizedSeverity =
    severity?.toLowerCase() || "";

  if (
    normalizedSeverity.includes("high") ||
    normalizedSeverity.includes("severe")
  ) {
    return "border-rose-200 bg-rose-50 text-rose-700";
  }

  if (
    normalizedSeverity.includes("moderate") ||
    normalizedSeverity.includes("medium")
  ) {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }

  return "border-emerald-200 bg-emerald-50 text-emerald-700";
}

export default function VisionPage() {
  const [selectedFile, setSelectedFile] =
    useState<File | null>(null);

  const [previewUrl, setPreviewUrl] =
    useState("");

  const [result, setResult] =
    useState<VisionResult | null>(null);

  const [loading, setLoading] =
    useState(false);

  const [error, setError] =
    useState("");

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  function handleImageChange(
    event: ChangeEvent<HTMLInputElement>
  ) {
    const file =
      event.target.files?.[0];

    setError("");
    setResult(null);

    if (!file) {
      return;
    }

    const allowedTypes = [
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/webp",
    ];

    if (!allowedTypes.includes(file.type)) {
      setError(
        "Please select a JPG, PNG or WEBP image."
      );

      event.target.value = "";
      return;
    }

    const maximumSize =
      10 * 1024 * 1024;

    if (file.size > maximumSize) {
      setError(
        "The selected image must be smaller than 10 MB."
      );

      event.target.value = "";
      return;
    }

    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }

    const newPreviewUrl =
      URL.createObjectURL(file);

    setSelectedFile(file);
    setPreviewUrl(newPreviewUrl);
  }

  async function handleAnalyze(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    setError("");
    setResult(null);

    if (!selectedFile) {
      setError(
        "Please select a cinnamon leaf image before starting the analysis."
      );
      return;
    }

    try {
      setLoading(true);

      const formData = new FormData();

      formData.append(
        "file",
        selectedFile
      );

      const response = await fetch(
        `${API_BASE_URL}/predict-disease/`,
        {
          method: "POST",
          body: formData,
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data?.detail ||
            data?.message ||
            "Unable to analyze the selected image."
        );
      }

      const prediction =
        data.prediction ||
        data.disease ||
        data.class_name ||
        data.label ||
        "Unknown";

      const confidence =
        Number(
          data.confidence ??
            data.probability ??
            data.score ??
            0
        ) || 0;

      setResult({
        prediction,
        confidence,
        severity:
          data.severity || "Not specified",
        recommendation:
          data.recommendation ||
          data.advice ||
          "Continue monitoring the plant and consult an agricultural specialist if symptoms develop.",
      });
    } catch (analysisError) {
      console.error(
        "Vision analysis failed:",
        analysisError
      );

      setError(
        analysisError instanceof Error
          ? analysisError.message
          : "Unable to analyze the image. Please try again."
      );
    } finally {
      setLoading(false);
    }
  }

  function handleReset() {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }

    setSelectedFile(null);
    setPreviewUrl("");
    setResult(null);
    setError("");

    const fileInput =
      document.getElementById(
        "visionImage"
      ) as HTMLInputElement | null;

    if (fileInput) {
      fileInput.value = "";
    }
  }

  const confidencePercentage =
    result
      ? formatConfidence(
          result.confidence
        )
      : 0;

  return (
    <ProtectedRoute>
      <main className="min-h-[calc(100vh-4rem)] bg-slate-50 py-8">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <section className="relative overflow-hidden rounded-3xl bg-emerald-800 px-6 py-8 shadow-sm sm:px-8 lg:px-10">
            <div className="pointer-events-none absolute inset-0">
              <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-white/5" />

              <div className="absolute -bottom-28 left-1/3 h-72 w-72 rounded-full bg-emerald-400/10 blur-3xl" />
            </div>

            <div className="relative z-10 max-w-3xl">
              <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-semibold text-emerald-50">
                <Brain className="h-4 w-4" />

                AI-powered image analysis
              </span>

              <h1 className="mt-5 text-3xl font-bold tracking-tight text-white sm:text-4xl">
                AI Vision Disease Detection
              </h1>

              <p className="mt-3 max-w-2xl text-sm leading-6 text-emerald-100 sm:text-base">
                Upload a clear cinnamon leaf
                image to identify possible
                diseases using the trained AI
                image classification model.
              </p>
            </div>
          </section>

          <section className="mt-6 grid gap-6 lg:grid-cols-[1fr_420px]">
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
              <div className="flex items-start gap-3 border-b border-slate-100 pb-6">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-emerald-100 text-emerald-700">
                  <ImagePlus className="h-5 w-5" />
                </span>

                <div>
                  <h2 className="text-xl font-bold text-slate-900">
                    Upload cinnamon leaf
                  </h2>

                  <p className="mt-1 text-sm leading-6 text-slate-500">
                    Select a clear image in JPG,
                    PNG or WEBP format.
                  </p>
                </div>
              </div>

              {error && (
                <div
                  role="alert"
                  className="mt-6 flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />

                  <p>{error}</p>
                </div>
              )}

              <form
                onSubmit={handleAnalyze}
                className="mt-6"
              >
                {!previewUrl ? (
                  <label
                    htmlFor="visionImage"
                    className="flex min-h-80 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center transition hover:border-emerald-400 hover:bg-emerald-50/40"
                  >
                    <span className="grid h-16 w-16 place-items-center rounded-2xl bg-emerald-100 text-emerald-700">
                      <Upload className="h-7 w-7" />
                    </span>

                    <h3 className="mt-5 text-base font-bold text-slate-900">
                      Select a leaf image
                    </h3>

                    <p className="mt-2 max-w-sm text-sm leading-6 text-slate-500">
                      Click here to browse your
                      device and choose a clear
                      cinnamon leaf image.
                    </p>

                    <span className="mt-4 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-slate-500 shadow-sm">
                      Maximum file size: 10 MB
                    </span>
                  </label>
                ) : (
                  <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-950">
                    <div className="relative flex min-h-80 items-center justify-center">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={previewUrl}
                        alt="Selected cinnamon leaf preview"
                        className="max-h-[520px] w-full object-contain"
                      />

                      {loading && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/70 text-white backdrop-blur-sm">
                          <span className="grid h-16 w-16 place-items-center rounded-2xl bg-white/10">
                            <ScanLine className="h-8 w-8 animate-pulse" />
                          </span>

                          <p className="mt-4 text-sm font-semibold">
                            Analyzing image...
                          </p>

                          <p className="mt-1 text-xs text-slate-300">
                            AI model is processing
                            the cinnamon leaf.
                          </p>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center justify-between gap-4 border-t border-white/10 bg-slate-900 px-4 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-white">
                          {selectedFile?.name}
                        </p>

                        <p className="mt-0.5 text-xs text-slate-400">
                          {selectedFile
                            ? `${(
                                selectedFile.size /
                                1024 /
                                1024
                              ).toFixed(2)} MB`
                            : ""}
                        </p>
                      </div>

                      <label
                        htmlFor="visionImage"
                        className="cursor-pointer rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/15"
                      >
                        Change image
                      </label>
                    </div>
                  </div>
                )}

                <input
                  id="visionImage"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handleImageChange}
                  disabled={loading}
                  className="hidden"
                />

                <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
                  {previewUrl && (
                    <button
                      type="button"
                      onClick={handleReset}
                      disabled={loading}
                      className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-500/10 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <RefreshCcw className="h-4 w-4" />

                      Reset
                    </button>
                  )}

                  <button
                    type="submit"
                    disabled={
                      loading ||
                      !selectedFile
                    }
                    className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-emerald-700 px-6 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />

                        Analyzing image...
                      </>
                    ) : (
                      <>
                        <ScanLine className="h-4 w-4" />

                        Analyze disease
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>

            <aside className="space-y-6">
              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex items-center gap-3">
                  <span className="grid h-11 w-11 place-items-center rounded-xl bg-slate-100 text-slate-700">
                    <Camera className="h-5 w-5" />
                  </span>

                  <div>
                    <p className="text-sm font-semibold text-emerald-700">
                      Analysis result
                    </p>

                    <h2 className="text-lg font-bold text-slate-900">
                      Disease prediction
                    </h2>
                  </div>
                </div>

                {!result ? (
                  <div className="mt-6 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center">
                    <Leaf className="mx-auto h-9 w-9 text-slate-300" />

                    <p className="mt-4 text-sm font-semibold text-slate-700">
                      No analysis available
                    </p>

                    <p className="mt-2 text-xs leading-5 text-slate-500">
                      Upload a cinnamon leaf image
                      and start the AI analysis to
                      view the result.
                    </p>
                  </div>
                ) : (
                  <div className="mt-6 space-y-5">
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5">
                      <div className="flex items-start gap-3">
                        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />

                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-600">
                            Predicted condition
                          </p>

                          <p className="mt-1 text-xl font-bold capitalize text-emerald-900">
                            {result.prediction}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold text-slate-700">
                          Confidence
                        </p>

                        <p className="text-sm font-bold text-emerald-700">
                          {confidencePercentage}%
                        </p>
                      </div>

                      <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-200">
                        <div
                          className="h-full rounded-full bg-emerald-700 transition-all duration-500"
                          style={{
                            width: `${Math.min(
                              confidencePercentage,
                              100
                            )}%`,
                          }}
                        />
                      </div>
                    </div>

                    <div
                      className={`rounded-xl border px-4 py-3 ${getSeverityStyles(
                        result.severity
                      )}`}
                    >
                      <p className="text-xs font-semibold uppercase tracking-wide opacity-70">
                        Severity
                      </p>

                      <p className="mt-1 text-sm font-bold capitalize">
                        {result.severity ||
                          "Not specified"}
                      </p>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                        Recommendation
                      </p>

                      <p className="mt-2 text-sm leading-6 text-slate-600">
                        {result.recommendation}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
                <div className="flex gap-3">
                  <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />

                  <div>
                    <h3 className="text-sm font-bold text-emerald-900">
                      Image guidelines
                    </h3>

                    <p className="mt-2 text-xs leading-5 text-emerald-700">
                      Use a well-lit, focused
                      image showing the complete
                      leaf. Avoid blurry images,
                      dark backgrounds and
                      multiple overlapping
                      leaves.
                    </p>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
                <div className="flex gap-3">
                  <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />

                  <div>
                    <h3 className="text-sm font-bold text-amber-900">
                      Important notice
                    </h3>

                    <p className="mt-2 text-xs leading-5 text-amber-700">
                      AI predictions are provided
                      for research and monitoring
                      purposes. Consult an
                      agricultural specialist
                      before applying treatments.
                    </p>
                  </div>
                </div>
              </div>
            </aside>
          </section>
        </div>
      </main>
    </ProtectedRoute>
  );
}