from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .sensors import utc_timestamp

Identifier = str
ID_PATTERN = r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$"


class PlantRegistration(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    plant_id: Identifier = Field(pattern=ID_PATTERN)
    owner_id: str = Field(min_length=1, max_length=128, pattern=r"^[^/]+$")
    device_id: Identifier = Field(pattern=ID_PATTERN)
    calibration_id: str = Field(min_length=1, max_length=100)
    expected_interval_seconds: int = Field(ge=1, le=604800)
    source_kind: Literal["device", "legacy"] = "device"
    active: bool = True


class HealthObservation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    inspected_at: datetime
    assessment_id: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")
    reported_label: Literal["healthy", "unhealthy", "unknown"]
    symptoms: str = Field(default="", max_length=2000)
    interventions: str = Field(default="", max_length=2000)
    inspection_kind: Literal["routine", "alert_triggered"] = "routine"

    @field_validator("inspected_at", mode="before")
    @classmethod
    def timezone_required(cls, value):
        if isinstance(value, datetime):
            if value.tzinfo is None:
                raise ValueError("Inspection time must include its timezone.")
            return value
        return utc_timestamp(value)


class ObservationReview(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    confirmed_label: Literal["healthy", "unhealthy", "unknown"]
    review_notes: str = Field(min_length=1, max_length=2000)


class InputOrigins(BaseModel):
    model_config = ConfigDict(extra="forbid")
    temperature: Literal["iot", "manual"] = "manual"
    humidity: Literal["iot", "manual"] = "manual"
    moisture: Literal["iot", "manual"] = "manual"


class LiveSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    temperature: float | None = Field(default=None, ge=-50, le=100)
    humidity: float | None = Field(default=None, ge=0, le=100)
    moisture: float | None = Field(default=None, ge=0, le=100)
    battery: float | None = Field(default=None, ge=0, le=100)
    timestamp: str = Field(default="", max_length=128)
    observed_at: str | None = Field(default=None, max_length=128)
    fetched_at: str = Field(max_length=128)
    source: str = Field(default="Firebase RTDB - ESP32", max_length=128)
    source_record_id: str = Field(max_length=500)
    freshness: Literal["fresh", "stale", "unknown", "future"]
    age_seconds: float | None = None
    stale_after_seconds: float | None = None
    missing_fields: list[Literal["temperature", "humidity", "moisture"]] = Field(default_factory=list, max_length=3)
    warnings: list[str] = Field(default_factory=list, max_length=10)

    @field_validator("observed_at", "fetched_at")
    @classmethod
    def normalized_timestamp(cls, value):
        if value is None:
            return value
        return utc_timestamp(value).isoformat()


class ConditionCheck(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True, allow_inf_nan=False)
    request_id: UUID
    plant_id: str = Field(min_length=1, max_length=100)
    temperature: float = Field(ge=-50, le=100)
    humidity: float = Field(ge=0, le=100)
    moisture: float = Field(ge=0, le=100)
    input_origins: InputOrigins = Field(default_factory=InputOrigins)
    live_snapshot: LiveSnapshot | None = None

    @field_validator("temperature", "humidity", "moisture", mode="before")
    @classmethod
    def actual_number_required(cls, value):
        if isinstance(value, bool) or value is None or isinstance(value, str) and not value.strip():
            raise ValueError("Enter a finite sensor measurement.")
        return value

    @model_validator(mode="after")
    def matching_snapshot_required(self):
        for name, origin in self.input_origins.model_dump().items():
            if origin == "iot" and (self.live_snapshot is None or
                                     getattr(self.live_snapshot, name) != getattr(self, name)):
                raise ValueError("IoT-origin values must match the submitted fetched snapshot.")
        return self
