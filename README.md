# CinnaAI

CinnaAI is a full-stack cinnamon monitoring project with a FastAPI/TensorFlow
backend and a Next.js frontend.

## Repository structure

- `backend/` — FastAPI API, TensorFlow disease model, Gemini shadow-mode
  integration, Firebase Admin integration, tests, and supporting ML code.
- `frontend/` — Next.js user interface for disease, growth, harvest, IoT,
  robotic, dashboard, authentication, and history features.

Generated dependencies, build caches, local datasets, environment files,
private Firebase credentials, obsolete models, and backup models are excluded
from Git.

## Backend setup

Use Python 3.11:

```bash
cd backend
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
if [ ! -f .env ]; then cp .env.example .env; fi
```

Place the Firebase Admin service-account file at `backend/firebase-key.json`
and configure the real values in `backend/.env`. Never commit either file.

Start the API:

```bash
python -m uvicorn main:app --host 0.0.0.0 --port 8001
```

Health check: <http://localhost:8001/health/>

## Plant condition monitoring

The IoT page accepts a typed Plant ID and editable temperature, humidity and
calibrated soil moisture. Click **Get Live IoT Data** to fill available values,
enter missing readings manually, then **Check Plant Condition** to evaluate
and save a check under your account. No plant registration or worker is needed
for this interactive flow. Older readings are labelled with their actual source
time and can still be evaluated.

The original four-card live overview refreshes every five seconds independently
of the editable form. Refresh Data updates only the overview. A condition result
shows sensor findings and basic care instructions immediately, then optionally
loads Gemini-written guidance using the existing backend Gemini configuration.
Recent Checks includes saved details; the dashboard retains its telemetry,
growth and disease sections and shows the five latest saved sensor assessments
in Live plant condition check beside the disease distribution chart. This list
refreshes every five seconds while visible, without running models or Gemini.

The baseline model and the optional advanced registered-device worker and
inspection-label collection are documented in
[backend/plant_condition/README.md](backend/plant_condition/README.md).
Interactive results compare sensor conditions with a healthy-only baseline;
they do not diagnose plant health. The advanced worker retains its default
shadow mode.

Configure the actual ESP32 database in `backend/.env`:

```dotenv
FIREBASE_SENSOR_DATABASE_URL=https://your-sensor-database.firebasedatabase.app
IOT_SENSOR_TIMEZONE=Asia/Colombo
IOT_STALE_AFTER_SECONDS=900
# Optional token for protected sensor RTDB REST reads.
FIREBASE_SENSOR_AUTH_TOKEN=
```

Interactive history uses the two `plant_condition_checks` composite indexes
in `firestore.indexes.json`; create them in your Firebase project's Firestore
Indexes screen. They are specifications, not automatically deployed indexes.
If saving a check fails, the IoT page shows the calculated result as unsaved.
History queries show a storage error rather than silently returning no records.

## Frontend setup

Use Node.js 22:

```bash
cd frontend
npm ci
if [ ! -f .env.local ]; then cp .env.example .env.local; fi
npm run dev
```

Fill `frontend/.env.local` with the Firebase web-app configuration for the
same Firebase project used by the backend service account.

Open <http://localhost:3000>.

## Important files kept in Git

- `backend/cinnamon_multi_part_model.h5` — active seven-class disease model.
- `backend/class_names.json` — exact model output-class order.
- `backend/.env.example` and `frontend/.env.example` — safe configuration
  templates without secrets.
