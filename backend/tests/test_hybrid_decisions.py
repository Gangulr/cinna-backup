import unittest

from hybrid_disease.decision_engine import calculate_shadow_counterfactual
from hybrid_disease.schemas import (
    GeminiVerificationResult,
    GeminiVerificationStatus,
)
from tests.helpers import make_observation, make_specialist


def verification(candidate_class: str) -> GeminiVerificationResult:
    return GeminiVerificationResult(
        invoked=True,
        status=GeminiVerificationStatus.SUCCESS,
        observation=make_observation(candidate_class=candidate_class),
        model="gemini-test-model",
        latency_ms=20,
    )


class HybridDecisionTests(unittest.TestCase):
    def test_agreement_calculates_disease_counterfactual(self) -> None:
        result = calculate_shadow_counterfactual(
            make_specialist(),
            verification("leaf_miner_attack"),
            version="hybrid-v1",
        )

        self.assertTrue(result.agreement)
        self.assertEqual(result.would_have_status, "disease_detected")
        self.assertEqual(result.would_have_prediction, "leaf_miner_attack")
        self.assertFalse(result.hybrid_used)

    def test_disagreement_remains_counterfactually_uncertain(self) -> None:
        result = calculate_shadow_counterfactual(
            make_specialist(),
            verification("leaf_blight"),
            version="hybrid-v1",
        )

        self.assertFalse(result.agreement)
        self.assertEqual(result.would_have_status, "uncertain")
        self.assertEqual(result.would_have_prediction, "unknown")

    def test_unknown_and_insufficient_have_null_agreement(self) -> None:
        for candidate in ("unknown", "insufficient_image"):
            with self.subTest(candidate=candidate):
                result = calculate_shadow_counterfactual(
                    make_specialist(),
                    verification(candidate),
                    version="hybrid-v1",
                )
                self.assertIsNone(result.agreement)
                self.assertEqual(result.would_have_status, "uncertain")


if __name__ == "__main__":
    unittest.main()
