"""Run separately: python -m plant_condition.worker [--once]."""
import argparse
import logging
import os
from pathlib import Path
import signal
import threading

from dotenv import load_dotenv

from .runtime import build_service


def run_cycle(service):
    processed = 0
    for plant in service.store.plants(active_only=True):
        try:
            service.process(plant)
            processed += 1
        except Exception:
            logging.error("Condition persistence unavailable for plant %s", plant["plant_id"])
    return processed


def main():
    load_dotenv(Path(__file__).resolve().parents[1] / ".env")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--interval", type=float, default=float(os.getenv("PLANT_CONDITION_POLL_SECONDS", "30")))
    args = parser.parse_args()
    if args.interval <= 0:
        parser.error("The polling interval must be positive.")
    from firebase_auth import db
    url = os.getenv("FIREBASE_SENSOR_DATABASE_URL", "").strip()
    if not url:
        parser.error("FIREBASE_SENSOR_DATABASE_URL must be configured.")
    service = build_service(db, url)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    if service.baseline.error:
        logging.warning("Baseline unavailable: %s", service.baseline.error)
    stopped = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stopped.set())
    signal.signal(signal.SIGINT, lambda *_: stopped.set())
    while not stopped.is_set():
        try:
            count = run_cycle(service)
            logging.info("Checked %d registered plants", count)
        except Exception:
            logging.error("Plant registry unavailable; retrying on the next cycle")
        if args.once:
            break
        stopped.wait(args.interval)


if __name__ == "__main__":
    main()
