# Harvest Readiness Section

## Purpose

This section combines plant condition, growth and seasonal inputs into a 0–100 harvest-readiness score.

## System flow

```text
User opens harvest page
  -> page attempts to load the latest saved growth prediction
  -> user reviews or enters plant and quality values
  -> frontend validates the form
  -> authenticated POST /harvest-readiness/
  -> backend calculates the weighted readiness score
  -> score becomes Ready, Almost Ready or Not Ready
  -> result is saved to Firestore and CSV
  -> frontend displays score, recommendation and action label
  -> separate frontend CDD checks control the robotic-preparation message
```

## Model type

Harvest readiness does not currently use a trained ML model. It uses a transparent deterministic weighted calculation in `calculate_harvest_readiness()`.

## Inputs

```text
plant_id
age
growth_rate
bark_thickness
disease_status
current_month
bark_quality
maturity_level
health_status
```

The growth rate and bark thickness can be loaded from the latest growth-prediction record.

## Readiness-score calculation

| Factor | High score | Middle score | Low score |
|---|---:|---:|---:|
| Age | 24+ months: +20 | 18–23: +12 | Below 18: +5 |
| Growth value | 80+: +20 | 50–79.99: +12 | Below 50: +5 |
| Bark thickness | 1.3+ mm: +20 | 1.0–1.29 mm: +12 | Below 1.0 mm: +5 |
| Disease status | Healthy: +15 | — | Diseased: +3 |
| Month | Mar–May or Jul–Sep: +10 | Oct–Nov: +7 | Other months: +4 |
| Mean quality | 85+: +15 | 70–84.99: +10 | Below 70: +5 |

```text
quality_average = (bark_quality + maturity_level + health_status) / 3
final_score = minimum(round(total_score), 100)
```

## Final status calculation

| Score | Status | Action label |
|---:|---|---|
| 80–100 | Ready for Harvest | APPROVED |
| 60–79 | Almost Ready | WAIT |
| Below 60 | Not Ready | BLOCKED |

The action label is returned to the UI. It does not directly control physical harvesting hardware.

## Frontend CDD checks

The page also performs separate local checks for:

- recommended harvest season
- fully brown outer bark
- absence of new shoots, flowers or fruits
- age of at least 24 months
- recorded bark thickness
- healthy disease status

These checks do not change the backend readiness score. They can block the **Prepare Robotic Harvesting Output** message even when the calculated score is Ready for Harvest.

## Main code files

| File | Responsibility |
|---|---|
| `frontend/app/harvest-readiness/page.tsx` | Form, latest-growth loading, CDD checks and result display |
| `frontend/app/lib/api.ts` | Authenticated API helper |
| `backend/main.py` | Harvest schemas, weighted calculation, endpoint and persistence |
| `backend/tests/test_scoped_prototype_models.py` | Score boundaries, validation and endpoint tests |
| `backend/Dataset/csv/harvest_readiness_dataset.csv` | Harvest prediction log when CSV saving is enabled |

## API and stored output

- Endpoint: `POST /harvest-readiness/`
- Growth history dependency: `GET /growth-history/`
- Authentication: Firebase ID token required
- Firestore collection: `harvest_readiness_predictions`
- Important output: readiness score, status, recommendation, robotic action, quality average and save flags

## Prototype limitation

The weights and thresholds are manually defined prototype rules and have not been validated against a retained field harvest-outcome dataset. The result should support demonstration and monitoring, not autonomous equipment control.
