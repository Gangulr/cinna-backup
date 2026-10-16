"""Public responses preserve the notebook's experimental/uncertain distinction."""
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class BarkScore(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    class_name: Literal["RoughBark", "StripeCanker"] = Field(alias="class")
    confidence: float = Field(ge=0, le=1)


class BarkPrediction(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    status: Literal["experimental_candidate", "uncertain", "rejected"]
    prediction: str | None
    candidate_class: str | None
    reason: str
    confidence_score: float | None = Field(ge=0, le=1)
    confidence_margin: float | None = Field(ge=0, le=1)
    top_predictions: list[BarkScore]
    domain_distance: float | None
    domain_distance_threshold: float
    in_known_disease_reference: bool | None
    domain_gate_negative_targets_met: bool
    relevance_status: str
    relevance_score: float | None
    relevance_reason: str
    disease_classification_performed: bool
    review_recommended: bool
    healthy_detection_supported: Literal[False]
    is_cinnamon: None
    assessment_mode: Literal["reference_only_experimental"]
    input_relevance_verified: bool
    unrelated_image_rejection_validated: bool
    assessment_scope: str
    display_prediction: str | None
    message: str
    recommendations: list[str]
    solutions: list[str] = Field(default_factory=list)
    prevention: list[str] = Field(default_factory=list)
    model_version: str
    model_sha256: str
    prediction_time: str
    created_at: str
    uploaded_filename: str
    user_id: str
    user_email: str
    user_name: str
    database_saved: bool = False
    record_id: str | None = None
