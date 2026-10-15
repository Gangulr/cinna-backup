"""Wire the service to the existing Firebase application; never fit a model."""
import os
from pathlib import Path

from .model import BaselineModel
from .sensors import SensorSource
from .service import ConditionService
from .store import ConditionStore
from .guidance import GuidanceService


def build_service(database, sensor_url):
    default = Path(__file__).resolve().parents[1] / "models" / "plant_condition"
    directory = Path(os.getenv("PLANT_CONDITION_MODEL_DIR", str(default)))
    baseline = BaselineModel(directory)
    service = ConditionService(
        ConditionStore(database),
        SensorSource(sensor_url, os.getenv("FIREBASE_SENSOR_AUTH_TOKEN", "")),
        baseline,
        shadow=os.getenv("PLANT_CONDITION_SHADOW_MODE", "true").lower() != "false",
    )
    service.guidance = GuidanceService(service.store, baseline)
    return service
