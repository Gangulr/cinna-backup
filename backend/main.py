from datetime import datetime
from email.message import EmailMessage
from html import escape
from pathlib import Path
from typing import Any, Dict

import csv
import hashlib
import io
import json
import os
import random
import smtplib
import ssl

import numpy as np
import pandas as pd
import requests
import tensorflow as tf

from dotenv import load_dotenv

from fastapi import (
    Depends,
    FastAPI,
    File,
    HTTPException,
    UploadFile,
    status,
)

from fastapi.middleware.cors import CORSMiddleware

from PIL import Image, ImageOps, UnidentifiedImageError

from pydantic import BaseModel

from sklearn.ensemble import RandomForestRegressor

from hybrid_disease import (
    HybridDiseaseOrchestrator,
    SpecialistPredictionResult,
    TopPrediction,
)

# Load backend configuration before importing firebase_auth because that
# module initializes Firebase as soon as it is imported.
BASE_DIR = Path(__file__).resolve().parent

load_dotenv(
    dotenv_path=BASE_DIR / ".env"
)

from firebase_auth import (
    db,
    get_current_user,
    require_admin,
)


# =========================================================
# ENVIRONMENT
# =========================================================

# =========================================================
# FASTAPI APPLICATION
# =========================================================

app = FastAPI(
    title="CinnaAI Backend API",
    description=(
        "AI and IoT powered cinnamon monitoring system."
    ),
    version="1.0.0",
)


# =========================================================
# CONFIGURATION
# =========================================================

RTDB_URL = os.getenv(
    "FIREBASE_SENSOR_DATABASE_URL",
    (
        "https://smart-environment-cd7ca-default-rtdb."
        "asia-southeast1.firebasedatabase.app"
    ),
).rstrip("/")

GROWTH_DATASET_PATH = (
    BASE_DIR / "Dataset/csv/cinnamon_growth_dataset.csv"
)

HARVEST_DATASET_PATH = (
    BASE_DIR / "Dataset/csv/harvest_readiness_dataset.csv"
)

DISEASE_MODEL_PATH = (
    BASE_DIR / "cinnamon_multi_part_model.h5"
)

DISEASE_CLASS_NAMES_PATH = (
    BASE_DIR / "class_names.json"
)

EXPECTED_DISEASE_CLASS_NAMES = [
    "healthy_cinnamon",
    "leaf_blight",
    "leaf_miner_attack",
    "leaf_patches_fungal",
    "lower_leaf_gall",
    "non_cinnamon",
    "upper_leaf_gall",
]


def get_probability_threshold(
    variable_name: str,
    default_value: float,
) -> float:
    try:
        value = float(
            os.getenv(
                variable_name,
                str(default_value),
            )
        )
    except ValueError:
        return default_value

    if 0.0 <= value <= 1.0:
        return value

    return default_value


CONFIDENCE_THRESHOLD = get_probability_threshold(
    "DISEASE_CONFIDENCE_THRESHOLD",
    0.70,
)

MARGIN_THRESHOLD = get_probability_threshold(
    "DISEASE_MARGIN_THRESHOLD",
    0.15,
)

try:
    MAX_DISEASE_IMAGE_BYTES = int(
        float(
            os.getenv(
                "DISEASE_MAX_UPLOAD_MB",
                "10",
            )
        )
        * 1024
        * 1024
    )
except ValueError:
    MAX_DISEASE_IMAGE_BYTES = 10 * 1024 * 1024

if MAX_DISEASE_IMAGE_BYTES <= 0:
    MAX_DISEASE_IMAGE_BYTES = 10 * 1024 * 1024


hybrid_disease_orchestrator = (
    HybridDiseaseOrchestrator.from_environment(
        default_confidence_threshold=(
            CONFIDENCE_THRESHOLD
        ),
        default_margin_threshold=(
            MARGIN_THRESHOLD
        ),
    )
)

hybrid_startup = (
    hybrid_disease_orchestrator.startup_summary()
)

print(
    "Gemini enabled:",
    str(hybrid_startup["enabled"]).lower(),
)
print(
    "Gemini model:",
    hybrid_startup["model"],
)
print(
    "Hybrid shadow mode:",
    str(hybrid_startup["shadow_mode"]).lower(),
)
print(
    "Hybrid thresholds:",
    (
        "confidence="
        f"{hybrid_startup['confidence_threshold']} "
        "margin="
        f"{hybrid_startup['margin_threshold']}"
    ),
)


@app.on_event("shutdown")
async def close_hybrid_disease_service() -> None:
    await hybrid_disease_orchestrator.gemini_service.close()


SMTP_HOST = os.getenv(
    "SMTP_HOST",
    "smtp.gmail.com",
)

SMTP_PORT = int(
    os.getenv(
        "SMTP_PORT",
        "465",
    )
)

SMTP_EMAIL = os.getenv(
    "SMTP_EMAIL",
    "",
).strip()

SMTP_APP_PASSWORD = os.getenv(
    "SMTP_APP_PASSWORD",
    "",
).replace(" ", "").strip()

SMTP_FROM_NAME = os.getenv(
    "SMTP_FROM_NAME",
    "CinnaAI Notifications",
).strip()

SMTP_ENABLED = bool(
    SMTP_EMAIL
    and SMTP_APP_PASSWORD
)


DEFAULT_NOTIFICATION_SETTINGS = {
    "emailNotifications": True,
    "diseaseAlerts": True,
    "growthUpdates": True,
    "harvestAlerts": True,
    "sensorAlerts": True,
}


GROWTH_CSV_HEADERS = [
    "user_id",
    "user_email",
    "plant_id",
    "date",
    "temperature",
    "humidity",
    "soil_moisture",
    "plant_age_months",
    "bark_thickness_mm",
    "growth_value",
    "harvest_status",
]


HARVEST_CSV_HEADERS = [
    "user_id",
    "user_email",
    "plant_id",
    "date",
    "age",
    "growth_rate",
    "bark_thickness",
    "disease_status",
    "current_month",
    "bark_quality",
    "maturity_level",
    "health_status",
    "readiness_score",
    "readiness_status",
    "robotic_action",
]


