import math
import os
import random
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

import firebase_admin
import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from firebase_admin import credentials, firestore
from pydantic import BaseModel, Field
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_squared_error, r2_score
from sklearn.model_selection import train_test_split


# =========================================================
# Application Configuration
# =========================================================

BASE_DIR = Path(__file__).resolve().parent

app = FastAPI(
    title="Cinna AI Growth Prediction API",
    description="Growth prediction and IoT sensor API for cinnamon plants.",
    version="1.0.0",
)


# =========================================================
# CORS Configuration
# =========================================================

default_origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "https://cinna-ai-research.vercel.app",
]

allowed_origins_env = os.getenv("ALLOWED_ORIGINS", "").strip()

if allowed_origins_env:
    allowed_origins = [
        origin.strip()
        for origin in allowed_origins_env.split(",")
        if origin.strip()
    ]
else:
    allowed_origins = default_origins

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# =========================================================
# Firebase Initialization
# =========================================================

db: Optional[Any] = None


def initialize_firebase() -> Optional[Any]:
    try:
        firebase_key_path = Path(
            os.getenv(
                "FIREBASE_CREDENTIALS_PATH",
                str(BASE_DIR / "firebase-key.json"),
            )
        )

        if not firebase_key_path.exists():
            print(
                f"⚠️ Firebase credentials file not found: "
                f"{firebase_key_path}"
            )
            return None

        if not firebase_admin._apps:
            firebase_credential = credentials.Certificate(
                str(firebase_key_path)
            )
            firebase_admin.initialize_app(firebase_credential)

        firestore_client = firestore.client()

        print("✅ Firebase connected successfully")

        return firestore_client

    except Exception as error:
        print(f"❌ Firebase connection failed: {error}")
        return None


db = initialize_firebase()


# =========================================================
# Machine Learning Model
# =========================================================

FEATURE_COLUMNS = [
    "Temperature",
    "Humidity",
    "Soil_Moisture",
]

model_metrics: Dict[str, Any] = {}


def train_model() -> RandomForestRegressor:
    global model_metrics

    np.random.seed(42)

    number_of_samples = 500

    dataset = {
        "Temperature": np.random.uniform(
            22,
            35,
            number_of_samples,
        ),
        "Humidity": np.random.uniform(
            60,
            90,
            number_of_samples,
        ),
        "Soil_Moisture": np.random.uniform(
            30,
            70,
            number_of_samples,
        ),
    }

    dataframe = pd.DataFrame(dataset)

    dataframe["Growth_Value"] = (
        dataframe["Temperature"] * 0.2
        + dataframe["Humidity"] * 0.4
        + dataframe["Soil_Moisture"] * 0.5
        + np.random.normal(
            0,
            1.2,
            number_of_samples,
        )
    )

    features = dataframe[FEATURE_COLUMNS]
    target = dataframe["Growth_Value"]

    (
        features_train,
        features_test,
        target_train,
        target_test,
    ) = train_test_split(
        features,
        target,
        test_size=0.2,
        random_state=42,
    )

    trained_model = RandomForestRegressor(
        n_estimators=100,
        random_state=42,
        n_jobs=-1,
    )

    trained_model.fit(
        features_train,
        target_train,
    )

    predictions = trained_model.predict(features_test)

    r2 = float(
        r2_score(
            target_test,
            predictions,
        )
    )

    mse = float(
        mean_squared_error(
            target_test,
            predictions,
        )
    )

    rmse = math.sqrt(mse)

    model_metrics = {
        "model_name": "Random Forest Regressor",
        "r2_score": round(r2, 4),
        "accuracy_percentage": round(
            max(0.0, min(r2 * 100, 100.0)),
            2,
        ),
        "mse": round(mse, 4),
        "rmse": round(rmse, 4),
        "training_samples": number_of_samples,
        "input_features": [
            "Temperature",
            "Humidity",
            "Soil Moisture",
        ],
        "outputs": [
            "Growth Value",
            "Bark Thickness",
            "Harvest Status",
            "Recommendation",
            "Alert",
        ],
    }

    print("✅ ML model trained successfully")

    return trained_model


try:
    model: Optional[RandomForestRegressor] = train_model()

except Exception as error:
    model = None
    model_metrics = {
        "model_name": "Random Forest Regressor",
        "status": "Model training failed",
        "error": str(error),
    }

    print(f"❌ ML model training failed: {error}")


# =========================================================
# Request Models
# =========================================================

