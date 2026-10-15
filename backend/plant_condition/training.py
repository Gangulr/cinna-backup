"""Offline training and export for a confirmed-healthy sensor baseline."""
from __future__ import annotations

import argparse
import hashlib
import json
import platform
import time
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import sklearn
from sklearn.ensemble import IsolationForest

FEATURES = ["temperature", "humidity", "moisture"]
UNITS = {"temperature": "degC", "humidity": "percent_rh", "moisture": "calibrated_percent"}
CALIBRATION_ID = "client-moisture-percent-v1"


def load_dataset(path: str | Path) -> pd.DataFrame:
    path = Path(path)
    frame = pd.read_excel(path) if path.suffix.lower() == ".xlsx" else pd.read_csv(path)
    aliases = {
        "date": "observed_date", "temprature": "temperature",
        "huminidity": "humidity", "soill moisture": "moisture",
    }
    frame.columns = [aliases.get(str(c).strip().lower(), str(c).strip().lower()) for c in frame.columns]
    if frame.columns.duplicated().any():
        raise ValueError("Duplicate normalized column names.")
    required = ["observed_date"] + FEATURES
    if not set(required).issubset(frame.columns):
        raise ValueError(f"Dataset must include {required}.")
    frame = frame[required].copy()
    dates = frame["observed_date"]
    if pd.api.types.is_numeric_dtype(dates):
        frame["observed_date"] = pd.to_datetime(dates, unit="D", origin="1899-12-30")
    else:
        frame["observed_date"] = pd.to_datetime(dates, errors="raise")
    if frame["observed_date"].isna().any() or frame["observed_date"].duplicated().any():
        raise ValueError("Every daily record must have a distinct valid date.")
    for column in FEATURES:
        frame[column] = pd.to_numeric(frame[column], errors="raise")
    if not np.isfinite(frame[FEATURES].to_numpy(dtype=float)).all():
        raise ValueError("Sensor values must be finite and complete.")
    if not frame["humidity"].between(0, 100).all() or not frame["moisture"].between(0, 100).all():
        raise ValueError("Humidity and calibrated moisture must be percentages in [0, 100].")
    if not frame["temperature"].between(-50, 100).all():
        raise ValueError("Temperature is outside the supported sensor input range.")
    frame = frame.sort_values("observed_date").reset_index(drop=True)
    if len(frame) < 25:
        raise ValueError("At least 25 confirmed-healthy records are required.")
    return frame


def wilson_interval(count: int, total: int) -> list[float]:
    z = 1.959963984540054
    p = count / total
    divisor = 1 + z * z / total
    center = (p + z * z / (2 * total)) / divisor
    radius = z * np.sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / divisor
    return [float(max(0, center - radius)), float(min(1, center + radius))]


