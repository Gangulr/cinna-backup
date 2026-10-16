import argparse
import hashlib
import json
from pathlib import Path
import numpy as np
import tensorflow as tf
from preprocessing import preprocess_bark_image
from bark_rejection import load_rejection_assets, mean_knn_cosine_distance, assess_prediction, predict_with_domain_gate, assess_relevance_score

BASE_DIR = Path(__file__).resolve().parent
parser = argparse.ArgumentParser(description="Check bark model probabilities AND rejection decisions.")
parser.add_argument("--model", default="bark_condition_model.keras")
args = parser.parse_args()
MODEL_PATH = BASE_DIR / args.model
with open(BASE_DIR / "parity_fixtures" / "expected_predictions.json", encoding="utf-8") as file:
    parity_data = json.load(file)
with open(BASE_DIR / "class_names.json", encoding="utf-8") as file:
    class_names = json.load(file)
assert class_names == ["RoughBark", "StripeCanker"] == parity_data["class_names"]
reference, domain_policy = load_rejection_assets(BASE_DIR, MODEL_PATH)
with open(BASE_DIR / "relevance_policy.json",encoding="utf-8") as file:
    relevance_policy=json.load(file)
relevance_model=None
if relevance_policy["available"]:
    relevance_path=BASE_DIR/relevance_policy["model_file"]
    assert hashlib.sha256(relevance_path.read_bytes()).hexdigest()==relevance_policy["model_sha256"]
    relevance_model=tf.keras.models.load_model(relevance_path,compile=False)
relevance_predictor=None if relevance_model is None else lambda images: np.asarray(relevance_model(images,training=False))
model = tf.keras.models.load_model(MODEL_PATH, compile=False)
assert model.input_shape == (None, 224, 224, 3) and model.output_shape == (None, 2)
analysis = tf.keras.Model(model.inputs, [model.output, model.get_layer("global_average_pooling").output])
TOLERANCE = 1e-4
differences, distance_differences = [], []
for fixture in parity_data["fixtures"]:
    image_path = BASE_DIR / "parity_fixtures" / "images" / fixture["file"]
    assert hashlib.sha256(image_path.read_bytes()).hexdigest() == fixture["image_sha256"]
    batch = preprocess_bark_image(image_path)
    assert hashlib.sha256(batch.astype("<f4").tobytes(order="C")).hexdigest() == fixture["input_tensor_sha256"]
    probabilities, embeddings = [np.asarray(v) for v in analysis(batch, training=False)]
    actual = probabilities[0]
    expected = np.asarray(fixture["expected_probabilities"], dtype=np.float32)
    np.testing.assert_allclose(actual, expected, atol=TOLERANCE, rtol=0)
    np.testing.assert_allclose(actual, np.asarray(analysis(batch, training=False)[0])[0], atol=TOLERANCE, rtol=0)
    distance = float(mean_knn_cosine_distance(embeddings, reference, k=domain_policy["k"])[0])
    np.testing.assert_allclose(distance, fixture["expected_domain_distance"], atol=TOLERANCE, rtol=0)
    relevance_score=None if relevance_model is None else float(np.asarray(relevance_model(batch,training=False)).reshape(-1)[0])
    if fixture["expected_relevance_score"] is None:
        assert relevance_score is None
    else:
        np.testing.assert_allclose(relevance_score,fixture["expected_relevance_score"],atol=TOLERANCE,rtol=0)
    result=assess_prediction(actual,distance,domain_policy,parity_data["decision_policy"],
        assess_relevance_score(relevance_score,relevance_policy))
    # Exercise the actual head-skipping public path as well as raw diagnostic serialization.
    head_calls = []
    def run_head(features):
        head_calls.append(True)
        values = model.get_layer("classification_dropout")(tf.convert_to_tensor(features), training=False)
        return np.asarray(model.get_layer("bark_predictions")(values))
    public_result = predict_with_domain_gate(batch, lambda images: embeddings, run_head,
        reference,domain_policy,parity_data["decision_policy"],relevance_predictor,relevance_policy)
    assert bool(head_calls) == public_result["disease_classification_performed"]
    assert public_result["status"] == result["status"]
    assert public_result["prediction"] == result["prediction"]
    assert result["disease_classification_performed"] == fixture["expected_disease_classification_performed"]
    assert class_names[int(np.argmax(actual))] == fixture["raw_classifier_class"]
    assert result["candidate_class"] == fixture["predicted_class"]
    assert result["status"] == fixture["expected_status"], "Rejected/uncertain/experimental/disease status changed."
    assert result["prediction"] == fixture["expected_prediction"]
    assert result["assessment_mode"] == fixture["expected_assessment_mode"]
    assert result["input_relevance_verified"] == fixture["expected_input_relevance_verified"]
    assert result["reason"] == fixture["expected_reason"]
    differences.append(float(np.max(np.abs(actual - expected))))
    distance_differences.append(abs(distance - fixture["expected_domain_distance"]))
print("PASS:", MODEL_PATH.name, "fixtures:", len(differences),
      "score difference:", max(differences), "distance difference:", max(distance_differences))
print("Numerical compatibility only; field rejection/diagnostic reliability needs independent data.")
