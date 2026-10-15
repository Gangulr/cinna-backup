"""Sensor findings and conservative care actions grounded in the saved baseline."""
from copy import deepcopy

LABELS = {"temperature": "Temperature", "humidity": "Humidity", "moisture": "Soil moisture"}
UNITS = {"temperature": "°C", "humidity": "% RH", "moisture": "%"}
ACTION_TEXT = {
    "routine": "Continue your usual care routine and record fresh sensor measurements regularly.",
    "measure": "Repeat the measurements and check sensor placement and moisture calibration before changing plant care.",
    "soil": "Inspect the soil directly before adjusting watering; confirm whether it is dry or retaining excess water.",
    "drainage": "Inspect drainage and check for standing water around the plant.",
    "environment": "Inspect sun exposure, shade and airflow around the plant before making environmental adjustments.",
    "inspect": "Inspect leaves, stems and soil for visible changes, including wilting, discolouration or damage.",
    "expert": "Seek advice from a qualified agronomist if unusual readings or visible symptoms persist.",
}


def care_details(record, baseline):
    """Do not reinterpret old records using a different model's reference ranges."""
    compatible = bool(baseline.model is not None and
                      record.get("model_version") == baseline.metadata.get("model_version"))
    findings = []
    for name, label in LABELS.items():
        value = record[name]
        limits = baseline.metadata.get("training_ranges", {}).get(name) if compatible else None
        comparison = ("below_baseline" if value < limits["min"] else
                      "above_baseline" if value > limits["max"] else "within_baseline") if limits else "unavailable"
        findings.append({"feature": name, "label": label, "value": value, "unit": UNITS[name],
                         "baseline_min": limits["min"] if limits else None,
                         "baseline_max": limits["max"] if limits else None, "comparison": comparison})
    ids = ["routine", "inspect", "measure"] if record["status"] == "OK" else ["measure", "inspect", "expert"]
    if record.get("freshness") in ("stale", "unknown", "future"):
        ids = ["measure", *[key for key in ids if key != "measure"]]
    moisture = next(item for item in findings if item["feature"] == "moisture")
    if moisture["comparison"] in ("above_baseline", "below_baseline"):
        ids.insert(1, "soil")
        if moisture["comparison"] == "above_baseline":
            ids.insert(2, "drainage")
    if any(item["comparison"] in ("above_baseline", "below_baseline") for item in findings[:2]):
        ids.insert(1, "environment")
    ids = list(dict.fromkeys(ids))[:5]
    summary = {
        "OK": "The submitted sensor pattern resembles the healthy reference readings. Continue routine care and direct plant inspections.",
        "ATTENTION": "The submitted sensor pattern differs from the healthy reference readings. Verify the measurements and inspect the plant before changing care.",
        "UNKNOWN": "These measurements cannot be assessed reliably with the available baseline. Verify the readings and use direct inspection to decide the next steps.",
    }[record["status"]]
    if record["status"] == "ATTENTION" and all(item["comparison"] == "within_baseline" for item in findings):
        summary += " Individual values are within the observed ranges, but their combination is unusual."
    follow_up = ("Take current measurements before using this assessment to guide present-day care."
                 if record.get("freshness") in ("stale", "unknown", "future") else
                 "Repeat the check with new measurements after inspection or any care adjustment; seek agronomic advice if concerns persist.")
    return {"sensor_findings": findings, "basic_guidance": {
        "summary": summary, "recommended_actions": [{"action_id": key, "instruction": ACTION_TEXT[key]} for key in ids],
        "follow_up": follow_up, "source": "basic",
    }}


def enrich_check(record, baseline):
    result = deepcopy(record)
    if "sensor_findings" not in result or "basic_guidance" not in result:
        result.update(care_details(result, baseline))
    return result
