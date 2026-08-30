# CinnaAI Disease, Growth, and Harvest Technical Analysis

**Updated:** 2026-08-30  
**Assessment target:** university-level research prototype  
**Canonical backend:** `backend/main.py`  
**Canonical frontend:** `frontend/app/`

> **Implementation boundary:** only disease detection, growth prediction, and harvest readiness are analyzed as change targets. Authentication, dashboards, profiles, IoT transport, alternate vision pages, robotic harvesting, cut-depth control, ESP32/relay code, deployment, and unrelated lint are outside scope. They are mentioned only where one of the three assigned modules consumes their data or returns a label that another module may display.

## 1. Final system summary

The scoped system now contains three deliberately different model types:

| Module | Active method | What it actually estimates |
|---|---|---|
| Disease | Trained EfficientNetB0 image classifier | Closed-set class probability for seven configured image classes |
| Growth | Random Forest regression over synthetic formula labels | Bark-thickness approximation, converted to a maturity percentage |
| Harvest | Deterministic weighted score | Rule-based readiness indicator using growth, bark, health, season, and quality inputs |

Only disease uses a retained, pre-trained neural-network artifact. Growth is ML fitted to generated labels. Harvest is intentionally not presented as ML because a transparent rule is more appropriate than training a classifier to copy the same rule.

All three modules now have aligned backend/frontend contracts and focused automated tests.

## 2. Canonical code and data flow

```text
Disease page
  -> authenticated multipart upload
  -> image validation/preprocessing
  -> EfficientNet probabilities
  -> confidence/margin application decision
  -> optional FAISS similarity evidence
  -> optional Gemini shadow observation
  -> result/history/notification metadata

Growth page
  -> typed age + environmental inputs
  -> Random Forest bark estimate
  -> 0-100 bark-derived growth proxy
  -> Initial Stage / Growing / Ready to Harvest status
  -> result/history metadata

Harvest page
  -> nine typed plant/readiness inputs
  -> deterministic six-factor score
  -> APPROVED / WAIT / BLOCKED display label
  -> result/history metadata
```

`backend/api.py` is a legacy standalone growth server and is not imported by the canonical backend. Its model and units must not be mixed with `main.py`.

## 3. Disease detection

### 3.1 Retained artifact

| Property | Value |
|---|---|
| File | `backend/cinnamon_multi_part_model.h5` |
| SHA-256 | `53bb30592b1ae89d7f17b7242aa168fdb2f608a59bc4125a82388bf925f6cd53` |
| Keras model name | `cinnamon_disease_inference_model` |
| Input | `(None, 224, 224, 3)` |
| Output | `(None, 7)` |
| Parameters | 4,063,658 |
| File size | 16,725,016 bytes |

Top-level layers:

| Layer | Output | Parameters |
|---|---:|---:|
| `input_image` | 224 x 224 x 3 | 0 |
| `efficientnetb0` | 7 x 7 x 1280 | 4,049,571 |
| `global_average_pooling` | 1280 | 0 |
| `classification_batch_norm` | 1280 | 5,120 |
| `classification_dropout` | 1280 | 0 |
| `disease_predictions` | 7 | 8,967 |

Configured class order:

```text
0 healthy_cinnamon
1 leaf_blight
2 leaf_miner_attack
3 leaf_patches_fungal
4 lower_leaf_gall
5 non_cinnamon
6 upper_leaf_gall
```

The backend refuses startup use of a model whose input shape, output size, or `class_names.json` order differs from this contract.

### 3.2 Preprocessing

For each uploaded file:

1. The endpoint requires an image content type.
2. The byte stream is capped by `DISEASE_MAX_UPLOAD_MB`, default 10 MB.
3. Pillow decodes the image.
4. EXIF orientation is applied.
5. The image is converted to RGB.
6. It is resized to 224 x 224 with nearest-neighbour interpolation.
7. A `float32` batch with shape `(1, 224, 224, 3)` is passed to the model.

The model's EfficientNet stack performs its expected input scaling internally; the endpoint intentionally does not divide by 255.

Limitations:

- Direct square resize can distort leaf geometry.
- Nearest-neighbour resize can produce more aliasing than bilinear interpolation.
- `non_cinnamon` is only one trained class, not proof of general open-set rejection.
- These preprocessing choices must remain the same as those used for retained validation before they are changed.

### 3.3 Softmax decision calculation

Let the sorted model probabilities be `p1 >= p2 >= ... >= p7`.

```text
confidence = p1
margin = p1 - p2
low_confidence = confidence < 0.70 OR margin < 0.15
```

Application mapping:

