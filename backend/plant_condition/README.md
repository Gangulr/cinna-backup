# Plant condition monitoring

This feature detects sensor snapshots that differ from the client-confirmed healthy baseline. It does not diagnose disease or establish that a plant is healthy. The current spreadsheet contains only healthy observations, so there is no unhealthy-class sensitivity, F1, ROC-AUC or health-accuracy result.

## Included

- A shared 300-tree Isolation Forest, trained offline on temperature, humidity and calibrated soil moisture.
- A separate Colab notebook in `backend/notebooks/Plant_Condition_Baseline_Training_Colab.ipynb`.
- The fitted artifact, metadata, exact dependency versions, normalized dataset, evaluation CSV and PNG/PDF charts in `backend/models/plant_condition/`.
- An independent RTDB ingestion worker, authenticated plant APIs, transactional device assignment, deduplicated history, inspection submission and independent administrator review.
- Plant condition assessment and history on the IoT page, and device/inspection administration on the Admin page.

The original disease notebook and its model are not changed.

## Ordinary IoT page: live fetch and manual inputs

Run the FastAPI backend (`python -m uvicorn main:app --host 127.0.0.1 --port 8001`
from `backend/`) and frontend (`npm run dev` from `frontend/`). Sign in and open
`http://localhost:3000/iot-monitoring`.

1. Enter a Plant ID, as on Growth/Harvest. It is an account-scoped record label,
   not a global registration or verified assignment of the shared sensor feed.
2. Click **Get Live IoT Data** to fill available values from the existing ESP32
   RTDB stream. Missing values stay blank or preserve an existing manual entry.
   Valid zero values stay zero. IoT/manual origin is retained in saved metadata.
3. Complete or edit the three inputs. Manual soil moisture must be measured on
   the same calibrated percentage scale as the baseline. No plant age is used.
4. Click **Check Plant Condition**. The saved Isolation Forest evaluates these
   values immediately; neither a registry entry nor a worker is required.

Live fetching never evaluates a model or saves a check. The editable form does
not poll in the background. Fetching disables inputs temporarily; editing
inputs or the Plant ID clears the previous displayed result.

The original temperature, humidity, soil-moisture and battery gauges are shown
above the form, alongside Latest Sensor Information and System Status. This
overview polls every five seconds and has a Refresh Data button. Those updates
do not change the form, source snapshot submitted with it, or displayed result.
Only Get Live IoT Data populates the form. Missing values show Not available;
feed reachability and measurement freshness are displayed separately. Raw JSON
and repeated fetch/source warning blocks are omitted from the ordinary view.

`GET /latest-iot-data` preserves its top-level temperature/humidity/moisture,
battery, timestamp and source fields. Partial readings return null fields,
missing-field warnings, source-record identity, normalized `observed_at`,
`fetched_at` and freshness metadata. Selection uses the greatest measurement
timestamp from one record; conflicting ties or records of unknown order are
reported instead of guessing. No measurements are combined across records.
Single records with unknown time can be displayed but have unknown freshness.
The root/`esp32`/`sensor_data` single-device layouts remain supported; multi-device
roots require a configured single shared feed or the advanced device workflow.

Configure the actual `FIREBASE_SENSOR_DATABASE_URL` and, if needed,
`FIREBASE_SENSOR_AUTH_TOKEN` in `backend/.env`. Legacy device timestamps such as
`2026-8-31 12:3` use `IOT_SENSOR_TIMEZONE=Asia/Colombo`; explicit offsets and Unix
seconds/milliseconds retain their meaning. `IOT_STALE_AFTER_SECONDS=900` is an
initial age-display setting, not a health limit. Older snapshots may be checked
but are explicitly labelled historical. Sensor measurement time, fetch time
and assessment time remain separate. Replacing moisture manually does not
refresh retained old IoT temperature/humidity. Fully manual values have no
verified measurement time.

Authenticated interfaces:

- `POST /plant-condition-check`: a UUID `request_id`, Plant ID, three finite
  measurements, `input_origins` (`iot`/`manual` per field) and optional fetched
  `live_snapshot`. IoT-origin inputs must match that submitted snapshot.
- `GET /plant-condition-history?plant_id=P-001&limit=50`: account-scoped records;
  omit Plant ID to list the account's latest checks. Limit is 1–100. Administrators
  using this interactive route also receive only their own checks.

