"""Closed, versioned ontology supplied to Gemini without specialist output."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .schemas import SpecialistClass


DEFAULT_ONTOLOGY_PATH = Path(__file__).with_name("disease_ontology.json")


@dataclass(frozen=True)
class DiseaseOntology:
    version: str
    classes: dict[str, dict[str, Any]]

    @classmethod
    def load(cls, path: Path = DEFAULT_ONTOLOGY_PATH) -> "DiseaseOntology":
        with path.open("r", encoding="utf-8") as file:
            payload = json.load(file)

        version = str(payload.get("version") or "").strip()
        classes = payload.get("classes")

        if not version:
            raise ValueError("Disease ontology version is required.")

        if not isinstance(classes, dict):
            raise ValueError("Disease ontology classes must be an object.")

        expected = {item.value for item in SpecialistClass}
        actual = set(classes)

        if actual != expected:
            missing = sorted(expected - actual)
            unexpected = sorted(actual - expected)
            raise ValueError(
                "Disease ontology classes do not match the production model. "
                f"Missing={missing}, unexpected={unexpected}."
            )

        validated: dict[str, dict[str, Any]] = {}

        for class_id, metadata in classes.items():
            if not isinstance(metadata, dict):
                raise ValueError(f"Ontology entry {class_id} must be an object.")

            display_label = str(metadata.get("display_label") or "").strip()
            visual_description = str(
                metadata.get("visual_description") or ""
            ).strip()
            expert_review_required = metadata.get("expert_review_required")

            if not display_label:
                raise ValueError(f"Ontology entry {class_id} needs a display label.")

            if not isinstance(expert_review_required, bool):
                raise ValueError(
                    f"Ontology entry {class_id} needs expert_review_required."
                )

            validated[class_id] = {
                "display_label": display_label,
                "visual_description": visual_description,
                "expert_review_required": expert_review_required,
            }

        return cls(version=version, classes=validated)

    def get(self, class_id: str) -> dict[str, Any]:
        if class_id not in self.classes:
            raise ValueError(f"Unsupported disease ontology class: {class_id}")

        return dict(self.classes[class_id])

    def gemini_instruction(self) -> str:
        descriptions = []

        for class_id in (item.value for item in SpecialistClass):
            metadata = self.classes[class_id]
            description = metadata["visual_description"]
            descriptions.append(
                f"  - {class_id}: {description or 'No verified visual description is available.'}"
            )

        ontology_text = "\n".join(descriptions)

        return (
            "You are a precise visual classification component for a cinnamon-leaf "
            "disease detection system. Your sole task is to inspect the "
            "uploaded image and assign it to exactly one of the seven disease classes "
            "listed below.\n\n"
            "## Strict Visual Boundaries\n\n"
            "Apply ONLY the following descriptions to classify the image. Do NOT use "
            "general botanical knowledge beyond these definitions:\n\n"
            f"{ontology_text}\n\n"
            "Additional safe values: unknown (no recognisable cinnamon leaf visible), "
            "insufficient_image (image too blurry, too dark, or cropped).\n\n"
            "## Disambiguation Rules\n\n"
            "  1. leaf_blight vs leaf_patches_fungal: Blight lesions are LARGE and "
            "     IRREGULAR, covering >20% of the lamina. Fungal patches are SMALL "
            "     (<10% each), CIRCULAR, and show a defined halo or ring boundary.\n"
            "  2. leaf_miner_attack vs any other: Must show clearly SERPENTINE or "
            "     WINDING white/silver trails—not patches, not spots, not bumps.\n"
            "  3. upper_leaf_gall vs lower_leaf_gall: Confirm which SURFACE the "
            "     protrusions are on. Dome-shapes on TOP → upper_leaf_gall. "
            "     Dome-shapes on BOTTOM → lower_leaf_gall.\n"
            "  4. non_cinnamon: Use only when the plant/object is definitively NOT "
            "     a cinnamon leaf.\n\n"
            "## Required Output Format\n\n"
            "You MUST return ONLY a single valid JSON object. No markdown fences, "
            "no preamble, and no trailing commentary. The response schema supplied "
            "with the request is authoritative. Populate exactly these fields:\n\n"
            "  - is_leaf_visible: boolean\n"
            "  - is_probably_cinnamon: boolean or null\n"
            "  - image_quality: good, acceptable, or poor\n"
            "  - visible_features: zero to six short, unique observations\n"
            "  - candidate_class: one allowed class listed below\n"
            "  - alternative_class: a different allowed class or null\n"
            "  - evidence_strength: high, medium, or low\n"
            "  - requires_expert_review: boolean\n"
            "  - summary: one concise evidence-based sentence\n\n"
            "candidate_class and alternative_class, when not null, MUST use: "
            "healthy_cinnamon, leaf_blight, "
            "leaf_miner_attack, leaf_patches_fungal, lower_leaf_gall, non_cinnamon, "
            "upper_leaf_gall, unknown, insufficient_image. "
            "Do NOT invent another class or include fields outside the supplied schema."
        )
