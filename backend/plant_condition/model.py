"""Load a trusted offline artifact and score sensor snapshots without fitting."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import sklearn

from .training import FEATURES, UNITS


class BaselineModel:
    def __init__(self, directory: Path):
        self.model = None
        self.metadata = {}
        self.error = None
        try:
            metadata = json.loads((directory / "metadata.json").read_text())
            artifact = directory / "baseline.joblib"
            if hashlib.sha256(artifact.read_bytes()).hexdigest() != metadata["artifact_sha256"]:
                raise ValueError("Baseline artifact fingerprint does not match metadata.")
            if metadata["features"] != FEATURES or metadata["units"] != UNITS:
                raise ValueError("Baseline feature order or units do not match the sensor service.")
            if metadata["versions"]["scikit_learn"] != sklearn.__version__:
                raise ValueError("Install the scikit-learn version in the artifact requirements.txt.")
            if metadata["score_function"] != "-score_samples" or metadata["threshold_comparison"] != ">":
                raise ValueError("Unsupported score convention.")
            if not np.isfinite(metadata["threshold"]):
                raise ValueError("Invalid calibration threshold.")
            # Only locally provisioned, trusted artifacts may be loaded: joblib is not an upload format.
            bundle = joblib.load(artifact)
            if any(bundle["metadata"].get(key) != value for key, value in metadata.items()
                   if key != "artifact_sha256"):
                raise ValueError("Model and threshold metadata differ.")
            self.model = bundle["model"]
            self.metadata = metadata
        except Exception as exc:
            self.error = str(exc)

    def assess(self, reading: dict) -> dict:
        if self.model is None:
            return {"status": "UNKNOWN", "reason": "The sensor assessment model is unavailable.",
                    "anomaly_score": None, "threshold": None, "model_version": None}
        frame = pd.DataFrame([{name: reading[name] for name in FEATURES}], columns=FEATURES)
        score = float(-self.model.score_samples(frame)[0])
        threshold = self.metadata["threshold"]
        unusual = score > threshold
        outside = []
        for name in FEATURES:
            value = float(reading[name])
            limits = self.metadata["training_ranges"][name]
            if value < limits["min"]:
                outside.append(f"{name.replace('_', ' ')} is below the observed training baseline")
            elif value > limits["max"]:
                outside.append(f"{name.replace('_', ' ')} is above the observed training baseline")
        reason = ("; ".join(outside).capitalize() + ". These are observed ranges, not agronomic limits."
                  if outside and unusual else "This combination of sensor readings differs from the healthy baseline."
                  if unusual else "Sensor readings are consistent with the supplied healthy baseline.")
        status = "ATTENTION" if unusual else "OK"
        if outside and not unusual:
            status = "UNKNOWN"
            reason = ("; ".join(outside).capitalize() +
                      ". This baseline cannot assess that reading reliably. These are observed ranges, not agronomic limits.")
        return {"status": status, "reason": reason,
                "anomaly_score": score, "threshold": threshold,
                "model_version": self.metadata["model_version"],
                "outside_training_range": bool(outside)}