```text
top class = non_cinnamon       -> rejected / Non-Cinnamon
top class = healthy_cinnamon   -> healthy / Healthy Cinnamon
top class = disease class      -> disease_detected / named disease
```

The top model class is always returned in both `prediction` and `detected_class`, regardless of confidence. Weak results set `low_confidence=true` and `review_recommended=true`; the thresholds still control Gemini shadow routing but no longer replace the class name with `unknown`.

### 3.4 FAISS evidence

If `cinnamon_faiss.index` and `faiss_label_map.json` exist, the backend builds a 1,280-dimensional embedding extractor from `global_average_pooling`.

The query vector is L2 normalized. With an inner-product index:

```text
cosine_similarity(q, x) = q · x
```

The default evidence threshold is:

```text
FAISS_SIMILARITY_THRESHOLD = 0.82
```

FAISS output is intentionally separate:

```json
{
  "faiss_retrieval": {
    "available": true,
    "accepted": true,
    "threshold": 0.82,
    "top_label": "leaf_blight",
    "top_similarity": 0.95,
    "second_label": "healthy_cinnamon",
    "second_similarity": 0.85
  }
}
```

Cosine similarity is not softmax probability. It therefore cannot populate `confidence`, `second_confidence`, `confidence_margin`, or the softmax `top_predictions`. This separation fixes the prior schema error where a FAISS label was combined with softmax top-k values.

Current checkout limitation: the FAISS index and label-map files are absent, so the service runs in softmax-only mode. `build_faiss_index.py` exists, but its output needs a documented dataset version and benchmark before the threshold is treated as meaningful.

### 3.5 Gemini shadow observation

Gemini is a research-only verifier:

- It is invoked only when the EfficientNet result is weak under the configured confidence or margin gate.
- Image metadata is removed and a bounded canonical image is sent.
- The response is constrained and then validated as `GeminiObservation`.
- Timeouts, rate limits, provider errors, refusals, invalid JSON, and circuit-open states normalize into typed failure results.
- Every failure preserves the EfficientNet result.
- Even when `HYBRID_SHADOW_MODE=false` is supplied, the current orchestrator does not activate provider output as the application diagnosis.

The prompt and schema now agree on:

```text
is_leaf_visible
is_probably_cinnamon
image_quality
visible_features
candidate_class
alternative_class
evidence_strength
requires_expert_review
summary
```

The outer metadata always reports:

```text
hybrid_used = false
decision_source = efficientnet
```

Gemini agreement and counterfactual fields remain useful for research comparison without silently changing user-visible or persisted decisions.

### 3.6 Disease frontend state model

The page now uses the backend's `status` as the source of truth.

The page maps the backend's top class to Healthy, Unsupported Image, or Disease Detected and always displays the corresponding class label. A legacy `uncertain` response is normalized using `detected_class`. Low-confidence outputs keep their confidence score and show an expert-review note instead of hiding the class behind an uncertainty state.

### 3.7 Disease evidence still missing

The repository lacks:

- training images
- final split manifest
- held-out prediction output
- confusion matrix
- per-class precision/recall/F1
- calibration or reliability plot
- out-of-distribution benchmark
- experiment record linking the current H5 hash to dataset and commit versions

Therefore, this report makes no numerical real-world accuracy claim for the disease classifier.

## 4. Growth prediction

### 4.1 Generated training domain

`build_growth_training_data()` uses NumPy's fixed-seed generator to create 10,000 independent samples across the same domain accepted by the form and API:

| Feature | Distribution |
|---|---|
| Plant age `A` | Uniform 1-120 months |
| Temperature `T` | Uniform 0.1-60 C |
| Humidity `H` | Uniform 0.1-100% |
| Soil moisture `M` | Uniform 0-100% |

No correlations, measurement noise, site effects, variety effects, rainfall history, soil chemistry, management practice, or longitudinal tree identity are modelled.

### 4.2 Label equation

Environmental suitability components:

```text
S_T = exp(-(T - 30)^2 / 50)
S_H = exp(-(H - 80)^2 / 100)
S_M = exp(-(M - 60)^2 / 200)

ESI = 0.3*S_T + 0.3*S_H + 0.4*S_M
```

Synthetic stem diameter and bark thickness:

```text
D = 25 * exp(-4 * exp(-0.15 * (A * ESI)))
B = 0.5 + 0.04*D
```

Properties:

- `D` asymptotically approaches 25.
- `B` asymptotically approaches 1.5 mm.
- Age has a direct multiplicative role inside the Gompertz-style term.
- Environmental variables influence growth only through the hand-weighted ESI.

The Random Forest is a numerical surrogate for this equation. It cannot learn biological behavior missing from the equation.

