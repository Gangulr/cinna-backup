"""Normalize plant-scoped RTDB readings without guessing identity or recency."""
from __future__ import annotations

import hashlib
import math
from datetime import datetime, timezone
from urllib.parse import quote

import requests

ALIASES = {
    "temperature": ["temperature", "Temperature"],
    "humidity": ["humidity", "Humidity"],
    "moisture": ["moisture", "Moisture", "soil_moisture", "Soil_Moisture", "soilMoisture"],
}


def utc_timestamp(value) -> datetime:
    if isinstance(value, bool):
        raise ValueError("Invalid source timestamp.")
    if isinstance(value, (int, float)):
        value = float(value)
        if not math.isfinite(value):
            raise ValueError("Invalid source timestamp.")
        return datetime.fromtimestamp(value / 1000 if abs(value) > 1e11 else value, timezone.utc)
    if not isinstance(value, str) or not value.strip():
        raise ValueError("A source timestamp is required.")
    parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("Source timestamps must include a timezone or use Unix time.")
    return parsed.astimezone(timezone.utc)


def pick(record: dict, names: list[str]):
    for name in names:
        if name in record and record[name] is not None:
            return record[name]
    return None


def candidates(payload, prefix="", depth=0) -> list[tuple[str, dict]]:
    if depth > 5:
        return []
    if isinstance(payload, dict):
        sensor_keys = [key for names in ALIASES.values() for key in names]
        if any(key in payload for key in sensor_keys):
            return [(prefix, payload)]
        result = []
        for key, value in payload.items():
            result.extend(candidates(value, f"{prefix}/{key}", depth + 1))
        return result
    if isinstance(payload, list):
        return [item for i, value in enumerate(payload)
                for item in candidates(value, f"{prefix}/{i}", depth + 1)]
    return []


def latest_record(payload, timestamp_parser=utc_timestamp) -> tuple[str, dict]:
    records = candidates(payload)
    if not records:
        raise ValueError("No sensor reading is available for this device.")
    dated = []
    for key, record in records:
        try:
            dated.append((timestamp_parser(pick(record, ["timestamp", "observed_at"])), key, record))
        except (ValueError, TypeError, OverflowError, OSError, KeyError):
            # A reading of unknown recency must not be silently replaced with an older valid reading.
            raise ValueError("A sensor record has a missing or invalid source timestamp.")
    _, key, record = max(dated, key=lambda item: (item[0], item[1]))
    return key, record


def normalize(payload, plant: dict, now: datetime) -> dict:
    timestamp_parser = utc_timestamp
    if plant.get("source_kind") == "legacy":
        # Resolve after module initialization: live imports our aliases and helpers.
        from .live import sensor_timestamp
        timestamp_parser = sensor_timestamp
    key, record = latest_record(payload, timestamp_parser)
    device = record.get("device_id")
    if device is not None and device != plant["device_id"]:
        raise ValueError("The reading device does not match the assigned device.")
    embedded_plant = record.get("plant_id")
    if embedded_plant is not None and embedded_plant != plant["plant_id"]:
        raise ValueError("The reading plant does not match the registered plant.")
    observed = timestamp_parser(pick(record, ["timestamp", "observed_at"]))
    if (observed - now).total_seconds() > 60:
        raise ValueError("The source timestamp is in the future.")
    values = {}
    for name, aliases in ALIASES.items():
        raw = pick(record, aliases)
        if raw is None or isinstance(raw, bool):
            raise ValueError(f"A valid {name} reading is required.")
        value = float(raw)
        if not math.isfinite(value):
            raise ValueError(f"The {name} reading must be finite.")
        lower, upper = (-50, 100) if name == "temperature" else (0, 100)
        if not lower <= value <= upper:
            raise ValueError(f"The {name} reading is outside its sensor input range.")
        values[name] = value
    supplied_calibration = record.get("calibration_id", plant["calibration_id"])
    if supplied_calibration != plant["calibration_id"]:
        raise ValueError("The reading calibration differs from the device registration.")
    observed_at = observed.isoformat()
    source_id = str(record.get("reading_id") or key.strip("/") or observed_at)
    identity = hashlib.sha256(f"{plant['device_id']}|{source_id}|{observed_at}".encode()).hexdigest()
    battery = record.get("battery")
    if battery is not None:
        try:
            battery = float(battery)
            if not math.isfinite(battery) or not 0 <= battery <= 100:
                battery = None
        except (ValueError, TypeError):
            battery = None
    return {**values, "observed_at": observed_at, "source_record_id": source_id,
            "reading_id": identity, "device_id": plant["device_id"], "plant_id": plant["plant_id"],
            "calibration_id": supplied_calibration, "battery": battery,
            "source": "Firebase RTDB - ESP32"}


class SensorSource:
    def __init__(self, url: str, token: str = ""):
        self.url = url.rstrip("/")
        self.token = token

    def read(self, plant: dict):
        if plant["source_kind"] == "legacy":
            path = "/"
        else:
            path = f"/devices/{quote(plant['device_id'], safe='')}/readings"
        response = requests.get(f"{self.url}{path}.json", timeout=10,
                                params={"auth": self.token} if self.token else None)
        response.raise_for_status()
        payload = response.json()
        if plant["source_kind"] == "legacy" and isinstance(payload, dict):
            if "esp32" in payload:
                payload = payload["esp32"]
            elif "devices" in payload:
                raise ValueError("No single-device legacy stream is present. Register a dedicated device feed.")
            if isinstance(payload, dict):
                payload = payload.get("sensor_data", payload)
        return payload
