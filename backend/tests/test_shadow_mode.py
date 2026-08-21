import unittest

from hybrid_disease.ontology import DiseaseOntology
from hybrid_disease.orchestrator import (
    HybridDiseaseOrchestrator,
    HybridOrchestratorConfig,
)
from hybrid_disease.schemas import (
    GeminiVerificationResult,
    GeminiVerificationStatus,
)
from tests.helpers import make_image_bytes, make_observation, make_specialist


class FakeGeminiService:
    model_name = "gemini-test-model"

    def __init__(self) -> None:
        self.calls = 0

    async def verify(self, image, ontology) -> GeminiVerificationResult:
        self.calls += 1
        return GeminiVerificationResult(
            invoked=True,
            status=GeminiVerificationStatus.SUCCESS,
            observation=make_observation(),
            model=self.model_name,
            latency_ms=10,
        )


def make_orchestrator(service: FakeGeminiService) -> HybridDiseaseOrchestrator:
    return HybridDiseaseOrchestrator(
        gemini_service=service,
        ontology=DiseaseOntology.load(),
        config=HybridOrchestratorConfig(
            confidence_threshold=0.70,
            margin_threshold=0.15,
            version="hybrid-v1",
            gemini_image_max_dimension=1600,
        ),
    )


class ShadowModeTests(unittest.IsolatedAsyncioTestCase):
    async def test_strong_prediction_skips_gemini(self) -> None:
        service = FakeGeminiService()
        orchestrator = make_orchestrator(service)
        specialist = make_specialist(
            confidence=0.80,
            second_confidence=0.20,
        )

        metadata = await orchestrator.analyze(
            specialist,
            make_image_bytes(),
        )

        self.assertEqual(service.calls, 0)
        self.assertFalse(metadata["gemini"]["invoked"])
        self.assertFalse(metadata["hybrid_used"])
        self.assertEqual(metadata["decision_source"], "efficientnet")

    async def test_agreement_does_not_change_baseline_result(self) -> None:
        service = FakeGeminiService()
        orchestrator = make_orchestrator(service)
        baseline = {
            "status": "uncertain",
            "prediction": "unknown",
            "display_prediction": "Uncertain Result",
            "diagnosis": "Baseline diagnosis",
        }

        metadata = await orchestrator.analyze(
            make_specialist(),
            make_image_bytes(),
        )
        merged = {**baseline, **metadata}

        self.assertEqual(service.calls, 1)
        self.assertEqual(merged["status"], baseline["status"])
        self.assertEqual(merged["prediction"], baseline["prediction"])
        self.assertEqual(
            merged["display_prediction"],
            baseline["display_prediction"],
        )
        self.assertEqual(merged["diagnosis"], baseline["diagnosis"])
        self.assertFalse(merged["hybrid_used"])
        self.assertEqual(merged["decision_source"], "efficientnet")
        self.assertTrue(merged["agreement"])


if __name__ == "__main__":
    unittest.main()
