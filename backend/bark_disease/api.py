"""Authenticated bark routes with independent history and no cloud/image side effects."""
from datetime import datetime, timezone
import logging

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from .model import BarkModelUnavailable, InvalidBarkImage
from .schemas import BarkPrediction


LOGGER = logging.getLogger(__name__)
COLLECTION = "bark_disease_predictions"
MAX_UPLOAD_BYTES = 10 * 1024 * 1024
LABELS = {"RoughBark": "Rough Bark", "StripeCanker": "Stripe Canker"}


def describe_result(result):
    if result["status"] == "experimental_candidate":
        label = LABELS[result["candidate_class"]]
        observation = ("Inspect the affected bark and document the extent of roughened areas."
                       if result["candidate_class"] == "RoughBark" else
                       "Inspect the affected stem and document the extent of visible bark changes.")
        message = "A possible cinnamon bark condition was identified. This experimental finding requires review."
        solutions = [observation,
                     f"Consult a qualified plant-health specialist to confirm the possible {label} finding before choosing treatment."]
        prevention = ["Monitor nearby stems and new growth for similar visible changes.",
                      "Ask a plant-health specialist for prevention advice specific to the confirmed condition."]
    elif result["reason"] == "outside_known_disease_bark_reference":
        message = "No supported bark disease could be assigned from this image."
        solutions = ["Retake a clear, well-lit close-up with the affected bark filling the frame.",
                     "Consult a plant-health specialist if visible bark changes persist."]
        prevention = []
    else:
        message = "The result is uncertain. Any displayed disease name is a candidate for review."
        solutions = ["Try another clear photograph of the affected bark.",
                     "Consult a qualified plant-health specialist before choosing treatment."]
        prevention = []
    return {"message": message, "solutions": solutions, "prevention": prevention,
            "recommendations": solutions + prevention}


def create_router(model, get_current_user, save_to_firebase, get_user_history):
    router = APIRouter(tags=["Bark disease"])

    @router.post("/bark-disease-predict", response_model=BarkPrediction, include_in_schema=False)
    @router.post("/bark-disease-predict/", response_model=BarkPrediction)
    def predict(file: UploadFile = File(...), user=Depends(get_current_user)):
        # A synchronous route keeps decoding, locked TensorFlow inference and Firestore
        # writes in FastAPI's worker pool, rather than blocking the async event loop.
        if not model.ready:
            raise HTTPException(503, "Bark analysis is temporarily unavailable.")
        if file.content_type and file.content_type not in {"image/jpeg", "image/png", "image/webp"}:
            raise HTTPException(400, "Please upload a JPEG, PNG or WebP image.")
        image_bytes = file.file.read(MAX_UPLOAD_BYTES + 1)
        if not image_bytes:
            raise HTTPException(400, "The uploaded image is empty.")
        if len(image_bytes) > MAX_UPLOAD_BYTES:
            raise HTTPException(413, "The image exceeds the 10 MB upload limit.")
        try:
            result = model.predict(image_bytes)
        except InvalidBarkImage as exc:
            raise HTTPException(400, str(exc)) from exc
        except BarkModelUnavailable as exc:
            raise HTTPException(503, "Bark analysis is temporarily unavailable.") from exc
        except Exception as exc:
            LOGGER.exception("Bark inference failed")
            raise HTTPException(500, "Bark analysis could not be completed.") from exc
        guidance = describe_result(result)
        now = datetime.now(timezone.utc).isoformat()
        response = BarkPrediction.model_validate({
            **result, "display_prediction": LABELS.get(result["candidate_class"]),
            **guidance,
            "model_version": model.metadata["model_version"],
            "model_sha256": model.metadata["artifact_sha256"],
            "prediction_time": now, "created_at": now,
            "uploaded_filename": (file.filename or "").replace("\\", "/").rsplit("/", 1)[-1][:255],
            "user_id": user["uid"], "user_email": user.get("email", ""),
            "user_name": user.get("fullName", ""),
        })
        # Validate/convert NumPy values before persistence. Store no image bytes or embeddings.
        record = response.model_dump(mode="json", by_alias=True, exclude={"database_saved", "record_id"})
        try:
            saved = save_to_firebase(COLLECTION, record)
            response.database_saved = bool(saved["saved"])
            response.record_id = saved["id"] if response.database_saved else None
        except Exception:
            LOGGER.exception("Bark history save failed; returning the completed assessment")
        return response

    @router.get("/bark-disease-history", include_in_schema=False)
    @router.get("/bark-disease-history/")
    def history(user=Depends(get_current_user)):
        return get_user_history(COLLECTION, user)

    return router
