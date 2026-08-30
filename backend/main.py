from datetime import datetime
from email.message import EmailMessage
from html import escape
from pathlib import Path
from typing import Any, Dict, Literal, Optional, Union

import csv
import hashlib
import io
import json
import os
import random
import smtplib
import ssl
import threading
import time

import faiss
import numpy as np
import pandas as pd
import requests
import serial
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

from pydantic import BaseModel, Field

from serial import SerialException

from sklearn.ensemble import RandomForestRegressor, RandomForestClassifier
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.model_selection import train_test_split

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
# ESP32 USB SERIAL CONTROLLER
# =========================================================

ESP32_SERIAL_PORT = os.getenv(
    "ESP32_SERIAL_PORT",
    "",
).strip()

ESP32_BAUD_RATE = int(
    os.getenv(
        "ESP32_BAUD_RATE",
        "115200",
    )
)

esp32_serial: Optional[serial.Serial] = None
esp32_serial_lock = threading.Lock()

relay_states = {
    "r1": False,
    "r2": False,
}


class RelayCommand(BaseModel):
    relay: Literal["r1", "r2"]
    state: Literal["on", "off"]


def connect_esp32() -> bool:
    """Open the ESP32 USB serial connection when needed."""
    global esp32_serial

    if esp32_serial is not None and esp32_serial.is_open:
        return True

    if not ESP32_SERIAL_PORT:
        print("ESP32_SERIAL_PORT is not configured")
        return False

    try:
        esp32_serial = serial.Serial(
            port=ESP32_SERIAL_PORT,
            baudrate=ESP32_BAUD_RATE,
            timeout=2,
            write_timeout=2,
        )

        # Opening a serial connection can restart an ESP32.
        time.sleep(2)
        esp32_serial.reset_input_buffer()

        print(
            f"ESP32 connected: {ESP32_SERIAL_PORT} "
            f"at {ESP32_BAUD_RATE} baud"
        )
        return True

    except (SerialException, OSError) as error:
        esp32_serial = None
        print(f"ESP32 connection failed: {error}")
        return False


def send_esp32_command(command: str) -> str:
    """Send one supported relay command and return the ESP32 reply."""
    global esp32_serial

    with esp32_serial_lock:
        if not connect_esp32():
            raise HTTPException(
                status_code=503,
                detail=(
                    "ESP32 is not connected. Check the USB cable, "
                    "ESP32_SERIAL_PORT and Arduino Serial Monitor."
                ),
            )

        try:
            assert esp32_serial is not None
            esp32_serial.reset_input_buffer()
            esp32_serial.write(f"{command}\n".encode("utf-8"))
            esp32_serial.flush()

            response = esp32_serial.readline().decode(
                "utf-8",
                errors="ignore",
            ).strip()

            if not response:
                response = "Command sent; no serial reply received"

            return response

        except (SerialException, OSError) as error:
            if esp32_serial is not None:
                try:
                    esp32_serial.close()
                except Exception:
                    pass

            esp32_serial = None

            raise HTTPException(
                status_code=503,
                detail=f"ESP32 communication failed: {error}",
            ) from error


def close_esp32_connection() -> None:
    """Release the USB serial port during backend shutdown."""
    global esp32_serial

    with esp32_serial_lock:
        if esp32_serial is not None:
            try:
                if esp32_serial.is_open:
                    esp32_serial.close()
            except Exception:
                pass
            finally:
                esp32_serial = None


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

# FAISS index files produced by build_faiss_index.py
FAISS_INDEX_PATH    = BASE_DIR / "cinnamon_faiss.index"
FAISS_LABELMAP_PATH = BASE_DIR / "faiss_label_map.json"

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

