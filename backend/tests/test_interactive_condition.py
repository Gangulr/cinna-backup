"""Interactive evaluations and partial shared readings, with no live Firebase writes."""
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from uuid import uuid4

from fastapi import FastAPI, Header, HTTPException
from fastapi.testclient import TestClient
from google.api_core.exceptions import ServiceUnavailable
import requests

from plant_condition.api import create_router
from plant_condition.live import fetch_live, normalize_live, sensor_timestamp
from plant_condition.model import BaselineModel
from plant_condition.schemas import ConditionCheck
from plant_condition.interactive import check_condition
from plant_condition.store import ConditionStore
from tests.test_plant_condition import Database, transactional

NOW = datetime(2026, 10, 11, 12, tzinfo=timezone.utc)
ARTIFACT = Path(__file__).resolve().parents[1] / "models" / "plant_condition"


def payload(**changes):
    return {"request_id": str(uuid4()), "plant_id": "P-001", "temperature": 27.6,
            "humidity": 69.9, "moisture": 49.25, **changes}


def reading(when=NOW, **changes):
    return {"timestamp": when.isoformat(), "temperature": 27.6, "humidity": 69.9,
            "moisture": 49.25, **changes}


class InteractiveConditionTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(os.environ, {"IOT_SENSOR_TIMEZONE": "Asia/Colombo", "IOT_STALE_AFTER_SECONDS": "900"})
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.transactions = patch("plant_condition.store.firestore.transactional", transactional)
        self.transactions.start()
        self.addCleanup(self.transactions.stop)
        self.database = Database()
        self.store = ConditionStore(self.database)
        self.baseline = BaselineModel(ARTIFACT)
        self.assertIsNone(self.baseline.error)
        self.service = SimpleNamespace(store=self.store, baseline=self.baseline, shadow=True)

        def current_user(authorization: str | None = Header(None)):
            if not authorization:
                raise HTTPException(401, "Sign in")
            uid = authorization.removeprefix("Bearer ")
            return {"uid": uid, "role": "admin" if uid == "admin" else "user", "fullName": uid}

        app = FastAPI()
        app.include_router(create_router(self.service, current_user, current_user))
        self.client = TestClient(app)
        self.headers = {"Authorization": "Bearer alice"}

    def test_legacy_and_explicit_timestamps(self):
        self.assertEqual(sensor_timestamp("2026-8-31 12:3"), datetime(2026, 8, 31, 6, 33, tzinfo=timezone.utc))
        self.assertEqual(sensor_timestamp("2026-10-11T17:30:00+05:30"), NOW)
        self.assertEqual(sensor_timestamp(NOW.timestamp()), NOW)
        self.assertEqual(sensor_timestamp(int(NOW.timestamp() * 1000)), NOW)
        for bad in [None, True, float("nan"), "2026-99-31 12:3"]:
            with self.assertRaises((ValueError, TypeError)):
                sensor_timestamp(bad)

    def test_latest_partial_record_is_selected_without_mixing(self):
        newest = reading(NOW, moisture=None)
        older = reading(NOW - timedelta(days=1), temperature=25)
        selected = normalize_live({"esp32": {"sensor_data": {"z-new": newest, "a-old": older}}}, NOW)
        self.assertEqual(selected["source_record_id"], "z-new")
        self.assertEqual(selected["temperature"], newest["temperature"])
        self.assertIsNone(selected["moisture"])
        self.assertEqual(selected["missing_fields"], ["moisture"])
        self.assertNotIn("error", selected)

    def test_single_record_layouts_and_zero_are_supported(self):
        point = reading(moisture=0, humidity=0, temperature=0)
        for source in [point, [point], {"sensor_data": point}, {"esp32": point}, {"esp32": {"sensor_data": [point]}}]:
            selected = normalize_live(source, NOW)
            self.assertEqual([selected[k] for k in ["temperature", "humidity", "moisture"]], [0, 0, 0])
            self.assertEqual(selected["missing_fields"], [])

    def test_invalid_values_are_missing_not_zero(self):
        selected = normalize_live(reading(temperature=True, humidity="NaN", moisture=101), NOW)
        self.assertEqual(selected["missing_fields"], ["temperature", "humidity", "moisture"])
        self.assertTrue(all(selected[k] is None for k in selected["missing_fields"]))

    def test_ambiguous_ordering_is_not_guessed(self):
        for source in [[reading(), reading(timestamp="invalid")], [reading(), reading(moisture=48)], {"devices": {"ESP-1": reading()}}]:
            with self.assertRaises(ValueError):
                normalize_live(source, NOW)
        single = normalize_live(reading(timestamp="invalid"), NOW)
        self.assertEqual(single["freshness"], "unknown")
        self.assertIsNone(single["observed_at"])

    def test_fetch_passes_token_without_exposing_failure_details(self):
        with patch("plant_condition.live.requests.get") as get:
            get.return_value.json.return_value = reading()
            response = fetch_live("https://sensor.example", "private-token")
            self.assertNotIn("error", response)
            self.assertEqual(get.call_args.kwargs["params"], {"auth": "private-token"})
            get.side_effect = requests.RequestException("https://sensor.example/.json?auth=private-token")
            failure = fetch_live("https://sensor.example", "private-token")
            self.assertNotIn("private-token", failure["error"])

    def test_check_runs_without_registered_plants_even_in_shadow_mode(self):
        response = self.client.post("/plant-condition-check", json=payload(), headers=self.headers)
        self.assertEqual(response.status_code, 200)
        result = response.json()
        self.assertEqual(result["status"], self.baseline.assess(result)["status"])
        self.assertEqual(result["assessment_mode"], "interactive_baseline")
        self.assertEqual(result["freshness"], "manual")
        self.assertTrue(result["database_saved"])
        self.assertIsNone(result["health_prediction"])
        self.assertFalse(result["device_assignment_verified"])
        self.assertEqual(set(name for name, _ in self.database.values), {"plant_condition_checks"})

    def test_old_mixed_readings_keep_their_sensor_time(self):
        snapshot = normalize_live(reading(NOW - timedelta(days=40), moisture=None), NOW)
        body = ConditionCheck(**payload(live_snapshot=snapshot, input_origins={"temperature": "iot", "humidity": "iot", "moisture": "manual"}))
        result = check_condition(self.service, body, {"uid": "alice"}, NOW)
        self.assertEqual(result["input_mode"], "mixed")
        self.assertEqual(result["freshness"], "stale")
        self.assertEqual(result["observed_at"], snapshot["observed_at"])
        self.assertEqual(result["source_age_seconds"], 40 * 86400)
        self.assertIn("older sensor snapshot", result["assessment_scope"])
        self.assertEqual(result["live_snapshot"], snapshot)
        body.input_origins.temperature = body.input_origins.humidity = "manual"
        body.request_id = uuid4()
        manual = check_condition(self.service, body, {"uid": "alice"}, NOW)
        self.assertEqual(manual["freshness"], "manual")
        self.assertIsNone(manual["observed_at"])
        self.assertEqual(manual["live_snapshot"], snapshot)

    def test_unknown_and_future_sensor_times_are_labelled(self):
        for timestamp, expected in [(None, "unknown"), (NOW + timedelta(hours=1), "future")]:
            point = reading(timestamp=timestamp.isoformat() if timestamp else None)
            snapshot = normalize_live(point, NOW)
            body = ConditionCheck(**payload(live_snapshot=snapshot, input_origins={"temperature": "iot"}))
            result = check_condition(self.service, body, {"uid": "alice"}, NOW)
            self.assertEqual(result["freshness"], expected)
            self.assertIn("unverified", result["assessment_scope"])

    def test_account_scoped_history_including_administrators(self):
        for uid in ["alice", "bob", "admin"]:
            for plant_id in ["P-001", "P-002"]:
                self.client.post("/plant-condition-check", json=payload(plant_id=plant_id), headers={"Authorization": f"Bearer {uid}"})
        for uid in ["alice", "bob", "admin"]:
            headers = {"Authorization": f"Bearer {uid}"}
            rows = self.client.get("/plant-condition-history?plant_id=P-001", headers=headers).json()
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]["user_id"], uid)
            self.assertEqual(len(self.client.get("/plant-condition-history?limit=1", headers=headers).json()), 1)

    def test_duplicate_submission_is_idempotent_and_conflicts_are_explicit(self):
        body = payload()
        first = self.client.post("/plant-condition-check", json=body, headers=self.headers).json()
        second = self.client.post("/plant-condition-check", json=body, headers=self.headers).json()
        self.assertEqual(first, second)
        conflict = self.client.post("/plant-condition-check", json={**body, "moisture": 51}, headers=self.headers)
        self.assertEqual(conflict.status_code, 409)
        self.assertEqual(len(self.database.values), 1)

    def test_save_failure_retains_calculated_result(self):
        with patch.object(self.store, "save_check", side_effect=ServiceUnavailable("private details")):
            result = self.client.post("/plant-condition-check", json=payload(), headers=self.headers).json()
        self.assertFalse(result["database_saved"])
        self.assertIsNone(result["record_id"])
        self.assertEqual(result["status"], self.baseline.assess(result)["status"])
        self.assertNotIn("private details", json.dumps(result))

    def test_unavailable_history_returns_503(self):
        with patch.object(self.store, "check_history", side_effect=ServiceUnavailable("private details")):
            response = self.client.get("/plant-condition-history", headers=self.headers)
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("private details", response.text)

    def test_authentication_and_input_validation(self):
        self.assertEqual(self.client.post("/plant-condition-check", json=payload()).status_code, 401)
        self.assertEqual(self.client.get("/plant-condition-history").status_code, 401)
        for changes in [{"plant_id": " "}, {"temperature": True}, {"moisture": ""}, {"humidity": None},
                        {"temperature": -51}, {"humidity": 101}, {"user_id": "bob"},
                        {"input_origins": {"temperature": "iot"}}]:
            self.assertEqual(self.client.post("/plant-condition-check", json=payload(**changes), headers=self.headers).status_code, 422, changes)
        raw = json.dumps(payload(moisture=float("nan")))
        self.assertEqual(self.client.post("/plant-condition-check", content=raw, headers={**self.headers, "Content-Type": "application/json"}).status_code, 422)
        snapshot = normalize_live(reading(), NOW)
        mismatch = payload(temperature=28, live_snapshot=snapshot, input_origins={"temperature": "iot"})
        self.assertEqual(self.client.post("/plant-condition-check", json=mismatch, headers=self.headers).status_code, 422)

    def test_unavailable_model_and_unsupported_values_are_not_ok(self):
        zero = self.client.post("/plant-condition-check", json=payload(moisture=0), headers=self.headers).json()
        self.assertEqual(zero["status"], "UNKNOWN")
        self.baseline.model = None
        result = self.client.post("/plant-condition-check", json=payload(), headers=self.headers).json()
        self.assertEqual(result["status"], "UNKNOWN")
        self.assertIsNone(result["anomaly_score"])
        self.assertTrue(result["database_saved"])


if __name__ == "__main__":
    unittest.main()
