"""Optional one-image live Gemini verification; never imported by tests."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv


BACKEND_DIR = Path(__file__).resolve().parents[1]

if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

load_dotenv(BACKEND_DIR / ".env")

from hybrid_disease.gemini_service import GeminiVisionService
from hybrid_disease.image_processing import prepare_gemini_image
from hybrid_disease.ontology import DiseaseOntology


async def run(image_path: Path) -> int:
    if not os.getenv("GEMINI_API_KEY", "").strip():
        raise SystemExit("GEMINI_API_KEY is required in backend/.env")

    if not os.getenv("GEMINI_MODEL", "").strip():
        raise SystemExit("GEMINI_MODEL is required in backend/.env")

    if os.getenv("GEMINI_ENABLED", "false").strip().lower() != "true":
        raise SystemExit("Set GEMINI_ENABLED=true in backend/.env for this live test")

    original_bytes = image_path.read_bytes()
    prepared = prepare_gemini_image(original_bytes)
    service = GeminiVisionService()

    try:
        result = await service.verify(
            prepared,
            DiseaseOntology.load(),
        )
    finally:
        await service.close()

    print(json.dumps(result.model_dump(mode="json"), indent=2))
    return 0 if result.status.value == "success" else 1


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Run one sanitized live Gemini image verification.",
    )
    parser.add_argument("image", type=Path)
    arguments = parser.parse_args()

    if not arguments.image.is_file():
        parser.error("image must be an existing local file")

    return asyncio.run(run(arguments.image))


if __name__ == "__main__":
    raise SystemExit(main())
