"""Load and verify the trusted Colab handoff, then use its exact inference policy."""
from __future__ import annotations

import hashlib
import io
import json
import logging
from pathlib import Path
import re
import threading
from types import ModuleType

import numpy as np
from PIL import Image, UnidentifiedImageError


LOGGER = logging.getLogger(__name__)
CLASS_NAMES = ["RoughBark", "StripeCanker"]
MODEL_FILE = "bark_condition_model.keras"
CROSS_RUNTIME_TOLERANCE = 1e-4


class InvalidBarkImage(ValueError):
    """The upload is not a decodable JPEG, PNG or WebP image."""


class BarkModelUnavailable(RuntimeError):
    """The model package did not pass initialization checks."""


class BarkModel:
    def __init__(self, directory: Path):
        self.directory = Path(directory).resolve()
        self.ready = False
        self.error: str | None = None
        self.parity_images = 0
        self.lock = threading.Lock()
        try:
            self._load()
            self.ready = True
        except Exception as exc:
            self.error = str(exc)
            LOGGER.exception("Bark model initialization failed; other features remain available")

    def _path(self, relative: str) -> Path:
        candidate = self.directory / relative
        if (Path(relative).is_absolute() or ".." in Path(relative).parts
                or not candidate.resolve().is_relative_to(self.directory)):
            raise ValueError("Invalid bark artifact path")
        return candidate

    def _verify_checksums(self):
        self.checksums = {}
        for line in (self.directory / "checksums.sha256").read_text(encoding="utf-8").splitlines():
            digest, relative = line.split("  ", 1)
            if (not re.fullmatch(r"[0-9a-f]{64}", digest) or relative in self.checksums
                    or relative == "checksums.sha256"):
                raise ValueError("Invalid bark checksum index")
            self._path(relative)
            self.checksums[relative] = digest
        required = {MODEL_FILE, "metadata.json", "class_names.json", "ood_policy.json",
                    "ood_reference.npz", "relevance_policy.json", "bark_rejection.py",
                    "preprocessing.py", "parity_fixtures/expected_predictions.json"}
        if not required.issubset(self.checksums):
            raise ValueError("Incomplete bark checksum index")
        for relative, expected in self.checksums.items():
            if hashlib.sha256(self._path(relative).read_bytes()).hexdigest() != expected:
                raise ValueError(f"Bark artifact checksum mismatch: {relative}")

    def _json(self, relative):
        return json.loads(self._path(relative).read_text(encoding="utf-8"))

    def _trusted_module(self, filename: str) -> ModuleType:
        # Only execute local, checksum-verified handoff helpers. Do not modify sys.path
        # or write __pycache__ into the immutable model package.
        module = ModuleType(f"_cinna_bark_{Path(filename).stem}")
        module.__file__ = str(self._path(filename))
        source = self._path(filename).read_bytes()
        if hashlib.sha256(source).hexdigest() != self.checksums[filename]:
            raise ValueError("Bark helper changed during initialization")
        exec(compile(source, module.__file__, "exec"), module.__dict__)
        return module

    def _load(self):
        self._verify_checksums()
        self.metadata = self._json("metadata.json")
        self.policy = self._json("ood_policy.json")
        self.relevance = self._json("relevance_policy.json")
        self.disease_policy = self.metadata["decision_policy"]
        if (self._json("class_names.json") != CLASS_NAMES
                or self.metadata["output"]["class_names"] != CLASS_NAMES
                or self.metadata["model_file"] != MODEL_FILE
                or self.metadata["artifact_sha256"] != self.checksums[MODEL_FILE]
                or self.metadata["input_rejection"] != self.policy
                or self.metadata["relevance_gate"] != self.relevance
                or not self.metadata["export_parity"]["keras_passed"]):
            raise ValueError("Bark metadata/model contract mismatch")
        expected_input = {"shape": [None, 224, 224, 3], "dtype": "float32", "colour_order": "RGB",
                          "pixel_range": [0, 255], "exif_transpose": True, "resize_library": "Pillow",
                          "resize_method": "bilinear", "aspect_ratio_policy": "stretch",
                          "external_normalization": "none", "backbone_preprocessing": "included_in_model"}
        if any(self.metadata["input"].get(k) != v for k, v in expected_input.items()):
            raise ValueError("Unsupported bark preprocessing contract")
        if (self.policy["inference_mode"] != "reference_only_experimental"
                or self.metadata["prediction_runtime"]["inference_mode"] != self.policy["inference_mode"]
                or self.relevance["available"]
                or self.policy["k"] != 5
                or self.policy["method"] != "mean_knn_cosine_distance"
                or not np.isfinite(self.policy["distance_threshold"])):
            raise ValueError("Unsupported bark inference policy")
        self.runtime = self._trusted_module("bark_rejection.py")
        self.preprocessing = self._trusted_module("preprocessing.py")
        self.reference, _ = self.runtime.load_rejection_assets(self.directory, self._path(MODEL_FILE))
        import tensorflow as tf

        self.tf = tf
        self.model = tf.keras.models.load_model(self._path(MODEL_FILE), compile=False)
        if self.model.input_shape != (None, 224, 224, 3) or self.model.output_shape != (None, 2):
            raise ValueError("Invalid bark model shape")
        self.features = tf.keras.Model(self.model.inputs, self.model.get_layer("global_average_pooling").output)
        if self.features.output_shape[-1] != self.reference.shape[1]:
            raise ValueError("Bark embedding dimension mismatch")
        self.dropout = self.model.get_layer("classification_dropout")
        self.head = self.model.get_layer("bark_predictions")
        self._verify_parity()

    def _head(self, features):
        return np.asarray(self.head(self.dropout(self.tf.convert_to_tensor(features), training=False)))

    def _predict_batch(self, batch):
        return self.runtime.predict_with_domain_gate(
            batch, lambda images: np.asarray(self.features(images, training=False)), self._head,
            self.reference, self.policy, self.disease_policy, None, self.relevance)

    def _verify_parity(self):
        fixtures = self._json("parity_fixtures/expected_predictions.json")
        if (fixtures["class_names"] != CLASS_NAMES or not fixtures["keras"]["passed"]
                or fixtures["decision_policy"] != self.disease_policy or len(fixtures["fixtures"]) != 8):
            raise ValueError("Invalid bark parity fixture contract")
        for fixture in fixtures["fixtures"]:
            image_path = self._path(f"parity_fixtures/images/{fixture['file']}")
            if hashlib.sha256(image_path.read_bytes()).hexdigest() != fixture["image_sha256"]:
                raise ValueError("Bark fixture image mismatch")
            batch = self.preprocessing.preprocess_bark_image(image_path)
            if hashlib.sha256(batch.astype("<f4").tobytes(order="C")).hexdigest() != fixture["input_tensor_sha256"]:
                raise ValueError("Bark preprocessing parity mismatch")
            scores = np.asarray(self.model(batch, training=False))[0]
            np.testing.assert_allclose(scores, fixture["expected_probabilities"],
                                       atol=CROSS_RUNTIME_TOLERANCE, rtol=0)
            result = self._predict_batch(batch)
            np.testing.assert_allclose(result["domain_distance"], fixture["expected_domain_distance"],
                                       atol=CROSS_RUNTIME_TOLERANCE, rtol=0)
            expected = {"status": "expected_status", "prediction": "expected_prediction",
                        "reason": "expected_reason", "candidate_class": "predicted_class",
                        "disease_classification_performed": "expected_disease_classification_performed",
                        "assessment_mode": "expected_assessment_mode",
                        "input_relevance_verified": "expected_input_relevance_verified"}
            if (any(result[k] != fixture[v] for k, v in expected.items())
                    or CLASS_NAMES[int(np.argmax(scores))] != fixture["raw_classifier_class"]
                    or fixture["expected_relevance_score"] is not None):
                raise ValueError("Bark decision parity mismatch")
            self.parity_images += 1

    def predict(self, image_bytes: bytes):
        if not self.ready:
            raise BarkModelUnavailable("Bark model is not available")
        try:
            with Image.open(io.BytesIO(image_bytes)) as image:
                if image.format not in {"JPEG", "PNG", "WEBP"}:
                    raise InvalidBarkImage("Please upload a JPEG, PNG or WebP image.")
                if Image.MAX_IMAGE_PIXELS is not None and image.width * image.height > Image.MAX_IMAGE_PIXELS:
                    raise InvalidBarkImage("The image dimensions are too large.")
            batch = self.preprocessing.preprocess_bark_image(io.BytesIO(image_bytes))
        except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as exc:
            raise InvalidBarkImage("Please upload a valid JPEG, PNG or WebP image.") from exc
        with self.lock:
            return self._predict_batch(batch)
