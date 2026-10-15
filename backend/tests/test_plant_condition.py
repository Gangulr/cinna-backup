"""Meaningful sensor/model/ownership tests without Firebase, email or relay I/O."""
from __future__ import annotations

import copy
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.testclient import TestClient
from google.api_core.exceptions import ServiceUnavailable
import joblib
import numpy as np
import pandas as pd

from plant_condition.api import create_router
from plant_condition.model import BaselineModel
from plant_condition.sensors import SensorSource, latest_record, normalize, utc_timestamp
from plant_condition.service import ConditionService
from plant_condition.store import ConditionStore
from plant_condition.training import FEATURES, load_dataset
from plant_condition.worker import run_cycle

ARTIFACT = Path(__file__).resolve().parents[1] / "models" / "plant_condition"
NOW = datetime(2026, 10, 11, 12, tzinfo=timezone.utc)


class Snapshot:
    def __init__(self, reference, value):
        self.reference, self.id = reference, reference.id
        self.exists = value is not None
        self.value = copy.deepcopy(value)
    def to_dict(self):
        return copy.deepcopy(self.value)


class Reference:
    def __init__(self, database, collection, identity):
        self.database, self.collection, self.id = database, collection, identity
    @property
    def key(self):
        return self.collection, self.id
    def get(self, transaction=None):
        return Snapshot(self, self.database.values.get(self.key))
    def set(self, value):
        self.database.values[self.key] = copy.deepcopy(value)
    def update(self, changes):
        self.database.values[self.key].update(copy.deepcopy(changes))


class Query:
    def __init__(self, database, name, filters=(), order=None, count=None):
        self.database, self.name, self.filters, self.order, self.count = database, name, filters, order, count
    def document(self, identity=None):
        if identity is None:
            self.database.counter += 1
            identity = f"observation-{self.database.counter}"
        return Reference(self.database, self.name, identity)
    def where(self, *, filter):
        return Query(self.database, self.name, (*self.filters, filter), self.order, self.count)
    def order_by(self, field, direction=None):
        return Query(self.database, self.name, self.filters, field, self.count)
    def limit(self, count):
        return Query(self.database, self.name, self.filters, self.order, count)
    def stream(self):
        records = [Snapshot(self.document(identity), value) for (name, identity), value in self.database.values.items()
                   if name == self.name and all(value.get(f.field_path) == f.value for f in self.filters)]
        if self.order:
            records.sort(key=lambda record: record.value[self.order], reverse=True)
        return records[:self.count] if self.count else records


class Transaction:
    def __init__(self, database):
        self.database, self.operations = database, []
    def set(self, reference, value):
        self.operations.append(("set", reference, copy.deepcopy(value)))
    def delete(self, reference):
        self.operations.append(("delete", reference, None))


class Database:
    def __init__(self):
        self.values, self.counter, self.lock = {}, 0, threading.RLock()
    def collection(self, name):
        return Query(self, name)
    def transaction(self):
        return Transaction(self)


def transactional(function):
    def wrapped(transaction):
        with transaction.database.lock:
            result = function(transaction)
            for action, reference, value in transaction.operations:
                if action == "set":
                    reference.set(value)
                else:
                    transaction.database.values.pop(reference.key, None)
            return result
    return wrapped


class Source:
    def __init__(self):
        self.records = {}
    def read(self, plant):
        return self.records[plant["device_id"]]


def registration(plant_id="P-1", device_id="ESP-1", owner_id="alice", **extra):
    return {"plant_id": plant_id, "device_id": device_id, "owner_id": owner_id,
            "calibration_id": "client-moisture-percent-v1", "expected_interval_seconds": 300,
            "source_kind": "device", "active": True, **extra}


def reading(timestamp=NOW, **extra):
    return {"timestamp": timestamp.isoformat(), "temperature": 27.6, "humidity": 69.9,
            "moisture": 49.25, **extra}


