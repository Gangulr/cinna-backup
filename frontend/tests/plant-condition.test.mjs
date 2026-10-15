import assert from "node:assert/strict";
import test from "node:test";
import { mergeLiveInputs, validateSensorForm } from "../app/lib/interactive-condition.ts";

const form = { plant_id: "P-001", temperature: "26", humidity: "70", moisture: "49" };

test("partial fetching retains a manual measurement and attributes available readings to one snapshot", () => {
  const result = mergeLiveInputs(form, { temperature: 27.8, humidity: 71.2, moisture: null });
  assert.deepEqual(result.form, { plant_id: "P-001", temperature: "27.8", humidity: "71.2", moisture: "49" });
  assert.deepEqual(result.origins, { temperature: "iot", humidity: "iot", moisture: "manual" });
});

test("missing readings stay blank and a genuine zero is retained", () => {
  const result = mergeLiveInputs({ ...form, humidity: "", moisture: "" }, { temperature: 0, humidity: null, moisture: 0 });
  assert.equal(result.form.temperature, "0");
  assert.equal(result.form.humidity, "");
  assert.equal(result.form.moisture, "0");
  assert.equal(result.origins.humidity, "manual");
});

test("a new partial fetch clears an earlier IoT value rather than relabelling it as manual", () => {
  const result = mergeLiveInputs(form, { temperature: 28, humidity: null, moisture: 50 },
    { temperature: "iot", humidity: "iot", moisture: "manual" });
  assert.equal(result.form.humidity, "");
  assert.equal(result.origins.humidity, "manual");
});

test("validation distinguishes zero from empty and rejects nonfinite or out-of-range readings", () => {
  assert.equal(validateSensorForm({ ...form, temperature: "-50", humidity: "0", moisture: "0" }), "");
  for (const changes of [{ moisture: "" }, { moisture: " " }, { temperature: "NaN" }, { humidity: "Infinity" },
    { moisture: "101" }, { temperature: "-51" }, { plant_id: " " }, { plant_id: "P".repeat(101) }]) {
    assert.notEqual(validateSensorForm({ ...form, ...changes }), "");
  }
});
