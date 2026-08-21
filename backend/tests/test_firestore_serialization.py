import json
import unittest

from hybrid_disease.decision_engine import calculate_shadow_counterfactual
from hybrid_disease.orchestrator import HybridDiseaseOrchestrator
from hybrid_disease.schemas import (
    GeminiVerificationResult,
    GeminiVerificationStatus,
)
from tests.helpers import make_observation, make_specialist


class FirestoreSerializationTests(unittest.TestCase):
    def test_shadow_metadata_contains_only_json_serializable_values(self) -> None:
        specialist = make_specialist()
        gemini = GeminiVerificationResult(
            invoked=True,
            status=GeminiVerificationStatus.SUCCESS,
            observation=make_observation(),
            model="gemini-test-model",
            latency_ms=25,
        )
        hybrid = calculate_shadow_counterfactual(
            specialist,
            gemini,
            version="hybrid-v1",
        )

        metadata = HybridDiseaseOrchestrator._serialize_metadata(
            specialist,
            gemini,
            hybrid,
        )
        encoded = json.dumps(metadata)

        self.assertIn('"specialist"', encoded)
        self.assertIn('"gemini"', encoded)
        self.assertIn('"hybrid"', encoded)
        self.assertNotIn("test-key", encoded)
        self.assertNotIn("canonical_bytes", encoded)
        self.assertNotIn("raw_response", encoded)
        self.assertNotIn("system_instruction", encoded)


if __name__ == "__main__":
    unittest.main()
