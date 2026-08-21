"""Typed boundaries for specialist, Gemini, and shadow-mode decisions."""

from __future__ import annotations

from enum import Enum
from typing import Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)


class StrictModel(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        str_strip_whitespace=True,
    )


class SpecialistClass(str, Enum):
    HEALTHY_CINNAMON = "healthy_cinnamon"
    LEAF_BLIGHT = "leaf_blight"
    LEAF_MINER_ATTACK = "leaf_miner_attack"
    LEAF_PATCHES_FUNGAL = "leaf_patches_fungal"
    LOWER_LEAF_GALL = "lower_leaf_gall"
    NON_CINNAMON = "non_cinnamon"
    UPPER_LEAF_GALL = "upper_leaf_gall"


class GeminiCandidateClass(str, Enum):
    HEALTHY_CINNAMON = "healthy_cinnamon"
    LEAF_BLIGHT = "leaf_blight"
    LEAF_MINER_ATTACK = "leaf_miner_attack"
    LEAF_PATCHES_FUNGAL = "leaf_patches_fungal"
    LOWER_LEAF_GALL = "lower_leaf_gall"
    NON_CINNAMON = "non_cinnamon"
    UPPER_LEAF_GALL = "upper_leaf_gall"
    UNKNOWN = "unknown"
    INSUFFICIENT_IMAGE = "insufficient_image"


class ImageQuality(str, Enum):
    GOOD = "good"
    ACCEPTABLE = "acceptable"
    POOR = "poor"


class EvidenceStrength(str, Enum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class GeminiVerificationStatus(str, Enum):
    NOT_INVOKED = "not_invoked"
    SUCCESS = "success"
    DISABLED = "disabled"
    MISCONFIGURED = "misconfigured"
    CIRCUIT_OPEN = "circuit_open"
    TIMEOUT = "timeout"
    RATE_LIMITED = "rate_limited"
    NETWORK_ERROR = "network_error"
    PROVIDER_ERROR = "provider_error"
    REFUSED = "refused"
    INVALID_RESPONSE = "invalid_response"
    EMPTY_RESPONSE = "empty_response"


class DecisionSource(str, Enum):
    EFFICIENTNET = "efficientnet"


class TopPrediction(StrictModel):
    class_name: SpecialistClass
    confidence: float = Field(ge=0.0, le=1.0)


class SpecialistPredictionResult(StrictModel):
    """Server-created EfficientNet result; it is never a request model."""

    predicted_class: SpecialistClass
    confidence: float = Field(ge=0.0, le=1.0)
    second_class: SpecialistClass
    second_confidence: float = Field(ge=0.0, le=1.0)
    confidence_margin: float = Field(ge=0.0, le=1.0)
    top_predictions: list[TopPrediction] = Field(
        min_length=1,
        max_length=3,
    )
    model_hash: str = Field(
        min_length=64,
        max_length=64,
        pattern=r"^[0-9a-f]{64}$",
    )
    model_name: str = Field(min_length=1, max_length=255)
    schema_version: Literal["specialist-v1"] = "specialist-v1"

    @model_validator(mode="after")
    def validate_prediction_order(self) -> "SpecialistPredictionResult":
        classes = [item.class_name for item in self.top_predictions]

        if len(classes) != len(set(classes)):
            raise ValueError("Top prediction classes must be unique.")

        confidences = [item.confidence for item in self.top_predictions]

        if any(
            confidences[index] < confidences[index + 1]
            for index in range(len(confidences) - 1)
        ):
            raise ValueError("Top predictions must be in descending order.")

        first = self.top_predictions[0]

        if first.class_name != self.predicted_class:
            raise ValueError("The first top prediction must match predicted_class.")

        if abs(first.confidence - self.confidence) > 1e-6:
            raise ValueError("The first top confidence must match confidence.")

        if len(self.top_predictions) > 1:
            second = self.top_predictions[1]

            if second.class_name != self.second_class:
                raise ValueError("The second top prediction must match second_class.")

            if abs(second.confidence - self.second_confidence) > 1e-6:
                raise ValueError(
                    "The second top confidence must match second_confidence."
                )

        expected_margin = self.confidence - self.second_confidence

        if expected_margin < -1e-6:
            raise ValueError("The top confidence cannot be below the second confidence.")

        if abs(expected_margin - self.confidence_margin) > 1e-6:
            raise ValueError(
                "confidence_margin must equal confidence minus second_confidence."
            )

        return self


class GeminiObservation(StrictModel):
    is_leaf_visible: bool
    is_probably_cinnamon: bool | None
    image_quality: ImageQuality
    visible_features: list[str] = Field(max_length=6)
    candidate_class: GeminiCandidateClass
    alternative_class: GeminiCandidateClass | None = None
    evidence_strength: EvidenceStrength
    requires_expert_review: bool
    summary: str = Field(min_length=1, max_length=400)

    @field_validator("visible_features")
    @classmethod
    def validate_visible_features(cls, values: list[str]) -> list[str]:
        normalized: list[str] = []

        for value in values:
            feature = value.strip()

            if not feature:
                raise ValueError("Visible features cannot be empty.")

            if len(feature) > 160:
                raise ValueError("Visible features must be 160 characters or fewer.")

            if "\n" in feature or "\r" in feature:
                raise ValueError("Visible features must be short single-line observations.")

            normalized.append(feature)

        if len(normalized) != len(set(normalized)):
            raise ValueError("Visible features must be unique.")

        return normalized

    @model_validator(mode="after")
    def validate_alternative(self) -> "GeminiObservation":
        if self.alternative_class == self.candidate_class:
            raise ValueError("alternative_class cannot equal candidate_class.")

        return self


class GeminiVerificationResult(StrictModel):
    invoked: bool
    status: GeminiVerificationStatus
    observation: GeminiObservation | None = None
    model: str | None = Field(default=None, max_length=255)
    latency_ms: int | None = Field(default=None, ge=0)
    failure_code: str | None = Field(default=None, max_length=100)
    schema_version: Literal["gemini-verification-v1"] = (
        "gemini-verification-v1"
    )

    @model_validator(mode="after")
    def validate_status_consistency(self) -> "GeminiVerificationResult":
        if self.status == GeminiVerificationStatus.SUCCESS:
            if not self.invoked or self.observation is None or not self.model:
                raise ValueError(
                    "Successful Gemini verification requires invocation, model, and observation."
                )
        elif self.observation is not None:
            raise ValueError("Only successful verification may contain an observation.")

        return self


class HybridPredictionResult(StrictModel):
    shadow_mode: Literal[True] = True
    agreement: bool | None
    hybrid_used: Literal[False] = False
    decision_source: Literal["efficientnet"] = "efficientnet"
    fallback_reason: str | None = Field(default=None, max_length=100)
    would_have_status: Literal[
        "healthy",
        "rejected",
        "disease_detected",
        "uncertain",
    ] | None = None
    would_have_prediction: str | None = Field(default=None, max_length=100)
    version: str = Field(default="hybrid-v1", min_length=1, max_length=100)
