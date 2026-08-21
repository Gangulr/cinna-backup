from __future__ import annotations

import asyncio
import json
import unittest
from types import SimpleNamespace

from google.genai import errors

from hybrid_disease.gemini_service import (
    GeminiServiceConfig,
    GeminiVisionService,
)
from hybrid_disease.image_processing import prepare_gemini_image
from hybrid_disease.ontology import DiseaseOntology
from hybrid_disease.orchestrator import (
    HybridDiseaseOrchestrator,
    HybridOrchestratorConfig,
)
from hybrid_disease.schemas import (
    GeminiVerificationResult,
    GeminiVerificationStatus,
)
from tests.helpers import make_image_bytes, make_observation, make_specialist


class FakeModels:
    def __init__(self, behavior) -> None:
        self.behavior = behavior
        self.calls = 0
        self.last_kwargs = None

    async def generate_content(self, **kwargs):
        self.calls += 1
        self.last_kwargs = kwargs

        if isinstance(self.behavior, Exception):
            raise self.behavior

        if callable(self.behavior):
            return await self.behavior()

        return self.behavior


class FakeClient:
    def __init__(self, behavior) -> None:
        self.models = FakeModels(behavior)
        self.aio = SimpleNamespace(models=self.models)

    def close(self) -> None:
        return None


class ResultService:
    model_name = "gemini-test-model"

    def __init__(self, status: GeminiVerificationStatus) -> None:
        self.status = status

    async def verify(self, image, ontology) -> GeminiVerificationResult:
        not_invoked = {
            GeminiVerificationStatus.DISABLED,
            GeminiVerificationStatus.MISCONFIGURED,
            GeminiVerificationStatus.CIRCUIT_OPEN,
        }
        return GeminiVerificationResult(
            invoked=self.status not in not_invoked,
            status=self.status,
            model=self.model_name,
            failure_code=self.status.value,
        )


def config(**overrides) -> GeminiServiceConfig:
    values = {
        "enabled": True,
        "api_key": "test-key-not-real",
        "model": "gemini-test-model",
        "timeout_seconds": 0.2,
        "max_concurrency": 2,
        "circuit_failure_threshold": 3,
        "circuit_cooldown_seconds": 60.0,
    }
    values.update(overrides)
    return GeminiServiceConfig(**values)


def response(*, parsed=None, text=None, refused=False):
    finish_reason = "SAFETY" if refused else "STOP"
    return SimpleNamespace(
        parsed=parsed,
        text=text,
        prompt_feedback=None,
        candidates=[SimpleNamespace(finish_reason=finish_reason)],
    )


class GeminiFallbackTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.image = prepare_gemini_image(make_image_bytes())
        self.ontology = DiseaseOntology.load()

    async def verify_with(self, service: GeminiVisionService):
        return await service.verify(self.image, self.ontology)

    async def test_disabled_and_missing_configuration(self) -> None:
        disabled = GeminiVisionService(config(enabled=False))
        missing = GeminiVisionService(config(api_key=""))

        self.assertEqual(
            (await self.verify_with(disabled)).status,
            GeminiVerificationStatus.DISABLED,
        )
        self.assertEqual(
            (await self.verify_with(missing)).status,
            GeminiVerificationStatus.MISCONFIGURED,
        )

    async def test_timeout_rate_limit_network_and_server_errors(self) -> None:
        async def slow_response():
            await asyncio.sleep(0.05)
            return response(parsed=make_observation())

        cases = [
            (
                GeminiVisionService(
                    config(timeout_seconds=0.001),
                    client=FakeClient(slow_response),
                ),
                GeminiVerificationStatus.TIMEOUT,
            ),
            (
                GeminiVisionService(
                    config(),
                    client=FakeClient(errors.ClientError(429, {})),
                ),
                GeminiVerificationStatus.RATE_LIMITED,
            ),
            (
                GeminiVisionService(
                    config(),
                    client=FakeClient(ConnectionError("offline")),
                ),
                GeminiVerificationStatus.NETWORK_ERROR,
            ),
            (
                GeminiVisionService(
                    config(),
                    client=FakeClient(errors.ServerError(500, {})),
                ),
                GeminiVerificationStatus.PROVIDER_ERROR,
            ),
        ]

        for service, expected_status in cases:
            with self.subTest(status=expected_status.value):
                result = await self.verify_with(service)
                self.assertEqual(result.status, expected_status)
                self.assertTrue(result.invoked)
                self.assertIsNone(result.observation)

    async def test_invalid_schema_empty_and_refusal(self) -> None:
        cases = [
            (
                response(text="{not-json"),
                GeminiVerificationStatus.INVALID_RESPONSE,
            ),
            (
                response(text=json.dumps({"is_leaf_visible": True})),
                GeminiVerificationStatus.INVALID_RESPONSE,
            ),
            (
                response(text=""),
                GeminiVerificationStatus.EMPTY_RESPONSE,
            ),
            (
                response(text="{}", refused=True),
                GeminiVerificationStatus.REFUSED,
            ),
        ]

        for provider_response, expected_status in cases:
            with self.subTest(status=expected_status.value):
                service = GeminiVisionService(
                    config(),
                    client=FakeClient(provider_response),
                )
                result = await self.verify_with(service)
                self.assertEqual(result.status, expected_status)
                self.assertIsNone(result.observation)

    async def test_circuit_opens_after_repeated_provider_failure(self) -> None:
        client = FakeClient(errors.ServerError(500, {}))
        service = GeminiVisionService(
            config(circuit_failure_threshold=1),
            client=client,
        )

        first = await self.verify_with(service)
        second = await self.verify_with(service)

        self.assertEqual(first.status, GeminiVerificationStatus.PROVIDER_ERROR)
        self.assertEqual(second.status, GeminiVerificationStatus.CIRCUIT_OPEN)
        self.assertEqual(client.models.calls, 1)

    async def test_every_failure_preserves_valid_baseline_result(self) -> None:
        baseline = {
            "status": "uncertain",
            "prediction": "unknown",
            "display_prediction": "Uncertain Result",
            "email_notification": {"sent": False},
        }
        failure_statuses = [
            status
            for status in GeminiVerificationStatus
            if status
            not in {
                GeminiVerificationStatus.SUCCESS,
                GeminiVerificationStatus.NOT_INVOKED,
            }
        ]

        for failure_status in failure_statuses:
            with self.subTest(status=failure_status.value):
                orchestrator = HybridDiseaseOrchestrator(
                    gemini_service=ResultService(failure_status),
                    ontology=self.ontology,
                    config=HybridOrchestratorConfig(
                        confidence_threshold=0.70,
                        margin_threshold=0.15,
                        version="hybrid-v1",
                        gemini_image_max_dimension=1600,
                    ),
                )
                metadata = await orchestrator.analyze(
                    make_specialist(),
                    make_image_bytes(),
                )
                merged = {**baseline, **metadata}

                self.assertEqual(merged["status"], baseline["status"])
                self.assertEqual(merged["prediction"], baseline["prediction"])
                self.assertEqual(
                    merged["email_notification"],
                    baseline["email_notification"],
                )
                self.assertFalse(merged["hybrid_used"])
                self.assertEqual(merged["decision_source"], "efficientnet")


if __name__ == "__main__":
    unittest.main()
