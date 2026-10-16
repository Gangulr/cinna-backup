"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { AlertTriangle, Ban, Leaf, Loader2, Sparkles, Upload } from "lucide-react";
import { apiPostFormData } from "@/app/lib/api";
import { type BarkResult, barkRecommendationGroups, presentBarkDetection, validateBarkFile } from "@/app/lib/bark-disease";

export default function BarkDiseaseSection() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [result, setResult] = useState<BarkResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState("");
  const requestVersion = useRef(0);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  useEffect(() => () => { requestVersion.current += 1; }, []);

  function selectImage(selected: File) {
    const validationError = validateBarkFile(selected);
    if (validationError) { setError(validationError); return; }
    requestVersion.current += 1;
    setFile(selected);
    setPreview(URL.createObjectURL(selected));
    setResult(null);
    setError("");
    setLoading(false);
  }

  async function analyse() {
    if (!file) return;
    const version = ++requestVersion.current;
    const form = new FormData();
    form.append("file", file);
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const response = await apiPostFormData<BarkResult>("/bark-disease-predict/", form);
      if (version === requestVersion.current) setResult(response);
    } catch (failure) {
      if (version === requestVersion.current) {
        setError(failure instanceof Error ? failure.message : "Bark analysis failed. Please try again.");
      }
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }

  const display = presentBarkDetection(result);
  const { solutions, prevention } = barkRecommendationGroups(result);

  return (
    <section aria-labelledby="bark-disease-title" className="space-y-8" data-testid="bark-disease-section">
      <div>
        <h2 id="bark-disease-title" className="page-title">Cinnamon Bark Disease Detection</h2>
        <p className="page-subtitle">Upload a cinnamon bark image for AI-powered condition analysis.</p>
      </div>

      {error && <div role="alert" className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" />
        <p className="text-sm font-medium text-rose-700">{error}</p>
      </div>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="card p-6">
          <h3 className="mb-4 text-base font-semibold text-slate-900">Upload Image</h3>
          <label
            onDragOver={event => { event.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={event => {
              event.preventDefault(); setDragOver(false);
              const selected = event.dataTransfer.files[0];
              if (selected) selectImage(selected);
            }}
            className={["flex min-h-[240px] cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 text-center transition-all duration-200",
              dragOver ? "border-emerald-500 bg-emerald-50" : preview ? "border-slate-200 bg-slate-50"
                : "border-slate-300 bg-white hover:border-emerald-400 hover:bg-emerald-50/40"].join(" ")}
          >
            <input type="file" accept="image/jpeg,image/png,image/webp" aria-label="Upload cinnamon bark image" className="sr-only"
              onChange={event => {
                const selected = event.target.files?.[0];
                if (selected) selectImage(selected);
                event.target.value = "";
              }} />
            {preview ? <div className="space-y-3">
              <Image src={preview} alt="Uploaded cinnamon bark" width={176} height={176} unoptimized
                className="mx-auto h-44 w-44 rounded-xl object-cover shadow-sm ring-1 ring-slate-200" />
              <p className="text-xs text-slate-500">Click or drop to replace image</p>
            </div> : <>
              <div className="mb-4 grid h-12 w-12 place-items-center rounded-xl bg-emerald-50 text-emerald-700"><Upload className="h-6 w-6" /></div>
              <p className="text-sm font-semibold text-slate-800">Upload cinnamon bark image</p>
              <p className="mt-1.5 text-xs text-slate-500">Drag and drop or click to browse · PNG, JPG, WebP · Up to 10 MB</p>
            </>}
          </label>
          <button type="button" onClick={analyse} disabled={loading || !file}
            className="btn-primary mt-5 w-full py-3 disabled:cursor-not-allowed disabled:opacity-60">
            {loading ? <><Loader2 className="h-4 w-4 animate-spin" />Analyzing Image…</>
              : <><Sparkles className="h-4 w-4" />Analyze Image</>}
          </button>
        </div>

        <div className="card p-6" aria-live="polite" aria-busy={loading}>
          <h3 className="mb-4 text-base font-semibold text-slate-900">Detection Result</h3>
          <div className="space-y-3">
            <div className="rounded-xl border border-slate-200/60 bg-white p-5">
              <p className="kpi-label">Disease Status</p>
              <div className="mt-2 flex items-center gap-2">
                {!result ? <Leaf className="h-5 w-5 shrink-0 text-slate-400" />
                  : result.status === "rejected" ? <Ban className="h-5 w-5 shrink-0 text-amber-600" />
                    : <AlertTriangle className={`h-5 w-5 shrink-0 ${display.isFinding ? "text-rose-600" : "text-amber-600"}`} />}
                <h4 className={`text-xl font-bold ${!result ? "text-slate-500" : display.isFinding ? "text-rose-700" : "text-amber-700"}`}>{display.statusLabel}</h4>
              </div>
              {display.badgeLabel && <span className={`mt-3 inline-flex ${display.isFinding ? "badge-danger" : "badge-warning"}`}>
                {display.badgeLabel}
              </span>}
            </div>
            <div className="rounded-xl border border-slate-200/60 bg-white p-5">
              <p className="kpi-label">Disease Type</p>
              <h4 className="mt-2 text-lg font-bold text-slate-900">
                {display.candidateLabel ?? (result ? "No supported disease assigned" : "No image analyzed yet")}
              </h4>
              {display.message && <p className="mt-2 text-sm leading-6 text-slate-600">{display.message}</p>}
            </div>
          </div>
          {result?.database_saved === false && <p role="status" className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
            Analysis completed, but this result could not be saved to History.
          </p>}
        </div>
      </div>

      <div className="card p-6">
        <h3 className="mb-5 text-base font-semibold text-slate-900">Recommendations</h3>
        {result ? <div className="space-y-3">
          {solutions.map((item, index) => <div key={`solution-${index}`}
            className="flex items-start gap-4 rounded-xl border border-emerald-200/60 bg-white p-4">
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-emerald-700 text-sm font-bold text-white">{index + 1}</div>
            <div>
              <p className="font-semibold text-slate-900">{item}</p>
              <p className="mt-1 text-sm text-slate-500">Recommended action based on AI disease analysis.</p>
            </div>
          </div>)}
          {prevention.map((item, index) => <div key={`prevention-${index}`}
            className="flex items-start gap-4 rounded-xl border border-slate-200/60 bg-white p-4">
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-700 text-sm font-bold text-white">{index + 1}</div>
            <div>
              <p className="font-semibold text-slate-900">{item}</p>
              <p className="mt-1 text-sm text-slate-500">Prevention guidance for future plant health.</p>
            </div>
          </div>)}
          {solutions.length === 0 && prevention.length === 0 && <div className="rounded-xl border border-slate-200/60 bg-white p-5">
            <p className="font-semibold text-slate-900">No recommendations available</p>
            <p className="mt-1 text-sm text-slate-500">The analysis did not return any treatment or prevention guidance.</p>
          </div>}
        </div> : <div className="rounded-xl border border-slate-200/60 bg-white p-5">
          <p className="font-semibold text-slate-900">Capture clear bark images</p>
          <p className="mt-1 text-sm text-slate-500">Use a well-lit close-up with the affected bark clearly visible.</p>
        </div>}
        <p className="mt-4 text-sm leading-6 text-slate-500">This experimental assessment supports Rough Bark and Stripe Canker only. Healthy bark and cinnamon species are not verified.</p>
      </div>
    </section>
  );
}