# Minimum cosine similarity for a FAISS retrieval result to be trusted.
# Inner-product on L2-normalised vectors equals cosine similarity (range 0-1).
# Below this threshold the image is considered out-of-distribution and falls
# back to the softmax confidence/margin gate.
FAISS_SIMILARITY_THRESHOLD = get_probability_threshold(
    "FAISS_SIMILARITY_THRESHOLD",
    0.82,
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
    close_esp32_connection()


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
    "age_months",
    "rainfall_index",
    "phenology_stage",
    "bark_browning_percent",
    "final_score",
    "status",
    "action",
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
    temperature: float = Field(gt=0, le=60)
    humidity: float = Field(gt=0, le=100)
    moisture: float = Field(ge=0, le=100)
    plant_id: str = Field(default="P-001", min_length=1, max_length=100)
    plant_age_months: int = Field(default=18, ge=1, le=120)


class ApprovedCutResponse(BaseModel):
    predicted_bark_thickness_mm: float
    model_uncertainty_mm: float
    commanded_cut_depth_mm: float
    model_confidence: float
    cut_permission: Literal["APPROVED"] = "APPROVED"


class BlockedCutResponse(BaseModel):
    cut_permission: Literal["BLOCKED"] = "BLOCKED"
    reason: Literal["LOW_MODEL_CONFIDENCE"]


class RoboticCutRequest(BaseModel):
    plant_age_months: float
    temperature: float
    humidity: float
    moisture: float


class HarvestReadinessResponse(BaseModel):
    final_score: float = Field(ge=0, le=100)
    status: Literal[
        "Ready for Harvest",
        "Almost Ready",
        "Not Ready",
    ]
    action: Literal["APPROVED", "WAIT", "BLOCKED"]
    status_message: str


class HarvestData(BaseModel):
    plant_id: str = Field(min_length=1, max_length=100)
    age_months: float
    rainfall_index: float
    phenology_stage: int
    bark_browning_percent: float


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

GROWTH_TRAINING_RANGES: Dict[str, tuple[float, float]] = {
    "plant_age_months": (1.0, 120.0),
    "temperature": (0.1, 60.0),
    "humidity": (0.1, 100.0),
    "moisture": (0.0, 100.0),
}


def build_growth_training_data(
    n_samples: int = 10000,
    random_seed: int = 42,
) -> tuple[pd.DataFrame, np.ndarray]:
    """Create reproducible data across the complete supported input domain."""
    random_generator = np.random.default_rng(random_seed)

    age_months = random_generator.uniform(
        *GROWTH_TRAINING_RANGES["plant_age_months"],
        n_samples,
    )
    temperature = random_generator.uniform(
        *GROWTH_TRAINING_RANGES["temperature"],
        n_samples,
    )
    humidity = random_generator.uniform(
        *GROWTH_TRAINING_RANGES["humidity"],
        n_samples,
    )
    soil_moisture = random_generator.uniform(
        *GROWTH_TRAINING_RANGES["moisture"],
        n_samples,
    )

    s_t = np.exp(-((temperature - 30) ** 2) / 50)
    s_h = np.exp(-((humidity - 80) ** 2) / 100)
    s_m = np.exp(-((soil_moisture - 60) ** 2) / 200)
    esi = (0.3 * s_t) + (0.3 * s_h) + (0.4 * s_m)

    stem_diameter = 25.0 * np.exp(
        -4.0 * np.exp(-0.15 * (age_months * esi))
    )
    noise = np.random.normal(0, 0.15, size=n_samples)
    bark_thickness = np.clip(0.5 + (stem_diameter * 0.04) + noise, 0.2, 2.5)

    dataframe = pd.DataFrame(
        {
            "Plant_Age": age_months,
            "Temperature": temperature,
            "Humidity": humidity,
            "Soil_Moisture": soil_moisture,
        }
    )

    return dataframe, bark_thickness


def train_growth_model() -> tuple[RandomForestRegressor, Dict[str, Any]]:
    features, target = build_growth_training_data()
    (
        training_features,
        evaluation_features,
        training_target,
        evaluation_target,
    ) = train_test_split(
        features,
        target,
        test_size=0.20,
        random_state=42,
    )

    evaluation_model = RandomForestRegressor(
        n_estimators=100,
        random_state=42,
        n_jobs=-1,
    )
    evaluation_model.fit(training_features, training_target)
    evaluation_predictions = evaluation_model.predict(evaluation_features)

    # Note: The R2 and MAE metrics below reflect variance-adjusted synthetic baselines 
    # pending real CSV data ingestion.
    metrics: Dict[str, Any] = {
        "model_name": "Random Forest Regressor",
        "model_role": "Environmental growth estimator",
        "data_source": "Formula-generated growth data",
        "training_samples": int(len(features)),
        "evaluation_samples": int(len(evaluation_features)),
        "r2_score": round(
            float(r2_score(evaluation_target, evaluation_predictions)),
            4,
        ),
        "mean_absolute_error_mm": round(
            float(
                mean_absolute_error(
                    evaluation_target,
                    evaluation_predictions,
                )
            ),
            4,
        ),
        "training_ranges": {
            name: {"minimum": limits[0], "maximum": limits[1]}
            for name, limits in GROWTH_TRAINING_RANGES.items()
        },
    }

    final_model = RandomForestRegressor(
        n_estimators=100,
        random_state=42,
        n_jobs=-1,
    )
    final_model.fit(features, target)

    return final_model, metrics


def interpret_growth_value(growth_value: float) -> Dict[str, str]:
    if growth_value >= 80:
        return {
            "status": "Ready to Harvest",
            "alert": "Harvest Recommended",
            "recommendation": "This plant is suitable for harvesting.",
        }

    if growth_value >= 50:
        return {
            "status": "Growing",
            "alert": "Normal Growth",
            "recommendation": "Continue monitoring the plant.",
        }

    return {
        "status": "Initial Stage",
        "alert": "Low Growth",
        "recommendation": "The plant is not ready for harvesting.",
    }


growth_model, growth_model_metrics = train_growth_model()


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


disease_model_hash  = ""

# ----- FAISS retrieval globals (set during model startup) --------------------
# embedding_model : truncated at global_average_pooling  -> (None, 1280)
# faiss_index     : faiss.IndexFlatIP holding L2-normalised 1280-d vectors
# faiss_label_map : {"0": "healthy_cinnamon", ...} mapping index id -> class
embedding_model : tf.keras.Model | None = None
faiss_index     : faiss.Index    | None = None
faiss_label_map : dict           | None = None


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

    # ------------------------------------------------------------------
    # Build 1280-d embedding extractor (truncated at global_average_pooling)
    # This model shares weights with disease_model — no double loading.
    # ------------------------------------------------------------------
    try:
        pool_layer = disease_model.get_layer("global_average_pooling")
    except ValueError:
        # Layer may be nested inside efficientnetb0 sub-model.
        eff_sub   = disease_model.get_layer("efficientnetb0")
        pool_layer = eff_sub.get_layer("global_average_pooling")

    embedding_model = tf.keras.Model(
        inputs  = disease_model.input,
        outputs = pool_layer.output,
        name    = "embedding_extractor",
    )

    print(
        "Embedding extractor output shape:",
        embedding_model.output_shape,
    )

    # ------------------------------------------------------------------
    # Load FAISS index and label map (optional — degrades gracefully)
    # ------------------------------------------------------------------
    if FAISS_INDEX_PATH.exists() and FAISS_LABELMAP_PATH.exists():
        faiss_index = faiss.read_index(str(FAISS_INDEX_PATH))

        with open(FAISS_LABELMAP_PATH, "r", encoding="utf-8") as f:
            faiss_label_map = json.load(f)

        print(
            "FAISS index loaded:",
            faiss_index.ntotal,
            "vectors, dim",
            faiss_index.d,
        )
        print(
            "FAISS label map entries:",
            len(faiss_label_map),
        )
    else:
        print(
            "[WARN] FAISS index not found — "
            "running in softmax-only mode. "
            "Run build_faiss_index.py to enable retrieval."
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
    disease_model   = None
    embedding_model = None
    faiss_index     = None
    faiss_label_map = None
    class_names     = []

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
    return growth_model_metrics.copy()


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
# ROBOTIC HARVESTING
# =========================================================

@app.post("/api/robotic-harvest/cut-depth", response_model=Union[ApprovedCutResponse, BlockedCutResponse])
def robotic_harvest_cut_depth(data: RoboticCutRequest):
    input_features = np.array([[data.plant_age_months, data.temperature, data.humidity, data.moisture]])

    predictions = []
    for estimator in growth_model.estimators_:
        predictions.append(estimator.predict(input_features)[0])
        
    predictions = np.array(predictions)
    mu_thickness = np.mean(predictions)
    sigma_uncertainty = np.std(predictions)

    model_confidence = 1.0 - ((sigma_uncertainty / max(mu_thickness, 1e-4)) * 1.5)
    model_confidence = max(0.0, min(1.0, model_confidence))

    if model_confidence < 0.85:
        return BlockedCutResponse(
            cut_permission="BLOCKED",
            reason="LOW_MODEL_CONFIDENCE"
        )

    commanded_depth = mu_thickness - (1.5 * sigma_uncertainty) - 0.10
    commanded_depth = max(0.0, commanded_depth)

    return ApprovedCutResponse(
        predicted_bark_thickness_mm=round(float(mu_thickness), 2),
        model_uncertainty_mm=round(float(sigma_uncertainty), 2),
        commanded_cut_depth_mm=round(float(commanded_depth), 2),
        model_confidence=round(float(model_confidence), 2),
        cut_permission="APPROVED"
    )


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
                    "Plant_Age": data.plant_age_months,
                    "Temperature": data.temperature,
                    "Humidity": data.humidity,
                    "Soil_Moisture": data.moisture,
                }
            ]
        )
    )[0]

    # The new model outputs raw bark thickness (approx 0.5mm to 1.5mm).
    # We map this back to a 0-100 scale for the UI's "Growth Value" percentage.
    bark_thickness = float(prediction)
    growth_value = max(0.0, min(100.0, (bark_thickness - 0.5) / 1.0 * 100.0))

    growth_interpretation = interpret_growth_value(growth_value)
    growth_status = growth_interpretation["status"]
    alert = growth_interpretation["alert"]
    recommendation = growth_interpretation["recommendation"]

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
            float(growth_value),
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
        "model_scope": "Supported-domain environmental growth estimate",
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

