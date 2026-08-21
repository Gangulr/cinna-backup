"""Shadow-mode Gemini verification support for cinnamon disease predictions."""

from .decision_engine import (
    calculate_shadow_counterfactual,
    compare_results,
    is_specialist_strong,
    should_invoke_gemini,
)
from .gemini_service import GeminiVisionService
from .ontology import DiseaseOntology
from .orchestrator import HybridDiseaseOrchestrator
from .schemas import (
    GeminiObservation,
    GeminiVerificationResult,
    HybridPredictionResult,
    SpecialistPredictionResult,
    TopPrediction,
)

__all__ = [
    "DiseaseOntology",
    "GeminiObservation",
    "GeminiVerificationResult",
    "GeminiVisionService",
    "HybridDiseaseOrchestrator",
    "HybridPredictionResult",
    "SpecialistPredictionResult",
    "TopPrediction",
    "calculate_shadow_counterfactual",
    "compare_results",
    "is_specialist_strong",
    "should_invoke_gemini",
]