class PlantConditionTests(unittest.TestCase):
    def setUp(self):
        self.database = Database()
        for name in ["alice", "bob", "admin", "reviewer"]:
            self.database.collection("users").document(name).set({"role": "user"})
        self.transactions = patch("plant_condition.store.firestore.transactional", transactional)
        self.transactions.start()
        self.addCleanup(self.transactions.stop)
        self.store = ConditionStore(self.database)
        self.source = Source()
        self.baseline = BaselineModel(ARTIFACT)
        self.assertIsNone(self.baseline.error)
        self.service = ConditionService(self.store, self.source, self.baseline, shadow=False)

    def add(self, **values):
        return self.store.register(registration(**values), "admin")

    def client(self):
        async def current(x_actor: str = Header(default="alice")):
            if x_actor == "anonymous":
                raise HTTPException(401, "Sign in required.")
            return {"uid": x_actor, "role": "admin" if x_actor in ["admin", "reviewer"] else "user"}
        async def admin(user=Depends(current)):
            if user["role"] != "admin":
                raise HTTPException(403, "Administrator access required.")
            return user
        app = FastAPI()
        app.include_router(create_router(self.service, current, admin))
        return TestClient(app)

    def test_chronological_partitions_and_no_refit(self):
        metadata = self.baseline.metadata
        records = pd.read_csv(ARTIFACT / "evaluation_records.csv")
        self.assertEqual(records.partition.value_counts().to_dict(), {"training": 164, "calibration": 55, "test": 55})
        self.assertEqual(self.baseline.model.max_samples_, 164)
        dates = pd.to_datetime(records.observed_date)
        self.assertTrue(dates.is_monotonic_increasing)
        self.assertLess(dates.iloc[163], dates.iloc[164])
        self.assertLess(dates.iloc[218], dates.iloc[219])
        calibration_scores = records.loc[records.partition == "calibration", "anomaly_score"]
        self.assertAlmostEqual(metadata["threshold"], np.quantile(calibration_scores, .95))
        test = records[records.partition == "test"]
        self.assertEqual(metadata["evaluation"]["false_alert_count"], int((test.anomaly_score > metadata["threshold"]).sum()))
        self.assertNotIn("accuracy", metadata["evaluation"])

    def test_excel_headers_and_excel_serial_dates(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "data.xlsx"
            pd.DataFrame({"Date ": list(range(46023, 46048)), "Temprature": [27] * 25,
                          "Huminidity": [70] * 25, "Soill moisture": [50] * 25}).to_excel(path, index=False)
            frame = load_dataset(path)
        self.assertEqual(frame.columns.tolist(), ["observed_date"] + FEATURES)
        self.assertEqual(str(frame.observed_date.iloc[0].date()), "2026-01-01")

    def test_roundtrip_scores_and_feature_order(self):
        original = joblib.load(ARTIFACT / "baseline.joblib")["model"]
        features = pd.DataFrame([{name: reading()[name] for name in FEATURES}])
        np.testing.assert_array_equal(original.score_samples(features), self.baseline.model.score_samples(features))
        self.assertEqual(self.baseline.model.feature_names_in_.tolist(), FEATURES)
        result = self.baseline.assess(reading())
        self.assertAlmostEqual(result["anomaly_score"], float(-original.score_samples(features)[0]))

    def test_exact_threshold_boundary_and_direction(self):
        threshold = self.baseline.metadata["threshold"]
        with patch.object(self.baseline.model, "score_samples", return_value=np.array([-threshold])):
            self.assertEqual(self.baseline.assess(reading())["status"], "OK")
        with patch.object(self.baseline.model, "score_samples", return_value=np.array([-threshold - .01])):
            self.assertEqual(self.baseline.assess(reading())["status"], "ATTENTION")

    def test_extreme_values_cannot_be_reported_as_matching_the_baseline(self):
        for values in [{"moisture": 0}, {"temperature": 50}, {"humidity": 0}]:
            with self.subTest(values=values):
                self.assertNotEqual(self.baseline.assess(reading(**values))["status"], "OK")

    def test_missing_or_corrupt_model_is_unavailable(self):
        with tempfile.TemporaryDirectory() as folder:
            baseline = BaselineModel(Path(folder))
            self.assertIsNotNone(baseline.error)
            self.assertEqual(baseline.assess(reading())["status"], "UNKNOWN")
            metadata = copy.deepcopy(self.baseline.metadata)
            (Path(folder) / "metadata.json").write_text(json.dumps(metadata))
            (Path(folder) / "baseline.joblib").write_bytes(b"corrupt")
            self.assertIn("fingerprint", BaselineModel(Path(folder)).error)

    def test_zero_aliases_and_source_timestamp_selection(self):
        plant = self.add()
        payload = {"new": reading(NOW, temperature=0, humidity=0, moisture=0),
                   "old": reading(NOW - timedelta(seconds=100))}
        normalized = normalize(payload, plant, NOW)
        self.assertEqual([normalized[k] for k in FEATURES], [0, 0, 0])
        self.assertEqual(normalized["source_record_id"], "new")
        self.assertEqual(utc_timestamp(0), datetime(1970, 1, 1, tzinfo=timezone.utc))
        self.assertEqual(utc_timestamp(NOW.timestamp() * 1000), NOW)

    def test_legacy_dates_use_local_timezone_and_latest_timestamp(self):
        plant = self.add(source_kind="legacy")
        payload = {"latest": {**reading(), "timestamp": "2026-10-11 17:30"},
                   "older": {**reading(), "timestamp": "2026-10-11 17:29"}}
        with patch.dict("os.environ", {"IOT_SENSOR_TIMEZONE": "Asia/Colombo"}):
            normalized = normalize(payload, plant, NOW)
        self.assertEqual(normalized["source_record_id"], "latest")
        self.assertEqual(utc_timestamp(normalized["observed_at"]), NOW)
        with self.assertRaises(ValueError):
            normalize(payload, {**plant, "source_kind": "device"}, NOW)

    def test_unpadded_legacy_dates_remain_stale_and_invalid_dates_fail(self):
        plant = self.add(source_kind="legacy")
        point = {**reading(), "timestamp": "2026-8-31 12:4"}
        with patch.dict("os.environ", {"IOT_SENSOR_TIMEZONE": "Asia/Colombo"}):
            normalized = normalize(point, plant, NOW)
            self.assertEqual(normalized["observed_at"], "2026-08-31T06:34:00+00:00")
            self.source.records = {plant["device_id"]: point}
            result = self.service.process(plant, NOW)
            self.assertEqual(result["status"], "UNKNOWN")
            self.assertIn("stale", result["reason"])
            self.assertEqual(result["reading"]["observed_at"], normalized["observed_at"])
            with self.assertRaises(ValueError):
                normalize([point, {**point, "timestamp": "2026-99-31 12:4"}], plant, NOW)

    def test_invalid_missing_nonfinite_and_future_values(self):
        plant = self.add()
        cases = [reading(temperature=float("nan")), reading(humidity=101), reading(moisture=None),
                 reading(timestamp=NOW + timedelta(seconds=61)), {"temperature": 27},
                 reading(timestamp=NOW, device_id="OTHER"), reading(calibration_id="other-scale"),
                 reading(timestamp=NOW, plant_id="P-OTHER"), reading(temperature=True)]
        for payload in cases:
            with self.subTest(payload=payload), self.assertRaises((ValueError, TypeError)):
                normalize(payload, plant, NOW)
        with self.assertRaises(ValueError):
            latest_record({"dated": reading(), "undated": {"temperature": 28}})
        with self.assertRaises(ValueError):
            utc_timestamp("2026-10-11 12:00:00")

    def test_stale_reading_and_calibration_mismatch(self):
        plant = self.add()
        self.source.records["ESP-1"] = reading(NOW - timedelta(seconds=901))
        self.assertEqual(self.service.process(plant, NOW)["status"], "UNKNOWN")
        self.assertEqual(len(self.store.history("P-1")), 0)
        self.source.records["ESP-1"] = reading()
        plant = self.store.register(registration(calibration_id="different"), "admin")
        self.assertIn("calibration", self.service.process(plant, NOW)["reason"])

    def test_two_plants_are_isolated_and_repeats_do_not_duplicate(self):
        first = self.add()
        second = self.add(plant_id="P-2", device_id="ESP-2", owner_id="bob")
        self.source.records = {"ESP-1": reading(), "ESP-2": reading(moisture=0)}
        for _ in range(2):
            self.service.process(first, NOW)
            self.service.process(second, NOW)
        self.assertEqual(len(self.store.history("P-1")), 1)
        self.assertEqual(len(self.store.history("P-2")), 1)
        self.assertNotEqual(self.store.latest("P-1")["reading"]["moisture"], self.store.latest("P-2")["reading"]["moisture"])
        with patch("plant_condition.service.datetime") as clock:
            clock.now.return_value = NOW
            self.assertEqual(run_cycle(self.service), 2)
        self.assertEqual(len(self.store.history("P-1")), 1)

    def test_device_assignment_and_legacy_stream_uniqueness(self):
        self.add(source_kind="legacy")
        with self.assertRaises(HTTPException) as conflict:
            self.add(plant_id="P-2", device_id="ESP-1")
        self.assertEqual(conflict.exception.status_code, 409)
        with self.assertRaises(HTTPException):
            self.add(plant_id="P-2", device_id="ESP-2", source_kind="legacy")
        with self.assertRaises(HTTPException):
            self.store.register(registration(owner_id="bob"), "admin")

    def test_concurrent_assignment_only_one_wins(self):
        def attempt(identity):
            try:
                self.add(plant_id=identity)
                return True
            except HTTPException:
                return False
        with ThreadPoolExecutor(max_workers=2) as pool:
            self.assertEqual(sum(pool.map(attempt, ["P-1", "P-2"])), 1)

    def test_deactivated_old_assignment_cannot_delete_new_device_owner(self):
        self.add()
        self.store.register(registration(active=False), "admin")
        self.add(plant_id="P-2", owner_id="bob")
        self.store.register(registration(device_id="ESP-NEW"), "admin")
        self.assertEqual(self.database.values[("plant_devices", "ESP-1")]["plant_id"], "P-2")

    def test_assignment_change_invalidates_latest_and_inflight_old_worker(self):
        old = self.add()
        self.source.records["ESP-1"] = reading()
        assessment = self.service.process(old, NOW)
        new = self.store.register(registration(device_id="ESP-2"), "admin")
        self.assertIsNone(self.store.latest("P-1"))
        self.assertFalse(self.store.persist(old, assessment))
        self.assertEqual(self.service.current(new, NOW)["status"], "UNKNOWN")

    def test_reads_do_not_write_and_recheck_recency(self):
        plant = self.add()
        self.source.records["ESP-1"] = reading()
        self.service.process(plant, NOW)
        before = copy.deepcopy(self.database.values)
        self.assertEqual(self.service.current(plant, NOW + timedelta(seconds=901))["status"], "UNKNOWN")
        self.assertEqual(before, self.database.values)

    def test_shadow_does_not_display_candidate_as_health(self):
        plant = self.add()
        self.service.shadow = True
        self.source.records["ESP-1"] = reading()
        result = self.service.process(plant, NOW)
        self.assertEqual(result["status"], "UNKNOWN")
        self.assertIn(result["candidate_status"], ["OK", "ATTENTION"])
        self.assertIsNone(result["health_prediction"])

    def test_authenticated_api_ownership_admin_and_storage_failure(self):
        self.add()
        self.add(plant_id="P-2", device_id="ESP-2", owner_id="bob")
        client = self.client()
        self.assertEqual([p["plant_id"] for p in client.get("/plants").json()], ["P-1"])
        self.assertEqual(client.get("/plants", headers={"X-Actor": "anonymous"}).status_code, 401)
        self.assertEqual(client.get("/plants/P-2/condition").status_code, 403)
        self.assertEqual(client.get("/plants/P-2/condition-history").status_code, 403)
        self.assertEqual(client.post("/admin/plants", json=registration()).status_code, 403)
        self.assertEqual(client.post("/admin/plants", json=registration(), headers={"X-Actor": "admin"}).status_code, 200)
        with patch.object(self.store, "latest", side_effect=ServiceUnavailable("offline")):
            self.assertEqual(client.get("/plants/P-1/condition").status_code, 503)

    def test_observations_are_unlabeled_until_independent_review(self):
        self.add()
        client = self.client()
        result = client.post("/plants/P-1/health-observations", json={
            "inspected_at": "2026-01-01T12:00:00Z", "reported_label": "unhealthy", "symptoms": "Observed wilting",
        })
        self.assertEqual(result.status_code, 200)
        record = result.json()
        self.assertIsNone(record["training_label"])
        self.assertEqual(record["review_status"], "pending")
        response = client.post(f"/admin/plants/P-1/health-observations/{record['observation_id']}/review",
                               headers={"X-Actor": "admin"}, json={"confirmed_label": "unhealthy", "review_notes": "Independent inspection."})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["training_label"], 1)
        self.assertFalse(response.json()["eligible_for_training"])
        unknown = client.post(f"/admin/plants/P-1/health-observations/{record['observation_id']}/review",
                              headers={"X-Actor": "reviewer"}, json={"confirmed_label": "unknown", "review_notes": "Evidence insufficient."})
        self.assertIsNone(unknown.json()["training_label"])

    def test_inspection_pairing_preserves_values_and_blocks_other_plant_or_future_reading(self):
        plant = self.add()
        old_time = datetime(2026, 1, 1, tzinfo=timezone.utc)
        self.source.records["ESP-1"] = reading(old_time)
        self.service.process(plant, old_time)
        assessment = self.store.latest("P-1")
        client = self.client()
        body = {"inspected_at": "2026-01-01T01:00:00Z", "assessment_id": assessment["assessment_id"], "reported_label": "healthy"}
        result = client.post("/plants/P-1/health-observations", json=body)
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()["sensor_reading"]["temperature"], 27.6)
        self.assertEqual(result.json()["sensor_to_inspection_seconds"], 3600)
        body["inspected_at"] = "2025-12-31T23:00:00Z"
        self.assertEqual(client.post("/plants/P-1/health-observations", json=body).status_code, 422)
        self.add(plant_id="P-2", device_id="ESP-2")
        self.assertEqual(client.post("/plants/P-2/health-observations", json=body).status_code, 422)

    def test_sensor_source_uses_device_scoped_paths(self):
        source = SensorSource("https://example.invalid", "token")
        with patch("plant_condition.sensors.requests.get") as get:
            source.read(registration())
            self.assertEqual(get.call_args.args[0], "https://example.invalid/devices/ESP-1/readings.json")
            self.assertEqual(get.call_args.kwargs["params"], {"auth": "token"})
            source.read(registration(source_kind="legacy"))
            self.assertEqual(get.call_args.args[0], "https://example.invalid/.json")

    def test_legacy_source_unwraps_supported_single_device_layouts(self):
        source = SensorSource("https://example.invalid")
        point = reading()
        with patch("plant_condition.sensors.requests.get") as get:
            for payload in [point, {"sensor_data": point}, {"esp32": point}, {"esp32": {"sensor_data": point}}]:
                get.return_value.json.return_value = payload
                self.assertEqual(source.read(registration(source_kind="legacy")), point)
            get.return_value.json.return_value = {"devices": {"OTHER": {"readings": point}}}
            with self.assertRaises(ValueError):
                source.read(registration(source_kind="legacy"))

    def test_health_labels_require_pairing_and_an_independent_reviewer(self):
        plant = self.add()
        recorded = datetime(2026, 1, 1, tzinfo=timezone.utc)
        self.source.records["ESP-1"] = reading(recorded)
        self.service.process(plant, recorded)
        assessment = self.store.latest("P-1")
        client = self.client()
        observation = client.post("/plants/P-1/health-observations", json={
            "inspected_at": "2026-01-01T01:00:00Z", "assessment_id": assessment["assessment_id"],
            "reported_label": "healthy",
        }, headers={"X-Actor": "admin"}).json()
        path = f"/admin/plants/P-1/health-observations/{observation['observation_id']}/review"
        body = {"confirmed_label": "healthy", "review_notes": "Independent observation checked."}
        self.assertEqual(client.post(path, json=body, headers={"X-Actor": "admin"}).status_code, 409)
        result = client.post(path, json=body, headers={"X-Actor": "reviewer"})
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()["training_label"], 0)
        self.assertTrue(result.json()["eligible_for_training"])

    def test_model_version_mismatch_is_unavailable(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)
            metadata = copy.deepcopy(self.baseline.metadata)
            metadata["versions"]["scikit_learn"] = "0.0.0"
            (path / "metadata.json").write_text(json.dumps(metadata))
            (path / "baseline.joblib").write_bytes((ARTIFACT / "baseline.joblib").read_bytes())
            result = BaselineModel(path)
            self.assertIsNone(result.model)
            self.assertIn("scikit-learn version", result.error)

    def test_source_failure_preserves_history_and_clears_current_assessment(self):
        plant = self.add()
        self.source.records["ESP-1"] = reading()
        self.service.process(plant, NOW)
        with patch.object(self.source, "read", side_effect=RuntimeError("credential-bearing URL must not be exposed")):
            result = self.service.process(plant, NOW)
        self.assertEqual(result["status"], "UNKNOWN")
        self.assertNotIn("credential", result["reason"])
        self.assertEqual(len(self.store.history("P-1")), 1)
        self.assertEqual(self.store.latest("P-1")["status"], "UNKNOWN")

    def test_separate_colab_notebook_embeds_the_offline_training_implementation(self):
        root = Path(__file__).resolve().parents[1]
        notebook = json.loads((root / "notebooks/Plant_Condition_Baseline_Training_Colab.ipynb").read_text())
        source = (root / "plant_condition/training.py").read_text().split("\ndef main()")[0]
        cells = ["".join(cell["source"]) for cell in notebook["cells"] if cell["cell_type"] == "code"]
        self.assertIn(source, cells)
        for code in cells:
            if not code.startswith("%pip"):
                compile(code, "colab_cell", "exec")
        self.assertTrue(all(not cell.get("outputs") for cell in notebook["cells"]))


if __name__ == "__main__":
    unittest.main()
