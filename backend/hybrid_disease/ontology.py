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
                f"- {class_id}: {description or 'No project-verified visual description is available.'}"
            )

        ontology_text = "\n".join(descriptions)

        return (
            "You are a visual verification component for a research "
            "cinnamon-leaf condition classification system. Independently "
            "inspect the provided image. Classify only using the supplied "
            "closed ontology. Do not invent additional disease names. If "
            "the image does not provide enough visual evidence, return "
            "unknown or insufficient_image. Base visible_features only on "
            "directly observable image evidence. Do not provide hidden "
            "reasoning or chain-of-thought. Return only the required "
            "structured output.\n\nClosed ontology:\n"
            f"{ontology_text}\n"
            "Additional safe values: unknown, insufficient_image."
        )
