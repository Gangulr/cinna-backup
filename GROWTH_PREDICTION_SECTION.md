# Growth Prediction Section

## Purpose

This section estimates cinnamon bark thickness and converts it into a 0–100 growth value and a growth status.

## System flow

```text
User enters plant age and sensor values
  OR loads temperature, humidity and moisture from Firebase IoT data
  -> frontend validates the supported ranges
  -> authenticated POST /growth-predict/
  -> Random Forest estimates bark thickness
  -> bark thickness is converted to a 0-100 growth value
  -> growth value is mapped to a status, alert and recommendation
  -> result is saved to Firestore and CSV
  -> frontend displays growth, bark thickness and status
```

## Inputs and supported domain

| Input | Supported range |
|---|---:|
| Plant age | 1–120 months |
| Temperature | Greater than 0 through 60 °C |
| Humidity | Greater than 0 through 100% |
| Soil moisture | 0–100% |

Inputs outside these bounds are rejected. Every accepted input is inside the generated model-training domain and receives a status.

## Active model

The backend trains a `RandomForestRegressor` at startup:

- 100 decision trees
- `random_state=42`
- 10,000 reproducible formula-labelled samples
- 80/20 evaluation split
- final model refitted to all 10,000 samples

Current formula-holdout evaluation:

| Metric | Value |
|---|---:|
| R² | 0.9808 |
| Mean absolute error | 0.0309 mm |

## Training-label calculation

For age `A`, temperature `T`, humidity `H` and soil moisture `M`:

```text
S_T = exp(-(T - 30)^2 / 50)
S_H = exp(-(H - 80)^2 / 100)
S_M = exp(-(M - 60)^2 / 200)

ESI = 0.3*S_T + 0.3*S_H + 0.4*S_M
D = 25 * exp(-4 * exp(-0.15 * A * ESI))
B = 0.5 + 0.04*D
```

`B` is the generated bark-thickness target in millimetres. The Random Forest learns to approximate this calculation.

## Output calculation

```text
growth_value = clamp((predicted_bark_thickness - 0.5) * 100, 0, 100)
```

| Growth value | Status | Alert |
|---:|---|---|
| Below 50 | Initial Stage | Low Growth |
| 50 to below 80 | Growing | Normal Growth |
| 80 or above | Ready to Harvest | Harvest Recommended |

## Main code files

| File | Responsibility |
|---|---|
| `frontend/app/growthprediction/page.tsx` | Sensor form, IoT loading and result display |
| `frontend/app/lib/api.ts` | API and authentication helper |
| `backend/main.py` | Data generation, model training, metrics, prediction and persistence |
| `backend/tests/test_scoped_prototype_models.py` | Model reproducibility, ranges, statuses and endpoint tests |
| `backend/Dataset/csv/cinnamon_growth_dataset.csv` | Prediction log when CSV saving is enabled |

## API and stored output

- Prediction endpoint: `POST /growth-predict/`
- Metrics endpoint: `GET /metrics/`
- Optional sensor endpoint: `GET /latest-iot-data/`
- Authentication: required for prediction and history
- Firestore collection: `growth_predictions`
- Important output: growth value, bark thickness, status, alert, recommendation and save flags

## Prototype limitation

The Random Forest is trained from formula-generated labels rather than independently measured field targets. Its R² and MAE measure agreement with that formula, not verified real-world cinnamon growth accuracy.
