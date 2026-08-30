"""Async Gemini provider adapter with bounded failure behavior."""

from __future__ import annotations

import asyncio
import os
import time
from dataclasses import dataclass
from typing import Any

from google import genai
from google.genai import errors, types
from pydantic import ValidationError

from .image_processing import PreparedGeminiImage
from .ontology import DiseaseOntology
from .schemas import (
    GeminiObservation,
    GeminiVerificationResult,
    GeminiVerificationStatus,
)


def _gemini_response_schema() -> dict[str, Any]:
    """Return the strict observation schema in Gemini's supported subset."""

    def remove_unsupported(value: Any) -> Any:
        if isinstance(value, dict):
            return {
                key: remove_unsupported(item)
                for key, item in value.items()
                if key != "additionalProperties"
            }

        if isinstance(value, list):
            return [remove_unsupported(item) for item in value]

        return value

    return remove_unsupported(
        GeminiObservation.model_json_schema()
    )


GEMINI_RESPONSE_SCHEMA = _gemini_response_schema()


def _read_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)

    if raw is None:
        return default

    normalized = raw.strip().lower()

    if normalized in {"1", "true", "yes", "on"}:
        return True

    if normalized in {"0", "false", "no", "off"}:
        return False

    return default


def _read_positive_int(name: str, default: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError:
        return default

    return value if value > 0 else default


def _read_positive_float(name: str, default: float) -> float:
    try:
        value = float(os.getenv(name, str(default)))
    except ValueError:
        return default

    return value if value > 0 else default


@dataclass(frozen=True)
class GeminiServiceConfig:
    enabled: bool
    api_key: str
    model: str
    timeout_seconds: float
    max_concurrency: int
    circuit_failure_threshold: int
    circuit_cooldown_seconds: float

    @classmethod
    def from_environment(cls) -> "GeminiServiceConfig":
        return cls(
            enabled=_read_bool("GEMINI_ENABLED", False),
            api_key=os.getenv("GEMINI_API_KEY", "").strip(),
            model=os.getenv("GEMINI_MODEL", "").strip(),
            timeout_seconds=_read_positive_float(
                "GEMINI_TIMEOUT_SECONDS",
                15.0,
            ),
            max_concurrency=_read_positive_int(
                "GEMINI_MAX_CONCURRENCY",
                2,
            ),
            circuit_failure_threshold=_read_positive_int(
                "GEMINI_CIRCUIT_FAILURE_THRESHOLD",
                3,
            ),
            circuit_cooldown_seconds=_read_positive_float(
                "GEMINI_CIRCUIT_COOLDOWN_SECONDS",
                120.0,
            ),
        )


class GeminiVisionService:
    """Provider-only service. It never selects the final application result."""

    def __init__(
        self,
        config: GeminiServiceConfig | None = None,
        *,
        client: Any | None = None,
    ) -> None:
        self.config = config or GeminiServiceConfig.from_environment()
        self._client = client
        self._semaphore = asyncio.Semaphore(self.config.max_concurrency)
        self._circuit_lock = asyncio.Lock()
        self._consecutive_provider_failures = 0
        self._circuit_opened_at: float | None = None
        self._probe_in_progress = False

    @property
    def model_name(self) -> str | None:
        return self.config.model or None

    def startup_summary(self) -> dict[str, Any]:
        return {
            "enabled": self.config.enabled,
            "model": self.config.model or "not configured",
            "timeout_seconds": self.config.timeout_seconds,
            "max_concurrency": self.config.max_concurrency,
        }

    async def close(self) -> None:
        if self._client is None:
            return

        try:
            await self._client.aio.aclose()
        except Exception:
            pass

        try:
            self._client.close()
        except Exception:
            pass

    def _ensure_client(self) -> Any:
        if self._client is None:
            self._client = genai.Client(
                api_key=self.config.api_key,
                http_options=types.HttpOptions(
                    timeout=int(self.config.timeout_seconds * 1000),
                    retry_options=types.HttpRetryOptions(attempts=1),
                ),
            )

        return self._client

    async def _can_attempt_provider(self) -> bool:
        async with self._circuit_lock:
            if self._circuit_opened_at is None:
                return True

            elapsed = time.monotonic() - self._circuit_opened_at

            if elapsed < self.config.circuit_cooldown_seconds:
                return False

            if self._probe_in_progress:
                return False

            self._probe_in_progress = True
            return True

    async def _record_provider_success(self) -> None:
        async with self._circuit_lock:
            self._consecutive_provider_failures = 0
            self._circuit_opened_at = None
            self._probe_in_progress = False

    async def _record_provider_failure(self) -> None:
        async with self._circuit_lock:
            self._probe_in_progress = False
            self._consecutive_provider_failures += 1

            if (
                self._consecutive_provider_failures
                >= self.config.circuit_failure_threshold
            ):
                self._circuit_opened_at = time.monotonic()

    async def _call_provider(
        self,
        image: PreparedGeminiImage,
        ontology: DiseaseOntology,
    ) -> Any:
        client = self._ensure_client()

        return await client.aio.models.generate_content(
            model=self.config.model,
            contents=[
                "Independently analyze this uploaded cinnamon-leaf image.",
                types.Part.from_bytes(
                    data=image.canonical_bytes,
                    mime_type=image.mime_type,
                ),
            ],
            config=types.GenerateContentConfig(
                system_instruction=ontology.gemini_instruction(),
                max_output_tokens=500,
                response_mime_type="application/json",
                # The SDK's Schema type currently exposes an
                # `additional_properties` field that this Gemini endpoint
                # rejects. Send the same schema without that transport-only
                # keyword, then strictly validate the response with Pydantic.
                response_schema=GEMINI_RESPONSE_SCHEMA,
            ),
        )

    @staticmethod
    def _response_was_refused(response: Any) -> bool:
        prompt_feedback = getattr(response, "prompt_feedback", None)
        block_reason = getattr(prompt_feedback, "block_reason", None)

        if block_reason and str(block_reason).upper() not in {"0", "NONE"}:
            return True

        for candidate in getattr(response, "candidates", None) or []:
            finish_reason = str(getattr(candidate, "finish_reason", "")).upper()

            if any(
                marker in finish_reason
                for marker in ("SAFETY", "BLOCK", "PROHIBITED", "RECITATION")
            ):
                return True

        return False

    @staticmethod
    def _parse_observation(response: Any) -> GeminiObservation:
        parsed = getattr(response, "parsed", None)

        if isinstance(parsed, GeminiObservation):
            return parsed

        if isinstance(parsed, dict):
            return GeminiObservation.model_validate(parsed)

        text = getattr(response, "text", None)

        if not text or not str(text).strip():
            raise LookupError("empty_response")

        return GeminiObservation.model_validate_json(str(text))

    @staticmethod
    def _normalize_provider_error(error: Exception) -> GeminiVerificationStatus:
        if isinstance(error, (asyncio.TimeoutError, TimeoutError)):
            return GeminiVerificationStatus.TIMEOUT

        if isinstance(error, errors.APIError):
            if error.code == 429:
                return GeminiVerificationStatus.RATE_LIMITED

            if error.code is not None and error.code >= 500:
                return GeminiVerificationStatus.PROVIDER_ERROR

            return GeminiVerificationStatus.PROVIDER_ERROR

        if isinstance(error, (ConnectionError, OSError)):
            return GeminiVerificationStatus.NETWORK_ERROR

        error_name = type(error).__name__.lower()

        if any(marker in error_name for marker in ("connect", "network", "transport")):
            return GeminiVerificationStatus.NETWORK_ERROR

        return GeminiVerificationStatus.PROVIDER_ERROR

    def _failure_result(
        self,
        status: GeminiVerificationStatus,
        *,
        invoked: bool,
        latency_ms: int | None = None,
        failure_code: str | None = None,
    ) -> GeminiVerificationResult:
        return GeminiVerificationResult(
            invoked=invoked,
            status=status,
            model=self.model_name,
            latency_ms=latency_ms,
            failure_code=failure_code or status.value,
        )

    async def verify(
        self,
        image: PreparedGeminiImage,
        ontology: DiseaseOntology,
    ) -> GeminiVerificationResult:
        if not self.config.enabled:
            return self._failure_result(
                GeminiVerificationStatus.DISABLED,
                invoked=False,
            )

        if not self.config.api_key or not self.config.model:
            return self._failure_result(
                GeminiVerificationStatus.MISCONFIGURED,
                invoked=False,
                failure_code="missing_api_key_or_model",
            )

        if not await self._can_attempt_provider():
            return self._failure_result(
                GeminiVerificationStatus.CIRCUIT_OPEN,
                invoked=False,
            )

        started = time.monotonic()

        async with self._semaphore:
            try:
                response = await asyncio.wait_for(
                    self._call_provider(image, ontology),
                    timeout=self.config.timeout_seconds,
                )
                latency_ms = max(0, int((time.monotonic() - started) * 1000))

                if self._response_was_refused(response):
                    await self._record_provider_failure()
                    return self._failure_result(
                        GeminiVerificationStatus.REFUSED,
                        invoked=True,
                        latency_ms=latency_ms,
                    )

                try:
                    observation = self._parse_observation(response)
                except LookupError:
                    await self._record_provider_failure()
                    return self._failure_result(
                        GeminiVerificationStatus.EMPTY_RESPONSE,
                        invoked=True,
                        latency_ms=latency_ms,
                    )
                except (ValidationError, ValueError, TypeError):
                    await self._record_provider_failure()
                    return self._failure_result(
                        GeminiVerificationStatus.INVALID_RESPONSE,
                        invoked=True,
                        latency_ms=latency_ms,
                    )

                await self._record_provider_success()

                return GeminiVerificationResult(
                    invoked=True,
                    status=GeminiVerificationStatus.SUCCESS,
                    observation=observation,
                    model=self.config.model,
                    latency_ms=latency_ms,
                    failure_code=None,
                )

            except Exception as error:
                latency_ms = max(0, int((time.monotonic() - started) * 1000))
                normalized_status = self._normalize_provider_error(error)
                await self._record_provider_failure()

                return self._failure_result(
                    normalized_status,
                    invoked=True,
                    latency_ms=latency_ms,
                )
