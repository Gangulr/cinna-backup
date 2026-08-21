"""Pure routing and shadow counterfactual rules for hybrid disease analysis."""

from __future__ import annotations

from .schemas import (
    EvidenceStrength,
    GeminiCandidateClass,
    GeminiVerificationResult,
    GeminiVerificationStatus,
    HybridPredictionResult,
    ImageQuality,
    SpecialistClass,
    SpecialistPredictionResult,
)


def is_specialist_strong(
    specialist: SpecialistPredictionResult,
    *,
    confidence_threshold: float,
    margin_threshold: float,
) -> bool:
    return (
        specialist.confidence >= confidence_threshold
        and specialist.confidence_margin >= margin_threshold
    )


def should_invoke_gemini(
    specialist: SpecialistPredictionResult,
    *,
    confidence_threshold: float,
    margin_threshold: float,
) -> bool:
    return not is_specialist_strong(
        specialist,
        confidence_threshold=confidence_threshold,
        margin_threshold=margin_threshold,
    )


def compare_results(
    specialist: SpecialistPredictionResult,
    gemini: GeminiVerificationResult,
) -> bool | None:
    if (
        gemini.status != GeminiVerificationStatus.SUCCESS
        or gemini.observation is None
    ):
        return None

    candidate = gemini.observation.candidate_class

    if candidate in {
        GeminiCandidateClass.UNKNOWN,
        GeminiCandidateClass.INSUFFICIENT_IMAGE,
    }:
        return None

    return candidate.value == specialist.predicted_class.value


def calculate_shadow_counterfactual(
    specialist: SpecialistPredictionResult,
    gemini: GeminiVerificationResult,
    *,
    version: str,
    fallback_reason: str | None = None,
) -> HybridPredictionResult:
    """Calculate research metadata without altering the baseline result."""

    agreement = compare_results(specialist, gemini)
    would_have_status = "uncertain"
    would_have_prediction = "unknown"

    if (
        agreement is True
        and gemini.observation is not None
        and gemini.observation.is_leaf_visible
        and gemini.observation.image_quality
        in {ImageQuality.GOOD, ImageQuality.ACCEPTABLE}
        and gemini.observation.evidence_strength
        in {EvidenceStrength.HIGH, EvidenceStrength.MEDIUM}
        and not gemini.observation.requires_expert_review
    ):
        predicted_class = specialist.predicted_class

        if (
            predicted_class == SpecialistClass.NON_CINNAMON
            and gemini.observation.is_probably_cinnamon is False
        ):
            would_have_status = "rejected"
            would_have_prediction = SpecialistClass.NON_CINNAMON.value

        elif (
            predicted_class == SpecialistClass.HEALTHY_CINNAMON
            and gemini.observation.is_probably_cinnamon is True
        ):
            would_have_status = "healthy"
            would_have_prediction = SpecialistClass.HEALTHY_CINNAMON.value

        elif (
            predicted_class
            not in {
                SpecialistClass.HEALTHY_CINNAMON,
                SpecialistClass.NON_CINNAMON,
            }
            and gemini.observation.is_probably_cinnamon is True
        ):
            would_have_status = "disease_detected"
            would_have_prediction = predicted_class.value

    return HybridPredictionResult(
        agreement=agreement,
        fallback_reason=fallback_reason,
        would_have_status=would_have_status,
        would_have_prediction=would_have_prediction,
        version=version,
    )
