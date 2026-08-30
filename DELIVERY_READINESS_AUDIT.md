# CinnaAI University Prototype Delivery Audit

**Final audit date:** 2026-08-30  
**Code inspected:** `main` at `33e0508` plus the current working tree  
**Runtime:** FastAPI/Python 3.11 and Next.js 16/React 19  
**Assessment level:** university research prototype, not a production agricultural or industrial control system

> **Fixed implementation scope:** disease detection, growth prediction, and harvest readiness only. Dashboard, general authentication, profiles/settings, IoT transport, alternate vision pages, robotic harvesting, cut-depth control, ESP32/relay code, deployment, and unrelated pages remain out of scope unless the user explicitly expands it.

## 1. Delivery outcome

The three assigned modules are now suitable for university-prototype delivery, subject to the research limitations in this report.

| Module | Final state | Verification |
|---|---|---|
| Disease detection | EfficientNet's top class is always the displayed result; FAISS and Gemini are research-only evidence; weak outputs retain a review flag | Three response states, low-confidence top-class behavior, and FAISS separation tested |
| Growth prediction | Random Forest retained with real formula-holdout R²/MAE and a training domain aligned with every accepted form/API value | Reproducibility, complete supported-domain boundaries, status mapping, endpoint, lint, and TypeScript tested |
| Harvest readiness | Frontend and backend use one 0-100 deterministic score contract; persistence restored; thresholds aligned with current growth scale and page seasons | APPROVED/WAIT/BLOCKED and exact frontend payload tested |

This conclusion does not claim field accuracy, agronomic validation, hardware safety, or production readiness.

## 2. Canonical scoped architecture

| Area | Active implementation | Role |
|---|---|---|
| Backend | `backend/main.py` | FastAPI routes and scoped calculations |
| Disease model | `backend/cinnamon_multi_part_model.h5` | Seven-class EfficientNetB0 artifact |
| Disease ontology/hybrid | `backend/hybrid_disease/` | Closed ontology and optional Gemini shadow observation |
| FAISS | Optional index and label map | Similarity evidence only; artifacts are not included in this checkout |
| Growth model | Startup-trained `RandomForestRegressor` | Surrogate for a deterministic synthetic bark formula |
| Harvest model | `calculate_harvest_readiness()` | Transparent weighted prototype score; no longer a synthetic classifier |
| Frontend pages | `diseaseprediction`, `growthprediction`, `harvest-readiness` | The only pages changed under this assignment |

## 3. Final API contract matrix

| Feature | Route | Auth | Final contract |
|---|---|---:|---|
| Growth metadata | `GET /metrics/` | No | Synthetic sample count, holdout count, R², MAE, source, role, and training ranges |
| Growth prediction | `POST /growth-predict/` | Yes | Valid age/sensor inputs to bark estimate, 0-100 growth proxy, a status, and persistence flags |
| Disease prediction | `POST /disease-predict/` | Yes | Top class mapped to `healthy`, `disease_detected`, or `rejected`, with confidence/review flags and separate FAISS/Gemini metadata |
| Harvest readiness | `POST /harvest-readiness/` | Yes | Existing nine-field page payload to 0-100 score, status, recommendation, action label, and persistence flags |

The previously observed harvest HTTP 422 contract failure is resolved.

## 4. Disease detection readiness

### 4.1 Authoritative model

- Artifact: `backend/cinnamon_multi_part_model.h5`
- SHA-256: `53bb30592b1ae89d7f17b7242aa168fdb2f608a59bc4125a82388bf925f6cd53`
- Input: 224 x 224 RGB pixels
- Output: seven softmax probabilities
- Review gates: top probability at least 0.70 and top-two margin at least 0.15
- Classes: healthy cinnamon, leaf blight, leaf miner attack, fungal leaf patches, lower leaf gall, non-cinnamon, and upper leaf gall

Startup validates input shape, output count, and exact class order. Upload handling checks type and size, applies EXIF orientation, converts to RGB, and produces one of three explicit application states.

### 4.2 Final decision design

EfficientNet is the only authoritative diagnosis for this prototype:

```text
uploaded image
  -> EfficientNet softmax top-k
  -> top class always selected
  -> healthy / disease_detected / rejected
  -> confidence and margin add low-confidence/review flags
```

Optional evidence is additive:

- FAISS output is returned under `faiss_retrieval` with its own similarity labels, similarities, threshold, availability, and acceptance flag.
- FAISS cosine similarity never replaces softmax probability or `SpecialistPredictionResult` fields.
- Gemini is forced to shadow-only behavior. It may produce research metadata but cannot replace status, diagnosis, persistence, or notification decisions.
- The Gemini instruction now requests exactly the fields enforced by `GeminiObservation`.

