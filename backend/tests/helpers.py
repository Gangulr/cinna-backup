from __future__ import annotations

import io

from PIL import Image

from hybrid_disease.schemas import (
    EvidenceStrength,
    GeminiCandidateClass,
    GeminiObservation,
    ImageQuality,
    SpecialistPredictionResult,
    TopPrediction,
)


def make_specialist(
    *,
    predicted_class: str = "leaf_miner_attack",
    confidence: float = 0.62,
    second_class: str = "leaf_blight",
    second_confidence: float = 0.30,
) -> SpecialistPredictionResult:
    third_class = (
        "healthy_cinnamon"
        if predicted_class != "healthy_cinnamon"
        else "non_cinnamon"
    )
    third_confidence = min(second_confidence, 0.05)

    return SpecialistPredictionResult(
        predicted_class=predicted_class,
        confidence=confidence,
        second_class=second_class,
        second_confidence=second_confidence,
        confidence_margin=confidence - second_confidence,
        top_predictions=[
            TopPrediction(
                class_name=predicted_class,
                confidence=confidence,
            ),
            TopPrediction(
                class_name=second_class,
                confidence=second_confidence,
            ),
            TopPrediction(
                class_name=third_class,
                confidence=third_confidence,
            ),
        ],
        model_hash="a" * 64,
        model_name="cinnamon_multi_part_model.h5",
    )


def make_observation(
    *,
    candidate_class: str = "leaf_miner_attack",
    is_probably_cinnamon: bool | None = True,
    image_quality: ImageQuality = ImageQuality.GOOD,
    evidence_strength: EvidenceStrength = EvidenceStrength.MEDIUM,
    requires_expert_review: bool = False,
) -> GeminiObservation:
    return GeminiObservation(
        is_leaf_visible=True,
        is_probably_cinnamon=is_probably_cinnamon,
        image_quality=image_quality,
        visible_features=["Visible damaged leaf tissue"],
        candidate_class=GeminiCandidateClass(candidate_class),
        alternative_class=None,
        evidence_strength=evidence_strength,
        requires_expert_review=requires_expert_review,
        summary="The image contains visible features for the selected class.",
    )


def make_image_bytes(
    size: tuple[int, int] = (80, 60),
    *,
    image_format: str = "PNG",
) -> bytes:
    output = io.BytesIO()
    Image.new("RGB", size, (45, 130, 55)).save(
        output,
        format=image_format,
    )
    return output.getvalue()
