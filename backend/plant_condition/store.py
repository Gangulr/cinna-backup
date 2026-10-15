"""Firestore persistence with atomic device assignment and reading deduplication."""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib

from fastapi import HTTPException
from firebase_admin import firestore
from google.cloud.firestore_v1.base_query import FieldFilter


class ConditionStore:
    def __init__(self, database):
        self.db = database

    def plants(self, user=None, active_only=False) -> list[dict]:
        query = self.db.collection("plants")
        if user and user.get("role") != "admin":
            query = query.where(filter=FieldFilter("owner_id", "==", user["uid"]))
        if active_only:
            query = query.where(filter=FieldFilter("active", "==", True))
        return sorted((document.to_dict() for document in query.stream()), key=lambda p: p["plant_id"])

    def save_check(self, record):
        identity = hashlib.sha256(f"{record['user_id']}|{record['request_id']}".encode()).hexdigest()
        reference = self.db.collection("plant_condition_checks").document(identity)

        @firestore.transactional
        def commit(tx):
            previous = reference.get(transaction=tx)
            if previous.exists:
                saved = previous.to_dict()
                if saved.get("request_fingerprint") != record["request_fingerprint"]:
                    raise HTTPException(409, "This submission ID was already used for different inputs.")
                return saved
            saved = {**record, "record_id": identity}
            tx.set(reference, saved)
            return saved

        return commit(self.db.transaction())

    def check_history(self, user_id, plant_id=None, limit=50):
        query = self.db.collection("plant_condition_checks").where(filter=FieldFilter("user_id", "==", user_id))
        if plant_id is not None:
            query = query.where(filter=FieldFilter("plant_id", "==", plant_id))
        query = query.order_by("assessed_at", direction=firestore.Query.DESCENDING).limit(limit)
        return [snapshot.to_dict() for snapshot in query.stream()]

    def check(self, record_id, user_id):
        snapshot = self.db.collection("plant_condition_checks").document(record_id).get()
        if not snapshot.exists:
            raise HTTPException(404, "Condition check was not found.")
        record = snapshot.to_dict()
        if record["user_id"] != user_id:
            raise HTTPException(403, "You cannot access this condition check.")
        return record

    def save_guidance(self, record_id, user_id, guidance):
        reference = self.db.collection("plant_condition_checks").document(record_id)

        @firestore.transactional
        def commit(tx):
            snapshot = reference.get(transaction=tx)
            if not snapshot.exists:
                raise HTTPException(404, "Condition check was not found.")
            record = snapshot.to_dict()
            if record["user_id"] != user_id:
                raise HTTPException(403, "You cannot access this condition check.")
            existing = record.get("care_guidance")
            if existing and existing.get("version") == guidance["version"]:
                return existing
            tx.set(reference, {**record, "care_guidance": guidance})
            return guidance

        return commit(self.db.transaction())

    def plant(self, plant_id, user=None) -> dict:
        snapshot = self.db.collection("plants").document(plant_id).get()
        if not snapshot.exists:
            raise HTTPException(404, "Plant is not registered.")
        plant = snapshot.to_dict()
        if user and user.get("role") != "admin" and plant["owner_id"] != user["uid"]:
            raise HTTPException(403, "You do not own this plant.")
        return plant

    def register(self, values: dict, admin_id: str) -> dict:
        if not self.db.collection("users").document(values["owner_id"]).get().exists:
            raise HTTPException(422, "The owner must be an existing user.")
        plant_ref = self.db.collection("plants").document(values["plant_id"])
        device_ref = self.db.collection("plant_devices").document(values["device_id"])
        legacy_ref = self.db.collection("plant_condition_locks").document("legacy-source")
        transaction = self.db.transaction()

        @firestore.transactional
        def commit(tx):
            old_snapshot = plant_ref.get(transaction=tx)
            device_snapshot = device_ref.get(transaction=tx)
            legacy_snapshot = legacy_ref.get(transaction=tx)
            old = old_snapshot.to_dict() if old_snapshot.exists else None
            occupied = device_snapshot.to_dict() if device_snapshot.exists else None
            legacy = legacy_snapshot.to_dict() if legacy_snapshot.exists else None
            if old and old["owner_id"] != values["owner_id"]:
                raise HTTPException(409, "Ownership transfer requires a separate reviewed migration.")
            if values["active"] and occupied and occupied["plant_id"] != values["plant_id"]:
                raise HTTPException(409, "This device already has an active plant assignment.")
            if values["active"] and values["source_kind"] == "legacy" and legacy and legacy["plant_id"] != values["plant_id"]:
                raise HTTPException(409, "The single legacy sensor stream is already assigned.")
            now = datetime.now(timezone.utc).isoformat()
            mapping_changed = old and any(old.get(k) != values[k] for k in
                                         ["device_id", "calibration_id", "source_kind", "active"])
            result = {**values, "registered_by": admin_id, "updated_at": now,
                      "created_at": old["created_at"] if old else now,
                      "assignment_version": int(old.get("assignment_version", 1)) + int(bool(mapping_changed)) if old else 1}
            if old and old["active"] and (old["device_id"] != values["device_id"] or not values["active"]):
                tx.delete(self.db.collection("plant_devices").document(old["device_id"]))
            if old and old["active"] and old["source_kind"] == "legacy" and (values["source_kind"] != "legacy" or not values["active"]):
                tx.delete(legacy_ref)
            if values["active"]:
                tx.set(device_ref, {"plant_id": values["plant_id"], "owner_id": values["owner_id"]})
                if values["source_kind"] == "legacy":
                    tx.set(legacy_ref, {"plant_id": values["plant_id"]})
            tx.set(plant_ref, result)
            if mapping_changed:
                tx.delete(self.db.collection("plant_condition_latest").document(values["plant_id"]))
            return result

        return commit(transaction)

    def latest(self, plant_id) -> dict | None:
        snapshot = self.db.collection("plant_condition_latest").document(plant_id).get()
        return snapshot.to_dict() if snapshot.exists else None

    def assessment(self, assessment_id) -> dict | None:
        snapshot = self.db.collection("plant_conditions").document(assessment_id).get()
        return snapshot.to_dict() if snapshot.exists else None

    def persist(self, plant: dict, assessment: dict) -> bool:
        # Include the assignment generation so reassigned devices cannot leak earlier assessments.
        identity = hashlib.sha256(
            f"{plant['plant_id']}|{plant.get('assignment_version', 1)}|{assessment['reading_id']}".encode()
        ).hexdigest()
        reference = self.db.collection("plant_conditions").document(identity)
        latest_ref = self.db.collection("plant_condition_latest").document(plant["plant_id"])
        plant_ref = self.db.collection("plants").document(plant["plant_id"])
        transaction = self.db.transaction()

        @firestore.transactional
        def commit(tx):
            current = plant_ref.get(transaction=tx).to_dict()
            previous = reference.get(transaction=tx)
            last_snapshot = latest_ref.get(transaction=tx)
            last = last_snapshot.to_dict() if last_snapshot.exists else None
            if not current or not current["active"] or any(current.get(k) != plant.get(k) for k in
                                                          ["device_id", "owner_id", "assignment_version"]):
                return False
            record = {**assessment, "assessment_id": identity,
                      "assignment_version": plant.get("assignment_version", 1)}
            if not previous.exists:
                tx.set(reference, record)
            if not last or not last.get("observed_at") or record["observed_at"] >= last["observed_at"]:
                tx.set(latest_ref, record)
            return not previous.exists

        return commit(transaction)

    def unavailable(self, plant, assessment):
        # Preserve the last good history; only the current availability changes.
        reference = self.db.collection("plant_condition_latest").document(plant["plant_id"])
        plant_ref = self.db.collection("plants").document(plant["plant_id"])
        transaction = self.db.transaction()

        @firestore.transactional
        def commit(tx):
            current = plant_ref.get(transaction=tx).to_dict()
            if current and current.get("assignment_version", 1) == plant.get("assignment_version", 1):
                tx.set(reference, {**assessment, "assignment_version": plant.get("assignment_version", 1)})

        commit(transaction)

    def history(self, plant_id, limit=100) -> list[dict]:
        query = (self.db.collection("plant_conditions")
                 .where(filter=FieldFilter("plant_id", "==", plant_id))
                 .order_by("observed_at", direction=firestore.Query.DESCENDING).limit(limit))
        return [snapshot.to_dict() for snapshot in query.stream()]

    def add_observation(self, record: dict) -> dict:
        reference = self.db.collection("plant_health_observations").document()
        record = {**record, "observation_id": reference.id}
        reference.set(record)
        return record

    def observations(self, plant_id) -> list[dict]:
        query = (self.db.collection("plant_health_observations")
                 .where(filter=FieldFilter("plant_id", "==", plant_id))
                 .order_by("inspected_at", direction=firestore.Query.DESCENDING).limit(100))
        return [snapshot.to_dict() for snapshot in query.stream()]

    def review_observation(self, plant_id, observation_id, changes):
        reference = self.db.collection("plant_health_observations").document(observation_id)
        snapshot = reference.get()
        if not snapshot.exists or snapshot.to_dict()["plant_id"] != plant_id:
            raise HTTPException(404, "Inspection was not found for this plant.")
        if snapshot.to_dict()["reported_by"] == changes["reviewed_by"]:
            raise HTTPException(409, "An independent administrator must review this observation.")
        changes["eligible_for_training"] = bool(changes["training_label"] is not None and snapshot.to_dict().get("sensor_reading"))
        reference.update(changes)
        return {**snapshot.to_dict(), **changes}