def train_harvest_classifier() -> RandomForestClassifier:
    np.random.seed(42)
    n_samples = 2000

    age_months = np.random.uniform(6, 60, n_samples)
    rainfall_index = np.random.uniform(0, 100, n_samples)
    phenology_stage = np.random.choice([0, 1, 2], n_samples)
    bark_browning_percent = np.random.uniform(0, 100, n_samples)

    peeling_test_passed = np.ones(n_samples, dtype=int)
    peeling_test_passed[np.isin(phenology_stage, [0, 1])] = 0
    peeling_test_passed[rainfall_index < 40] = 0
    peeling_test_passed[age_months < 24] = 0
    peeling_test_passed[bark_browning_percent < 75] = 0

    X = pd.DataFrame({
        "age_months": age_months,
        "rainfall_index": rainfall_index,
        "phenology_stage": phenology_stage,
        "bark_browning_percent": bark_browning_percent
    })
    y = pd.Series(peeling_test_passed, name="peeling_test_passed")

    model = RandomForestClassifier(n_estimators=100, random_state=42)
    model.fit(X, y)

    return model

harvest_ml_model = train_harvest_classifier()


@app.post("/harvest-readiness")
@app.post("/harvest-readiness/")
def harvest_readiness(
    data: HarvestData,
    current_user: Dict[str, Any] = Depends(
        get_current_user
    ),
) -> Dict[str, Any]:
    features = np.array([[
        data.age_months,
        data.rainfall_index,
        data.phenology_stage,
        data.bark_browning_percent
    ]])

    probability = float(harvest_ml_model.predict_proba(features)[0][1])

    if probability >= 0.80:
        status_text = "Ready for Harvest"
        action = "APPROVED"
        status_message = "The Machine Learning model indicates optimal conditions for a clean bark peel."
    elif probability >= 0.60:
        status_text = "Almost Ready"
        action = "WAIT"
        status_message = "Conditions are approaching optimal. Await slightly more rainfall or bark browning."
    else:
        status_text = "Not Ready"
        action = "BLOCKED"
        status_message = "Conditions are currently unfavorable. Harvesting now will likely result in bark tearing."

    final_score = round(probability * 100, 2)
    prediction_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    result: Dict[str, Any] = {
        "user_id": current_user["uid"],
        "user_email": current_user["email"],
        "user_name": current_user["fullName"],
        "plant_id": data.plant_id,
        "age_months": data.age_months,
        "rainfall_index": data.rainfall_index,
        "phenology_stage": data.phenology_stage,
        "bark_browning_percent": data.bark_browning_percent,
        "final_score": final_score,
        "status": status_text,
        "action": action,
        "status_message": status_message,
        "prediction_time": prediction_time,
        "created_at": datetime.now().isoformat(),
    }

    firebase_result = save_to_firebase(
        "harvest_readiness_predictions",
        result,
    )
    result["database_saved"] = firebase_result["saved"]
    result["record_id"] = firebase_result["id"]
    result["csv_saved"] = save_harvest_to_csv(result)
    
    result["email_notification"] = send_user_notification(
        current_user=current_user,
        setting_name="harvestAlerts",
        subject=f"CinnaAI harvest readiness - {data.plant_id}",
        title="Harvest readiness result",
        message="A new ML-powered harvest readiness assessment has been completed.",
        details={
            "Plant ID": data.plant_id,
            "Readiness score": f"{final_score}%",
            "Readiness status": status_text,
            "Prediction time": prediction_time,
        },
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

        # FAISS is retained as a secondary validation metric. Its cosine
        # similarity values are not probabilities and never replace the
        # EfficientNet softmax decision or confidence fields.
        faiss_retrieval: Dict[str, Any] = {
            "available": False,
            "accepted": False,
            "threshold": FAISS_SIMILARITY_THRESHOLD,
            "top_label": None,
            "top_similarity": None,
            "second_label": None,
            "second_similarity": None,
        }

        if (
            embedding_model is not None
            and faiss_index is not None
            and faiss_label_map is not None
            and faiss_index.ntotal > 0
        ):
            raw_embedding = np.asarray(
                embedding_model.predict(image_batch, verbose=0),
                dtype=np.float32,
            )
            faiss.normalize_L2(raw_embedding)

            neighbor_count = min(2, faiss_index.ntotal)
            distances, neighbor_indices = faiss_index.search(
                raw_embedding,
                k=neighbor_count,
            )
            top_index = int(neighbor_indices[0][0])
            top_label = faiss_label_map.get(str(top_index))
            top_similarity = float(distances[0][0])
            second_label: str | None = None
            second_similarity: float | None = None

            if neighbor_count > 1:
                second_index = int(neighbor_indices[0][1])
                second_label = faiss_label_map.get(str(second_index))
                second_similarity = float(distances[0][1])

            label_is_supported = top_label in EXPECTED_DISEASE_CLASS_NAMES
            faiss_retrieval = {
                "available": True,
                "accepted": bool(
                    label_is_supported
                    and top_similarity >= FAISS_SIMILARITY_THRESHOLD
                ),
                "threshold": FAISS_SIMILARITY_THRESHOLD,
                "top_label": top_label if label_is_supported else None,
                "top_similarity": top_similarity,
                "second_label": (
                    second_label
                    if second_label in EXPECTED_DISEASE_CLASS_NAMES
                    else None
                ),
                "second_similarity": second_similarity,
            }

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

        detected_class = class_names[best_index]

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
            second_class=class_names[second_index],
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

        low_confidence = (
            best_confidence < CONFIDENCE_THRESHOLD
            or confidence_margin < MARGIN_THRESHOLD
        )
        classification_data = {
            "prediction": detected_class,
            "detected_class": detected_class,
            "confidence": f"{best_confidence * 100:.2f}%",
            "confidence_score": best_confidence,
            "confidence_margin": confidence_margin,
            "top_predictions": top_predictions,
            "low_confidence": low_confidence,
            "review_recommended": low_confidence,
        }

        if detected_class == "non_cinnamon":
            result: Dict[str, Any] = {
                **common_user_data,
                **classification_data,
                "status": "rejected",
                "display_prediction": "Non-Cinnamon",
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
                **classification_data,
                "status": "healthy",
                "display_prediction": information[
                    "label"
                ],
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
                **classification_data,
                "status": "disease_detected",
                "display_prediction": information[
                    "label"
                ],
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
        result["faiss_retrieval"] = faiss_retrieval

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


# =========================================================
# ROBOTIC MACHINE RELAY ENDPOINTS
# =========================================================

@app.get("/robotic-machine/status/")
def get_robotic_machine_status(
    current_user: Dict[str, Any] = Depends(
        get_current_user
    ),
) -> Dict[str, Any]:
    connected = (
        esp32_serial is not None
        and esp32_serial.is_open
    )

    return {
        "connected": connected,
        "serial_port_configured": bool(ESP32_SERIAL_PORT),
        "relays": relay_states.copy(),
    }


@app.post("/robotic-machine/relay/")
def control_robotic_machine_relay(
    command: RelayCommand,
    current_user: Dict[str, Any] = Depends(
        get_current_user
    ),
) -> Dict[str, Any]:
    esp32_command = (
        f"{command.relay.upper()} "
        f"{command.state.upper()}"
    )

    esp32_response = send_esp32_command(esp32_command)
    relay_states[command.relay] = command.state == "on"

    return {
        "success": True,
        "command": esp32_command,
        "esp32_response": esp32_response,
        "connected": True,
        "relays": relay_states.copy(),
    }
