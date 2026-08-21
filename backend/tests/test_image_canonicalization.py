import io
import json
import unittest
from types import SimpleNamespace

from PIL import Image

from hybrid_disease.gemini_service import (
    GeminiServiceConfig,
    GeminiVisionService,
)
from hybrid_disease.image_processing import prepare_gemini_image
from hybrid_disease.ontology import DiseaseOntology
from tests.helpers import make_observation


class CapturingModels:
    def __init__(self) -> None:
        self.kwargs = None

    async def generate_content(self, **kwargs):
        self.kwargs = kwargs
        return SimpleNamespace(
            parsed=make_observation(),
            prompt_feedback=None,
            candidates=[],
        )


class ImageCanonicalizationTests(unittest.IsolatedAsyncioTestCase):
    def make_oriented_image(self) -> bytes:
        output = io.BytesIO()
        image = Image.new("RGB", (40, 20), "green")
        exif = Image.Exif()
        exif[274] = 6
        image.save(
            output,
            format="JPEG",
            exif=exif,
            comment=b"private-source-metadata",
        )
        return output.getvalue()

    async def test_exif_rgb_metadata_dimensions_and_stable_hash(self) -> None:
        source = self.make_oriented_image()
        first = prepare_gemini_image(source, max_dimension=30)
        second = prepare_gemini_image(source, max_dimension=30)

        self.assertLessEqual(max(first.width, first.height), 30)
        self.assertGreater(first.height, first.width)
        self.assertEqual(first.sha256, second.sha256)
        self.assertEqual(first.canonical_bytes, second.canonical_bytes)

        with Image.open(io.BytesIO(first.canonical_bytes)) as canonical:
            self.assertEqual(canonical.mode, "RGB")
            self.assertEqual(len(canonical.getexif()), 0)
            self.assertNotIn("comment", canonical.info)

    async def test_provider_receives_no_original_filename(self) -> None:
        models = CapturingModels()
        client = SimpleNamespace(
            aio=SimpleNamespace(models=models),
            close=lambda: None,
        )
        service = GeminiVisionService(
            GeminiServiceConfig(
                enabled=True,
                api_key="test-key-not-real",
                model="gemini-test-model",
                timeout_seconds=1.0,
                max_concurrency=1,
                circuit_failure_threshold=3,
                circuit_cooldown_seconds=60.0,
            ),
            client=client,
        )
        image = prepare_gemini_image(self.make_oriented_image())

        result = await service.verify(image, DiseaseOntology.load())

        self.assertEqual(result.status.value, "success")
        contents = models.kwargs["contents"]
        self.assertEqual(len(contents), 2)
        self.assertNotIn("secret-original-name.jpg", repr(contents))
        self.assertNotIn("leaf_miner_attack", str(contents[0]))

        config = models.kwargs["config"]
        self.assertIsNotNone(config.response_schema)
        self.assertIsNone(config.response_json_schema)
        self.assertNotIn(
            "additionalProperties",
            json.dumps(config.response_schema),
        )


if __name__ == "__main__":
    unittest.main()