Checks use the separate `plant_condition_checks` collection. Model score,
threshold and version are saved with inputs and source metadata, but ordinary
cards do not show internal scores as health probabilities. Source metadata is
explicitly recorded as user-submitted, not as a verified device assignment.
Results never become health labels. The API does not depend on the worker's
shadow mode: its output is an explicitly interactive baseline evaluation.

Repeated submissions with the same account/request UUID and identical payload
return the original saved check. Reusing a UUID with different inputs returns
409. The UI retains the UUID for failed-save retries and disables duplicate
clicks. Database failures preserve the computed result with `database_saved=false`
and **Result not saved**. Account/time and account/Plant-ID/time indexes are
included in `firestore.indexes.json` and must be created in Firestore. Direct
client writes to the collection should be denied; backend authentication derives
the user identity. Your existing profile rules must be preserved.

The dashboard retains its sensor, growth and disease sections and displays
Live plant condition check beside the disease distribution chart. It reads
`GET /plant-condition-history?limit=5` for the signed-in account and shows Plant
ID, condition and sensor values, newest first. It refreshes every five seconds
while visible and on return to the page; it never scores readings or calls
Gemini. Failed refreshes preserve that account's last loaded results with an
error message. Account changes clear the list and discard pending responses.

The ordinary IoT view omits input-origin captions, assessment-scope text,
assessment-card timestamps and the history Source column. Last Updated remains
in the sensor overview and Check time remains in the IoT history table. Stored
timestamps/origins and backend responses are preserved. Saved View details uses
the same simplified assessment card, with explanations and care guidance.
Advanced registered-device monitoring and inspections are available through the
collapsed advanced section on the IoT page; device administration is separately
labelled optional on the Admin page. Their existing records are unchanged.

## Assessment explanations and optional AI care guidance

Saved checks include `sensor_findings` (values, units, observed model reference
ranges and comparisons) and `basic_guidance` (summary, approved care actions and
follow-up). UI headings are Favourable Sensor Conditions, Sensor Conditions
Require Attention and Unable to Assess These Conditions Reliably. The saved
Isolation Forest and threshold still select OK/ATTENTION/UNKNOWN. Reference
ranges come from artifact metadata, not universal agronomic thresholds. An
unusual combination inside those ranges is explained without blaming a sensor.

