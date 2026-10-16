"""Check the notebook's exported NumPy rejection policy without downloading data."""

import ast
import contextlib
import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

import numpy as np
import pandas as pd
from PIL import Image


NOTEBOOK = Path(__file__).resolve().parents[1] / "notebooks/Bark_Disease_Model_Training_Colab.ipynb"


class BarkNotebookRejectionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.notebook = json.loads(NOTEBOOK.read_text())
        cls.cells = {
            c["metadata"]["cinnaai_cell_number"]: "".join(c["source"])
            for c in cls.notebook["cells"] if c["cell_type"] == "code"
        }
        tree = ast.parse(cls.cells["44B"])
        runtime = next(node.value.value for node in tree.body if isinstance(node, ast.Assign))
        cls.runtime = {}
        exec(compile(runtime, "bark_rejection.py", "exec"), cls.runtime)

    def policy(self, **changes):
        result = {
            "inference_mode": "staged_relevance",
            "distance_threshold": 0.1, "negative_validation_targets_met": True,
            "negative_validation_images": 20, "allow_positive_only_disease_results": False,
            "k": 1,
        }
        result.update(changes)
        return result

    def assess(self, probabilities, distance, domain=None, enabled=True, relevance=None):
        return self.runtime["assess_prediction"](
            probabilities, distance, domain or self.policy(),
            {"acceptance_enabled": enabled, "confidence_threshold": 0.8, "margin_threshold": 0.4},
            relevance or {"status": "passed", "reason": "relevance_accepted", "score": 0.99},
        )

    def test_high_softmax_score_cannot_override_reference_rejection(self):
        result = self.assess([0.001, 0.999], 0.9)
        self.assertEqual(result["status"], "uncertain")
        self.assertEqual(result["reason"], "outside_known_disease_bark_reference")
        self.assertIsNone(result["prediction"])
        self.assertIsNone(result["candidate_class"])
        self.assertIsNone(result["confidence_score"])
        self.assertIsNone(result["confidence_margin"])
        self.assertEqual(result["top_predictions"], [])
        self.assertFalse(result["disease_classification_performed"])
        self.assertIsNone(result["is_cinnamon"])

    def test_rejected_image_never_calls_disease_head(self):
        def fail_if_called(features):
            self.fail("Rejected input reached the disease head")
        result = self.runtime["predict_with_domain_gate"](
            np.zeros((1, 2)), fail_if_called, fail_if_called,
            np.array([[1.0, 0.0]]), self.policy(),
            {"acceptance_enabled": True, "confidence_threshold": 0.8, "margin_threshold": 0.4},
            lambda batch: [[0.01]], {"available": True, "rejection_enabled": True,
                                    "reject_threshold": 0.1, "acceptance_enabled": True, "accept_threshold": 0.9},
        )
        self.assertEqual(result["status"], "rejected")

    def test_reference_pass_calls_head_once_with_existing_features(self):
        calls = []
        def head(features):
            calls.append(np.asarray(features))
            return np.array([[0.01, 0.99]])
        result = self.runtime["predict_with_domain_gate"](
            np.zeros((1, 2)), lambda batch: np.array([[1.0, 0.0]]), head,
            np.array([[1.0, 0.0]]), self.policy(),
            {"acceptance_enabled": True, "confidence_threshold": 0.8, "margin_threshold": 0.4},
            lambda batch: [[0.99]], {"available": True, "rejection_enabled": True,
                                    "reject_threshold": 0.1, "acceptance_enabled": True, "accept_threshold": 0.9},
        )
        self.assertEqual(len(calls), 1)
        np.testing.assert_array_equal(calls[0], [[1.0, 0.0]])
        self.assertEqual(result["prediction"], "StripeCanker")
        self.assertTrue(result["disease_classification_performed"])

    def display_result(self, result):
        namespace = {"uploaded": {}, "json": json}
        with contextlib.redirect_stdout(io.StringIO()):
            exec(self.cells[97], namespace)
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            namespace["display_bark_prediction"](result)
        return output.getvalue()

    def test_manual_display_distinguishes_rejected_and_hides_disease_scores(self):
        text = self.display_result(self.assess([0.001, 0.999], 0.9, relevance={
            "status": "rejected", "reason": "image_not_relevant", "score": 0.01}))
        self.assertIn("IMAGE REJECTED", text)
        self.assertIn("No disease classification was performed", text)
        self.assertNotIn("UNCERTAIN", text)
        self.assertNotIn("CLASS SCORES", text)
        self.assertNotIn("StripeCanker", text)

    def test_manual_display_handles_uncertainty_disease_and_invalid_files(self):
        self.assertIn("UNCERTAIN", self.display_result(self.assess([0.49, 0.51], 0.01)))
        self.assertIn("SUPPORTED DISEASE CANDIDATE: StripeCanker",
                      self.display_result(self.assess([0.01, 0.99], 0.01)))
        self.assertIn("could not be decoded", self.display_result({
            "status": "rejected", "reason": "invalid_or_unsupported_image",
        }))

    def test_drive_backup_copies_full_verified_package_and_detects_stale_files(self):
        tree = ast.parse(self.cells["94A"])
        helper = next(node.value.value for node in tree.body if isinstance(node, ast.Assign))
        backup = {}
        exec(helper, backup)
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "handoff"
            source.mkdir()
            for relative in backup["REQUIRED_BACKUP_FILES"]:
                path = source / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b"fixture asset")
            (source / "metadata.json").write_text(json.dumps({"prediction_runtime": {
                "domain_first": True, "separate_relevance_gate": False,
                "response_schema": "bark-prediction-v5", "inference_mode": "reference_only_experimental"}}))
            (source / "relevance_policy.json").write_text(json.dumps({"available": False}))
            policy = {"inference_mode": "reference_only_experimental", "model_sha256": {
                name: hashlib.sha256((source / name).read_bytes()).hexdigest()
                for name in ["bark_condition_model.keras", "bark_condition_model.h5"]},
                "reference_sha256": hashlib.sha256((source / "ood_reference.npz").read_bytes()).hexdigest()}
            (source / "ood_policy.json").write_text(json.dumps(policy))
            lines = [f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.relative_to(source).as_posix()}"
                     for path in sorted(source.rglob("*")) if path.is_file()]
            (source / "checksums.sha256").write_text("\n".join(lines) + "\n")
            destination, archive = backup["save_bark_handoff_backup"](source, root / "drive")
            self.assertTrue(destination.is_dir())
            self.assertTrue(archive.is_file())
            backup["verify_bark_handoff"](destination / "bark_model_handoff")
            with zipfile.ZipFile(archive) as zipped:
                self.assertIn("ood_reference.npz", zipped.namelist())
                self.assertIsNone(zipped.testzip())
            second, _ = backup["save_bark_handoff_backup"](source, root / "drive")
            self.assertNotEqual(second, destination)
            (source / "ood_reference.npz").write_bytes(b"tampered reference")
            with self.assertRaisesRegex(ValueError, "checksum mismatch"):
                backup["save_bark_handoff_backup"](source, root / "drive")

    def test_in_reference_disease_requires_both_policies(self):
        self.assertEqual(self.assess([0.02, 0.98], 0.02)["prediction"], "StripeCanker")
        self.assertEqual(self.assess([0.49, 0.51], 0.02)["status"], "uncertain")
        self.assertEqual(self.assess([0.02, 0.98], 0.02, enabled=False)["status"], "uncertain")

    def test_missing_negative_validation_is_uncertain_by_default(self):
        result = self.runtime["assess_prediction"]([0.999, 0.001], 0.01, self.policy(),
            {"acceptance_enabled": True, "confidence_threshold": 0.8, "margin_threshold": 0.4})
        self.assertEqual(result["status"], "uncertain")
        self.assertIsNone(result["prediction"])
        self.assertFalse(result["healthy_detection_supported"])

    def test_legacy_positive_only_override_cannot_replace_relevance(self):
        result = self.runtime["assess_prediction"]([0.99, 0.01], 0.01, self.policy(
            negative_validation_targets_met=True, allow_positive_only_disease_results=True),
            {"acceptance_enabled": True, "confidence_threshold": 0.8, "margin_threshold": 0.4})
        self.assertEqual(result["status"], "uncertain")
        self.assertEqual(result["reason"], "relevance_model_unavailable")

    def test_experimental_override_cannot_hide_failed_negative_validation(self):
        result = self.runtime["assess_prediction"]([0.99, 0.01], 0.01, self.policy(
            negative_validation_targets_met=False, negative_validation_images=20,
            allow_positive_only_disease_results=True),
            {"acceptance_enabled": True, "confidence_threshold": 0.8, "margin_threshold": 0.4})
        self.assertEqual(result["status"], "uncertain")

    def test_distance_matches_analytic_geometry_and_chunking(self):
        calculate = self.runtime["mean_knn_cosine_distance"]
        reference = np.array([[1, 0], [0, 1]], dtype=float)
        query = np.array([[5, 0], [0, 7], [-1, 0]], dtype=float)
        np.testing.assert_allclose(calculate(query, reference, k=1, chunk_size=1), [0, 0, 1])
        np.testing.assert_allclose(calculate(query, reference, k=10), [0.5, 0.5, 1.5])
        np.testing.assert_allclose(calculate(query, reference, k=2, chunk_size=1),
                                   calculate(query, reference, k=2, chunk_size=128))

    def test_invalid_embeddings_probabilities_and_distances_fail_closed(self):
        normalize = self.runtime["normalize_embeddings"]
        for values in [np.zeros((1, 2)), np.array([[np.nan, 0]]), np.empty((0, 2))]:
            with self.assertRaises(ValueError):
                normalize(values)
        for probabilities, distance in [([0.2, 0.2], 0.1), ([np.nan, 0], 0.1), ([0.1, 0.9], np.nan)]:
            with self.assertRaises(ValueError):
                self.assess(probabilities, distance)

    def calibrate(self, negatives):
        namespace = {
            **self.runtime, "pd": pd, "json": json,
            "negative_validation_df": pd.DataFrame({"path": [f"negative-{i}" for i in range(len(negatives))]}),
            "collect_embeddings": lambda model, frame: np.asarray(negatives)[:, None],
            "embedding_model": None, "train_embeddings_normalized": np.ones((20, 2)),
            "mean_knn_cosine_distance": lambda query, reference, k: np.asarray(negatives),
            "validation_ood_distances": np.array([0.02, 0.03, 0.04, 0.05, 0.06]),
            "OOD_K": 5, "OOD_POSITIVE_QUANTILE": 0.975,
            "MIN_VALIDATION_BARK_COVERAGE": 0.95, "MAX_VALIDATION_NEGATIVE_PASS_RATE": 0.05,
            "MIN_NEGATIVE_VALIDATION_IMAGES": 20, "ALLOW_POSITIVE_ONLY_DISEASE_RESULTS": False,
            "INFERENCE_MODE": "reference_only_experimental",
        }
        with contextlib.redirect_stdout(io.StringIO()):
            exec(self.cells["44D"], namespace)
        return namespace["OOD_POLICY"]

    def test_separable_negative_calibration_enables_observed_targets(self):
        policy = self.calibrate(np.linspace(0.5, 1.0, 20))
        self.assertTrue(policy["negative_validation_targets_met"])
        self.assertEqual(policy["negative_validation_pass_rate"], 0)
        self.assertEqual(policy["validation_bark_coverage"], 1)

    def test_overlapping_or_insufficient_negatives_do_not_enable_diagnosis(self):
        for negatives in [np.linspace(0.0, 0.01, 20), np.linspace(0.5, 1.0, 19), []]:
            policy = self.calibrate(negatives)
            self.assertFalse(policy["negative_validation_targets_met"])
            self.assertEqual(policy["outside_reference_status"], "uncertain")
        self.assertIsNone(self.calibrate([])["negative_validation_pass_rate"])

    def test_reported_valid_bark_distance_is_uncertain_not_invalid(self):
        result = self.assess([0.01, 0.99], 0.33395084013745446,
                             self.policy(distance_threshold=0.27864599603105356))
        self.assertEqual(result["status"], "uncertain")
        self.assertIsNone(result["prediction"])
        self.assertFalse(result["disease_classification_performed"])
        self.assertIn("does not establish that it is invalid or healthy", self.display_result(result))

    def test_relevance_calibrates_separate_accept_and_reject_regions(self):
        calibrate = self.runtime["calibrate_relevance_policy"]
        policy, _ = calibrate([0] * 20 + [1] * 20,
                              np.concatenate([np.linspace(0.01, 0.1, 20), np.linspace(0.9, 0.99, 20)]))
        self.assertTrue(policy["acceptance_enabled"])
        self.assertTrue(policy["rejection_enabled"])
        self.assertLess(policy["reject_threshold"], policy["accept_threshold"])
        decide = self.runtime["assess_relevance_score"]
        self.assertEqual(decide(0.01, policy)["status"], "rejected")
        self.assertEqual(decide(0.5, policy)["status"], "uncertain")
        self.assertEqual(decide(0.99, policy)["status"], "passed")

    def test_overlapping_or_absent_relevance_data_never_invent_thresholds(self):
        calibrate = self.runtime["calibrate_relevance_policy"]
        policy, _ = calibrate([0] * 20 + [1] * 20, [0.5] * 40)
        self.assertFalse(policy["acceptance_enabled"])
        self.assertFalse(policy["rejection_enabled"])
        self.assertEqual(self.runtime["assess_relevance_score"](0.5, policy)["status"], "uncertain")
        empty, _ = calibrate([], [])
        self.assertFalse(empty["available"])

    def test_missing_relevance_still_skips_disease_head(self):
        def no_head(values):
            self.fail("Unavailable relevance must not reach the disease classifier")
        result = self.runtime["predict_with_domain_gate"](
            [[0]], lambda batch: [[1.0, 0.0]], no_head, [[1.0, 0.0]], self.policy(),
            {"acceptance_enabled": True, "confidence_threshold": 0.8, "margin_threshold": 0.4})
        self.assertEqual(result["status"], "uncertain")
        self.assertEqual(result["reason"], "relevance_model_unavailable")

    def test_reported_bark_reaches_classifier_without_relevance_data(self):
        distance = 0.07837926960655242
        features = np.array([[1 - distance, np.sqrt(1 - (1 - distance) ** 2)]])
        calls = []
        def head(values):
            calls.append(np.asarray(values))
            return [[0.01, 0.99]]
        result = self.runtime["predict_with_domain_gate"](
            [[0]], lambda batch: features, head, [[1.0, 0.0]],
            self.policy(inference_mode="reference_only_experimental",
                        distance_threshold=0.27864599603105356,
                        negative_validation_images=0, negative_validation_targets_met=False),
            {"acceptance_enabled": True, "confidence_threshold": 0.8, "margin_threshold": 0.4})
        self.assertEqual(len(calls), 1)
        np.testing.assert_array_equal(calls[0], features)
        self.assertAlmostEqual(result["domain_distance"], distance)
        self.assertEqual(result["status"], "experimental_candidate")
        self.assertEqual(result["prediction"], "StripeCanker")
        self.assertEqual(len(result["top_predictions"]), 2)
        self.assertTrue(result["disease_classification_performed"])
        self.assertTrue(result["review_recommended"])
        self.assertFalse(result["input_relevance_verified"])
        self.assertFalse(result["unrelated_image_rejection_validated"])
        self.assertEqual(result["relevance_reason"], "relevance_model_unavailable")
        self.assertIsNone(result["is_cinnamon"])
        text = self.display_result(result)
        self.assertIn("EXPERIMENTAL DISEASE CANDIDATE: StripeCanker", text)
        self.assertIn("CLASS SCORES", text)
        self.assertIn("not an accepted diagnosis", text)

    def test_reported_car_still_stops_before_head_without_relevance_data(self):
        distance = 0.8581709362910835
        def no_head(values):
            self.fail("Car outside the reference reached the disease head")
        result = self.runtime["predict_with_domain_gate"](
            [[0]], lambda batch: [[1 - distance, np.sqrt(1 - (1 - distance) ** 2)]],
            no_head, [[1.0, 0.0]],
            self.policy(inference_mode="reference_only_experimental", distance_threshold=0.27864599603105356),
            {"acceptance_enabled": True, "confidence_threshold": 0.8, "margin_threshold": 0.4})
        self.assertEqual(result["reason"], "outside_known_disease_bark_reference")
        self.assertFalse(result["disease_classification_performed"])
        self.assertIsNone(result["prediction"])
        self.assertEqual(result["top_predictions"], [])

    def test_experimental_mode_preserves_disease_confidence_policy(self):
        domain = self.policy(inference_mode="reference_only_experimental")
        unavailable = {"status": "uncertain", "reason": "relevance_model_unavailable", "score": None}
        for scores, enabled in [([0.49, 0.51], True), ([0.01, 0.99], False)]:
            result = self.assess(scores, 0.01, domain=domain, enabled=enabled, relevance=unavailable)
            self.assertEqual(result["status"], "uncertain")
            self.assertEqual(result["reason"], "insufficient_disease_evidence")
            self.assertTrue(result["disease_classification_performed"])
            self.assertIsNotNone(result["candidate_class"])
            self.assertEqual(len(result["top_predictions"]), 2)
            self.assertIsNone(result["prediction"])

    def test_experimental_mode_never_bypasses_trained_relevance_uncertainty_or_rejection(self):
        domain = self.policy(inference_mode="reference_only_experimental")
        for status, reason in [("uncertain", "relevance_unconfirmed_or_calibration_unmet"),
                               ("rejected", "image_not_relevant")]:
            result = self.assess([0.01, 0.99], 0.01, domain=domain,
                relevance={"status": status, "reason": reason, "score": 0.4})
            self.assertEqual(result["status"], status)
            self.assertFalse(result["disease_classification_performed"])
            self.assertIsNone(result["prediction"])

    def test_legacy_packages_remain_strict_and_invalid_mode_fails(self):
        domain = self.policy()
        domain.pop("inference_mode")
        result = self.runtime["assess_prediction"]([0.01, 0.99], 0.01, domain,
            {"acceptance_enabled": True, "confidence_threshold": 0.8, "margin_threshold": 0.4})
        self.assertEqual(result["reason"], "relevance_model_unavailable")
        with self.assertRaisesRegex(ValueError, "Unknown bark inference mode"):
            self.assess([0.01, 0.99], 0.01, domain=self.policy(inference_mode="typo"))

    def test_existing_colab_session_switches_mode_without_disease_retraining(self):
        namespace = {**self.runtime, "best_model": object(), "relevance_model": None,
                     "OOD_POLICY": self.policy(), "RELEVANCE_POLICY": {"available": False}}
        with contextlib.redirect_stdout(io.StringIO()):
            exec(self.cells["44I"], namespace)
        self.assertEqual(namespace["OOD_POLICY"]["inference_mode"], "reference_only_experimental")
        self.assertEqual(namespace["OOD_POLICY"]["schema_version"], 3)

    def test_reference_assets_bind_model_and_detect_tampering(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            model = folder / "bark_condition_model.keras"
            model.write_bytes(b"model fixture")
            reference_path = folder / "ood_reference.npz"
            np.savez_compressed(reference_path, embeddings=np.eye(2), class_ids=[0, 1],
                                image_sha256=np.array(["a" * 64, "b" * 64]))
            policy = {**self.policy(), "reference_images": 2, "embedding_dimension": 2,
                      "model_sha256": {model.name: hashlib.sha256(model.read_bytes()).hexdigest()},
                      "reference_sha256": hashlib.sha256(reference_path.read_bytes()).hexdigest()}
            (folder / "ood_policy.json").write_text(json.dumps(policy))
            load = self.runtime["load_rejection_assets"]
            values, _ = load(folder, model)
            np.testing.assert_array_equal(values, np.eye(2))
            reference_path.write_bytes(b"altered reference")
            with self.assertRaisesRegex(ValueError, "reference checksum"):
                load(folder, model)
            model.write_bytes(b"different model")
            with self.assertRaisesRegex(ValueError, "not bound"):
                load(folder, model)

    def test_negative_manifest_rejects_cross_partition_duplicates(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            for split in ["validation", "test"]:
                (folder / split).mkdir()
                Image.new("RGB", (12, 12), (50, 100, 150)).save(folder / split / "same.png")
            namespace = {
                "Path": Path, "pd": pd, "IMAGE_EXTENSIONS": {".png"},
                "split_manifest": pd.DataFrame(columns=["sha256"]),
                "conflicting_images": pd.DataFrame(columns=["sha256"]),
                "validate_image": lambda path: (True, None),
                "sha256_file": lambda path: hashlib.sha256(Path(path).read_bytes()).hexdigest(),
            }
            code = self.cells["44A"].replace('Path("/content/bark_negative_examples")', f'Path({temp!r})')
            with self.assertRaisesRegex(RuntimeError, "validation and test"):
                exec(code, namespace)

    def test_notebook_order_syntax_and_embedded_scripts(self):
        original_numbers = [c["metadata"]["cinnaai_cell_number"] for c in self.notebook["cells"]
                            if c["cell_type"] == "code" and isinstance(c["metadata"]["cinnaai_cell_number"], int)]
        self.assertEqual(original_numbers, list(range(1, 98)))
        for i, cell in enumerate(self.notebook["cells"]):
            if cell["cell_type"] != "code":
                continue
            number = cell["metadata"]["cinnaai_cell_number"]
            self.assertTrue("".join(self.notebook["cells"][i - 1]["source"]).startswith(f"## CELL {number} — "))
            if number != 1:
                tree = ast.parse("".join(cell["source"]))
                for node in tree.body:
                    if isinstance(node, ast.Assign) and isinstance(node.value, ast.Constant):
                        if any(isinstance(target, ast.Name) and target.id in
                               ["rejection_runtime_code", "backend_parity_script", "preprocessing_code", "backup_helper_code"]
                               for target in node.targets):
                            ast.parse(node.value.value)


if __name__ == "__main__":
    unittest.main()