### 4.3 Training and synthetic evaluation

1. Generate 10,000 fixed-seed rows.
2. Split 80%/20% with `random_state=42`.
3. Fit a 100-tree evaluation forest to 8,000 rows.
4. Evaluate against 2,000 formula-generated rows.
5. Fit the final 100-tree forest to all 10,000 rows for application inference.

Current metadata:

| Metric | Value |
|---|---:|
| Formula holdout R² | 0.9808 |
| Formula holdout MAE | 0.0309 mm |
| Total generated samples | 10,000 |
| Holdout samples | 2,000 |

Interpretation: the forest reproduces the generated equation well inside its sampled domain. These values do not establish field validity.

### 4.4 Output transformation

For predicted bark thickness `B_hat`:

```text
growth_value = clamp(100 * (B_hat - 0.5), 0, 100)
```

| Bark estimate | Growth proxy | Application status |
|---:|---:|---|
| `< 1.0 mm` | `< 50` | Initial Stage |
| `1.0 to < 1.3 mm` | `50 to < 80` | Growing |
| `>= 1.3 mm` | `>= 80` | Ready to Harvest |

Illustrative fixed-model results at 30 C, 80% humidity, and 60% soil moisture:

| Age | Bark estimate | Growth proxy |
|---:|---:|---:|
| 1 month | 0.5268 mm | 2.68% |
| 18 months | 1.1790 mm | 67.90% |
| 24 months | 1.2824 mm | 78.24% |
| 36 months | 1.4357 mm | 93.57% |
| 48 months | 1.4696 mm | 96.96% |

These are model examples, not expected field measurements.

### 4.5 Input validation and extrapolation

The Pydantic request rejects values outside broad physical/prototype bounds:

| Input | Accepted request bound |
|---|---:|
| Age | 1-120 months |
| Temperature | greater than 0 through 60 C |
| Humidity | greater than 0 through 100% |
| Soil moisture | 0-100% |

The generated training domain now matches these accepted bounds. Therefore, every accepted request is within the model's sampled support and receives a numeric estimate plus one of the three defined statuses. Inputs outside the supported bounds are rejected by Pydantic and the matching frontend validation.

Tree ensembles still do not establish biological correctness merely by covering a wider generated domain. This change removes the technical accepted-input/training-domain mismatch; field validation remains a separate research requirement.

### 4.6 Metrics frontend

The page now displays:

- model name
- synthetic holdout R²
- generated training sample count

The marked prototype-disclosure and out-of-range warning banners have been removed. The former hard-coded 92.5% “accuracy” and 300-sample count were unrelated to the active model and remain removed. The page's API boundaries use explicit `GrowthMetrics`, `SensorResponse`, and `GrowthResult` types.

### 4.7 Growth persistence caveat

Prediction rows are written through the existing Firestore helper and appended to `cinnamon_growth_dataset.csv`. That CSV is an inference log. It contains model-produced outputs, not independently observed targets, and must not be used as supervised ground truth without a separate measured label.

## 5. Harvest readiness

### 5.1 Why the synthetic classifier was removed

The client-modified backend temporarily trained a Random Forest classifier on 2,000 labels produced by four deterministic rainfall/phenology rules. The active page, however, sent nine different score inputs and expected a 0-100 response. This caused HTTP 422 for every normal page submission.

Training a classifier to approximate known rules added boundary error without adding observed information. For a university prototype, restoring and correcting the transparent score is more explainable and matches the existing UI.

### 5.2 Request validation

| Field | Bound/type |
|---|---|
| `plant_id` | non-empty, max 100 characters |
| `age` | integer 1-120 months |
| `growth_rate` | 0-100 growth proxy |
| `bark_thickness` | 0-10 mm |
| `disease_status` | `Healthy` or `Diseased` |
| `current_month` | exact calendar month name |
| `bark_quality` | 0-100 |
| `maturity_level` | 0-100 |
| `health_status` | 0-100 |

The frontend posts these exact keys, so the page/API contract is now direct rather than translated.

### 5.3 Factor scoring

Age:

```text
age >= 24 -> 20
age >= 18 -> 12
otherwise -> 5
```

Growth proxy:

```text
growth >= 80 -> 20
growth >= 50 -> 12
otherwise    -> 5
```

Bark thickness:

```text
bark >= 1.3 mm -> 20
bark >= 1.0 mm -> 12
otherwise      -> 5
```

Plant health:

```text
Healthy  -> 15
Diseased -> 3
```

Season:

```text
March-May or July-September -> 10
October-November            -> 7
other months                -> 4
```

Quality:

