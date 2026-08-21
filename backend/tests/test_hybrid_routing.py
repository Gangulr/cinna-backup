import unittest

from hybrid_disease.decision_engine import (
    is_specialist_strong,
    should_invoke_gemini,
)
from tests.helpers import make_specialist


class HybridRoutingTests(unittest.TestCase):
    def assert_routing(
        self,
        confidence: float,
        margin: float,
        *,
        strong: bool,
    ) -> None:
        specialist = make_specialist(
            confidence=confidence,
            second_confidence=confidence - margin,
        )

        self.assertEqual(
            is_specialist_strong(
                specialist,
                confidence_threshold=0.70,
                margin_threshold=0.15,
            ),
            strong,
        )
        self.assertEqual(
            should_invoke_gemini(
                specialist,
                confidence_threshold=0.70,
                margin_threshold=0.15,
            ),
            not strong,
        )

    def test_exact_boundary_skips_gemini(self) -> None:
        self.assert_routing(0.70, 0.15, strong=True)

    def test_confidence_below_boundary_is_eligible(self) -> None:
        self.assert_routing(0.6999, 0.15, strong=False)

    def test_margin_below_boundary_is_eligible(self) -> None:
        self.assert_routing(0.70, 0.1499, strong=False)


if __name__ == "__main__":
    unittest.main()
