import assert from "node:assert/strict";
import test from "node:test";
import { barkRecommendationGroups, buildBarkHistoryDocument, filterBarkHistory, formatBarkConfidence, MAX_BARK_UPLOAD_BYTES,
  presentBarkDetection, presentBarkResult, validateBarkFile } from "../app/lib/bark-disease.ts";

const result = {
  status: "experimental_candidate", prediction: "RoughBark", candidate_class: "RoughBark",
  confidence_score: 0.99, confidence_margin: 0.98, top_predictions: [{ class: "RoughBark", confidence: 0.99 }, { class: "StripeCanker", confidence: 0.01 }],
  reason: "reference_supported_experimental_candidate", disease_classification_performed: true,
  in_known_disease_reference: true, uploaded_filename: "bark.jpg", prediction_time: "2026-10-16T08:00:00+00:00", id: "a",
};

test("experimental findings keep their status and supported class label", () => {
  const display = presentBarkResult(result);
  assert.equal(display.statusLabel, "Experimental finding — review recommended");
  assert.equal(display.candidateLabel, "Rough Bark");
  assert.equal(display.confidenceLabel, "99.00%");
  assert.equal(display.scores.length, 2);
  assert.equal(presentBarkResult(null).statusLabel, "Waiting for image");
});

test("compact detection cards use a review badge while preserving the experimental assessment", () => {
  const display = presentBarkDetection(result);
  assert.equal(display.statusLabel, "Possible Disease Detected");
  assert.equal(display.badgeLabel, "Review detection");
  assert.equal(display.candidateLabel, "Rough Bark");
  assert.ok(display.message.includes("experimental finding requires review"));
  assert.equal(result.status, "experimental_candidate");
  assert.equal(presentBarkResult(result).statusLabel, "Experimental finding — review recommended");
  assert.equal(presentBarkDetection(null).statusLabel, "Waiting for image");
});

test("compact uncertainty cannot be promoted to a detected disease by a diagnostic candidate", () => {
  const display = presentBarkDetection({ ...result, status: "uncertain", prediction: null });
  assert.equal(display.statusLabel, "Uncertain Result");
  assert.equal(display.isFinding, false);
  assert.equal(display.badgeLabel, "Review image");
  const outside = presentBarkDetection({ ...result, status: "uncertain", in_known_disease_reference: false,
    reason: "outside_known_disease_bark_reference", disease_classification_performed: false });
  assert.equal(outside.candidateLabel, null);
});

test("recommendations separate action/prevention rows and accept the previous backend response", () => {
  assert.deepEqual(barkRecommendationGroups({ ...result, solutions: ["Review bark"], prevention: ["Monitor stems"] }),
    { solutions: ["Review bark"], prevention: ["Monitor stems"] });
  assert.deepEqual(barkRecommendationGroups({ ...result, recommendations: ["Earlier action"] }),
    { solutions: ["Earlier action"], prevention: [] });
  assert.deepEqual(barkRecommendationGroups({ ...result, solutions: [], prevention: [], recommendations: ["Earlier action"] }),
    { solutions: [], prevention: [] });
  assert.deepEqual(barkRecommendationGroups(null), { solutions: [], prevention: [] });
});

test("outside-reference and rejected results never display leaked candidate scores", () => {
  for (const fields of [{ status: "rejected" }, { reason: "outside_known_disease_bark_reference" },
    { in_known_disease_reference: false }, { disease_classification_performed: false }]) {
    const display = presentBarkResult({ ...result, ...fields });
    assert.equal(display.candidateLabel, null);
    assert.equal(display.confidenceLabel, "—");
    assert.deepEqual(display.scores, []);
  }
});

test("uncertain disease evidence remains uncertain even with diagnostic scores", () => {
  const display = presentBarkResult({ ...result, status: "uncertain", prediction: null, reason: "insufficient_disease_evidence" });
  assert.equal(display.statusLabel, "Uncertain — review recommended");
  assert.equal(display.candidateLabel, "Rough Bark");
  assert.equal(display.scores.length, 2);
});

test("missing and invalid confidence values never become a healthy or zero-confidence finding", () => {
  for (const value of [null, undefined, NaN, Infinity, -1, 2]) assert.equal(formatBarkConfidence(value), "—");
  assert.equal(formatBarkConfidence(0), "0.00%");
});

test("upload validation accepts exactly the supported image types and inclusive 10 MB limit", () => {
  for (const type of ["image/jpeg", "image/png", "image/webp"]) {
    assert.equal(validateBarkFile({ type, size: MAX_BARK_UPLOAD_BYTES }), "");
  }
  for (const change of [{ size: 0 }, { size: MAX_BARK_UPLOAD_BYTES + 1 }, { type: "image/gif" }, { type: "text/plain" }]) {
    assert.notEqual(validateBarkFile({ type: "image/png", size: 100, ...change }), "");
  }
});

test("history search/status filters sort latest first without mutating existing records", () => {
  const rows = [result, { ...result, id: "b", status: "uncertain", prediction_time: "2026-10-17T08:00:00Z" }];
  assert.deepEqual(filterBarkHistory(rows, "bark", "all").map(row => row.id), ["b", "a"]);
  assert.deepEqual(filterBarkHistory(rows, "rough bark", "experimental_candidate").map(row => row.id), ["a"]);
  assert.deepEqual(filterBarkHistory(rows, "no match", "all"), []);
  assert.equal(rows[0].id, "a");
});

test("PDF output preserves uncertainty, hides skipped scores and escapes filenames", () => {
  const html = buildBarkHistoryDocument([{ ...result, uploaded_filename: '<script>alert("x")</script>.jpg' },
    { ...result, status: "uncertain", disease_classification_performed: false }]);
  assert.ok(html.includes("Bark Prediction History"));
  assert.ok(html.includes("Experimental finding — review recommended"));
  assert.ok(html.includes("Uncertain — review recommended"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!html.includes("<script>"));
});
