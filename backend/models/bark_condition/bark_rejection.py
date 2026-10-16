"""Training-reference OOD checks, not a cinnamon-species or healthy-bark detector."""
import hashlib
import json
from pathlib import Path
import numpy as np

CLASS_NAMES = ["RoughBark", "StripeCanker"]

def normalize_embeddings(values):
    values = np.asarray(values, dtype=np.float64)
    if values.ndim != 2 or not len(values) or not np.isfinite(values).all():
        raise ValueError("Embeddings must be a nonempty finite matrix.")
    norms = np.linalg.norm(values, axis=1, keepdims=True)
    if (norms <= 0).any():
        raise ValueError("A zero embedding cannot support a domain assessment.")
    return values / norms

def mean_knn_cosine_distance(query_embeddings, reference_embeddings, k=5, chunk_size=128):
    query = normalize_embeddings(query_embeddings)
    reference = normalize_embeddings(reference_embeddings)
    if query.shape[1] != reference.shape[1] or int(k) < 1 or int(chunk_size) < 1:
        raise ValueError("Invalid embedding dimensions, k or chunk size.")
    actual_k = min(int(k), len(reference))
    output = []
    for offset in range(0, len(query), int(chunk_size)):
        similarities = np.clip(query[offset:offset + int(chunk_size)] @ reference.T, -1.0, 1.0)
        distances = 1.0 - similarities
        neighbours = np.partition(distances, actual_k - 1, axis=1)[:, :actual_k]
        output.append(neighbours.mean(axis=1))
    return np.concatenate(output)

def domain_decisions_enabled(policy):
    # This gate only measures support for known diseases; it never establishes input relevance.
    return bool(np.isfinite(policy["distance_threshold"]))

def calibrate_relevance_policy(labels, scores, minimum_per_class=20,
                               min_positive_pass=0.90, max_negative_pass=0.05,
                               max_positive_reject=0.02, min_negative_reject=0.80):
    y, s = np.asarray(labels, dtype=int), np.asarray(scores, dtype=float)
    if y.ndim != 1 or s.shape != y.shape or not np.isfinite(s).all() or ((s < 0) | (s > 1)).any():
        raise ValueError("Invalid relevance validation labels/scores.")
    if not set(y.tolist()).issubset({0, 1}):
        raise ValueError("Relevance labels must be 0=not_relevant, 1=relevant_bark.")
    p, q = s[y == 1], s[y == 0]
    policy = {"schema_version": 1, "available": bool(len(s)),
        "class_names": ["not_relevant", "relevant_bark"], "positive_class_id": 1,
        "acceptance_enabled": False, "rejection_enabled": False,
        "accept_threshold": None, "reject_threshold": None,
        "positive_validation_images": int(len(p)), "negative_validation_images": int(len(q)),
        "minimum_validation_per_class": int(minimum_per_class),
        "min_positive_pass": min_positive_pass, "max_negative_pass": max_negative_pass,
        "max_positive_reject": max_positive_reject, "min_negative_reject": min_negative_reject,
        "calibration_source": "relevance_validation_only", "healthy_diagnosis_supported": False,
        "model_file": None, "model_sha256": None}
    rows=[]
    if not len(p) or not len(q):
        return policy, rows
    for t in np.unique(np.concatenate(([0.0, 1.0], s))):
        rows.append({"threshold": float(t), "positive_pass": float((p >= t).mean()),
                     "negative_pass": float((q >= t).mean()),
                     "positive_reject": float((p <= t).mean()),
                     "negative_reject": float((q <= t).mean())})
    if min(len(p),len(q)) < minimum_per_class:
        return policy, rows
    accepts=[r for r in rows if r["positive_pass"] >= min_positive_pass and r["negative_pass"] <= max_negative_pass]
    if accepts:
        selected=sorted(accepts,key=lambda r:(-r["positive_pass"],r["negative_pass"],r["threshold"]))[0]
        policy.update(acceptance_enabled=True,accept_threshold=selected["threshold"],
                      observed_positive_pass=selected["positive_pass"],observed_negative_pass=selected["negative_pass"])
    # A low threshold must not overlap the relevance acceptance region.
    upper=policy["accept_threshold"] if policy["acceptance_enabled"] else 1.0
    rejects=[r for r in rows if r["threshold"] < upper and r["positive_reject"] <= max_positive_reject
             and r["negative_reject"] >= min_negative_reject]
    if rejects:
        selected=sorted(rejects,key=lambda r:(-r["negative_reject"],r["positive_reject"],r["threshold"]))[0]
        policy.update(rejection_enabled=True,reject_threshold=selected["threshold"],
                      observed_positive_reject=selected["positive_reject"],observed_negative_reject=selected["negative_reject"])
    return policy,rows

