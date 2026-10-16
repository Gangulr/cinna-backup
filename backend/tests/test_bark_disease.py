"""Bark API/model integration without live Firebase, training or external services."""
import ast
from copy import deepcopy
import hashlib
import io
import json
from pathlib import Path
import tempfile
import threading
import shutil
from types import SimpleNamespace
from typing import Any, Dict
import unittest
from unittest.mock import patch

from fastapi import FastAPI, Header, HTTPException
from fastapi.testclient import TestClient
import numpy as np
from PIL import Image

from bark_disease.api import COLLECTION, MAX_UPLOAD_BYTES, create_router
from bark_disease.model import BarkModel


BACKEND = Path(__file__).resolve().parents[1]
PACKAGE = BACKEND / "models/bark_condition"


def fixture_runtime(filename):
    namespace = {}
    exec(compile((PACKAGE / filename).read_text(), filename, "exec"), namespace)
    return SimpleNamespace(**namespace)


def image_bytes(format="PNG", mode="RGB"):
    buffer = io.BytesIO()
    Image.new(mode, (24, 32), 128).save(buffer, format=format)
    return buffer.getvalue()


class MemoryDatabase:
    def __init__(self):
        self.values = {}
        self.fail = False

    def collection(self, name):
        def document():
            identity = str(len(self.values) + 1)
            def save(data):
                if self.fail:
                    raise RuntimeError("Storage unavailable")
                self.values[name, identity] = deepcopy(data)
            return SimpleNamespace(id=identity, set=save)
        def stream():
            return [SimpleNamespace(id=identity, to_dict=lambda value=value: deepcopy(value))
                    for (collection, identity), value in self.values.items() if collection == name]
        return SimpleNamespace(document=document, stream=stream)


def storage_helpers(database):
    tree = ast.parse((BACKEND / "main.py").read_text())
    nodes = [node for node in tree.body if isinstance(node, ast.FunctionDef)
             and node.name in {"save_to_firebase", "get_user_history"}]
    namespace = {"db": database, "Dict": Dict, "Any": Any, "HTTPException": HTTPException}
    exec(compile(ast.Module(body=nodes, type_ignores=[]), "main-storage-helpers", "exec"), namespace)
    return namespace["save_to_firebase"], namespace["get_user_history"]


class ModelDouble:
    predict = BarkModel.predict  # Exercise the real decoding/validation and locking path.

    def __init__(self):
        self.ready = True
        self.metadata = json.loads((PACKAGE / "metadata.json").read_text())
        self.lock = threading.Lock()
        self.preprocessing = fixture_runtime("preprocessing.py")
        self.runtime = fixture_runtime("bark_rejection.py")
        self.distance = 0.07837926960655242
        self.scores = [0.99, 0.01]

    def _predict_batch(self, batch):
        assert batch.shape == (1, 224, 224, 3)
        assert batch.dtype == np.float32
        assert batch.max() > 1  # No unintended external /255.
        return self.runtime.assess_prediction(
            self.scores, self.distance, self.metadata["input_rejection"], self.metadata["decision_policy"])


