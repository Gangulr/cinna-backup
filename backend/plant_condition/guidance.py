"""Bounded, optional Gemini prose for already-saved sensor assessments."""
import asyncio
from datetime import datetime, timezone
import json
import re
from typing import Literal

from fastapi import HTTPException
from google import genai
from google.genai import types
from pydantic import BaseModel, ConfigDict, Field
from starlette.concurrency import run_in_threadpool

from hybrid_disease.gemini_service import GeminiServiceConfig
from .care import enrich_check

VERSION = "sensor-care-v1"


class CareAction(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action_id: Literal["routine", "measure", "soil", "drainage", "environment", "inspect", "expert"]
    instruction: str = Field(min_length=10, max_length=350)


class CareProse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    assessment_status: Literal["OK", "ATTENTION", "UNKNOWN"]
    summary: str = Field(min_length=20, max_length=600)
    recommended_actions: list[CareAction] = Field(min_length=3, max_length=5)
    follow_up: str = Field(min_length=10, max_length=350)


def response_schema():
    def clean(value):
        if isinstance(value, dict):
            return {key: clean(item) for key, item in value.items() if key != "additionalProperties"}
        if isinstance(value, list):
            return [clean(item) for item in value]
        return value
    return clean(CareProse.model_json_schema())


class GuidanceService:
    def __init__(self, store, baseline, config=None, client=None):
        self.store, self.baseline = store, baseline
        self.config = config or GeminiServiceConfig.from_environment()
        self.client = client
        self.pending = {}
        self.semaphore = asyncio.Semaphore(self.config.max_concurrency)

    async def close(self):
        tasks = list(self.pending.values())
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        if self.client is not None:
            try:
                await self.client.aio.aclose()
            finally:
                self.client.close()

    def context(self, record):
        # Explicit allowlist: no identity, Plant ID, free-text input or account metadata.
        return {"status": record["status"], "sensor_findings": record["sensor_findings"],
                "measurement_context": {"freshness": record.get("freshness"),
                                        "input_mode": record.get("input_mode")},
                "approved_guidance": record["basic_guidance"]}

    def validate_prose(self, response, record):
        feedback = getattr(response, "prompt_feedback", None)
        blocked = getattr(feedback, "block_reason", None)
        blocked = getattr(blocked, "value", blocked)
        if blocked and str(blocked).upper() not in {"0", "NONE", "BLOCK_REASON_UNSPECIFIED"}:
            raise ValueError("Provider refused guidance.")
        for candidate in getattr(response, "candidates", None) or []:
            reason = str(getattr(candidate, "finish_reason", "")).upper()
            if any(code in reason for code in ("MAX_TOKENS", "SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED", "SPII")):
                raise ValueError("Provider output is incomplete or refused.")
        parsed = getattr(response, "parsed", None)
        prose = CareProse.model_validate(parsed) if isinstance(parsed, dict) else (
            parsed if isinstance(parsed, CareProse) else CareProse.model_validate_json(response.text))
        allowed = {action["action_id"] for action in record["basic_guidance"]["recommended_actions"]}
        ids = [action.action_id for action in prose.recommended_actions]
        if prose.assessment_status != record["status"] or set(ids) != allowed or len(ids) != len(set(ids)):
            raise ValueError("Guidance must preserve the assessment and approved actions.")
        text = " ".join([prose.summary, prose.follow_up, *(action.instruction for action in prose.recommended_actions)])
        if re.search(r"\d|https?://|<[^>]+>|\b(pesticid\w*|fungicid\w*|insecticid\w*|fertili[sz]\w*|dosage|dose|litres?|liters?|millilit\w*)\b", text, re.I):
            raise ValueError("Guidance includes unsupported treatment or numerical advice.")
        if re.search(r"\b(disease[- ]free|plant is healthy|plant is unhealthy|plant has|diagnos\w*|guarantee\w*|probability)\b", text, re.I):
            raise ValueError("Guidance includes an unsupported health claim.")
        if record["status"] != "OK" and re.search(r"\b(no action (?:is )?needed|all readings are normal|conditions are optimal)\b", text, re.I):
            raise ValueError("Guidance contradicts the assessment.")
        anchors = {"routine": r"routine|usual|regular|monitor", "measure": r"measur|sensor|calibrat",
                   "soil": r"soil", "drainage": r"drain|standing water", "environment": r"shade|airflow|sun|exposure",
                   "inspect": r"inspect|observ|examin|check", "expert": r"agronom|expert|specialist"}
        if any(not re.search(anchors[action.action_id], action.instruction, re.I) for action in prose.recommended_actions):
            raise ValueError("Guidance departs from the selected care actions.")
        if record.get("freshness") in ("stale", "unknown", "future") and not re.search(r"current|fresh|new measur", prose.follow_up, re.I):
            raise ValueError("Guidance must request current measurements for unverified snapshots.")
        return prose

    async def get(self, record_id, user_id):
        record = await run_in_threadpool(self.store.check, record_id, user_id)
        cached = record.get("care_guidance")
        if cached and cached.get("version") == VERSION:
            return {"status": "ready", "guidance": cached}
        # Each authenticated request checks ownership before joining the shared task.
        if record_id not in self.pending:
            task = asyncio.create_task(self.generate(enrich_check(record, self.baseline)))
            self.pending[record_id] = task
            def remove(completed):
                if self.pending.get(record_id) is completed:
                    self.pending.pop(record_id, None)
                if not completed.cancelled():
                    completed.exception()
            task.add_done_callback(remove)
        return await asyncio.shield(self.pending[record_id])

    async def generate(self, record):
        unavailable = {"status": "unavailable", "guidance": None,
                       "message": "AI guidance is temporarily unavailable."}
        if not self.config.enabled or not self.config.api_key or not self.config.model:
            return unavailable
        try:
            async def request():
                async with self.semaphore:
                    if self.client is None:
                        self.client = genai.Client(api_key=self.config.api_key, http_options=types.HttpOptions(
                            timeout=int(self.config.timeout_seconds * 1000), retry_options=types.HttpRetryOptions(attempts=1)))
                    return await self.client.aio.models.generate_content(
                        model=self.config.model, contents=json.dumps(self.context(record)),
                        config=types.GenerateContentConfig(
                            system_instruction=("Write concise professional cinnamon sensor-care guidance in plain English. "
                                "Rewrite only the supplied approved guidance and use every approved action_id exactly once. "
                                "Preserve the supplied assessment_status. Describe sensor conditions, never diagnose plant health. "
                                "Observed ranges are reference data, not universal healthy limits. An unusual combination "
                                "does not identify a faulty individual sensor. Historical readings do not describe current conditions. "
                                "Do not invent symptoms, diseases, treatments, quantities, numeric values, confidence or links. "
                                "Actions must remain conditional inspections and measurement checks, not treatment prescriptions. "
                                "Return the requested JSON summary, recommended_actions and follow_up."),
                            # Gemini 3 counts thinking against the output allowance;
                            # this short rewrite needs low reasoning and room for complete JSON.
                            thinking_config=types.ThinkingConfig(thinking_level="low")
                                if self.config.model.startswith("gemini-3") else None,
                            max_output_tokens=2048, response_mime_type="application/json", response_schema=response_schema()))
            response = await asyncio.wait_for(request(), timeout=self.config.timeout_seconds)
            prose = self.validate_prose(response, record)
            guidance = {**prose.model_dump(exclude={"assessment_status"}), "source": "ai", "provider": "Gemini",
                        "model": self.config.model, "version": VERSION,
                        "generated_at": datetime.now(timezone.utc).isoformat()}
            saved = await run_in_threadpool(self.store.save_guidance, record["record_id"], record["user_id"], guidance)
            return {"status": "ready", "guidance": saved}
        except HTTPException:
            raise
        except Exception:
            # The saved assessment remains usable for all provider/storage failures.
            return unavailable