This fixes the earlier accepted-FAISS Pydantic failure and the contradictory active/shadow metadata.

### 4.3 Frontend behavior

- The page always displays the top class as Healthy Cinnamon, Non-Cinnamon, or the named disease.
- A legacy `uncertain` response is normalized from `detected_class`, so it cannot replace the available class name with **Uncertain Result**.
- Weak classifications keep their numeric confidence and show an expert-review note.
- Diagnosis, guidance, symptoms, severity, and the local Next.js Image preview remain visible.

### 4.4 Remaining research limitations

- The training image dataset, split manifest, retained test output, calibration report, and confusion matrix are absent from the delivery.
- Real disease accuracy cannot be independently verified from this checkout.
- `non_cinnamon` remains one closed-set class and is not a validated universal out-of-distribution detector.
- FAISS index and label-map artifacts are absent, so normal startup reports softmax-only mode.
- The 0.70 probability, 0.15 margin, and 0.82 FAISS threshold have no retained field benchmark here.
- Treatment and severity text is manually authored guidance, not a second medical/agronomic model.

These are acceptable disclosed limitations for a university prototype; they must not be converted into unsupported accuracy claims.

## 5. Growth prediction readiness

### 5.1 Synthetic calculation model

The backend deterministically generates 10,000 formula-labelled rows across the complete accepted input domain:

```text
age A           ~ Uniform(1, 120 months)
temperature T   ~ Uniform(0.1, 60 C)
humidity H      ~ Uniform(0.1, 100%)
soil moisture M ~ Uniform(0, 100%)

S_T = exp(-(T - 30)^2 / 50)
S_H = exp(-(H - 80)^2 / 100)
S_M = exp(-(M - 60)^2 / 200)
ESI = 0.3*S_T + 0.3*S_H + 0.4*S_M
D = 25 * exp(-4 * exp(-0.15 * A * ESI))
B = 0.5 + 0.04*D
```

A 100-tree Random Forest approximates bark thickness `B`. The API converts it to:

```text
growth_value = clamp(100 * (predicted_bark_mm - 0.5), 0, 100)
```

| Growth value | Status |
|---:|---|
| `< 50` | Initial Stage |
| `50 to < 80` | Growing |
| `>= 80` | Ready to Harvest |

This value is a bark-derived maturity proxy, not observed longitudinal growth rate, biomass, height, or yield.

### 5.2 Final evaluation disclosure

The fixed-seed dataset is split 80/20 for evaluation, after which a final model is fitted to all 10,000 rows.

| Metadata returned by `/metrics/` | Value |
|---|---:|
| Formula-generated samples | 10,000 |
| Formula holdout samples | 2,000 |
| Formula holdout R² | 0.9808 |
| Formula holdout MAE | 0.0309 mm |

The former invented `92.5%` accuracy and `300` samples remain removed. The marked prototype-disclosure banner was removed from the delivery UI; the technical limitation remains documented here.

### 5.3 Domain handling

Backend validation and the model now share one supported domain: age 1-120 months, temperature greater than 0 through 60 C, humidity greater than 0 through 100%, and soil moisture 0-100%. Every accepted request is therefore within the generated training domain and always maps to `Initial Stage`, `Growing`, or `Ready to Harvest`. Values outside those bounds are rejected instead of being silently extrapolated. The marked out-of-range warning banner is no longer needed and has been removed from the page.

The frontend continues to use explicit metrics, sensor, and result types instead of `any`.

### 5.4 Remaining research limitations

- All targets are generated from the stated equation; there is no field-labelled growth dataset.
- R² and MAE validate equation approximation only.
- The broader generated domain prevents accepted API inputs from falling outside training support, but it does not establish biological field accuracy.
- Prediction CSV rows are inference logs and must not be reused as observed training labels.
- `backend/api.py` contains a separate legacy growth model with incompatible semantics and is not the canonical backend.

## 6. Harvest readiness

### 6.1 Selected contract

The project now uses the page's existing 0-100 score contract. The removed rainfall/phenology Random Forest contract is no longer active.

Request:

```text
plant_id, age, growth_rate, bark_thickness, disease_status,
current_month, bark_quality, maturity_level, health_status
```

Response includes:

```text
readiness_score, readiness_status, recommendation, robotic_action,
quality_average, calculation_method, database_saved, record_id, csv_saved
```

### 6.2 Transparent score

