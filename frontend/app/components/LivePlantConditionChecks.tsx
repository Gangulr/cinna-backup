"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Inbox, Loader2 } from "lucide-react";
import { useAuth } from "@/app/context/AuthContext";
import { apiGet } from "@/app/lib/api";
import { assessmentTitle, type ConditionCheck } from "@/app/lib/interactive-condition";

export default function LivePlantConditionChecks() {
  const { firebaseUser, loading } = useAuth();
  return (
    <section className="card flex h-full flex-col p-6" aria-label="Recent saved plant condition checks">
      <div>
        <h3 className="text-base font-semibold text-slate-900">Live plant condition check</h3>
        <p className="mt-1 text-sm text-slate-500">Recent saved sensor assessments</p>
      </div>
      {loading ? <LoadingChecks /> : firebaseUser ?
        <RecentChecks key={firebaseUser.uid} /> : <p className="py-6 text-sm text-slate-500">Sign in to view your checks.</p>}
      <Link href="/iot-monitoring" className="mt-4 border-t border-slate-100 pt-4 text-sm font-semibold text-emerald-700 hover:text-emerald-800">Open IoT Monitoring →</Link>
    </section>
  );
}

function LoadingChecks() {
  return <div className="flex min-h-48 flex-1 items-center justify-center gap-2 text-sm text-slate-500"><Loader2 className="h-5 w-5 animate-spin" />Loading recent checks…</div>;
}

function RecentChecks() {
  const [records, setRecords] = useState<ConditionCheck[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    let loaded = false;
    const refresh = async () => {
      if (cancelled || inFlight || document.visibilityState === "hidden") return;
      inFlight = true;
      try {
        const rows = await apiGet<ConditionCheck[]>("/plant-condition-history?limit=5");
        if (!Array.isArray(rows)) throw new Error("Invalid history response");
        if (!cancelled) {
          setRecords(rows.slice(0, 5)); // The API orders saved checks newest first.
          setError("");
          loaded = true;
        }
      } catch {
        if (!cancelled) setError(loaded ? "Unable to refresh recent checks. Previously loaded results are shown." : "Unable to load recent checks. Please try again shortly.");
      } finally {
        inFlight = false;
        if (!cancelled) setLoading(false);
      }
    };
    const onReturn = () => { void refresh(); };
    void refresh();
    const interval = window.setInterval(onReturn, 5000);
    document.addEventListener("visibilitychange", onReturn);
    window.addEventListener("focus", onReturn);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onReturn);
      window.removeEventListener("focus", onReturn);
    };
  }, []);

  if (loading) return <LoadingChecks />;
  return <div className="mt-4 flex-1">
    {error && <p role="alert" className="mb-3 text-sm text-rose-700">{error}</p>}
    {!error && !records.length && <div className="flex min-h-48 flex-col items-center justify-center gap-2 text-center">
      <Inbox className="h-8 w-8 text-slate-300" /><p className="text-sm text-slate-500">No plant condition checks yet.</p>
    </div>}
    {!!records.length && <ul className="divide-y divide-slate-100">
      {records.map((record) => <li key={record.record_id || record.request_id} className="py-3 first:pt-0">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <p className="min-w-0 break-all text-sm font-semibold text-slate-900">{record.plant_id}</p>
          <span className={`max-w-full rounded-md px-2 py-1 text-xs font-medium ${record.status === "OK" ? "bg-emerald-50 text-emerald-800" : record.status === "ATTENTION" ? "bg-amber-50 text-amber-800" : "bg-slate-100 text-slate-700"}`}>
            {assessmentTitle(record.status)}
          </span>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-slate-600">{record.temperature}°C · {record.humidity}% RH · {record.moisture}% soil moisture</p>
      </li>)}
    </ul>}
  </div>;
}
