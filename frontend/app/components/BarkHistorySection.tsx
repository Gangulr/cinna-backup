"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Inbox, Leaf, Loader2, Search } from "lucide-react";
import { useAuth } from "@/app/context/AuthContext";
import { apiGet } from "@/app/lib/api";
import { type BarkHistoryRecord, buildBarkHistoryDocument, filterBarkHistory, formatBarkTime, presentBarkResult } from "@/app/lib/bark-disease";

const PAGE_SIZE = 10;

export default function BarkHistorySection() {
  const { firebaseUser } = useAuth();
  const uid = firebaseUser?.uid ?? "";
  const [attempt, setAttempt] = useState(0);
  const requestKey = `${uid}:${attempt}`;
  const [response, setResponse] = useState<{ key: string; records: BarkHistoryRecord[]; error: string }>({ key: "", records: [], error: "" });
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [exportError, setExportError] = useState("");

  useEffect(() => {
    let active = true;
    if (!uid) return;
    apiGet<BarkHistoryRecord[]>("/bark-disease-history/").then(records => {
      if (active) setResponse({ key: requestKey, records: Array.isArray(records) ? records : [], error: "" });
    }).catch(failure => {
      if (active) setResponse({ key: requestKey, records: [], error: failure instanceof Error ? failure.message : "Unable to load bark history." });
    });
    return () => { active = false; };
  }, [uid, requestKey]);

  const filtered = useMemo(() => filterBarkHistory(response.key === requestKey ? response.records : [], search, status), [response, requestKey, search, status]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const records = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const loading = Boolean(uid) && response.key !== requestKey;
  const error = response.key === requestKey ? response.error : "";

  function downloadPDF() {
    setExportError("");
    const printWindow = window.open("", "_blank");
    if (!printWindow) { setExportError("Please allow pop-ups to download bark history as a PDF."); return; }
    printWindow.opener = null;
    printWindow.document.write(buildBarkHistoryDocument(filtered));
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  }

  return (
    <section aria-labelledby="bark-history-title" className="card overflow-hidden" data-testid="bark-history-section">
      <div className="flex flex-col gap-4 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="rounded-lg bg-emerald-50 p-2 text-emerald-700"><Leaf className="h-4 w-4" /></span>
          <div><h2 id="bark-history-title" className="text-base font-semibold text-slate-900">Bark Predictions</h2>
            <p className="text-xs text-slate-500">{filtered.length} records</p></div>
        </div>
        <button type="button" onClick={downloadPDF} disabled={!filtered.length || loading}
          className="btn-primary disabled:cursor-not-allowed disabled:opacity-60"><Download className="h-4 w-4" />Download PDF</button>
      </div>
      <div className="grid gap-3 border-b border-slate-100 px-5 py-4 md:grid-cols-2">
        <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input type="search" aria-label="Search bark records" placeholder="Search bark records…" value={search}
            onChange={event => { setSearch(event.target.value); setPage(1); }}
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-emerald-500" /></div>
        <select aria-label="Filter bark assessment status" value={status}
          onChange={event => { setStatus(event.target.value); setPage(1); }}
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500">
          <option value="all">All assessment statuses</option>
          <option value="experimental_candidate">Experimental finding</option>
          <option value="uncertain">Uncertain</option>
          <option value="rejected">Unsupported image</option>
        </select>
      </div>
      {(error || exportError) && <div role="alert" className="m-5 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
        {error || exportError}
        {error && <button type="button" className="ml-3 underline" onClick={() => setAttempt(value => value + 1)}>Retry</button>}
      </div>}
      <div className="overflow-x-auto" aria-busy={loading}>
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>
            {["Date", "Filename", "Candidate", "Assessment Status", "Class Confidence"].map(label => <th key={label} className="whitespace-nowrap px-5 py-3">{label}</th>)}
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? <tr><td colSpan={5} className="px-5 py-8 text-center text-slate-500"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Loading bark history…</td></tr>
              : !records.length ? <tr><td colSpan={5} className="px-5 py-8 text-center text-slate-500"><Inbox className="mx-auto mb-2 h-6 w-6" />{error ? "Bark history is unavailable." : "No bark prediction records found."}</td></tr>
                : records.map(record => {
                  const display = presentBarkResult(record);
                  return <tr key={record.id}>
                    <td className="whitespace-nowrap px-5 py-4">{formatBarkTime(record.prediction_time)}</td>
                    <td className="max-w-64 break-words px-5 py-4">{record.uploaded_filename}</td>
                    <td className="px-5 py-4 font-medium">{display.candidateLabel ?? "—"}</td>
                    <td className="px-5 py-4"><span className="badge-warning">{display.statusLabel}</span></td>
                    <td className="px-5 py-4">{display.confidenceLabel}</td>
                  </tr>;
                })}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-5 py-4 text-sm">
        <button type="button" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)} className="btn-secondary px-3 py-2 disabled:opacity-50"><ChevronLeft className="h-4 w-4" />Previous</button>
        <span className="text-slate-600">Page {currentPage} of {totalPages}</span>
        <button type="button" disabled={currentPage >= totalPages} onClick={() => setPage(currentPage + 1)} className="btn-secondary px-3 py-2 disabled:opacity-50">Next<ChevronRight className="h-4 w-4" /></button>
      </div>
    </section>
  );
}