After a saved result appears, the UI calls authenticated
`POST /plant-condition-checks/{record_id}/guidance`. This is optional prose
generation, not a second health classifier. It uses the existing
`GEMINI_ENABLED`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_TIMEOUT_SECONDS` and
`GEMINI_MAX_CONCURRENCY` configuration and the installed google-genai SDK through
an independent adapter. No credentials are sent to the browser. The text client
is closed during backend shutdown; disease-image verification is unchanged.

The provider receives only sensor findings, model status, measurement context
and approved action categories. Account identity and Plant ID are excluded.
Structured output must preserve the status and approved categories. Unsupported
numerical prescriptions, chemical treatment and explicit health claims are
rejected. AI prose is labelled AI-assisted care guidance; it never changes model
scores, source time, health labels or the recorded result.

Successful guidance is stored on that same account-owned check, including its
provider, model, generation timestamp and version. Subsequent requests reuse it.
Concurrent requests share generation within a backend process; a transactional
write preserves the first successful guidance across processes. Timeouts cover
both concurrency waits and provider execution, with no automatic provider
retries. Missing configuration, provider failure or validation/storage failure
leaves basic instructions visible with AI guidance is temporarily unavailable.
Unsaved assessments keep basic instructions until saving succeeds.

Editing inputs invalidates late guidance responses. Recent Checks offers View
details for saved explanations without generating new guidance. Older records
remain readable; missing comparisons are marked unavailable, and records from
another model version do not inherit the current model's reference ranges.

## Model and dataset

Source: the client-supplied `data set.xlsx`, with 274 daily snapshots from 2026-01-01 through 2026-10-01. Historical plant IDs are unknown. Temperature is interpreted in Celsius, humidity in percent RH and moisture in the client's calibrated percentage scale.

Rows are sorted chronologically: 164 training, 55 threshold calibration, 55 test. The model is not refitted after evaluation. Score = `-model.score_samples(features)`. Scores strictly greater than the calibration scores' 95th percentile require inspection; equality remains OK. The threshold is not a probability or an agronomic limit. The output metadata records the measured false-alert rate and an approximate Wilson 95% interval; correlated plants/days can violate that interval's independence assumption.

The calibration ID `client-moisture-percent-v1` names the client's declared calibration. It does not calibrate hardware. Confirm the same moisture scale physically before registering live sensors. Observed ranges are baseline coverage ranges, not universal healthy thresholds. Isolation Forest scores can saturate beyond their training support: a score above the threshold still requires inspection, but a non-alert score outside the observed training ranges returns Unable to assess rather than OK. Evaluation records include this status and metadata reports assessment coverage separately from false alerts.

Rebuild offline from the backend directory:

```bash
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m plant_condition.training "/path/to/data set.xlsx" --confirmed-healthy --output models/plant_condition --calibration-id client-moisture-percent-v1
```

For Colab, open the new notebook, run its dependency cell, upload `data set.xlsx`, run the remaining cells and download the ZIP. Replace the artifact directory with the ZIP contents and install the accompanying version manifest when provisioning a backend. Only load trusted artifacts; joblib files execute Python during deserialization and are not accepted as API uploads. The backend checks the artifact fingerprint, feature contract, embedded metadata and scikit-learn version.

## Optional advanced monitoring: start the worker

Configure existing Firebase credentials and `FIREBASE_SENSOR_DATABASE_URL` in `backend/.env`. If the sensor RTDB needs a REST authentication token, set `FIREBASE_SENSOR_AUTH_TOKEN`. It must authorize the sensor database, which can be a different Firebase project from the users/history database.

```dotenv
PLANT_CONDITION_SHADOW_MODE=true
PLANT_CONDITION_POLL_SECONDS=30
# Optional absolute path; otherwise the bundled models/plant_condition is used.
# PLANT_CONDITION_MODEL_DIR=/absolute/path/to/export
```

Start the existing FastAPI server normally. In a separate terminal, from `backend/`, run:

```bash
.venv/bin/python -m plant_condition.worker
```

For one ingestion cycle, add `--once`. The worker imports Firebase and the baseline service, not `main.py`; it does not train the growth, harvest or condition models. GET requests only read stored assessments and recheck freshness. The worker runs without any browser open. No condition emails or relay actions are triggered.

The API `/health/` includes `plant_condition_model_loaded` and `plant_condition_mode`. A missing, corrupt or incompatible model makes assessments unavailable while the rest of the application remains accessible.

## Configure Firestore

The new collections are `plants`, `plant_devices`, `plant_condition_locks`, `plant_condition_latest`, `plant_conditions` and `plant_health_observations`. Client code accesses these through the authenticated API; configure Firestore security rules so direct client writes to these collections are denied. Firebase Admin writes use the existing backend service account. Do not replace existing user/profile rules.

For advanced monitoring, create the two original composite indexes in `firestore.indexes.json`: plant ID ascending plus observation time descending on conditions, and plant ID ascending plus inspection time descending on health observations. Interactive checks additionally need `plant_condition_checks` indexes for user ID ascending plus assessment time descending, and user ID ascending plus Plant ID ascending plus assessment time descending. These specifications have not been applied to a remote Firebase project by this implementation. History queries return a storage-unavailable error until required indexes are built.

## Register a plant

Sign in as an administrator and open Admin Dashboard → Plant devices and inspection reviews. Select an existing owner and set:

- A globally unique plant ID, for example `P-001`.
- Its dedicated device ID, for example `ESP32-001`.
- Calibration ID `client-moisture-percent-v1`, after confirming the scale matches.
- The actual sensor reporting interval in seconds, not the UI refresh interval.
- Dedicated device feed, or Existing single-device feed for the existing ESP32 path.

Exactly one active plant may own a device. Only one plant can be assigned to the legacy single-device stream. Assignment changes invalidate the previous latest result. Owner transfers are deliberately rejected because existing history must not move to another user without a separate migration.

Equivalent authenticated admin request: `POST /admin/plants`:

```json
{
  "plant_id": "P-001",
  "owner_id": "EXISTING_FIREBASE_USER_UID",
  "device_id": "ESP32-001",
  "calibration_id": "client-moisture-percent-v1",
  "expected_interval_seconds": 300,
  "source_kind": "device",
  "active": true
}
```

The interval above is an example; enter your actual firmware cadence.

## RTDB reading contract

Dedicated streams live at `/devices/{device_id}/readings/{source_record_key}`. The explicitly mapped legacy adapter supports the existing root, `esp32`, and `esp32/sensor_data` single-device layouts. It rejects a multi-device root without an explicit legacy stream. Both adapters support dictionaries or lists of readings. With multiple records, the greatest source timestamp wins, independent of insertion order. A record with unknown recency prevents an assessment rather than silently selecting an older reading.

```json
{
  "device_id": "ESP32-001",
  "reading_id": "EXAMPLE_SOURCE_RECORD_ID",
  "timestamp": "2026-10-11T09:30:00Z",
  "temperature": 27.8,
  "humidity": 71.2,
  "moisture": 49.5,
  "battery": 88,
  "calibration_id": "client-moisture-percent-v1"
}
```

Use current timestamps in firmware; this is a format example, not a live reading. Dedicated device feeds require ISO timestamps with a timezone (`Z` or an explicit offset), or Unix seconds/milliseconds. The existing single-device adapter also accepts legacy dates such as `2026-8-31 12:4`, interpreting dates without offsets using `IOT_SENSOR_TIMEZONE` (default Asia/Colombo), just like the normal IoT feed. Original measurement times are preserved and old readings still fail the registered device freshness check. Zero values are preserved. Humidity/moisture accept finite values from 0–100, and the sensor input temperature range is -50–100 °C; those bounds validate the sensor contract, not plant suitability. Battery is optional and never a model feature. Embedded device/plant identifiers, when supplied, must match the registration. Missing calibration in legacy records uses the explicitly provisioned registration's calibration ID; a conflicting supplied ID is rejected.

Records older than three registered reporting intervals, more than 60 seconds in the future, missing required values or carrying mismatched calibration produce Unable to assess. The worker hashes plant assignment, device, source record and source timestamp for idempotent history writes. A read/store failure updates availability without replacing earlier valid history.

## Shadow pilot and enablement

Shadow mode is the default: it saves candidate scores/statuses for evaluation but shows Unable to assess with a baseline-checking message. Collect confirmed-healthy live observations across plants and times of day and assess the observed false-alert burden. This is essential because the supplied daily snapshots do not establish coverage of all live measurement conditions.

After the pilot has been reviewed, set `PLANT_CONDITION_SHADOW_MODE=false` in both API and worker environments and restart both processes. Inspection-oriented OK / Needs inspection / Unable to assess cards will then be enabled. No result claims that a plant is disease-free.

## Inspection and future health labels

Plant owners use IoT Monitoring → Record a plant inspection. Routine and alert-triggered inspections are distinguished. The optional related assessment preserves its exact sensor values/device/time; the reading may not occur after the inspection. The elapsed interval is recorded for later label-alignment filtering.

All submitted labels start pending, with `training_label=null`. A different administrator reviews the evidence on the Admin page. Confirmed healthy maps to 0; unhealthy maps to 1; unknown stays null. Only reviewed records with paired sensor values are marked `eligible_for_training`. Unpaired observations remain useful inspection history. No existing model prediction is converted into a true health label.

Authenticated routes:

- `GET /plants`
- `POST /admin/plants`
- `GET /plants/{plant_id}/condition`
- `GET /plants/{plant_id}/condition-history?limit=100`
- `GET/POST /plants/{plant_id}/health-observations`
- `POST /admin/plants/{plant_id}/health-observations/{observation_id}/review`

The second milestone requires both independently observed classes, plant-independent and chronological evaluation, Logistic Regression/Random Forest comparison and a frozen decision policy. It is not trained from this healthy-only spreadsheet.

## Verification

Run from `backend/`:

```bash
.venv/bin/python -m unittest tests.test_condition_guidance tests.test_interactive_condition tests.test_plant_condition -v
```

Tests use in-memory Firestore/source doubles: they do not write to real Firebase, send email or operate relays. They cover partial live reads, legacy dates, timestamp ordering, manual/IoT origin validation, interactive checks without registration, account-scoped history, idempotent submission, unsaved results, model contracts, chronological partitions, timestamp/zero handling, recency, assignment isolation, duplicate ingestion, ownership, label review and unavailable storage. Firebase provisioning, device firmware and live field performance still require deployment validation.

From `frontend/`, run `npm run test:plant-condition` for input merging and validation checks.