| Factor | High | Middle | Low |
|---|---:|---:|---:|
| Age | `>=24`: +20 | `>=18`: +12 | otherwise +5 |
| Growth proxy | `>=80`: +20 | `>=50`: +12 | otherwise +5 |
| Bark thickness | `>=1.3 mm`: +20 | `>=1.0 mm`: +12 | otherwise +5 |
| Disease status | Healthy: +15 | - | Diseased: +3 |
| Month | Mar-May or Jul-Sep: +10 | Oct-Nov: +7 | otherwise +4 |
| Mean quality | `>=85`: +15 | `>=70`: +10 | otherwise +5 |

```text
quality_average = (bark_quality + maturity_level + health_status) / 3

score >= 80 -> Ready for Harvest / APPROVED
score >= 60 -> Almost Ready / WAIT
score < 60  -> Not Ready / BLOCKED
```

Age now matches the page's 24-month prototype guidance. Bark thresholds now match the active growth model's approximate 0.5-1.5 mm output rather than the incompatible former 3-4 mm values. Month weights match the page's displayed seasonal categories.

The route again uses the authenticated page flow and saves the result through the existing Firestore, CSV, and notification helpers. Those helpers were not otherwise changed.

### 6.3 Frontend clarification

The page describes the result as a university-prototype readiness estimate and displays `Deterministic prototype score v2`. Numeric quality inputs are checked for the backend's 0-100 range.

The page's additional local warnings for bark colour, shoots/flowers, season, age, missing bark measurement, and disease remain advisory UI checks. “Prepare Robotic Harvesting Output” remains a local message only; robotic dispatch is outside this assignment.

### 6.4 Remaining research limitations

- Weights and thresholds are transparent but not validated against a retained harvest outcome dataset.
- An additive score permits strong factors to compensate for weak factors; it is not a safety interlock.
- `growth_rate` is the growth module's bark-derived proxy, not a measured rate over time.
- Seasonal and post-harvest claims need exact source/page citations before being presented as authoritative guidance.
- `robotic_action` is a display label only and must not directly control equipment.

## 7. Verification evidence

Testing occurred after the code analysis and scoped implementation. Firestore writes, CSV writes, SMTP notifications, Gemini calls, and physical serial operations were mocked in endpoint tests.

| Check | Final result |
|---|---|
| Python compilation (`main.py`, hybrid package, tests) | Passed |
| Existing and new backend unit/integration suite | **37 passed, 0 failed** |
| Disease states: healthy/disease/rejected, including weak top-class outputs | Passed |
| Accepted FAISS remains separate from softmax decision | Passed |
| Growth reproducibility, metrics, status thresholds, complete accepted-domain boundaries, endpoint | Passed |
| Harvest APPROVED/WAIT/BLOCKED boundaries | Passed |
| Exact harvest frontend payload to FastAPI | **HTTP 200**, passed |
| Scoped ESLint on three pages | Passed with no findings |
| TypeScript `tsc --noEmit` | Passed |
| Next.js 16 production build | Passed; 20 static pages generated |

One environment warning remains: FastAPI's current `TestClient` emits a Starlette deprecation warning recommending `httpx2`. It does not fail the suite and is dependency maintenance, not a scoped model defect.

## 8. Files changed for the scoped implementation

- `backend/main.py`
- `backend/.env.example`
- `backend/hybrid_disease/ontology.py`
- `backend/hybrid_disease/orchestrator.py`
- `backend/tests/test_gemini_schema.py`
- `backend/tests/test_scoped_prototype_models.py`
- `frontend/app/diseaseprediction/page.tsx`
- `frontend/app/growthprediction/page.tsx`
- `frontend/app/harvest-readiness/page.tsx`
- `DELIVERY_READINESS_AUDIT.md`
- `PROJECT_ML_AND_CALCULATION_ANALYSIS.md`

Other pre-existing working-tree modifications were preserved and were not treated as authorization to change out-of-scope modules.

## 9. Handoff decision

**Scoped university-prototype delivery status: READY.**

The disease, growth, and harvest modules are internally consistent at the declared prototype level and their automated gates pass. The client handoff should include these disclosures:

1. Disease accuracy cannot be reconstructed without the missing dataset and retained evaluation outputs.
2. Growth metrics measure imitation of a synthetic formula, not field performance.
3. Harvest readiness is a transparent prototype score, not field-validated ML or machine-safety authorization.
4. FAISS is optional and its index artifacts are not included.
5. No conclusion in this audit approves robotic, ESP32, IoT, dashboard, authentication, deployment, or other out-of-scope behavior.
