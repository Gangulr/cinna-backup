from __future__ import annotations

import io
import unittest
from unittest.mock import AsyncMock, patch

import numpy as np
import pandas as pd
from fastapi.testclient import TestClient
from PIL import Image
from pydantic import ValidationError

import main


TEST_USER = {
    "uid": "prototype-user",
    "email": "prototype@example.com",
    "fullName": "Prototype User",
    "role": "user",
}


class FakeGrowthModel:
    def __init__(self, bark_thickness: float) -> None:
        self.bark_thickness = bark_thickness

    def predict(self, features):
        return np.asarray([self.bark_thickness], dtype=np.float64)


class FakeDiseaseModel:
    def __init__(self, probabilities: list[float]) -> None:
        self.probabilities = np.asarray([probabilities], dtype=np.float32)

    def predict(self, image_batch, verbose=0):
        return self.probabilities


class FakeEmbeddingModel:
    def predict(self, image_batch, verbose=0):
        return np.ones((1, 4), dtype=np.float32)


class FakeFaissIndex:
    ntotal = 2

    def search(self, embedding, k):
        return (
            np.asarray([[0.95, 0.85]], dtype=np.float32)[:, :k],
            np.asarray([[0, 1]], dtype=np.int64)[:, :k],
        )


def make_image_bytes() -> bytes:
    output = io.BytesIO()
    Image.new("RGB", (32, 32), "green").save(output, format="PNG")
    return output.getvalue()


class ScopedPrototypeModelTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        main.app.dependency_overrides[main.get_current_user] = lambda: TEST_USER
        cls.client = TestClient(main.app)

    @classmethod
    def tearDownClass(cls) -> None:
        main.app.dependency_overrides.clear()

    def test_growth_training_data_is_reproducible_and_bounded(self) -> None:
        first_features, first_target = main.build_growth_training_data()
        second_features, second_target = main.build_growth_training_data()

        self.assertTrue(first_features.equals(second_features))
        np.testing.assert_array_equal(first_target, second_target)
        self.assertEqual(len(first_features), 10000)
        self.assertGreaterEqual(float(first_target.min()), 0.5)
        self.assertLessEqual(float(first_target.max()), 1.5)

        self.assertEqual(main.growth_model_metrics["training_samples"], 10000)
        self.assertEqual(main.growth_model_metrics["evaluation_samples"], 2000)
        self.assertIn("r2_score", main.growth_model_metrics)
        self.assertIn("mean_absolute_error_mm", main.growth_model_metrics)
        self.assertNotIn("accuracy_percentage", main.growth_model_metrics)

    def test_growth_status_and_supported_input_boundaries(self) -> None:
        self.assertEqual(
            main.interpret_growth_value(49.99)["status"],
            "Initial Stage",
        )
        self.assertEqual(
            main.interpret_growth_value(50.0)["status"],
            "Growing",
        )
        self.assertEqual(
            main.interpret_growth_value(80.0)["status"],
            "Ready to Harvest",
        )

        supported_inputs = [
            main.SensorData(
                temperature=0.1,
                humidity=0.1,
                moisture=0,
                plant_age_months=1,
            ),
            main.SensorData(
                temperature=45,
                humidity=40,
                moisture=90,
                plant_age_months=60,
            ),
            main.SensorData(
                temperature=60,
                humidity=100,
                moisture=100,
                plant_age_months=120,
            ),
        ]

        for sensor_data in supported_inputs:
            features = pd.DataFrame(
                [
                    {
                        "Plant_Age": sensor_data.plant_age_months,
                        "Temperature": sensor_data.temperature,
                        "Humidity": sensor_data.humidity,
                        "Soil_Moisture": sensor_data.moisture,
                    }
                ]
            )
            bark_thickness = float(main.growth_model.predict(features)[0])
            growth_value = max(
                0.0,
                min(100.0, (bark_thickness - 0.5) * 100.0),
            )
            interpretation = main.interpret_growth_value(growth_value)

            self.assertTrue(np.isfinite(bark_thickness))
            self.assertGreaterEqual(bark_thickness, 0.5)
            self.assertLessEqual(bark_thickness, 1.5)
            self.assertIn(
                interpretation["status"],
                {"Initial Stage", "Growing", "Ready to Harvest"},
            )

        invalid_inputs = [
            {"temperature": 0, "humidity": 80, "moisture": 60},
            {"temperature": 30, "humidity": 0, "moisture": 60},
            {"temperature": 61, "humidity": 80, "moisture": 60},
            {"temperature": 30, "humidity": 101, "moisture": 60},
            {"temperature": 30, "humidity": 80, "moisture": 101},
        ]

        for invalid_input in invalid_inputs:
            with self.assertRaises(ValidationError):
                main.SensorData(
                    **invalid_input,
                    plant_age_months=24,
                )

    def test_growth_endpoint_returns_typed_prototype_contract(self) -> None:
        payload = {
            "plant_id": "P-101",
            "plant_age_months": 24,
            "temperature": 30,
            "humidity": 80,
            "moisture": 60,
        }

        with (
            patch.object(main, "growth_model", FakeGrowthModel(1.3)),
            patch.object(
                main,
                "save_to_firebase",
                return_value={"saved": True, "id": "growth-1"},
            ),
            patch.object(main, "save_growth_to_csv", return_value=True),
            patch.object(
                main,
                "send_user_notification",
                return_value={"sent": False, "reason": "test"},
            ),
        ):
            response = self.client.post("/growth-predict/", json=payload)

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["growth_value"], 80.0)
        self.assertEqual(body["harvest_status"], "Ready to Harvest")
        self.assertEqual(
            body["model_scope"],
            "Supported-domain environmental growth estimate",
        )

    def test_growth_endpoint_returns_a_status_across_supported_domain(self) -> None:
        cases = [
            (
                {
                    "plant_id": "P-MIN",
                    "plant_age_months": 1,
                    "temperature": 0.1,
                    "humidity": 0.1,
                    "moisture": 0,
                },
                "Initial Stage",
            ),
            (
                {
                    "plant_id": "P-REALISTIC",
                    "plant_age_months": 18,
                    "temperature": 30,
                    "humidity": 80,
                    "moisture": 60,
                },
                "Growing",
            ),
            (
                {
                    "plant_id": "P-SCREENSHOT",
                    "plant_age_months": 60,
                    "temperature": 45,
                    "humidity": 40,
                    "moisture": 90,
                },
                "Initial Stage",
            ),
            (
                {
                    "plant_id": "P-MATURE",
                    "plant_age_months": 120,
                    "temperature": 30,
                    "humidity": 80,
                    "moisture": 60,
                },
                "Ready to Harvest",
            ),
        ]

        with (
            patch.object(
                main,
                "save_to_firebase",
                return_value={"saved": True, "id": "growth-range"},
            ),
            patch.object(main, "save_growth_to_csv", return_value=True),
            patch.object(
                main,
                "send_user_notification",
                return_value={"sent": False, "reason": "test"},
            ),
        ):
            for payload, expected_status in cases:
                with self.subTest(plant_id=payload["plant_id"]):
                    response = self.client.post(
                        "/growth-predict/",
                        json=payload,
                    )

                    self.assertEqual(response.status_code, 200)
                    body = response.json()
                    self.assertEqual(body["status"], expected_status)
                    self.assertEqual(body["harvest_status"], expected_status)
                    self.assertGreaterEqual(body["growth_value"], 0)
                    self.assertLessEqual(body["growth_value"], 100)
                    self.assertGreaterEqual(body["bark_thickness_mm"], 0.5)
                    self.assertLessEqual(body["bark_thickness_mm"], 1.5)

    def test_growth_metrics_endpoint_reports_synthetic_evaluation(self) -> None:
        response = self.client.get("/metrics/")

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["training_samples"], 10000)
        self.assertEqual(body["evaluation_samples"], 2000)
        self.assertEqual(body["data_source"], "Formula-generated growth data")
        self.assertIn("r2_score", body)
        self.assertIn("mean_absolute_error_mm", body)
        self.assertNotIn("accuracy_percentage", body)

    def test_harvest_boundaries_and_input_validation(self) -> None:
        approved = main.calculate_harvest_readiness(
            main.HarvestData(
                plant_id="P-1",
                age=30,
                growth_rate=90,
                bark_thickness=1.4,
                disease_status="Healthy",
                current_month="March",
                bark_quality=90,
                maturity_level=90,
                health_status=90,
            )
        )
        waiting = main.calculate_harvest_readiness(
            main.HarvestData(
                plant_id="P-2",
                age=18,
                growth_rate=60,
                bark_thickness=1.1,
                disease_status="Healthy",
                current_month="October",
                bark_quality=75,
                maturity_level=75,
                health_status=75,
            )
        )
        blocked = main.calculate_harvest_readiness(
            main.HarvestData(
                plant_id="P-3",
                age=10,
                growth_rate=20,
                bark_thickness=0.6,
                disease_status="Diseased",
                current_month="December",
                bark_quality=30,
                maturity_level=30,
                health_status=30,
            )
        )

        self.assertEqual(approved.robotic_action, "APPROVED")
        self.assertGreaterEqual(approved.readiness_score, 80)
        self.assertEqual(waiting.robotic_action, "WAIT")
        self.assertGreaterEqual(waiting.readiness_score, 60)
        self.assertLess(waiting.readiness_score, 80)
        self.assertEqual(blocked.robotic_action, "BLOCKED")
        self.assertLess(blocked.readiness_score, 60)

        with self.assertRaises(ValidationError):
            main.HarvestData(
                plant_id="P-invalid",
                age=24,
                growth_rate=101,
                bark_thickness=1.2,
                disease_status="Healthy",
                current_month="March",
                bark_quality=90,
                maturity_level=90,
                health_status=90,
            )

    def test_harvest_endpoint_accepts_the_frontend_payload(self) -> None:
        payload = {
            "plant_id": "P-202",
            "age": 30,
            "growth_rate": 90,
            "bark_thickness": 1.4,
            "disease_status": "Healthy",
            "current_month": "March",
            "bark_quality": 90,
            "maturity_level": 90,
            "health_status": 90,
        }

        with (
            patch.object(
                main,
                "save_to_firebase",
                return_value={"saved": True, "id": "harvest-1"},
            ),
            patch.object(main, "save_harvest_to_csv", return_value=True),
            patch.object(
                main,
                "send_user_notification",
                return_value={"sent": False, "reason": "test"},
            ),
        ):
            response = self.client.post("/harvest-readiness/", json=payload)

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["robotic_action"], "APPROVED")
        self.assertEqual(body["readiness_score"], 100)
        self.assertEqual(body["readiness_status"], "Ready for Harvest")
        self.assertTrue(body["database_saved"])
        self.assertTrue(body["csv_saved"])

    def test_disease_endpoint_always_returns_the_top_model_class(self) -> None:
        cases = [
            (
                "healthy",
                "healthy_cinnamon",
                False,
                [0.90, 0.02, 0.02, 0.02, 0.01, 0.01, 0.02],
            ),
            (
                "disease_detected",
                "leaf_blight",
                False,
                [0.02, 0.90, 0.02, 0.02, 0.01, 0.01, 0.02],
            ),
            (
                "rejected",
                "non_cinnamon",
                False,
                [0.02, 0.02, 0.02, 0.02, 0.01, 0.90, 0.01],
            ),
            (
                "healthy",
                "healthy_cinnamon",
                True,
                [0.35, 0.30, 0.10, 0.08, 0.06, 0.05, 0.06],
            ),
            (
                "disease_detected",
                "leaf_miner_attack",
                True,
                [0.30, 0.10, 0.35, 0.08, 0.06, 0.05, 0.06],
            ),
            (
                "rejected",
                "non_cinnamon",
                True,
                [0.30, 0.10, 0.08, 0.06, 0.05, 0.35, 0.06],
            ),
        ]

        for (
            expected_status,
            expected_prediction,
            expected_low_confidence,
            probabilities,
        ) in cases:
            with self.subTest(
                expected_status=expected_status,
                expected_prediction=expected_prediction,
            ):
                with (
                    patch.object(
                        main,
                        "disease_model",
                        FakeDiseaseModel(probabilities),
                    ),
                    patch.object(main, "embedding_model", None),
                    patch.object(main, "faiss_index", None),
                    patch.object(main, "faiss_label_map", None),
                    patch.object(main, "disease_model_hash", "a" * 64),
                    patch.object(
                        main.hybrid_disease_orchestrator,
                        "analyze",
                        new=AsyncMock(
                            return_value={
                                "hybrid_used": False,
                                "decision_source": "efficientnet",
                            }
                        ),
                    ),
                    patch.object(
                        main,
                        "save_to_firebase",
                        return_value={"saved": False, "id": None},
                    ),
                    patch.object(
                        main,
                        "send_user_notification",
                        return_value={"sent": False, "reason": "test"},
                    ),
                ):
                    response = self.client.post(
                        "/disease-predict/",
                        files={
                            "file": (
                                "leaf.png",
                                make_image_bytes(),
                                "image/png",
                            )
                        },
                    )

                self.assertEqual(response.status_code, 200)
                body = response.json()
                self.assertEqual(body["status"], expected_status)
                self.assertEqual(body["prediction"], expected_prediction)
                self.assertEqual(
                    body["detected_class"],
                    expected_prediction,
                )
                self.assertEqual(
                    body["low_confidence"],
                    expected_low_confidence,
                )
                self.assertEqual(
                    body["review_recommended"],
                    expected_low_confidence,
                )
                self.assertEqual(
                    body["decision_source"],
                    "efficientnet",
                )

    def test_faiss_evidence_cannot_replace_softmax_diagnosis(self) -> None:
        probabilities = [0.90, 0.03, 0.02, 0.02, 0.01, 0.01, 0.01]

        with (
            patch.object(main, "disease_model", FakeDiseaseModel(probabilities)),
            patch.object(main, "embedding_model", FakeEmbeddingModel()),
            patch.object(main, "faiss_index", FakeFaissIndex()),
            patch.object(
                main,
                "faiss_label_map",
                {"0": "leaf_blight", "1": "healthy_cinnamon"},
            ),
            patch.object(main, "disease_model_hash", "a" * 64),
            patch.object(
                main.hybrid_disease_orchestrator,
                "analyze",
                new=AsyncMock(
                    return_value={
                        "hybrid_used": False,
                        "decision_source": "efficientnet",
                    }
                ),
            ),
            patch.object(
                main,
                "save_to_firebase",
                return_value={"saved": False, "id": None},
            ),
        ):
            response = self.client.post(
                "/disease-predict/",
                files={"file": ("leaf.png", make_image_bytes(), "image/png")},
            )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["status"], "healthy")
        self.assertEqual(body["prediction"], "healthy_cinnamon")
        self.assertEqual(body["decision_source"], "efficientnet")
        self.assertTrue(body["faiss_retrieval"]["accepted"])
        self.assertEqual(body["faiss_retrieval"]["top_label"], "leaf_blight")


if __name__ == "__main__":
    unittest.main()
