export type BarkStatus = "experimental_candidate" | "uncertain" | "rejected";
export type BarkClass = "RoughBark" | "StripeCanker";

export type BarkResult = {
  status: BarkStatus;
  prediction: BarkClass | null;
  candidate_class: BarkClass | null;
  confidence_score: number | null;
  confidence_margin: number | null;
  top_predictions: { class: BarkClass; confidence: number }[];
  reason: string;
  disease_classification_performed: boolean;
  in_known_disease_reference: boolean | null;
  input_relevance_verified: boolean;
  review_recommended: boolean;
  healthy_detection_supported: false;
  is_cinnamon: null;
  assessment_mode: "reference_only_experimental";
  display_prediction: string | null;
  message: string;
  recommendations: string[];
  solutions?: string[];
  prevention?: string[];
  database_saved: boolean;
  record_id: string | null;
  uploaded_filename: string;
  prediction_time: string;
  model_version: string;
  model_sha256: string;
};

export type BarkHistoryRecord = Omit<BarkResult, "database_saved" | "record_id"> & {
  id: string;
  user_id: string;
  user_email?: string;
  user_name?: string;
};

const LABELS: Record<BarkClass, string> = { RoughBark: "Rough Bark", StripeCanker: "Stripe Canker" };
export const MAX_BARK_UPLOAD_BYTES = 10 * 1024 * 1024;

export function validateBarkFile(file: Pick<File, "type" | "size">): string {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    return "Please select a JPEG, PNG or WebP image.";
  }
  if (!file.size) return "The selected image is empty.";
  if (file.size > MAX_BARK_UPLOAD_BYTES) return "The image exceeds the 10 MB upload limit.";
  return "";
}

export function formatBarkConfidence(score: number | null | undefined): string {
  return typeof score === "number" && Number.isFinite(score) && score >= 0 && score <= 1
    ? `${(score * 100).toFixed(2)}%` : "—";
}

export function presentBarkResult(result: BarkResult | BarkHistoryRecord | null) {
  const showScores = Boolean(result?.disease_classification_performed
    && result.in_known_disease_reference && result.status !== "rejected"
    && result.reason !== "outside_known_disease_bark_reference");
  const candidate = showScores && result?.candidate_class ? LABELS[result.candidate_class] : null;
  return {
    statusLabel: !result ? "Waiting for image"
      : result.status === "experimental_candidate" ? "Experimental finding — review recommended"
      : result.status === "rejected" ? "Unsupported image" : "Uncertain — review recommended",
    candidateLabel: candidate,
    confidenceLabel: showScores ? formatBarkConfidence(result?.confidence_score) : "—",
    scores: showScores ? result?.top_predictions ?? [] : [],
  };
}

// Compact detection cards use the leaf layout; history retains the full assessment status.
export function presentBarkDetection(result: BarkResult | null) {
  const assessment = presentBarkResult(result);
  const isFinding = result?.status === "experimental_candidate" && Boolean(assessment.candidateLabel);
  return {
    candidateLabel: assessment.candidateLabel,
    isFinding,
    statusLabel: !result ? "Waiting for image" : isFinding ? "Possible Disease Detected"
      : result.status === "rejected" ? "Unsupported Image" : "Uncertain Result",
    badgeLabel: !result ? null : result.status === "rejected" ? "Upload a cinnamon bark image"
      : isFinding ? "Review detection" : "Review image",
    message: !result ? null : isFinding
      ? "A possible cinnamon bark condition was identified. This experimental finding requires review."
      : result.status === "rejected" ? "Upload a clear image of cinnamon bark to try again."
      : result.reason === "outside_known_disease_bark_reference"
        ? "No supported bark disease could be assigned from this image."
        : "The result is uncertain. Any displayed disease name is a candidate for review.",
  };
}

export function barkRecommendationGroups(result: BarkResult | null) {
  // Remain compatible with a backend or saved result from before grouped guidance.
  const solutions = Array.isArray(result?.solutions) ? result.solutions
    : Array.isArray(result?.recommendations) ? result.recommendations : [];
  return { solutions, prevention: Array.isArray(result?.prevention) ? result.prevention : [] };
}

export function filterBarkHistory(records: BarkHistoryRecord[], search: string, status: string) {
  const query = search.trim().toLowerCase();
  return records.filter(record => {
    const display = presentBarkResult(record);
    return (status === "all" || record.status === status)
      && [record.uploaded_filename, record.candidate_class, display.candidateLabel,
        display.statusLabel, record.user_email, record.prediction_time]
        .some(value => String(value ?? "").toLowerCase().includes(query));
  }).sort((a, b) => Date.parse(b.prediction_time) - Date.parse(a.prediction_time));
}

export function formatBarkTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("en-GB");
}

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[char]!));
}

export function buildBarkHistoryDocument(records: BarkHistoryRecord[]): string {
  const rows = records.map(record => {
    const display = presentBarkResult(record);
    return `<tr><td>${escapeHtml(formatBarkTime(record.prediction_time))}</td>`
      + `<td>${escapeHtml(record.uploaded_filename)}</td><td>${escapeHtml(display.candidateLabel ?? "—")}</td>`
      + `<td>${escapeHtml(display.statusLabel)}</td><td>${escapeHtml(display.confidenceLabel)}</td></tr>`;
  }).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Bark Prediction History</title>
    <style>body{font:14px Arial,sans-serif;color:#0f172a;padding:24px}table{width:100%;border-collapse:collapse}
    td,th{border:1px solid #cbd5e1;padding:8px;text-align:left;overflow-wrap:anywhere}th{background:#f1f5f9}</style></head>
    <body><h1>Bark Prediction History</h1><p>${records.length} records</p>
    <p>Experimental findings require review. Healthy bark and cinnamon species are not verified.</p>
    <table><thead><tr><th>Date</th><th>Filename</th><th>Candidate</th><th>Assessment status</th><th>Class confidence</th></tr></thead>
    <tbody>${rows}</tbody></table></body></html>`;
}