def assess_relevance_score(score, policy):
    if score is None or not policy.get("available",False):
        return {"status":"uncertain","reason":"relevance_model_unavailable","score":None}
    score=float(score)
    if not np.isfinite(score) or not 0 <= score <= 1:
        raise ValueError("Invalid relevance score.")
    if policy.get("rejection_enabled",False) and score <= policy["reject_threshold"]:
        return {"status":"rejected","reason":"image_not_relevant","score":score}
    if policy.get("acceptance_enabled",False) and score >= policy["accept_threshold"]:
        return {"status":"passed","reason":"relevance_accepted","score":score}
    return {"status":"uncertain","reason":"relevance_unconfirmed_or_calibration_unmet","score":score}

def inference_mode(domain_policy):
    # Older packages stay strict unless the new experimental mode is explicitly recorded.
    mode = domain_policy.get("inference_mode", "staged_relevance")
    if mode not in {"reference_only_experimental", "staged_relevance"}:
        raise ValueError("Unknown bark inference mode.")
    return mode

def experimental_reference_fallback(domain_policy, relevance):
    # Never bypass an actual relevance rejection or an inconclusive trained model.
    return (inference_mode(domain_policy) == "reference_only_experimental"
            and relevance["reason"] == "relevance_model_unavailable"
            and relevance["score"] is None)

def _base_result(status, reason, distance, domain_policy, relevance):
    return {"status":status,"prediction":None,"candidate_class":None,
        "reason":reason,"confidence_score":None,"confidence_margin":None,"top_predictions":[],
        "domain_distance":None if distance is None else float(distance),
        "domain_distance_threshold":float(domain_policy["distance_threshold"]),
        "in_known_disease_reference":None if distance is None else bool(distance <= domain_policy["distance_threshold"]),
        "domain_gate_negative_targets_met":bool(domain_policy.get("negative_validation_targets_met",False)),
        "relevance_status":relevance["status"],"relevance_score":relevance["score"],
        "relevance_reason":relevance["reason"],"disease_classification_performed":False,
        "review_recommended":True,"healthy_detection_supported":False,"is_cinnamon":None,
        "assessment_mode":inference_mode(domain_policy),
        "input_relevance_verified":relevance["status"] == "passed",
        "unrelated_image_rejection_validated":False,
        "assessment_scope":("experimental_two_disease_reference_and_classifier"
            if experimental_reference_fallback(domain_policy,relevance)
            else "separate_relevance_then_known_disease_reference_and_classifier")}

def pre_disease_decision(distance, domain_policy, relevance):
    inference_mode(domain_policy)
    threshold=float(domain_policy["distance_threshold"])
    if not np.isfinite(threshold) or not 0 <= threshold <= 2:
        raise ValueError("Invalid disease-reference threshold.")
    if relevance["status"] == "rejected":
        return _base_result("rejected","image_not_relevant",None,domain_policy,relevance)
    if distance is not None:
        if not np.isfinite(distance) or not 0 <= distance <= 2:
            raise ValueError("Invalid disease-reference distance.")
        if distance > threshold:
            return _base_result("uncertain","outside_known_disease_bark_reference",distance,domain_policy,relevance)
    if relevance["status"] != "passed" and not experimental_reference_fallback(domain_policy,relevance):
        return _base_result("uncertain",relevance["reason"],distance,domain_policy,relevance)
    if distance is None:
        raise ValueError("Disease classification requires a disease-reference distance.")
    return None

