"""Authenticated condition routes, composed without importing the main application."""
from datetime import datetime, timezone
import math
import re

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.routing import APIRoute
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from google.api_core.exceptions import GoogleAPICallError, RetryError

from .schemas import ConditionCheck, HealthObservation, ObservationReview, PlantRegistration, ID_PATTERN
from .interactive import check_condition
from .sensors import utc_timestamp


class DatabaseAwareRoute(APIRoute):
    def get_route_handler(self):
        handler = super().get_route_handler()

        async def guarded(request):
            try:
                return await handler(request)
            except RequestValidationError as exc:
                # Invalid JSON NaN/Infinity must produce 422, not fail error serialization.
                def safe(value):
                    if isinstance(value, float) and not math.isfinite(value):
                        return str(value)
                    if isinstance(value, dict):
                        return {key: safe(item) for key, item in value.items()}
                    if isinstance(value, list):
                        return [safe(item) for item in value]
                    return value
                return JSONResponse(status_code=422, content={"detail": safe(jsonable_encoder(exc.errors()))})
            except (GoogleAPICallError, RetryError):
                raise HTTPException(503, "Plant monitoring storage is temporarily unavailable.")
        return guarded


def create_router(service, get_current_user, require_admin):
    router = APIRouter(tags=["Plant condition"], route_class=DatabaseAwareRoute)

    @router.post("/plant-condition-check")
    def check(body: ConditionCheck, user=Depends(get_current_user)):
        return check_condition(service, body, user)

    @router.post("/plant-condition-checks/{record_id}/guidance")
    async def guidance(record_id: str, user=Depends(get_current_user)):
        if not re.fullmatch(r"[a-f0-9]{64}", record_id):
            raise HTTPException(422, "Invalid condition check identifier.")
        return await service.guidance.get(record_id, user["uid"])

    @router.get("/plant-condition-history")
    def check_history(plant_id: str | None = Query(None, min_length=1, max_length=100),
                      limit: int = Query(50, ge=1, le=100), user=Depends(get_current_user)):
        if plant_id is not None and not plant_id.strip():
            raise HTTPException(422, "Enter a nonempty Plant ID.")
        return service.store.check_history(user["uid"], plant_id.strip() if plant_id else None, limit)

    def checked_plant(plant_id, user):
        if not re.fullmatch(ID_PATTERN, plant_id):
            raise HTTPException(422, "Invalid plant identifier.")
        return service.store.plant(plant_id, user)

    @router.get("/plants")
    def plants(user=Depends(get_current_user)):
        return service.store.plants(user)

    @router.post("/admin/plants")
    def register(body: PlantRegistration, user=Depends(require_admin)):
        return service.store.register(body.model_dump(), user["uid"])

    @router.get("/plants/{plant_id}/condition")
    def condition(plant_id: str, user=Depends(get_current_user)):
        return service.current(checked_plant(plant_id, user))

    @router.get("/plants/{plant_id}/condition-history")
    def history(plant_id: str, limit: int = Query(100, ge=1, le=500), user=Depends(get_current_user)):
        checked_plant(plant_id, user)
        return service.store.history(plant_id, limit)

    @router.get("/plants/{plant_id}/health-observations")
    def observations(plant_id: str, user=Depends(get_current_user)):
        checked_plant(plant_id, user)
        return service.store.observations(plant_id)

    @router.post("/plants/{plant_id}/health-observations")
    def observe(plant_id: str, body: HealthObservation, user=Depends(get_current_user)):
        plant = checked_plant(plant_id, user)
        now = datetime.now(timezone.utc)
        if body.inspected_at > now:
            raise HTTPException(422, "Inspection time cannot be in the future.")
        assessment = None
        if body.assessment_id:
            assessment = service.store.assessment(body.assessment_id)
            if not assessment or assessment["plant_id"] != plant_id:
                raise HTTPException(422, "Assessment does not belong to this plant.")
            if utc_timestamp(assessment["observed_at"]) > body.inspected_at:
                raise HTTPException(422, "A related sensor reading cannot occur after the inspection.")
        # A reported label is not a training label until independently reviewed.
        record = {**body.model_dump(mode="json"), "plant_id": plant_id,
                  "owner_id": plant["owner_id"], "reported_by": user["uid"],
                  "reported_at": now.isoformat(), "device_id": assessment["device_id"] if assessment else plant["device_id"],
                  "sensor_reading": assessment.get("reading") if assessment else None,
                  "sensor_to_inspection_seconds": (body.inspected_at - utc_timestamp(assessment["observed_at"])).total_seconds() if assessment else None,
                  "review_status": "pending", "confirmed_label": None,
                  "training_label": None, "reviewed_by": None}
        return service.store.add_observation(record)

    @router.post("/admin/plants/{plant_id}/health-observations/{observation_id}/review")
    def review(plant_id: str, observation_id: str, body: ObservationReview, user=Depends(require_admin)):
        checked_plant(plant_id, user)
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", observation_id):
            raise HTTPException(422, "Invalid inspection identifier.")
        label = {"healthy": 0, "unhealthy": 1}.get(body.confirmed_label)
        return service.store.review_observation(plant_id, observation_id, {
            **body.model_dump(), "review_status": "reviewed", "training_label": label,
            "reviewed_by": user["uid"], "reviewed_at": datetime.now(timezone.utc).isoformat(),
        })

    return router