```text
Q = (bark_quality + maturity_level + health_status) / 3

Q >= 85 -> 15
Q >= 70 -> 10
otherwise -> 5
```

Total:

```text
readiness_score = min(round(age + growth + bark + health + season + quality), 100)
```

### 5.4 Readiness mapping

| Score | Status | Display action |
|---:|---|---|
| `80-100` | Ready for Harvest | APPROVED |
| `60-79` | Almost Ready | WAIT |
| `0-59` | Not Ready | BLOCKED |

`robotic_action` is a compatibility/display field. This calculation does not send a serial command or authorize physical machinery.

### 5.5 Alignment improvements

Compared with the older score:

- Minimum high age changed from 18 to 24 months to match the page guidance.
- Growth middle threshold changed from 60 to 50 to match the growth module's status bands.
- Bark thresholds changed from 3/4 mm to 1.0/1.3 mm to match the active growth model's 0.5-1.5 mm scale.
- Optimal months changed to March-May and July-September; October-November is explicitly limited.
- Response includes `calculation_method = Deterministic prototype score v2`.
- The existing authenticated Firestore/CSV/notification flow is restored for this endpoint.

### 5.6 Dual UI guidance

The page also computes warnings for:

- low or limited season
- non-brown outer bark
- new shoots/flowers/fruits
- age below 24 months
- missing bark measurement
- diseased status

These warnings are not additional backend model features. They are presentation-level checks. A future research version should either send those observations to one documented backend decision or label them clearly as a separate checklist.

### 5.7 Harvest validity limits

- No retained field outcome dataset validates the weights or thresholds.
- Additive scoring permits compensation between factors.
- Bark quality, maturity, and health are user-entered subjective percentages.
- The result has no calibrated probability interpretation.
- Seasonal and post-harvest statements require exact source citations.
- The display action cannot be treated as a machinery safety decision.

## 6. Test design and results

### 6.1 Existing disease tests

The original suite covers:

- strict specialist and Gemini schemas
- confidence and margin routing boundaries
- image orientation, RGB conversion, metadata stripping, and stable canonical hashes
- Gemini provider error normalization and circuit breaker
- shadow counterfactual decisions
- Firestore-safe JSON serialization
- compatibility of EfficientNet preprocessing and class contract

The client changes had caused 13 configuration/serialization API-drift errors. Shadow-only contract restoration resolves them.

### 6.2 New scoped tests

`backend/tests/test_scoped_prototype_models.py` adds:

1. Fixed-seed growth dataset reproducibility and target bounds.
2. Correct growth metadata with no generic accuracy field.
3. Growth status boundaries at 50 and 80.
4. Minimum, representative, and maximum supported-domain calculation/status behavior plus invalid-bound rejection.
5. Growth endpoint contract with mocked persistence/providers.
6. Growth metrics endpoint reports the real synthetic evaluation contract.
7. Harvest APPROVED, WAIT, and BLOCKED examples.
8. Harvest input-bound rejection.
9. Exact harvest page payload receiving HTTP 200 and expected response fields.
10. Disease endpoint states for healthy, disease, and rejected inputs, including weak predictions that must still return their top class.
11. Accepted FAISS evidence disagreeing with EfficientNet while EfficientNet remains authoritative.
12. Environment configuration cannot activate unvalidated Gemini fusion.

### 6.3 Final verification

| Command/check | Result |
|---|---|
| Python `py_compile` for backend, hybrid code, and tests | Passed |
| `python -m unittest discover -s tests -v` | **37 passed** |
| ESLint on the three assigned pages | Passed |
| `tsc --noEmit` | Passed |
| `npm run build` | Passed |
| Next.js generated routes | 20 static pages |

All external persistence/provider actions were mocked for endpoint integration tests. The real H5 artifact was loaded during the full suite, confirming its shape and class contract. The environment reports that optional FAISS artifacts are absent.

## 7. Final prototype interpretation

The modules are technically coherent for a university demonstration when described accurately:

- Disease detection is a real retained classifier, but its delivery lacks the evidence needed to state real accuracy.
- Growth is a Random Forest approximation of an explicitly synthetic environmental equation.
- Harvest is a transparent readiness score, not a field-validated classifier.

The strongest handoff is one that demonstrates the working flows while showing these limitations in the presentation and report. None of the three outputs should be represented as autonomous agronomic advice or authorization for physical harvesting equipment.

## 8. Scope confirmation

No implementation changes were made to dashboards, user/admin/profile/settings, general authentication internals, IoT transport, alternate vision pages, robotic harvesting, cut-depth calculations, ESP32/relay behavior, deployment infrastructure, or unrelated lint findings. Those areas remain outside the user's assigned work.
