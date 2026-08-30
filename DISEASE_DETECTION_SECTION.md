# Disease Detection Section

## Purpose

This section analyses an uploaded image and displays one of the following results:

- Healthy Cinnamon
- Non-Cinnamon
- Leaf Blight
- Leaf Miner Attack
- Leaf Patches – Fungal Disease
- Lower Leaf Gall
- Upper Leaf Gall

## System flow

```text
User selects image
  -> frontend validates the file type and creates a preview
  -> authenticated POST /disease-predict/
  -> backend validates the image and upload size
  -> EXIF correction, RGB conversion and resize to 224 x 224
  -> EfficientNet model produces seven class probabilities
  -> highest-probability class becomes the displayed result
  -> confidence and top-two probability margin are calculated
  -> optional Gemini and FAISS research metadata is added
  -> result is saved to Firestore
  -> disease alert email is attempted for a disease result
  -> frontend displays the class, confidence and guidance
```

## Active model

| Item | Implementation |
|---|---|
| Model file | `backend/cinnamon_multi_part_model.h5` |
| Architecture | EfficientNet-based TensorFlow/Keras classifier |
| Input | One 224 x 224 RGB image |
| Output | Seven softmax class probabilities |
| Class order | `backend/class_names.json` |

The backend verifies the input shape, output count and exact class order when it starts. The class with the largest softmax probability is always returned as the main prediction.

## Decision calculation

```text
confidence = highest class probability
margin = highest probability - second-highest probability

low_confidence = confidence < 0.70 OR margin < 0.15
```

The confidence thresholds do not hide the class name. They only add `low_confidence` and `review_recommended` information.

| Top model class | Application status |
|---|---|
| `healthy_cinnamon` | `healthy` |
| `non_cinnamon` | `rejected` |
| Any disease class | `disease_detected` |

## Gemini and FAISS roles

- Gemini may be called for a weak EfficientNet result, but currently operates in shadow/research mode.
- Gemini cannot replace the displayed EfficientNet diagnosis.
- FAISS is optional similarity evidence and requires generated index artifacts.
- FAISS similarity does not replace the model probability or class.

## Main code files

| File | Responsibility |
|---|---|
| `frontend/app/diseaseprediction/page.tsx` | Upload UI, image preview and result display |
| `frontend/app/lib/api.ts` | Authenticated API request helper |
| `backend/main.py` | Image validation, preprocessing, inference, response and persistence |
| `backend/cinnamon_multi_part_model.h5` | Trained disease classifier |
| `backend/class_names.json` | Model output-class order |
| `backend/hybrid_disease/orchestrator.py` | Gemini routing and shadow metadata |
| `backend/hybrid_disease/gemini_service.py` | Gemini API communication |
| `backend/hybrid_disease/image_processing.py` | Sanitized image preparation for Gemini |
| `backend/hybrid_disease/ontology.py` | Gemini prompt and supported disease ontology |
| `backend/hybrid_disease/schemas.py` | Typed model/Gemini result contracts |
| `backend/Cinnamon_Disease_Model_Training.py` | Disease-model training/export code |
| `backend/Cinnamon_Disease_Model_Training.ipynb` | Notebook version of the training workflow |
| `backend/build_faiss_index.py` | Optional FAISS index builder |
| `backend/tests/test_scoped_prototype_models.py` | Disease endpoint and decision tests |

## API and stored output

- Endpoint: `POST /disease-predict/`
- Authentication: Firebase ID token required
- Input: multipart image field named `file`
- Important output: status, prediction, display name, confidence, margin, guidance and persistence flags
- Firestore collection: `disease_predictions`

## Prototype limitation

The model artifact is available, but the complete retained training dataset and final field-validation report are not included. Results are appropriate for a university prototype and should not be presented as expert-confirmed plant diagnosis.
