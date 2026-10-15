"use client";

import { Loader2 } from "lucide-react";
import { assessmentTitle, CareGuidance, ConditionCheck, sensorFields } from "@/app/lib/interactive-condition";

function legacyGuidance(result: ConditionCheck): CareGuidance {
  return {
    summary: result.reason,
    source: "basic",
    recommended_actions: [
      { action_id: "measure", instruction: "Take fresh measurements and check sensor placement and moisture calibration." },
      { action_id: "inspect", instruction: "Inspect leaves, stems and soil for visible changes before adjusting care." },
      { action_id: "expert", instruction: "Seek agronomic advice if unusual readings or visible symptoms persist." },
    ],
    follow_up: "Repeat the check with current measurements after inspection or any care adjustment.",
  };
}

export default function ConditionAssessment({ result, guidanceState = "idle" }: {
  result: ConditionCheck;
  guidanceState?: "idle" | "loading" | "ready" | "unavailable";
}) {
  const color = result.status === "OK" ? "border-emerald-200 bg-emerald-50" :
    result.status === "ATTENTION" ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-slate-50";
  const guidance = result.care_guidance || result.basic_guidance || legacyGuidance(result);
  const names = { temperature: "Temperature", humidity: "Humidity", moisture: "Soil moisture" };
  const units = { temperature: "°C", humidity: "% RH", moisture: "%" };
  return (
    <section className={`space-y-5 rounded-xl border p-5 sm:p-6 ${color}`} aria-label="Plant condition assessment" aria-live="polite">
      <div>
        <h3 className="text-xl font-semibold text-slate-900">{assessmentTitle(result.status)}</h3>
        <p className="mt-1 text-sm font-medium text-slate-700">{result.plant_id}</p>
      </div>
      <div>
        <h4 className="text-sm font-semibold text-slate-900">Assessment summary</h4>
        <p className="mt-1 text-sm leading-relaxed text-slate-700">{guidance.summary}</p>
        {result.status === "UNKNOWN" && <p className="mt-1 text-sm text-slate-600">{result.reason}</p>}
      </div>
      <div>
        <h4 className="text-sm font-semibold text-slate-900">Sensor findings</h4>
        <div className="mt-2 grid gap-3 sm:grid-cols-3">
          {sensorFields.map((name) => {
            const finding = result.sensor_findings?.find((item) => item.feature === name);
            const labels = { within_baseline: "Within observed baseline", below_baseline: "Below observed baseline",
              above_baseline: "Above observed baseline", unavailable: "Reference comparison unavailable" };
            return <div key={name} className="rounded-lg border border-white bg-white/70 p-3">
              <p className="text-xs font-medium text-slate-500">{names[name]}</p>
              <p className="mt-1 text-lg font-semibold">{result[name]} <span className="text-sm font-normal text-slate-500">{units[name]}</span></p>
              <p className="mt-1 text-xs text-slate-700">{labels[finding?.comparison || "unavailable"]}</p>
              {finding?.baseline_min != null && finding.baseline_max != null &&
                <p className="mt-1 text-xs text-slate-500">Observed range: {finding.baseline_min}–{finding.baseline_max} {units[name]}</p>}
            </div>;
          })}
        </div>
        {result.sensor_findings?.some((item) => item.baseline_min != null) &&
          <p className="mt-2 text-xs text-slate-600">Reference ranges describe the training observations, rather than universal healthy limits.</p>}
        {result.status === "ATTENTION" && result.sensor_findings?.every((item) => item.comparison === "within_baseline") &&
          <p className="mt-2 text-sm text-slate-700">The individual readings fall within observed ranges, but their combination differs from the baseline.</p>}
      </div>
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="text-sm font-semibold text-slate-900">Recommended actions</h4>
          {guidance.source === "ai" && <span className="rounded-full bg-white px-2 py-0.5 text-xs text-slate-600">AI-assisted care guidance</span>}
        </div>
        {guidanceState === "loading" && <p className="mt-2 flex items-center gap-2 text-sm text-slate-600"><Loader2 className="h-4 w-4 animate-spin" />Preparing care guidance…</p>}
        {guidanceState === "unavailable" && <p className="mt-2 text-sm text-slate-600">AI guidance is temporarily unavailable.</p>}
        <ul className="mt-2 list-disc space-y-2 pl-5 text-sm leading-relaxed text-slate-700">
          {guidance.recommended_actions.map((action) => <li key={action.action_id}>{action.instruction}</li>)}
        </ul>
      </div>
      <div><h4 className="text-sm font-semibold text-slate-900">Follow-up</h4><p className="mt-1 text-sm text-slate-700">{guidance.follow_up}</p></div>
      <div className="space-y-1 border-t border-slate-200/70 pt-3 text-sm text-slate-600">
        {result.database_saved === false && <p role="alert" className="font-semibold text-rose-700">{result.save_message || "Result not saved. Try again to save this check."}</p>}
        {result.database_saved === true && <p className="text-emerald-800">Check saved to your history.</p>}
      </div>
    </section>
  );
}