def train_export(dataset_path: str | Path, output_dir: str | Path,
                 calibration_id: str = CALIBRATION_ID) -> dict:
    """Fit only the earliest 60%; calibrate on the next 20%; preserve test rows."""
    frame = load_dataset(dataset_path)
    output = Path(output_dir)
    output.mkdir(parents=True, exist_ok=True)
    train_count = int(len(frame) * 0.60)
    calibration_count = (len(frame) - train_count) // 2
    train = frame.iloc[:train_count]
    calibration = frame.iloc[train_count:train_count + calibration_count]
    test = frame.iloc[train_count + calibration_count:]
    model = IsolationForest(n_estimators=300, max_samples="auto",
                            contamination="auto", random_state=42, n_jobs=-1)
    started = time.perf_counter()
    model.fit(train[FEATURES])
    fit_seconds = time.perf_counter() - started
    calibration_scores = -model.score_samples(calibration[FEATURES])
    threshold = float(np.quantile(calibration_scores, 0.95))
    started = time.perf_counter()
    test_scores = -model.score_samples(test[FEATURES])
    inference_seconds = time.perf_counter() - started
    false_alerts = int((test_scores > threshold).sum())
    ranges = {name: {"min": float(train[name].min()), "max": float(train[name].max())}
              for name in FEATURES}
    outside_test = np.zeros(len(test), dtype=bool)
    for name in FEATURES:
        outside_test |= ~test[name].between(ranges[name]["min"], ranges[name]["max"]).to_numpy()
    unsupported = int((outside_test & (test_scores <= threshold)).sum())
    source_hash = hashlib.sha256(Path(dataset_path).read_bytes()).hexdigest()
    version = f"healthy-baseline-v1-{source_hash[:12]}"
    metrics = {
        "healthy_test_records": len(test), "false_alert_count": false_alerts,
        "false_alert_rate": false_alerts / len(test),
        "unassessed_outside_baseline_records": unsupported,
        "assessment_coverage": (len(test) - unsupported) / len(test),
        "false_alert_rate_wilson_95": wilson_interval(false_alerts, len(test)),
        "interval_assumption": "Binomial approximation; repeated plants/days may be dependent.",
        "fit_seconds": fit_seconds, "test_batch_inference_seconds": inference_seconds,
        "mean_inference_ms_per_test_record": 1000 * inference_seconds / len(test),
    }
    split = {}
    for name, part in [("training", train), ("calibration", calibration), ("test", test)]:
        split[name] = {"records": len(part), "first_date": str(part.observed_date.iloc[0].date()),
                       "last_date": str(part.observed_date.iloc[-1].date())}
    metadata = {
        "schema_version": 1, "model_version": version,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "model_type": "IsolationForest", "features": FEATURES, "units": UNITS,
        "calibration_id": calibration_id, "threshold": threshold,
        "threshold_quantile": 0.95, "threshold_comparison": ">",
        "score_direction": "larger_is_more_unusual", "score_function": "-score_samples",
        "supported_domain_policy": "Score alerts first; otherwise unknown outside observed training ranges.",
        "dataset_sha256": source_hash, "dataset_records": len(frame), "split": split,
        "provenance": "Client-confirmed healthy plants; one snapshot per day; historical plant IDs unknown.",
        "training_ranges": ranges,
        "versions": {"python": platform.python_version(), "scikit_learn": sklearn.__version__,
                     "numpy": np.__version__, "pandas": pd.__version__, "joblib": joblib.__version__},
        "evaluation": metrics,
        "scope": "Sensor novelty monitoring, not validated plant-health classification.",
    }
    bundle = {"model": model, "metadata": metadata}
    artifact = output / "baseline.joblib"
    joblib.dump(bundle, artifact, compress=3)
    metadata["artifact_sha256"] = hashlib.sha256(artifact.read_bytes()).hexdigest()
    (output / "metadata.json").write_text(json.dumps(metadata, indent=2) + "\n")
    records = frame.copy()
    records["partition"] = ["training"] * len(train) + ["calibration"] * len(calibration) + ["test"] * len(test)
    records["anomaly_score"] = -model.score_samples(frame[FEATURES])
    records["flagged_for_inspection"] = records["anomaly_score"] > threshold
    outside = np.zeros(len(records), dtype=bool)
    for name in FEATURES:
        outside |= ~records[name].between(ranges[name]["min"], ranges[name]["max"]).to_numpy()
    records["assessment_status"] = np.where(records.flagged_for_inspection, "ATTENTION", np.where(outside, "UNKNOWN", "OK"))
    records.to_csv(output / "evaluation_records.csv", index=False)
    frame.to_csv(output / "healthy_sensor_data.csv", index=False)
    (output / "requirements.txt").write_text(
        f"scikit-learn=={sklearn.__version__}\nnumpy=={np.__version__}\n"
        f"pandas=={pd.__version__}\njoblib=={joblib.__version__}\n"
    )
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fig, axes = plt.subplots(1, 2, figsize=(16, 6), dpi=180)
    for name, color in [("calibration", "#4C78A8"), ("test", "#54A24B")]:
        part = records[records.partition == name]
        axes[0].hist(part.anomaly_score, bins=15, alpha=0.55, label=name.title(), color=color)
    axes[0].axvline(threshold, color="#E45756", linestyle="--", label="Calibration threshold")
    axes[0].set(title="Healthy Baseline — Score Distribution", xlabel="Anomaly score", ylabel="Records")
    evaluated = records[records.partition != "training"]
    axes[1].plot(evaluated.observed_date, evaluated.anomaly_score, color="#4C78A8", linewidth=1)
    flagged = evaluated[evaluated.flagged_for_inspection]
    axes[1].scatter(flagged.observed_date, flagged.anomaly_score, color="#E45756", label="Flagged healthy records")
    axes[1].axhline(threshold, color="black", linestyle="--", label="Calibration threshold")
    axes[1].set(title="Scores on Later Healthy Observations", xlabel="Observation date", ylabel="Anomaly score")
    axes[1].tick_params(axis="x", rotation=30)
    for axis in axes:
        axis.legend(fontsize=9)
        axis.grid(alpha=0.2)
    fig.tight_layout()
    fig.savefig(output / "baseline_evaluation.png", dpi=300, bbox_inches="tight")
    fig.savefig(output / "baseline_evaluation.pdf", bbox_inches="tight")
    plt.close(fig)
    return metadata


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dataset", type=Path)
    parser.add_argument("--output", type=Path, default=Path("models/plant_condition"))
    parser.add_argument("--calibration-id", default=CALIBRATION_ID)
    parser.add_argument("--confirmed-healthy", action="store_true", required=True,
                        help="Confirm these are healthy observations, not unlabeled mixed-health data.")
    args = parser.parse_args()
    result = train_export(args.dataset, args.output, args.calibration_id)
    print(json.dumps({"model_version": result["model_version"], "evaluation": result["evaluation"]}, indent=2))


if __name__ == "__main__":
    main()
