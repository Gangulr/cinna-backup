import ast
import unittest
from pathlib import Path

from hybrid_disease.decision_engine import should_invoke_gemini
from tests.helpers import make_specialist


BACKEND_DIR = Path(__file__).resolve().parents[1]


class ResponseCompatibilityTests(unittest.TestCase):
    def test_existing_efficientnet_preprocessing_source_is_unchanged(self) -> None:
        source = (BACKEND_DIR / "main.py").read_text(encoding="utf-8")
        module = ast.parse(source)
        function = next(
            node
            for node in module.body
            if isinstance(node, ast.FunctionDef)
            and node.name == "preprocess_disease_image"
        )
        function_source = ast.get_source_segment(source, function) or ""

        self.assertIn("ImageOps.exif_transpose", function_source)
        self.assertIn('.convert("RGB")', function_source)
        self.assertIn("Image.Resampling.NEAREST", function_source)
        self.assertIn("dtype=np.float32", function_source)
        self.assertIn("np.expand_dims", function_source)
        self.assertNotIn("255.0", function_source)
        self.assertNotIn("prepare_gemini_image", function_source)

    def test_model_and_class_contract_remain_present(self) -> None:
        source = (BACKEND_DIR / "main.py").read_text(encoding="utf-8")

        self.assertIn('BASE_DIR / "cinnamon_multi_part_model.h5"', source)
        for class_name in (
            "healthy_cinnamon",
            "leaf_blight",
            "leaf_miner_attack",
            "leaf_patches_fungal",
            "lower_leaf_gall",
            "non_cinnamon",
            "upper_leaf_gall",
        ):
            self.assertIn(f'"{class_name}"', source)

    def test_hybrid_routing_does_not_mutate_specialist(self) -> None:
        specialist = make_specialist()
        before = specialist.model_dump(mode="json")

        should_invoke_gemini(
            specialist,
            confidence_threshold=0.70,
            margin_threshold=0.15,
        )

        self.assertEqual(specialist.model_dump(mode="json"), before)


if __name__ == "__main__":
    unittest.main()