class SensorData(BaseModel):
    temperature: float = Field(
        ...,
        ge=-20,
        le=70,
        description="Temperature in degrees Celsius",
    )

    humidity: float = Field(
        ...,
        ge=0,
        le=100,
        description="Relative humidity percentage",
    )

    moisture: float = Field(
        ...,
        ge=0,
        le=100,
        description="Soil moisture percentage",
    )


# =========================================================
# Helper Functions
# =========================================================

def get_current_timestamp() -> str:
    return datetime.now(timezone.utc).isoformat()


def save_to_firebase(
    data: Dict[str, Any],
) -> Dict[str, Any]:
    if db is None:
        return {
            "saved": False,
            "error": "Firebase is not connected",
        }

    try:
        document_reference = (
            db.collection("growth_predictions")
            .document()
        )

        firebase_data = {
            **data,
            "created_at": firestore.SERVER_TIMESTAMP,
        }

        document_reference.set(firebase_data)

        print(
            "🔥 Saved to Firebase:",
            document_reference.id,
        )

        return {
            "saved": True,
            "document_id": document_reference.id,
        }

    except Exception as error:
        print(f"❌ Firebase save error: {error}")

        return {
            "saved": False,
            "error": str(error),
        }


def determine_growth_status(
    prediction: float,
) -> Dict[str, str]:
    if prediction >= 80:
        return {
            "status": "Ready to Harvest",
            "alert": "🚨 Harvest Recommended",
            "recommendation": (
                "Cinnamon plant is suitable for harvesting "
                "based on predicted growth and bark thickness."
            ),
        }

    if prediction >= 50:
        return {
            "status": "Growing",
            "alert": "✅ Normal Growth",
            "recommendation": (
                "Plant is still growing. Continue monitoring "
                "environmental conditions."
            ),
        }

    return {
        "status": "Initial Stage",
        "alert": "⚠️ Low Growth Detected",
        "recommendation": (
            "Plant is at an early growth stage. "
            "Not suitable for harvesting yet."
        ),
    }


# =========================================================
# API Routes
# =========================================================

@app.get("/")
def home() -> Dict[str, str]:
    return {
        "message": "Cinna AI backend is running",
        "status": "healthy",
    }


@app.get("/health")
@app.get("/health/")
def health_check() -> Dict[str, Any]:
    return {
        "status": "healthy",
        "model_loaded": model is not None,
        "firebase_connected": db is not None,
        "timestamp": get_current_timestamp(),
    }


@app.get("/metrics")
@app.get("/metrics/")
def get_metrics() -> Dict[str, Any]:
    return model_metrics


@app.get("/latest-sensor-data")
@app.get("/latest-sensor-data/")
def get_sensor() -> Dict[str, Any]:
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
        "timestamp": get_current_timestamp(),
        "source": "IoT Sensor Simulation",
    }


@app.post("/predict")
@app.post("/predict/")
def predict(data: SensorData) -> Dict[str, Any]:
    if model is None:
        raise HTTPException(
            status_code=503,
            detail="Prediction model is not available",
        )

    try:
        input_dataframe = pd.DataFrame(
            [
                {
                    "Temperature": data.temperature,
                    "Humidity": data.humidity,
                    "Soil_Moisture": data.moisture,
                }
            ],
            columns=FEATURE_COLUMNS,
        )

        prediction = float(
            model.predict(input_dataframe)[0]
        )

        bark_thickness = prediction * 0.15

        growth_information = determine_growth_status(
            prediction
        )

        prediction_time = get_current_timestamp()

        result: Dict[str, Any] = {
            "input_data": {
                "temperature": data.temperature,
                "humidity": data.humidity,
                "moisture": data.moisture,
            },
            "temperature": data.temperature,
            "humidity": data.humidity,
            "moisture": data.moisture,
            "growth_value": round(prediction, 2),
            "bark_thickness_mm": round(
                bark_thickness,
                2,
            ),
            "harvest_status": growth_information["status"],
            "recommendation": growth_information[
                "recommendation"
            ],
            "alert": growth_information["alert"],
            "prediction_time": prediction_time,
        }

        firebase_result = save_to_firebase(result)

        result["database_saved"] = firebase_result["saved"]
        result["firebase"] = firebase_result

        return result

    except HTTPException:
        raise

    except Exception as error:
        print(f"❌ Prediction error: {error}")

        raise HTTPException(
            status_code=500,
            detail="Growth prediction failed",
        ) from error