class BarkApiTests(unittest.TestCase):
    def setUp(self):
        self.database = MemoryDatabase()
        self.model = ModelDouble()
        save, history = storage_helpers(self.database)
        def auth(authorization: str | None = Header(None)):
            if authorization not in {"Bearer alice", "Bearer bob", "Bearer admin"}:
                raise HTTPException(401, "Sign in")
            uid = authorization.split()[1]
            return {"uid": uid, "email": uid + "@example.test", "fullName": uid,
                    "role": "admin" if uid == "admin" else "user"}
        app = FastAPI()
        app.include_router(create_router(self.model, auth, save, history))
        self.client = TestClient(app)

    def post(self, uid="alice", data=None, mime="image/png", filename="bark.png", path="/bark-disease-predict/"):
        return self.client.post(path, headers={"Authorization": "Bearer " + uid},
                                files={"file": (filename, image_bytes() if data is None else data, mime)})

    def test_authenticated_experimental_result_is_saved_without_images(self):
        response = self.post(filename="C:\\fakepath\\bark.png")
        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()
        self.assertEqual(result["status"], "experimental_candidate")
        self.assertEqual(result["display_prediction"], "Rough Bark")
        self.assertFalse(result["input_relevance_verified"])
        self.assertIsNone(result["is_cinnamon"])
        self.assertTrue(result["review_recommended"])
        self.assertTrue(result["database_saved"])
        self.assertEqual(result["uploaded_filename"], "bark.png")
        self.assertEqual(result["top_predictions"][0]["class"], "RoughBark")
        stored = self.database.values[COLLECTION, result["record_id"]]
        self.assertEqual(stored["user_id"], "alice")
        self.assertEqual(stored["assessment_mode"], "reference_only_experimental")
        self.assertNotIn("image_bytes", stored)
        self.assertNotIn("embeddings", stored)
        json.dumps(stored, allow_nan=False)

    def test_history_users_are_isolated_and_admin_receives_both(self):
        for uid in ["alice", "bob"]:
            self.assertEqual(self.post(uid).status_code, 200)
        for uid, expected in [("alice", {"alice"}), ("bob", {"bob"}), ("admin", {"alice", "bob"})]:
            response = self.client.get("/bark-disease-history/", headers={"Authorization": "Bearer " + uid})
            self.assertEqual(response.status_code, 200)
            self.assertEqual({r["user_id"] for r in response.json()}, expected)
        self.assertEqual({name for name, _ in self.database.values}, {COLLECTION})

    def test_both_disease_candidates_have_grouped_guidance_without_changing_status(self):
        for scores, label in [([0.99, 0.01], "Rough Bark"), ([0.01, 0.99], "Stripe Canker")]:
            self.model.scores = scores
            result = self.post().json()
            self.assertEqual(result["status"], "experimental_candidate")
            self.assertTrue(result["solutions"])
            self.assertTrue(result["prevention"])
            self.assertIn(label, " ".join(result["solutions"]))
            self.assertEqual(result["recommendations"], result["solutions"] + result["prevention"])
            self.assertIn("requires review", result["message"])

    def test_auth_required_for_both_endpoints(self):
        for path in ["/bark-disease-predict/", "/bark-disease-history/"]:
            response = (self.client.post(path, files={"file": ("a.png", image_bytes(), "image/png")})
                        if "predict" in path else self.client.get(path))
            self.assertEqual(response.status_code, 401)
        self.assertEqual(self.post(uid="forged").status_code, 401)
        self.assertFalse(self.database.values)

    def test_outside_reference_is_uncertain_without_class_scores(self):
        self.model.distance = 0.8581709362910835
        result = self.post().json()
        self.assertEqual(result["status"], "uncertain")
        self.assertEqual(result["reason"], "outside_known_disease_bark_reference")
        self.assertIsNone(result["display_prediction"])
        self.assertIsNone(result["candidate_class"])
        self.assertIsNone(result["confidence_score"])
        self.assertEqual(result["top_predictions"], [])
        self.assertFalse(result["disease_classification_performed"])
        self.assertTrue(result["database_saved"])
        self.assertTrue(result["solutions"])
        self.assertEqual(result["prevention"], [])
        self.assertFalse(any(label in " ".join(result["solutions"]) for label in ["Rough Bark", "Stripe Canker"]))

    def test_insufficient_evidence_preserves_scores_but_no_prediction(self):
        self.model.metadata["decision_policy"]["acceptance_enabled"] = False
        result = self.post().json()
        self.assertEqual(result["status"], "uncertain")
        self.assertIsNone(result["prediction"])
        self.assertEqual(result["candidate_class"], "RoughBark")
        self.assertTrue(result["disease_classification_performed"])

    def test_bad_uploads_return_400_and_are_not_stored(self):
        for data, mime in [(b"", "image/png"), (b"garbage", "image/jpeg"),
                           (b"text", "text/plain"), (image_bytes("GIF"), "image/png")]:
            self.assertEqual(self.post(data=data, mime=mime).status_code, 400)
        self.assertFalse(self.database.values)

    def test_oversized_upload_returns_413(self):
        self.assertEqual(self.post(data=b"x" * (MAX_UPLOAD_BYTES + 1)).status_code, 413)
        self.assertFalse(self.database.values)

    def test_unavailable_model_returns_503(self):
        self.model.ready = False
        self.assertEqual(self.post().status_code, 503)
        self.assertFalse(self.database.values)

    def test_save_failure_preserves_completed_analysis(self):
        self.database.fail = True
        result = self.post().json()
        self.assertEqual(result["status"], "experimental_candidate")
        self.assertFalse(result["database_saved"])
        self.assertIsNone(result["record_id"])

    def test_jpeg_webp_and_grayscale_preprocessing(self):
        for format, mime, mode in [("JPEG", "image/jpeg", "RGB"), ("WEBP", "image/webp", "RGB"), ("PNG", "image/png", "L")]:
            self.assertEqual(self.post(data=image_bytes(format, mode), mime=mime).status_code, 200)
        self.assertEqual(self.post(path="/bark-disease-predict").status_code, 200)


class RealBarkPackageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.model = BarkModel(PACKAGE)

    def test_package_load_and_all_eight_fixture_decisions(self):
        self.assertTrue(self.model.ready, self.model.error)
        self.assertEqual(self.model.parity_images, 8)
        fixture = PACKAGE / "parity_fixtures/images/00_RoughBark_IMG_E4864.JPG"
        result = self.model.predict(fixture.read_bytes())
        self.assertEqual(result["status"], "experimental_candidate")
        self.assertEqual(result["prediction"], "RoughBark")
        self.assertFalse(result["input_relevance_verified"])
        self.assertIsNone(result["is_cinnamon"])

    def test_actual_model_api_roundtrip_without_live_database(self):
        database = MemoryDatabase()
        save, history = storage_helpers(database)
        app = FastAPI()
        app.include_router(create_router(self.model, lambda: {"uid": "fixture-user"}, save, history))
        client = TestClient(app)
        fixture = PACKAGE / "parity_fixtures/images/04_StripeCanker_IMG_1549.JPG"
        response = client.post("/bark-disease-predict/", files={"file": (fixture.name, fixture.read_bytes(), "image/jpeg")})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["prediction"], "StripeCanker")
        self.assertTrue(response.json()["database_saved"])
        records = client.get("/bark-disease-history/").json()
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["model_sha256"], self.model.metadata["artifact_sha256"])

    def test_missing_package_isolated_failure(self):
        with tempfile.TemporaryDirectory() as temp, self.assertLogs("bark_disease.model", level="ERROR"):
            invalid = BarkModel(Path(temp))
        self.assertFalse(invalid.ready)
        self.assertIsNotNone(invalid.error)

    def test_corrupt_artifact_cannot_load(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp) / "package"
            shutil.copytree(PACKAGE, folder)
            (folder / "bark_condition_model.keras").write_bytes(b"corrupt")
            with self.assertLogs("bark_disease.model", level="ERROR"):
                invalid = BarkModel(folder)
            self.assertFalse(invalid.ready)
            self.assertIn("checksum mismatch", invalid.error)

    def test_failed_keras_export_is_not_approved_even_with_valid_hashes(self):
        original_json = self.model._json
        with patch.object(BarkModel, "_verify_checksums", lambda model: setattr(model, "checksums", self.model.checksums)), \
             patch.object(BarkModel, "_json", lambda model, name: (
                 {**self.model.metadata, "export_parity": {"keras_passed": False}}
                 if name == "metadata.json" else original_json(name))), \
             self.assertLogs("bark_disease.model", level="ERROR"):
            invalid = BarkModel(PACKAGE)
        self.assertFalse(invalid.ready)
        self.assertIn("contract mismatch", invalid.error)

    def test_model_bytes_unchanged(self):
        for filename, digest in self.model.checksums.items():
            self.assertEqual(hashlib.sha256((PACKAGE / filename).read_bytes()).hexdigest(), digest)


if __name__ == "__main__":
    unittest.main()
