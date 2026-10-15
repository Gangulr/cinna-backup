"""Application service shared by the API and the independent worker."""
from __future__ import annotations

from datetime import datetime, timezone

from .sensors import normalize, utc_timestamp


class ConditionService:
    def __init__(self, store, source, baseline, shadow=True):
        self.store, self.source, self.baseline, self.shadow = store, source, baseline, shadow

    def unknown(self, plant, reason, now=None, reading=None):
        now = now or datetime.now(timezone.utc)
        return {"plant_id": plant["plant_id"], "device_id": plant["device_id"],
                "owner_id": plant["owner_id"], "status": "UNKNOWN", "reason": reason,
                "assessed_at": now.isoformat(), "observed_at": (reading or {}).get("observed_at"),
                "reading": reading, "anomaly_score": None, "threshold": None,
                "model_version": None, "assessment_mode": "shadow" if self.shadow else "monitor",
                "health_prediction": None}

    def validate_recency(self, plant, reading, now):
        observed = utc_timestamp(reading["observed_at"])
        age = (now - observed).total_seconds()
        if age < -60:
            raise ValueError("The source timestamp is in the future.")
        if age > plant["expected_interval_seconds"] * 3:
            raise ValueError("Sensor data are stale. Waiting for a new reading.")

    def process(self, plant, now=None):
        now = now or datetime.now(timezone.utc)
        reading = None
        try:
            reading = normalize(self.source.read(plant), plant, now)
            self.validate_recency(plant, reading, now)
            if self.baseline.model is None:
                raise ValueError("The sensor assessment model is unavailable.")
            if reading["calibration_id"] != self.baseline.metadata["calibration_id"]:
                raise ValueError("The device calibration does not match the training baseline.")
            result = self.baseline.assess(reading)
            assessment = {**result, "plant_id": plant["plant_id"], "device_id": plant["device_id"],
                          "owner_id": plant["owner_id"], "observed_at": reading["observed_at"],
                          "assessed_at": now.isoformat(), "reading": reading,
                          "reading_id": reading["reading_id"], "source_record_id": reading["source_record_id"],
                          "assessment_mode": "shadow" if self.shadow else "monitor", "health_prediction": None}
            if self.shadow:
                assessment["candidate_status"] = assessment["status"]
                assessment["status"] = "UNKNOWN"
                assessment["reason"] = "Baseline observations are being checked. Plant condition is not yet assessed."
            self.store.persist(plant, assessment)
            return assessment
        except Exception as exc:
            # HTTP/network exceptions can contain credential-bearing URLs; never return them to users.
            reason = str(exc) if isinstance(exc, (ValueError, TypeError)) else "Unable to read or store this plant's sensor data."
            assessment = self.unknown(plant, reason, now, reading)
            self.store.unavailable(plant, assessment)
            return assessment

    def current(self, plant, now=None):
        now = now or datetime.now(timezone.utc)
        if not plant["active"]:
            return self.unknown(plant, "This plant's device assignment is inactive.", now)
        if self.baseline.model is None:
            return self.unknown(plant, "The sensor assessment model is unavailable.", now)
        record = self.store.latest(plant["plant_id"])
        if not record:
            return self.unknown(plant, "Waiting for the sensor worker's first assessment.", now)
        if record.get("assignment_version", 1) != plant.get("assignment_version", 1):
            return self.unknown(plant, "Waiting for readings from the new device assignment.", now)
        if not record.get("reading"):
            return record
        try:
            self.validate_recency(plant, record["reading"], now)
            if record["reading"].get("calibration_id") != self.baseline.metadata["calibration_id"]:
                raise ValueError("The device calibration does not match the training baseline.")
            if record.get("model_version") and record["model_version"] != self.baseline.metadata["model_version"]:
                raise ValueError("Waiting for assessment with the current baseline model.")
        except ValueError as exc:
            return self.unknown(plant, str(exc), now, record["reading"])
        if self.shadow and record["status"] != "UNKNOWN":
            return self.unknown(plant, "Baseline observations are being checked. Plant condition is not yet assessed.", now, record["reading"])
        return record