def assess_prediction(probabilities, domain_distance, domain_policy, disease_policy, relevance_result=None):
    relevance=relevance_result or assess_relevance_score(None,{"available":False})
    stopped=pre_disease_decision(domain_distance,domain_policy,relevance)
    if stopped is not None:
        return stopped
    p=np.asarray(probabilities,dtype=np.float64)
    if (p.shape != (2,) or not np.isfinite(p).all() or (p < 0).any()
            or (p > 1).any() or not np.isclose(p.sum(),1,atol=1e-5,rtol=0)):
        raise ValueError("Invalid two-class softmax output.")
    ranking=np.argsort(-p,kind="stable")
    first,second=int(ranking[0]),int(ranking[1])
    confidence,margin=float(p[first]),float(p[first]-p[second])
    accepted=bool(disease_policy["acceptance_enabled"] and confidence >= disease_policy["confidence_threshold"]
                  and margin >= disease_policy["margin_threshold"])
    experimental = experimental_reference_fallback(domain_policy,relevance)
    status = ("experimental_candidate" if experimental else "disease_detected") if accepted else "uncertain"
    reason = (("reference_supported_experimental_candidate" if experimental else "supported_disease_candidate")
              if accepted else "insufficient_disease_evidence")
    result=_base_result(status,reason,domain_distance,domain_policy,relevance)
    result.update(prediction=CLASS_NAMES[first] if accepted else None,candidate_class=CLASS_NAMES[first],
        confidence_score=confidence,confidence_margin=margin,disease_classification_performed=True,
        review_recommended=experimental or not accepted,
        top_predictions=[{"class":CLASS_NAMES[int(i)],"confidence":float(p[i])} for i in ranking])
    return result

def predict_with_domain_gate(batch, embedding_predictor, disease_head_predictor, reference,
                             domain_policy, disease_policy, relevance_predictor=None,relevance_policy=None):
    policy=relevance_policy or {"available":False}
    score=None if relevance_predictor is None else float(np.asarray(relevance_predictor(batch)).reshape(-1)[0])
    relevance=assess_relevance_score(score,policy)
    if relevance["status"] == "rejected":
        return pre_disease_decision(None,domain_policy,relevance)
    # Distance can still explain lack of disease support when relevance is unavailable.
    embeddings=np.asarray(embedding_predictor(batch))
    if embeddings.ndim != 2 or len(embeddings) != 1:
        raise ValueError("Interactive prediction expects one image embedding.")
    distance=float(mean_knn_cosine_distance(embeddings,reference,k=domain_policy["k"])[0])
    stopped=pre_disease_decision(distance,domain_policy,relevance)
    if stopped is not None:
        return stopped
    probabilities=np.asarray(disease_head_predictor(embeddings))
    if probabilities.shape != (1,2):
        raise ValueError("Invalid disease-head output shape.")
    return assess_prediction(probabilities[0],distance,domain_policy,disease_policy,relevance)

def load_rejection_assets(directory, model_path):
    directory, model_path = Path(directory), Path(model_path)
    with open(directory / "ood_policy.json", encoding="utf-8") as file:
        policy = json.load(file)
    model_hash = hashlib.sha256(model_path.read_bytes()).hexdigest()
    expected = policy["model_sha256"].get(model_path.name)
    if expected is None or model_hash != expected:
        raise ValueError("OOD reference is not bound to this model artifact.")
    reference_path = directory / "ood_reference.npz"
    if hashlib.sha256(reference_path.read_bytes()).hexdigest() != policy["reference_sha256"]:
        raise ValueError("OOD reference checksum mismatch.")
    with np.load(reference_path, allow_pickle=False) as data:
        reference = np.asarray(data["embeddings"], dtype=np.float64)
        labels = np.asarray(data["class_ids"])
        image_hashes = np.asarray(data["image_sha256"])
    if (reference.shape != (policy["reference_images"], policy["embedding_dimension"])
            or labels.shape != (len(reference),) or set(labels.tolist()) != {0, 1}
            or image_hashes.shape != (len(reference),)):
        raise ValueError("Invalid OOD reference schema or class coverage.")
    normalize_embeddings(reference)
    return reference, policy
