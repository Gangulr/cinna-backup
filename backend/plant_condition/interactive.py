"""User-attributed baseline checks; no device assignment or health label is inferred."""
from datetime import datetime, timezone
import hashlib
import json

from fastapi import HTTPException

from .live import age_information
from .care import care_details


def check_condition(service, body, user, now=None):
    now = now or datetime.now(timezone.utc)
    submitted = body.model_dump(mode="json")
    features = {name: submitted[name] for name in ("temperature", "humidity", "moisture")}
    origins = submitted["input_origins"]
    iot_fields = [name for name, origin in origins.items() if origin == "iot"]
    snapshot = submitted["live_snapshot"]
    age = age_information(snapshot["observed_at"], now) if iot_fields else {
        "observed_at": None, "age_seconds": None, "freshness": "manual", "stale_after_seconds": None}
    scope = ("Assessment of an older sensor snapshot" if age["freshness"] == "stale" else
             "Assessment of manually entered readings" if not iot_fields else
             "Assessment of readings with an unverified measurement time" if age["freshness"] in ("unknown", "future") else
             "Assessment of the submitted sensor readings")
    warnings = []
    if age["freshness"] == "stale":
        warnings.append("Older IoT readings remain in this check; this is not an assessment of current plant conditions.")
    elif age["freshness"] in ("unknown", "future"):
        warnings.append("The IoT measurement time cannot establish current conditions.")
    if any(origin == "manual" for origin in origins.values()):
        warnings.append("Manual entries have no verified sensor measurement time.")
    try:
        evaluation = service.baseline.assess(features)
    except Exception:
        evaluation = {"status": "UNKNOWN", "reason": "The sensor assessment model is unavailable.",
                      "anomaly_score": None, "threshold": None, "model_version": None}
    record = {**submitted, **evaluation, "user_id": user["uid"],
              "user_name": user.get("fullName", ""), "user_email": user.get("email", ""),
              "assessed_at": now.isoformat(), "observed_at": age["observed_at"],
              "source_age_seconds": age["age_seconds"], "freshness": age["freshness"],
              "assessment_scope": scope, "warnings": warnings,
              "input_mode": "iot" if len(iot_fields) == 3 else "mixed" if iot_fields else "manual",
              "assessment_mode": "interactive_baseline", "health_prediction": None,
              "source_metadata_verification": "user-submitted", "device_assignment_verified": False,
              "request_fingerprint": hashlib.sha256(json.dumps(submitted, sort_keys=True).encode()).hexdigest()}
    record.update(care_details(record, service.baseline))
    try:
        saved = service.store.save_check(record)
        return {**saved, "database_saved": True}
    except HTTPException:
        raise
    except Exception:
        return {**record, "record_id": None, "database_saved": False,
                "save_message": "Result not saved. Condition history storage is unavailable."}
