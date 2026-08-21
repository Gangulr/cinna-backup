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
cp .env.example .env
```

Place the Firebase Admin service-account file at `backend/firebase-key.json`
and configure the real values in `backend/.env`. Never commit either file.

Start the API:

```bash
python -m uvicorn main:app --host 0.0.0.0 --port 8001
```

Health check: <http://localhost:8001/health/>

## Frontend setup

Use Node.js 22:

```bash
cd frontend
npm ci
cp .env.example .env.local
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
