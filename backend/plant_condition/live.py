"""Shared-feed snapshots for editable, on-demand evaluations (no plant registry)."""
from datetime import datetime, timezone
import math
import os
import re
from zoneinfo import ZoneInfo

import requests

from .sensors import ALIASES, candidates, pick


def sensor_timestamp(value):
    """Legacy device dates are local; explicit offsets and Unix times are retained."""
    if isinstance(value, bool) or value is None:
        raise ValueError("A sensor timestamp is required.")
    if isinstance(value, (int, float)):
        if not math.isfinite(value):
            raise ValueError("Invalid sensor timestamp.")
        return datetime.fromtimestamp(value / 1000 if abs(value) > 1e11 else value, timezone.utc)
    if not isinstance(value, str) or not value.strip():
        raise ValueError("A sensor timestamp is required.")
    text = value.strip()
    if re.fullmatch(r"\d{10,13}(?:\.\d+)?", text):
        return sensor_timestamp(float(text))
    # The existing firmware also emits dates such as '2026-8-31 12:3'.
    match = re.fullmatch(
        r"(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{1,2})"
        r"(?::(\d{1,2})(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?", text)
    if match:
        year, month, day, hour, minute, second, fraction, offset = match.groups()
        text = (f"{year}-{int(month):02d}-{int(day):02d}T{int(hour):02d}:{int(minute):02d}:"
                f"{int(second or 0):02d}{fraction or ''}{offset or ''}")
    parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=ZoneInfo(os.getenv("IOT_SENSOR_TIMEZONE", "Asia/Colombo")))
    return parsed.astimezone(timezone.utc)


def age_information(observed_at, now=None):
    now = now or datetime.now(timezone.utc)
    try:
        observed = sensor_timestamp(observed_at)
        age = (now - observed).total_seconds()
        threshold = float(os.getenv("IOT_STALE_AFTER_SECONDS", "900"))
        if not math.isfinite(threshold) or threshold <= 0:
            raise ValueError("Invalid freshness setting.")
        freshness = "future" if age < -60 else "stale" if age > threshold else "fresh"
        return {"observed_at": observed.isoformat(), "age_seconds": round(age, 1),
                "freshness": freshness, "stale_after_seconds": threshold}
    except (ValueError, TypeError, OverflowError, OSError, KeyError):
        return {"observed_at": None, "age_seconds": None, "freshness": "unknown",
                "stale_after_seconds": None}


def sensor_number(value, name):
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(value)
        lower, upper = (-50, 100) if name == "temperature" else (0, 100)
        return number if math.isfinite(number) and lower <= number <= upper else None
    except (ValueError, TypeError, OverflowError):
        return None


def normalize_live(payload, now=None):
    now = now or datetime.now(timezone.utc)
    if isinstance(payload, dict):
        if "esp32" in payload:
            payload = payload["esp32"]
        elif "devices" in payload:
            raise ValueError("The shared feed contains multiple devices. Select a single ESP32 stream for this workflow.")
        if isinstance(payload, dict):
            payload = payload.get("sensor_data", payload)
    records = candidates(payload)
    if not records:
        raise ValueError("No sensor values were found. You can enter readings manually.")
    if len(records) == 1:
        key, record = records[0]
    else:
        try:
            dated = [(sensor_timestamp(pick(record, ["timestamp", "observed_at"])), key, record)
                     for key, record in records]
        except (ValueError, TypeError, OverflowError, OSError, KeyError):
            raise ValueError("Cannot identify the latest reading: a sensor record has an invalid or missing timestamp.") from None
        latest = max(item[0] for item in dated)
        tied = [item for item in dated if item[0] == latest]
        if len(tied) > 1 and any(item[2] != tied[0][2] for item in tied[1:]):
            raise ValueError("Cannot identify the latest reading: different records have the same timestamp.")
        _, key, record = tied[0]
    values = {name: sensor_number(pick(record, aliases), name) for name, aliases in ALIASES.items()}
    missing = [name for name, value in values.items() if value is None]
    raw_time = pick(record, ["timestamp", "observed_at"])
    age = age_information(raw_time, now)
    warnings = [f"{'Soil moisture' if name == 'moisture' else name.capitalize()} unavailable—enter a measured value."
                for name in missing]
    if age["freshness"] != "fresh":
        warnings.append({"stale": "This is an older sensor snapshot.",
                         "unknown": "The sensor measurement time is unavailable or invalid.",
                         "future": "The sensor timestamp is in the future; check the device clock."}[age["freshness"]])
    return {**values, **age, "battery": sensor_number(record.get("battery"), "battery"),
            "timestamp": str(raw_time) if raw_time is not None else "",
            "fetched_at": now.isoformat(), "source": "Firebase RTDB - ESP32",
            "source_record_id": str(record.get("reading_id") or key.strip("/") or "single-reading"),
            "missing_fields": missing, "warnings": warnings}


def fetch_live(url, token=""):
    try:
        response = requests.get(f"{url.rstrip('/')}/.json", timeout=10,
                                params={"auth": token} if token else None)
        response.raise_for_status()
        return normalize_live(response.json())
    except requests.RequestException:
        return {"error": "Unable to fetch the sensor database. You can enter readings manually."}
    except (ValueError, TypeError, OverflowError, OSError, KeyError) as exc:
        return {"error": str(exc) if isinstance(exc, ValueError) else "Invalid sensor response. Enter readings manually."}
