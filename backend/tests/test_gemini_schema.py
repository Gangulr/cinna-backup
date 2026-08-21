import unittest

from pydantic import ValidationError

from hybrid_disease.schemas import (
    GeminiObservation,
    GeminiVerificationResult,
    GeminiVerificationStatus,
)
from tests.helpers import make_observation


class GeminiSchemaTests(unittest.TestCase):
    def test_valid_structured_observation(self) -> None:
        observation = make_observation()
        result = GeminiVerificationResult(
            invoked=True,
            status=GeminiVerificationStatus.SUCCESS,
            observation=observation,
            model="gemini-test-model",
            latency_ms=15,
        )

        self.assertEqual(result.observation, observation)

    def test_rejects_arbitrary_disease_class(self) -> None:
        payload = make_observation().model_dump()
        payload["candidate_class"] = "invented_disease"

        with self.assertRaises(ValidationError):
            GeminiObservation.model_validate(payload)

    def test_rejects_long_features_and_matching_alternative(self) -> None:
        too_many = make_observation().model_dump()
        too_many["visible_features"] = [f"feature-{index}" for index in range(7)]

        with self.assertRaises(ValidationError):
            GeminiObservation.model_validate(too_many)

        matching = make_observation().model_dump()
        matching["alternative_class"] = matching["candidate_class"]

        with self.assertRaises(ValidationError):
            GeminiObservation.model_validate(matching)

    def test_success_requires_observation_and_model(self) -> None:
        with self.assertRaises(ValidationError):
            GeminiVerificationResult(
                invoked=True,
                status=GeminiVerificationStatus.SUCCESS,
                model="gemini-test-model",
            )


if __name__ == "__main__":
    unittest.main()