# =========================================================
# CORS
# =========================================================

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "https://cinna-ai-research.vercel.app",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# =========================================================
# PYDANTIC MODELS
# =========================================================

class SensorData(BaseModel):
    temperature: float
    humidity: float
    moisture: float
    plant_id: str = "P-001"
    plant_age_months: int = 18


class HarvestData(BaseModel):
    plant_id: str
    age: int
    growth_rate: float
    bark_thickness: float
    disease_status: str
    current_month: str
    bark_quality: float
    maturity_level: float
    health_status: float


# =========================================================
# FIRESTORE HELPERS
# =========================================================

def save_to_firebase(
    collection_name: str,
    data: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Save a new document into a Firestore collection.
    """

    try:
        document_reference = (
            db.collection(collection_name)
            .document()
        )

        document_reference.set(data)

        return {
            "saved": True,
            "id": document_reference.id,
        }

    except Exception as error:
        print(
            f"Firestore save error in {collection_name}:",
            error,
        )

        return {
            "saved": False,
            "id": None,
        }


def get_user_history(
    collection_name: str,
    current_user: Dict[str, Any],
) -> list[Dict[str, Any]]:
    """
    Admin users receive all records.

    Normal users receive only records containing
    their own user_id.
    """

    try:
        documents = (
            db.collection(collection_name)
            .stream()
        )

        history: list[Dict[str, Any]] = []

        for document in documents:
            item = document.to_dict() or {}
            item["id"] = document.id

            if current_user.get("role") == "admin":
                history.append(item)

            elif item.get("user_id") == current_user.get(
                "uid"
            ):
                history.append(item)

        history.sort(
            key=lambda value: value.get(
                "prediction_time",
                "",
            ),
            reverse=True,
        )

        return history

    except Exception as error:
        print(
            f"Firestore history error in {collection_name}:",
            error,
        )

        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unable to load history records.",
        )


# =========================================================
# EMAIL NOTIFICATION HELPERS
# =========================================================

def get_notification_settings(
    user_id: str,
) -> Dict[str, bool]:
    """
    Read a user's notification settings from Firestore.

    Default settings are returned when the user document
    or notificationSettings map does not exist.
    """

    settings = dict(
        DEFAULT_NOTIFICATION_SETTINGS
    )

    if not user_id:
        return settings

    try:
        user_snapshot = (
            db.collection("users")
            .document(user_id)
            .get()
        )

        if not user_snapshot.exists:
            return settings

        user_data = (
            user_snapshot.to_dict()
            or {}
        )

        saved_settings = user_data.get(
            "notificationSettings",
            {},
        )

        if isinstance(
            saved_settings,
            dict,
        ):
            for key in settings:
                saved_value = (
                    saved_settings.get(key)
                )

                if isinstance(
                    saved_value,
                    bool,
                ):
                    settings[key] = saved_value

        return settings

    except Exception as error:
        print(
            "Notification settings read error:",
            error,
        )

        return settings


def email_not_sent(
    reason: str,
) -> Dict[str, Any]:
    return {
        "sent": False,
        "reason": reason,
    }


def send_email_notification(
    recipient_email: str,
    subject: str,
    title: str,
    message: str,
    details: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    """
    Send a CinnaAI HTML email through Gmail SMTP.

    Email errors never stop an AI prediction from being
    returned or saved.
    """

    if not SMTP_ENABLED:
        return email_not_sent(
            "SMTP is not configured in the backend .env file."
        )

    if not recipient_email:
        return email_not_sent(
            "The authenticated user has no email address."
        )

    safe_title = escape(
        str(title)
    )

    safe_message = escape(
        str(message)
    )

    detail_rows = ""

    for key, value in (
        details or {}
    ).items():
        safe_key = escape(
            str(key)
        )

        safe_value = escape(
            str(value)
        )

        detail_rows += f"""
            <tr>
                <td style="
                    padding: 10px 12px;
                    border-bottom: 1px solid #e2e8f0;
                    color: #64748b;
                    font-size: 13px;
                    font-weight: 600;
                ">
                    {safe_key}
                </td>

                <td style="
                    padding: 10px 12px;
                    border-bottom: 1px solid #e2e8f0;
                    color: #0f172a;
                    font-size: 13px;
                    text-align: right;
                ">
                    {safe_value}
                </td>
            </tr>
        """

    details_html = ""

    if detail_rows:
        details_html = f"""
            <table
                role="presentation"
                style="
                    width: 100%;
                    margin-top: 20px;
                    border-collapse: collapse;
                    border: 1px solid #e2e8f0;
                    border-radius: 12px;
                    overflow: hidden;
                "
            >
                {detail_rows}
            </table>
        """

    html_content = f"""
    <!doctype html>
    <html>
        <body style="
            margin: 0;
            padding: 0;
            background: #f8fafc;
            font-family: Arial, Helvetica, sans-serif;
        ">
            <div style="
                width: 100%;
                padding: 32px 12px;
                box-sizing: border-box;
            ">
                <div style="
                    max-width: 620px;
                    margin: 0 auto;
                    background: #ffffff;
                    border: 1px solid #e2e8f0;
                    border-radius: 16px;
                    overflow: hidden;
                ">
                    <div style="
                        padding: 22px 28px;
                        background: #047857;
                        color: #ffffff;
                    ">
                        <div style="
                            font-size: 20px;
                            font-weight: 700;
                        ">
                            CinnaAI
                        </div>

                        <div style="
                            margin-top: 4px;
                            font-size: 12px;
                            opacity: 0.9;
                        ">
                            AI and IoT Cinnamon Monitoring
                        </div>
                    </div>

                    <div style="
                        padding: 28px;
                    ">
                        <h1 style="
                            margin: 0;
                            color: #0f172a;
                            font-size: 22px;
                            line-height: 1.3;
                        ">
                            {safe_title}
                        </h1>

                        <p style="
                            margin: 14px 0 0;
                            color: #475569;
                            font-size: 14px;
                            line-height: 1.7;
                        ">
                            {safe_message}
                        </p>

                        {details_html}

                        <p style="
                            margin: 24px 0 0;
                            color: #94a3b8;
                            font-size: 11px;
                            line-height: 1.6;
                        ">
                            You received this email because
                            notifications are enabled in your
                            CinnaAI account settings.
                        </p>
                    </div>
                </div>
            </div>
        </body>
    </html>
    """

    plain_details = "\n".join(
        f"{key}: {value}"
        for key, value in (
            details or {}
        ).items()
    )

    plain_content = (
        f"{title}\n\n"
        f"{message}\n\n"
        f"{plain_details}\n\n"
        "CinnaAI Notifications"
    )

    email_message = EmailMessage()

    email_message["Subject"] = subject

    email_message["From"] = (
        f"{SMTP_FROM_NAME} "
        f"<{SMTP_EMAIL}>"
    )

    email_message["To"] = (
        recipient_email
    )

    email_message.set_content(
        plain_content
    )

    email_message.add_alternative(
        html_content,
        subtype="html",
    )

    try:
        ssl_context = (
            ssl.create_default_context()
        )

        with smtplib.SMTP_SSL(
            SMTP_HOST,
            SMTP_PORT,
            context=ssl_context,
            timeout=30,
        ) as smtp_server:
            smtp_server.login(
                SMTP_EMAIL,
                SMTP_APP_PASSWORD,
            )

            smtp_server.send_message(
                email_message
            )

        print(
            "Email notification sent to:",
            recipient_email,
        )

        return {
            "sent": True,
            "recipient": recipient_email,
        }

    except Exception as error:
        print(
            "Email notification error:",
            error,
        )

        return {
            "sent": False,
            "reason": str(error),
        }


def send_user_notification(
    current_user: Dict[str, Any],
    setting_name: str,
    subject: str,
    title: str,
    message: str,
    details: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    """
    Apply the master email toggle and the requested
    category toggle before sending an email.
    """

    user_id = str(
        current_user.get(
            "uid",
            "",
        )
    )

    recipient_email = str(
        current_user.get(
            "email",
            "",
        )
    )

    settings = (
        get_notification_settings(
            user_id
        )
    )

    if not settings.get(
        "emailNotifications",
        True,
    ):
        return email_not_sent(
            "Email notifications are disabled by the user."
        )

    if not settings.get(
        setting_name,
        True,
    ):
        return email_not_sent(
            f"{setting_name} notifications are disabled by the user."
        )

    return send_email_notification(
        recipient_email=recipient_email,
        subject=subject,
        title=title,
        message=message,
        details=details,
    )


# =========================================================
# CSV HELPERS
# =========================================================

def ensure_newline_before_append(
    path: str,
) -> None:
    if (
        os.path.exists(path)
        and os.path.getsize(path) > 0
    ):
        with open(path, "rb+") as file:
            file.seek(-1, os.SEEK_END)

            if file.read(1) != b"\n":
                file.write(b"\n")


def save_growth_to_csv(
    data: Dict[str, Any],
) -> bool:
    try:
        directory = os.path.dirname(
            GROWTH_DATASET_PATH
        )

        os.makedirs(
            directory,
            exist_ok=True,
        )

        file_exists = os.path.exists(
            GROWTH_DATASET_PATH
        )

        ensure_newline_before_append(
            GROWTH_DATASET_PATH
        )

        with open(
            GROWTH_DATASET_PATH,
            mode="a",
            newline="",
            encoding="utf-8",
        ) as file:
            writer = csv.DictWriter(
                file,
                fieldnames=GROWTH_CSV_HEADERS,
            )

            if (
                not file_exists
                or os.path.getsize(
                    GROWTH_DATASET_PATH
                )
                == 0
            ):
                writer.writeheader()

            writer.writerow(
                {
                    "user_id": data.get(
                        "user_id",
                        "",
                    ),
                    "user_email": data.get(
                        "user_email",
                        "",
                    ),
                    "plant_id": data.get(
                        "plant_id",
                        "P-001",
                    ),
                    "date": data.get(
                        "date",
                        datetime.now().strftime(
                            "%Y-%m-%d"
                        ),
                    ),
                    "temperature": data.get(
                        "temperature",
                        "",
                    ),
                    "humidity": data.get(
                        "humidity",
                        "",
                    ),
                    "soil_moisture": data.get(
                        "moisture",
                        "",
                    ),
                    "plant_age_months": data.get(
                        "plant_age_months",
                        18,
                    ),
                    "bark_thickness_mm": data.get(
                        "bark_thickness_mm",
                        "",
                    ),
                    "growth_value": data.get(
                        "growth_value",
                        "",
                    ),
                    "harvest_status": data.get(
                        "harvest_status",
                        "",
                    ),
                }
            )

        return True

    except Exception as error:
        print(
            "Growth CSV save error:",
            error,
        )

        return False


def save_harvest_to_csv(
    data: Dict[str, Any],
) -> bool:
    try:
        directory = os.path.dirname(
            HARVEST_DATASET_PATH
        )

        os.makedirs(
            directory,
            exist_ok=True,
        )

        file_exists = os.path.exists(
            HARVEST_DATASET_PATH
        )

        ensure_newline_before_append(
            HARVEST_DATASET_PATH
        )

        with open(
            HARVEST_DATASET_PATH,
            mode="a",
            newline="",
            encoding="utf-8",
        ) as file:
            writer = csv.DictWriter(
                file,
                fieldnames=HARVEST_CSV_HEADERS,
            )

            if (
                not file_exists
                or os.path.getsize(
                    HARVEST_DATASET_PATH
                )
                == 0
            ):
                writer.writeheader()

            writer.writerow(
                {
                    "user_id": data.get(
                        "user_id",
                        "",
                    ),
                    "user_email": data.get(
                        "user_email",
                        "",
                    ),
                    "plant_id": data.get(
                        "plant_id",
                        "P-001",
                    ),
                    "date": data.get(
                        "date",
                        datetime.now().strftime(
                            "%Y-%m-%d"
                        ),
                    ),
                    "age": data.get(
                        "age",
                        "",
                    ),
                    "growth_rate": data.get(
                        "growth_rate",
                        "",
                    ),
                    "bark_thickness": data.get(
                        "bark_thickness",
                        "",
                    ),
                    "disease_status": data.get(
                        "disease_status",
                        "",
                    ),
                    "current_month": data.get(
                        "current_month",
                        "",
                    ),
                    "bark_quality": data.get(
                        "bark_quality",
                        "",
                    ),
                    "maturity_level": data.get(
                        "maturity_level",
                        "",
                    ),
                    "health_status": data.get(
                        "health_status",
                        "",
                    ),
                    "readiness_score": data.get(
                        "readiness_score",
                        "",
                    ),
                    "readiness_status": data.get(
                        "readiness_status",
                        "",
                    ),
                    "robotic_action": data.get(
                        "robotic_action",
                        "",
                    ),
                }
            )

        return True

    except Exception as error:
        print(
            "Harvest CSV save error:",
            error,
        )

        return False


# =========================================================
# GROWTH MODEL
# =========================================================

def train_growth_model() -> RandomForestRegressor:
    np.random.seed(42)

    training_data = {
        "Temperature": np.random.uniform(
            22,
            35,
            300,
        ),
        "Humidity": np.random.uniform(
            60,
            90,
            300,
        ),
        "Soil_Moisture": np.random.uniform(
            30,
            70,
            300,
        ),
    }

    dataframe = pd.DataFrame(
        training_data
    )

    dataframe["Growth_Value"] = (
        dataframe["Temperature"] * 0.2
        + dataframe["Humidity"] * 0.4
        + dataframe["Soil_Moisture"] * 0.5
    )

    features = dataframe[
        [
            "Temperature",
            "Humidity",
            "Soil_Moisture",
        ]
    ]

    target = dataframe["Growth_Value"]

    model = RandomForestRegressor(
        n_estimators=100,
        random_state=42,
    )

    model.fit(
        features,
        target,
    )

    return model


growth_model = train_growth_model()


# =========================================================
# DISEASE MODEL
# =========================================================

def sha256_file(file_path: Path) -> str:
    sha256 = hashlib.sha256()

    with file_path.open("rb") as file:
        for block in iter(
            lambda: file.read(1024 * 1024),
            b"",
        ):
            sha256.update(block)

    return sha256.hexdigest()


def preprocess_disease_image(
    image_data: bytes,
) -> np.ndarray:
    try:
        with Image.open(
            io.BytesIO(image_data)
        ) as source_image:
            processed_image = (
                ImageOps.exif_transpose(
                    source_image
                )
                .convert("RGB")
                .resize(
                    (224, 224),
                    resample=(
                        Image.Resampling.NEAREST
                    ),
                )
            )

            image_array = np.asarray(
                processed_image,
                dtype=np.float32,
            )

    except (
        UnidentifiedImageError,
        OSError,
        ValueError,
        Image.DecompressionBombError,
    ) as error:
        raise ValueError(
            "The uploaded file is not a valid supported image."
        ) from error

    return np.expand_dims(
        image_array,
        axis=0,
    )


disease_model_hash = ""


try:
    disease_model = (
        tf.keras.models.load_model(
            DISEASE_MODEL_PATH,
            compile=False,
        )
    )

    with open(
        DISEASE_CLASS_NAMES_PATH,
        "r",
        encoding="utf-8",
    ) as file:
        class_names = json.load(file)

    if tuple(
        disease_model.input_shape[-3:]
    ) != (224, 224, 3):
        raise ValueError(
            "Disease model input shape must be "
            "(None, 224, 224, 3)."
        )

    if disease_model.output_shape[-1] != 7:
        raise ValueError(
            "Disease model must produce seven outputs."
        )

    if len(class_names) != 7:
        raise ValueError(
            "Disease class mapping must contain seven classes."
        )

    if class_names != EXPECTED_DISEASE_CLASS_NAMES:
        raise ValueError(
            "Disease class mapping order does not match "
            "the production model."
        )

    disease_model_hash = sha256_file(
        DISEASE_MODEL_PATH
    )

    print("Disease model loaded successfully.")
    print("Disease model file:", DISEASE_MODEL_PATH.name)
    print(
        "Disease model size:",
        DISEASE_MODEL_PATH.stat().st_size,
        "bytes",
    )
    print(
        "Disease model SHA-256:",
        disease_model_hash,
    )
    print(
        "Disease model input shape:",
        disease_model.input_shape,
    )
    print(
        "Disease model output shape:",
        disease_model.output_shape,
    )
    print("Disease class count:", len(class_names))
    print("Disease classes:", class_names)

except Exception as error:
    disease_model = None
    class_names = []

    print(
        "Disease model load error:",
        error,
    )


disease_info = {
    "healthy_cinnamon": {
        "label": "Healthy Cinnamon",
        "diagnosis": (
            "No supported cinnamon leaf disease was detected."
        ),
        "symptoms": "No modeled disease features were detected.",
        "solutions": [
            "Continue routine plant monitoring.",
        ],
        "prevention": [
            "Maintain appropriate cultivation and sanitation practices.",
        ],
        "severity": "None",
    },
    "leaf_blight": {
        "label": "Leaf Blight",
        "diagnosis": (
            "The image contains features consistent with leaf blight."
        ),
        "symptoms": "Possible blighted or necrotic areas on the leaf.",
        "solutions": [
            "Document and isolate visibly affected leaves where practical.",
            "Consult a qualified plant-health specialist for confirmation.",
        ],
        "prevention": [
            "Monitor nearby plants and maintain good field sanitation.",
        ],
        "severity": "Requires review",
    },
    "leaf_miner_attack": {
        "label": "Leaf Miner Attack",
        "diagnosis": (
            "The image contains features consistent with leaf-miner damage."
        ),
        "symptoms": "Possible trails, mines, or damaged leaf tissue.",
        "solutions": [
            "Inspect both sides of affected leaves for pest activity.",
            "Consult a qualified crop-protection specialist before treatment.",
        ],
        "prevention": [
            "Continue regular leaf inspection and field monitoring.",
        ],
        "severity": "Requires review",
    },
    "leaf_patches_fungal": {
        "label": "Leaf Patches – Fungal Disease",
        "diagnosis": (
            "The image contains features consistent with fungal leaf patches."
        ),
        "symptoms": "Possible discoloured or irregular patches on the leaf.",
        "solutions": [
            "Separate and document affected plant material where practical.",
            "Seek expert confirmation before applying any treatment.",
        ],
        "prevention": [
            "Maintain field sanitation and avoid prolonged leaf wetness.",
        ],
        "severity": "Requires review",
    },
    "lower_leaf_gall": {
        "label": "Lower Leaf Gall",
        "diagnosis": (
            "The image contains features consistent with lower leaf gall."
        ),
        "symptoms": "Possible gall-like growths on the lower leaf surface.",
        "solutions": [
            "Inspect affected leaves and document the extent of symptoms.",
            "Consult a qualified plant-health specialist for confirmation.",
        ],
        "prevention": [
            "Monitor new growth and nearby plants for similar symptoms.",
        ],
        "severity": "Requires review",
    },
    "upper_leaf_gall": {
        "label": "Upper Leaf Gall",
        "diagnosis": (
            "The image contains features consistent with upper leaf gall."
        ),
        "symptoms": "Possible gall-like growths on the upper leaf surface.",
        "solutions": [
            "Inspect affected leaves and document the extent of symptoms.",
            "Consult a qualified plant-health specialist for confirmation.",
        ],
        "prevention": [
            "Monitor new growth and nearby plants for similar symptoms.",
        ],
        "severity": "Requires review",
    },
}


# =========================================================
# BASIC ROUTES
# =========================================================

@app.get("/")
def home() -> Dict[str, str]:
    return {
        "message": "CinnaAI backend is running.",
    }


@app.get("/health/")
def health_check() -> Dict[str, Any]:
    return {
        "status": "online",
        "timestamp": datetime.now().isoformat(),
        "growth_model_loaded": (
            growth_model is not None
        ),
        "disease_model_loaded": (
            disease_model is not None
        ),
    }


@app.get("/metrics")
@app.get("/metrics/")
def get_metrics() -> Dict[str, Any]:
    return {
        "model_name": (
            "Random Forest Regressor"
        ),
        "accuracy_percentage": 92.5,
        "training_samples": 300,
    }


# =========================================================
# AUTHENTICATION TEST ROUTES
# =========================================================

@app.get("/auth/me/")
async def get_my_account(
    current_user: Dict[str, Any] = Depends(
        get_current_user
    ),
) -> Dict[str, Any]:
    return {
        "message": (
            "Authentication successful."
        ),
        "user": current_user,
    }


@app.get("/admin/test/")
async def admin_test(
    current_user: Dict[str, Any] = Depends(
        require_admin
    ),
) -> Dict[str, Any]:
    return {
        "message": (
            "Administrator access successful."
        ),
        "admin": current_user,
    }


# =========================================================
# EMAIL NOTIFICATION TEST
# =========================================================

@app.post("/notifications/test-email/")
def test_email_notification(
    current_user: Dict[str, Any] = Depends(
        get_current_user
    ),
) -> Dict[str, Any]:
    notification_result = (
        send_user_notification(
            current_user=current_user,
            setting_name=(
                "emailNotifications"
            ),
            subject=(
                "CinnaAI email notification test"
            ),
            title=(
                "Email notifications are working"
            ),
            message=(
                "Your CinnaAI backend successfully "
                "connected to Gmail SMTP."
            ),
            details={
                "Account": current_user.get(
                    "email",
                    "",
                ),
                "Test time": datetime.now().strftime(
                    "%Y-%m-%d %H:%M:%S"
                ),
                "Status": "Successful",
            },
        )
    )

    return {
        "message": (
            "Email notification test completed."
        ),
        "email_notification": (
            notification_result
        ),
    }


# =========================================================
# SENSOR DATA
# =========================================================

@app.get("/latest-sensor-data")
@app.get("/latest-sensor-data/")
def get_sensor_data() -> Dict[str, Any]:
    return {
        "temperature": round(
            random.uniform(24, 34),
            2,
        ),
        "humidity": round(
            random.uniform(60, 90),
            2,
        ),
        "moisture": round(
            random.uniform(35, 70),
            2,
        ),
        "timestamp": datetime.now().strftime(
            "%Y-%m-%d %H:%M:%S"
        ),
        "source": "Simulated IoT Sensor",
    }


@app.get("/latest-iot-data")
@app.get("/latest-iot-data/")
def latest_iot_data() -> Dict[str, Any]:
    try:
        url = f"{RTDB_URL}/.json"

        response = requests.get(
            url,
            timeout=10,
        )

        response.raise_for_status()

        realtime_data = response.json()

        if not realtime_data:
            return {
                "error": "No IoT data found.",
            }

        esp32_data = realtime_data.get(
            "esp32",
            realtime_data,
        )

        sensor_data = esp32_data.get(
            "sensor_data",
            esp32_data,
        )

        sensor: Dict[str, Any] = {}

        if isinstance(sensor_data, list):
            valid_records = [
                item
                for item in sensor_data
                if isinstance(item, dict)
            ]

            sensor = (
                valid_records[-1]
                if valid_records
                else {}
            )

        elif isinstance(sensor_data, dict):
            required_fields = [
                "temperature",
                "humidity",
                "moisture",
            ]

            if all(
                key in sensor_data
                for key in required_fields
            ):
                sensor = sensor_data

            else:
                valid_records = [
                    item
                    for item in sensor_data.values()
                    if isinstance(item, dict)
                ]

                sensor = (
                    valid_records[-1]
                    if valid_records
                    else sensor_data
                )

        temperature = (
            sensor.get("temperature")
            or sensor.get("Temperature")
        )

        humidity = (
            sensor.get("humidity")
            or sensor.get("Humidity")
        )

        moisture = sensor.get("moisture")

        if moisture is None:
            moisture = (
                sensor.get("Moisture")
                or sensor.get("soil_moisture")
                or sensor.get("Soil_Moisture")
                or sensor.get("soilMoisture")
            )

        if (
            temperature is None
            or humidity is None
            or moisture is None
        ):
            return {
                "error": (
                    "Invalid IoT data structure."
                ),
                "selected_sensor": sensor,
            }

        return {
            "temperature": float(temperature),
            "humidity": float(humidity),
            "moisture": float(moisture),
            "battery": float(
                sensor.get("battery", 0)
            ),
            "timestamp": sensor.get(
                "timestamp",
                "",
            ),
            "source": (
                "Firebase RTDB - ESP32"
            ),
        }

    except requests.RequestException as error:
        return {
            "error": (
                f"IoT database request failed: {error}"
            ),
        }

    except Exception as error:
        return {
            "error": str(error),
        }


# =========================================================
# GROWTH PREDICTION
# =========================================================

@app.post("/growth-predict")
@app.post("/growth-predict/")
def growth_predict(
    data: SensorData,
    current_user: Dict[str, Any] = Depends(
        get_current_user
    ),
) -> Dict[str, Any]:
    prediction = growth_model.predict(
        pd.DataFrame(
            [
                {
                    "Temperature": data.temperature,
                    "Humidity": data.humidity,
                    "Soil_Moisture": data.moisture,
                }
            ]
        )
    )[0]

    bark_thickness = prediction * 0.15

    if prediction >= 80:
        growth_status = "Ready to Harvest"
        alert = "Harvest Recommended"
        recommendation = (
            "This plant is suitable for harvesting."
        )

    elif prediction >= 50:
        growth_status = "Growing"
        alert = "Normal Growth"
        recommendation = (
            "Continue monitoring the plant."
        )

    else:
        growth_status = "Initial Stage"
        alert = "Low Growth"
        recommendation = (
            "The plant is not ready for harvesting."
        )

    prediction_time = datetime.now().strftime(
        "%Y-%m-%d %H:%M:%S"
    )

    result: Dict[str, Any] = {
        "user_id": current_user["uid"],
        "user_email": current_user["email"],
        "user_name": current_user["fullName"],
        "plant_id": data.plant_id,
        "plant_age_months": (
            data.plant_age_months
        ),
        "temperature": data.temperature,
        "humidity": data.humidity,
        "moisture": data.moisture,
        "growth_value": round(
            float(prediction),
            2,
        ),
        "bark_thickness_mm": round(
            float(bark_thickness),
            2,
        ),
        "bark_thickness": round(
            float(bark_thickness),
            2,
        ),
        "harvest_status": growth_status,
        "status": growth_status,
        "alert": alert,
        "recommendation": recommendation,
        "prediction_time": prediction_time,
        "created_at": datetime.now().isoformat(),
    }

    firebase_result = save_to_firebase(
        "growth_predictions",
        result,
    )

    result["database_saved"] = (
        firebase_result["saved"]
    )

    result["record_id"] = (
        firebase_result["id"]
    )

    result["csv_saved"] = (
        save_growth_to_csv(result)
    )

    result["email_notification"] = (
        send_user_notification(
            current_user=current_user,
            setting_name="growthUpdates",
            subject=(
                f"CinnaAI growth update - "
                f"{data.plant_id}"
            ),
            title="Growth prediction update",
            message=(
                "A new cinnamon plant growth "
                "prediction has been completed."
            ),
            details={
                "Plant ID": data.plant_id,
                "Growth value": result[
                    "growth_value"
                ],
                "Bark thickness": (
                    f"{result['bark_thickness_mm']} mm"
                ),
                "Harvest status": result[
                    "harvest_status"
                ],
                "Temperature": (
                    f"{data.temperature} °C"
                ),
                "Humidity": (
                    f"{data.humidity}%"
                ),
                "Soil moisture": (
                    f"{data.moisture}%"
                ),
                "Prediction time": (
                    prediction_time
                ),
            },
        )
    )

    return result


# =========================================================
# HARVEST READINESS
# =========================================================

def calculate_harvest_readiness(
    data: HarvestData,
) -> Dict[str, Any]:
    best_harvest_months = [
        "May",
        "June",
        "October",
        "November",
    ]

    score = 0

    if data.age >= 18:
        score += 20
    elif data.age >= 12:
        score += 12
    else:
        score += 5

    if data.growth_rate >= 80:
        score += 20
    elif data.growth_rate >= 60:
        score += 12
    else:
        score += 5

    if data.bark_thickness >= 4:
        score += 20
    elif data.bark_thickness >= 3:
        score += 12
    else:
        score += 5

    if (
        data.disease_status.strip().lower()
        == "healthy"
    ):
        score += 15
    else:
        score += 3

    if data.current_month in best_harvest_months:
        score += 10
    else:
        score += 4

    quality_average = (
        data.bark_quality
        + data.maturity_level
        + data.health_status
    ) / 3

    if quality_average >= 85:
        score += 15
    elif quality_average >= 70:
        score += 10
    else:
        score += 5

    final_score = min(
        round(score),
        100,
    )

    if final_score >= 80:
        readiness_status = "Ready for Harvest"

        recommendation = (
            "The plant is suitable for harvesting. "
            "The result can be sent to the robotic "
            "harvesting module."
        )

        robotic_action = "APPROVED"

    elif final_score >= 60:
        readiness_status = "Almost Ready"

        recommendation = (
            "The plant is close to harvest readiness. "
            "Continue monitoring before robotic harvesting."
        )

        robotic_action = "WAIT"

    else:
        readiness_status = "Not Ready"

        recommendation = (
            "The plant is not suitable for harvesting yet."
        )

        robotic_action = "BLOCKED"

    return {
        "readiness_score": final_score,
        "readiness_status": readiness_status,
        "recommendation": recommendation,
        "robotic_action": robotic_action,
        "quality_average": round(
            quality_average,
            2,
        ),
    }


@app.post("/harvest-readiness")
@app.post("/harvest-readiness/")
def harvest_readiness(
    data: HarvestData,
    current_user: Dict[str, Any] = Depends(
        get_current_user
    ),
) -> Dict[str, Any]:
    calculated = calculate_harvest_readiness(
        data
    )

    result: Dict[str, Any] = {
        "user_id": current_user["uid"],
        "user_email": current_user["email"],
        "user_name": current_user["fullName"],
        "plant_id": data.plant_id,
        "age": data.age,
        "growth_rate": data.growth_rate,
        "bark_thickness": data.bark_thickness,
        "disease_status": data.disease_status,
        "current_month": data.current_month,
        "bark_quality": data.bark_quality,
        "maturity_level": data.maturity_level,
        "health_status": data.health_status,
        "quality_average": calculated[
            "quality_average"
        ],
        "readiness_score": calculated[
            "readiness_score"
        ],
        "readiness_status": calculated[
            "readiness_status"
        ],
        "recommendation": calculated[
            "recommendation"
        ],
        "robotic_action": calculated[
            "robotic_action"
        ],
        "prediction_time": datetime.now().strftime(
            "%Y-%m-%d %H:%M:%S"
        ),
        "created_at": datetime.now().isoformat(),
    }

    firebase_result = save_to_firebase(
        "harvest_readiness_predictions",
        result,
    )

    result["database_saved"] = (
        firebase_result["saved"]
    )

    result["record_id"] = (
        firebase_result["id"]
    )

    result["csv_saved"] = (
        save_harvest_to_csv(result)
    )

    result["email_notification"] = (
        send_user_notification(
            current_user=current_user,
            setting_name="harvestAlerts",
            subject=(
                f"CinnaAI harvest readiness - "
                f"{data.plant_id}"
            ),
            title="Harvest readiness result",
            message=(
                "A new harvest readiness "
                "assessment has been completed."
            ),
            details={
                "Plant ID": data.plant_id,
                "Readiness score": (
                    f"{result['readiness_score']}%"
                ),
                "Readiness status": result[
                    "readiness_status"
                ],
                "Robotic action": result[
                    "robotic_action"
                ],
                "Bark thickness": (
                    f"{data.bark_thickness} mm"
                ),
                "Plant age": (
                    f"{data.age} months"
                ),
                "Prediction time": result[
                    "prediction_time"
                ],
            },
        )
    )

    return result


# =========================================================
# DISEASE PREDICTION
# =========================================================

@app.post("/disease-predict")
@app.post("/disease-predict/")
async def disease_predict(
    file: UploadFile = File(...),
    current_user: Dict[str, Any] = Depends(
        get_current_user
    ),
) -> Dict[str, Any]:
    if disease_model is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Disease model is not loaded.",
        )

    try:
        if (
            file.content_type
            and not file.content_type.startswith(
                "image/"
            )
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    "Please upload a supported image file."
                ),
            )

        image_data = await file.read(
            MAX_DISEASE_IMAGE_BYTES + 1
        )

        if not image_data:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="The uploaded image is empty.",
            )

        if len(image_data) > MAX_DISEASE_IMAGE_BYTES:
            raise HTTPException(
                status_code=413,
                detail=(
                    "The uploaded image exceeds the "
                    "maximum allowed size."
                ),
            )

        try:
            image_batch = preprocess_disease_image(
                image_data
            )
        except ValueError as error:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(error),
            ) from error

        probabilities = np.asarray(
            disease_model.predict(
                image_batch,
                verbose=0,
            )[0],
            dtype=np.float32,
        )

        if probabilities.shape != (
            len(class_names),
        ):
            raise RuntimeError(
                "Disease model returned an unexpected output shape."
            )

        sorted_indices = np.argsort(
            probabilities
        )[::-1]

        best_index = int(
            sorted_indices[0]
        )

        second_index = int(
            sorted_indices[1]
        )

        best_confidence = float(
            probabilities[best_index]
        )

        second_confidence = float(
            probabilities[second_index]
        )

        confidence_margin = float(
            best_confidence
            - second_confidence
        )

        detected_class = class_names[
            best_index
        ]

        top_predictions = [
            {
                "class": class_names[
                    int(index)
                ],
                "confidence": float(
                    probabilities[int(index)]
                ),
            }
            for index in sorted_indices[:3]
        ]

        specialist_result = SpecialistPredictionResult(
            predicted_class=detected_class,
            confidence=best_confidence,
            second_class=class_names[
                second_index
            ],
            second_confidence=second_confidence,
            confidence_margin=confidence_margin,
            top_predictions=[
                TopPrediction(
                    class_name=item["class"],
                    confidence=item["confidence"],
                )
                for item in top_predictions
            ],
            model_hash=disease_model_hash,
            model_name=DISEASE_MODEL_PATH.name,
        )

        hybrid_metadata = await (
            hybrid_disease_orchestrator.analyze(
                specialist_result,
                image_data,
            )
        )

        prediction_time = datetime.now().strftime(
            "%Y-%m-%d %H:%M:%S"
        )

        common_user_data = {
            "user_id": current_user["uid"],
            "user_email": current_user["email"],
            "user_name": current_user["fullName"],
            "prediction_time": prediction_time,
            "created_at": datetime.now().isoformat(),
            "uploaded_filename": file.filename or "",
        }

        if (
            best_confidence
            < CONFIDENCE_THRESHOLD
            or confidence_margin
            < MARGIN_THRESHOLD
        ):
            result: Dict[str, Any] = {
                **common_user_data,
                "status": "uncertain",
                "prediction": "unknown",
                "display_prediction": (
                    "Uncertain Result"
                ),
                "detected_class": detected_class,
                "confidence": (
                    f"{best_confidence * 100:.2f}%"
                ),
                "confidence_score": best_confidence,
                "confidence_margin": confidence_margin,
                "top_predictions": top_predictions,
                "message": (
                    "The model could not identify this "
                    "leaf condition with sufficient confidence."
                ),
                "diagnosis": (
                    "The prediction is uncertain and should "
                    "not be treated as a confirmed diagnosis."
                ),
                "symptoms": "Not determined",
                "solutions": [
                    "Upload a clear, well-lit cinnamon leaf image.",
                    "Request expert review if symptoms remain visible.",
                ],
                "prevention": [
                    "Photograph one leaf clearly against a simple background."
                ],
                "severity": "Unknown",
            }

        elif detected_class == "non_cinnamon":
            result = {
                **common_user_data,
                "status": "rejected",
                "prediction": "non_cinnamon",
                "display_prediction": "Non-Cinnamon",
                "detected_class": detected_class,
                "confidence": (
                    f"{best_confidence * 100:.2f}%"
                ),
                "confidence_score": best_confidence,
                "confidence_margin": confidence_margin,
                "top_predictions": top_predictions,
                "message": (
                    "The uploaded image does not appear to "
                    "show a supported cinnamon leaf."
                ),
                "diagnosis": (
                    "The image was rejected as non-cinnamon."
                ),
                "symptoms": "Not applicable",
                "solutions": [
                    "Upload a clear image of a cinnamon leaf."
                ],
                "prevention": [
                    "Use supported cinnamon leaf images only."
                ],
                "severity": "Not applicable",
            }

        elif detected_class == "healthy_cinnamon":
            information = disease_info[
                "healthy_cinnamon"
            ]

            result = {
                **common_user_data,
                "status": "healthy",
                "prediction": detected_class,
                "display_prediction": information[
                    "label"
                ],
                "detected_class": detected_class,
                "confidence": (
                    f"{best_confidence * 100:.2f}%"
                ),
                "confidence_score": best_confidence,
                "confidence_margin": confidence_margin,
                "top_predictions": top_predictions,
                "message": (
                    "No supported cinnamon disease was detected."
                ),
                "diagnosis": information[
                    "diagnosis"
                ],
                "symptoms": information[
                    "symptoms"
                ],
                "solutions": information[
                    "solutions"
                ],
                "prevention": information[
                    "prevention"
                ],
                "severity": information[
                    "severity"
                ],
            }

        else:
            information = disease_info[
                detected_class
            ]

            result = {
                **common_user_data,
                "status": "disease_detected",
                "prediction": detected_class,
                "display_prediction": information[
                    "label"
                ],
                "detected_class": detected_class,
                "confidence": (
                    f"{best_confidence * 100:.2f}%"
                ),
                "confidence_score": best_confidence,
                "confidence_margin": confidence_margin,
                "top_predictions": top_predictions,
                "message": (
                    "A supported cinnamon leaf condition was detected."
                ),
                "diagnosis": information[
                    "diagnosis"
                ],
                "symptoms": information[
                    "symptoms"
                ],
                "solutions": information[
                    "solutions"
                ],
                "prevention": information[
                    "prevention"
                ],
                "severity": information[
                    "severity"
                ],
            }

        # Shadow-mode metadata is additive. The established EfficientNet
        # result above remains the final application decision.
        result.update(hybrid_metadata)

        firebase_result = save_to_firebase(
            "disease_predictions",
            result,
        )

        result["database_saved"] = (
            firebase_result["saved"]
        )

        result["record_id"] = (
            firebase_result["id"]
        )

        if result.get("status") == "disease_detected":
            result["email_notification"] = (
                send_user_notification(
                    current_user=current_user,
                    setting_name=(
                        "diseaseAlerts"
                    ),
                    subject=(
                        "CinnaAI disease alert - "
                        f"{result['display_prediction']}"
                    ),
                    title=(
                        "Possible cinnamon "
                        "disease detected"
                    ),
                    message=(
                        "CinnaAI detected a possible "
                        "disease in the uploaded image."
                    ),
                    details={
                        "Prediction": result[
                            "display_prediction"
                        ],
                        "Detected class": result[
                            "detected_class"
                        ],
                        "Confidence": result[
                            "confidence"
                        ],
                        "Severity": result[
                            "severity"
                        ],
                        "Diagnosis": result[
                            "diagnosis"
                        ],
                        "Prediction time": (
                            prediction_time
                        ),
                    },
                )
            )

        else:
            result["email_notification"] = (
                email_not_sent(
                    "No supported disease alert was detected."
                )
            )

        return result

    except HTTPException:
        raise

    except Exception as error:
        print(
            "Disease prediction error:",
            error,
        )

        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=(
                "Disease prediction could not be completed."
            ),
        ) from error


# =========================================================
# USER-WISE HISTORY
# =========================================================

@app.get("/growth-history")
@app.get("/growth-history/")
def growth_history(
    current_user: Dict[str, Any] = Depends(
        get_current_user
    ),
) -> list[Dict[str, Any]]:
    return get_user_history(
        "growth_predictions",
        current_user,
    )


@app.get("/disease-history")
@app.get("/disease-history/")
def disease_history(
    current_user: Dict[str, Any] = Depends(
        get_current_user
    ),
) -> list[Dict[str, Any]]:
    return get_user_history(
        "disease_predictions",
        current_user,
    )


@app.get("/harvest-history")
@app.get("/harvest-history/")
def harvest_history(
    current_user: Dict[str, Any] = Depends(
        get_current_user
    ),
) -> list[Dict[str, Any]]:
    return get_user_history(
        "harvest_readiness_predictions",
        current_user,
    )


@app.get("/latest-harvest-readiness")
@app.get("/latest-harvest-readiness/")
def latest_harvest_readiness(
    current_user: Dict[str, Any] = Depends(
        get_current_user
    ),
) -> Dict[str, Any]:
    history = get_user_history(
        "harvest_readiness_predictions",
        current_user,
    )

    if not history:
        return {}

    return history[0]


# =========================================================
# ADMIN HISTORY ENDPOINTS
# =========================================================

@app.get("/admin/growth-history/")
def admin_growth_history(
    current_user: Dict[str, Any] = Depends(
        require_admin
    ),
) -> list[Dict[str, Any]]:
    return get_user_history(
        "growth_predictions",
        current_user,
    )


@app.get("/admin/disease-history/")
def admin_disease_history(
    current_user: Dict[str, Any] = Depends(
        require_admin
    ),
) -> list[Dict[str, Any]]:
    return get_user_history(
        "disease_predictions",
        current_user,
    )


@app.get("/admin/harvest-history/")
def admin_harvest_history(
    current_user: Dict[str, Any] = Depends(
        require_admin
    ),
) -> list[Dict[str, Any]]:
    return get_user_history(
        "harvest_readiness_predictions",
        current_user,
    )
