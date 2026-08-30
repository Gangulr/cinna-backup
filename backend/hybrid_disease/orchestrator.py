"""Coordinates shadow verification while preserving the baseline result."""

from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass
from typing import Any

from .decision_engine import (
    calculate_shadow_counterfactual,
    should_invoke_gemini,
)
from .gemini_service import GeminiVisionService
from .image_processing import (
    GeminiImagePreparationError,
    prepare_gemini_image,
)
from .ontology import DiseaseOntology
from .schemas import (
    GeminiVerificationResult,
    GeminiVerificationStatus,
    HybridPredictionResult,
    SpecialistPredictionResult,
)


def _read_probability(name: str, default: float) -> float:
    try:
        value = float(os.getenv(name, str(default)))
    except ValueError:
        return default

    return value if 0.0 <= value <= 1.0 else default


def _read_positive_int(name: str, default: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError:
        return default

    return value if value > 0 else default


@dataclass(frozen=True)
class HybridOrchestratorConfig:
    confidence_threshold: float
    margin_threshold: float
    version: str
    gemini_image_max_dimension: int
    shadow_mode: bool = True

    @classmethod
    def from_environment(
        cls,
        *,
        default_confidence_threshold: float = 0.70,
        default_margin_threshold: float = 0.15,
    ) -> "HybridOrchestratorConfig":
        # Gemini remains in evaluation mode. Even if
        # HYBRID_SHADOW_MODE=false is supplied, the baseline prediction is not
        # replaced without a separately validated fusion implementation.
        return cls(
            confidence_threshold=_read_probability(
                "HYBRID_SPECIALIST_CONFIDENCE_THRESHOLD",
                default_confidence_threshold,
            ),
            margin_threshold=_read_probability(
                "HYBRID_SPECIALIST_MARGIN_THRESHOLD",
                default_margin_threshold,
            ),
            version=os.getenv("HYBRID_VERSION", "hybrid-v1").strip()
            or "hybrid-v1",
            gemini_image_max_dimension=_read_positive_int(
                "GEMINI_IMAGE_MAX_DIMENSION",
                1600,
            ),
            shadow_mode=True,
        )


class HybridDiseaseOrchestrator:
    def __init__(
        self,
        *,
        gemini_service: GeminiVisionService,
        ontology: DiseaseOntology,
        config: HybridOrchestratorConfig,
    ) -> None:
        self.gemini_service = gemini_service
        self.ontology = ontology
        self.config = config

    @classmethod
    def from_environment(
        cls,
        *,
        default_confidence_threshold: float = 0.70,
        default_margin_threshold: float = 0.15,
        gemini_service: GeminiVisionService | None = None,
    ) -> "HybridDiseaseOrchestrator":
        return cls(
            gemini_service=gemini_service or GeminiVisionService(),
            ontology=DiseaseOntology.load(),
            config=HybridOrchestratorConfig.from_environment(
                default_confidence_threshold=default_confidence_threshold,
                default_margin_threshold=default_margin_threshold,
            ),
        )

    def startup_summary(self) -> dict[str, Any]:
        service_summary = self.gemini_service.startup_summary()

        return {
            **service_summary,
            "shadow_mode": True,
            "confidence_threshold": self.config.confidence_threshold,
            "margin_threshold": self.config.margin_threshold,
            "hybrid_version": self.config.version,
            "ontology_version": self.ontology.version,
        }

    def _not_invoked_result(
        self,
        *,
        failure_code: str | None = None,
    ) -> GeminiVerificationResult:
        return GeminiVerificationResult(
            invoked=False,
            status=GeminiVerificationStatus.NOT_INVOKED,
            observation=None,
            model=self.gemini_service.model_name,
            latency_ms=None,
            failure_code=failure_code,
        )

    def fallback_metadata(
        self,
        specialist: SpecialistPredictionResult,
        failure_code: str,
    ) -> dict[str, Any]:
        gemini = self._not_invoked_result(failure_code=failure_code)
        hybrid = calculate_shadow_counterfactual(
            specialist,
            gemini,
            version=self.config.version,
            fallback_reason=failure_code,
        )
        return self._serialize_metadata(specialist, gemini, hybrid)

    async def analyze(
        self,
        specialist: SpecialistPredictionResult,
        original_image_bytes: bytes,
    ) -> dict[str, Any]:
        try:
            invoke_gemini = should_invoke_gemini(
                specialist,
                confidence_threshold=self.config.confidence_threshold,
                margin_threshold=self.config.margin_threshold,
            )

            if not invoke_gemini:
                gemini = self._not_invoked_result()
                hybrid = HybridPredictionResult(
                    agreement=None,
                    fallback_reason=None,
                    would_have_status=None,
                    would_have_prediction=None,
                    version=self.config.version,
                )
                return self._serialize_metadata(specialist, gemini, hybrid)

            try:
                prepared_image = await asyncio.to_thread(
                    prepare_gemini_image,
                    original_image_bytes,
                    max_dimension=self.config.gemini_image_max_dimension,
                )
            except GeminiImagePreparationError:
                return self.fallback_metadata(
                    specialist,
                    "image_canonicalization_failed",
                )

            gemini = await self.gemini_service.verify(
                prepared_image,
                self.ontology,
            )

            fallback_reason = (
                gemini.failure_code
                if gemini.status != GeminiVerificationStatus.SUCCESS
                else None
            )

            hybrid = calculate_shadow_counterfactual(
                specialist,
                gemini,
                version=self.config.version,
                fallback_reason=fallback_reason,
            )
            return self._serialize_metadata(specialist, gemini, hybrid)

        except Exception:
            return self.fallback_metadata(
                specialist,
                "hybrid_internal_error",
            )

    @staticmethod
    def _serialize_metadata(
        specialist: SpecialistPredictionResult,
        gemini: GeminiVerificationResult,
        hybrid: HybridPredictionResult,
    ) -> dict[str, Any]:
        specialist_data = specialist.model_dump(mode="json")
        specialist_data["prediction"] = specialist_data.pop(
            "predicted_class"
        )

        gemini_data = gemini.model_dump(mode="json")
        observation = gemini_data.pop("observation", None)

        if observation:
            gemini_data.update(observation)

        hybrid_data = hybrid.model_dump(mode="json")

        return {
            "hybrid_used": False,
            "decision_source": "efficientnet",
            "agreement": hybrid.agreement,
            "fallback_reason": hybrid.fallback_reason,
            "hybrid_version": hybrid.version,
            "specialist": specialist_data,
            "gemini": gemini_data,
            "hybrid": hybrid_data,
        }
