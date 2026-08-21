import unittest

from pydantic import ValidationError

from hybrid_disease.schemas import SpecialistPredictionResult
from tests.helpers import make_specialist


class SpecialistSchemaTests(unittest.TestCase):
    def test_valid_specialist_result(self) -> None:
        result = make_specialist()

        self.assertEqual(result.predicted_class.value, "leaf_miner_attack")
        self.assertEqual(len(result.top_predictions), 3)
        self.assertEqual(result.schema_version, "specialist-v1")

    def test_rejects_probability_outside_unit_interval(self) -> None:
        payload = make_specialist().model_dump()
        payload["confidence"] = 1.1

        with self.assertRaises(ValidationError):
            SpecialistPredictionResult.model_validate(payload)

    def test_rejects_duplicate_or_unsorted_top_predictions(self) -> None:
        duplicate = make_specialist().model_dump()
        duplicate["top_predictions"][1]["class_name"] = (
            duplicate["top_predictions"][0]["class_name"]
        )

        with self.assertRaises(ValidationError):
            SpecialistPredictionResult.model_validate(duplicate)

        unsorted = make_specialist().model_dump()
        unsorted["top_predictions"][2]["confidence"] = 0.50

        with self.assertRaises(ValidationError):
            SpecialistPredictionResult.model_validate(unsorted)

    def test_rejects_invalid_model_hash(self) -> None:
        payload = make_specialist().model_dump()
        payload["model_hash"] = "client-value"

        with self.assertRaises(ValidationError):
            SpecialistPredictionResult.model_validate(payload)


if __name__ == "__main__":
    unittest.main()
