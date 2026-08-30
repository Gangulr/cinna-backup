"""
build_faiss_index.py
====================
Standalone script — run ONCE after training to build the FAISS retrieval index.

Usage
-----
python build_faiss_index.py \
    --model   backend/cinnamon_multi_part_model.h5 \
    --dataset /content/cinnamon_split/train \
    --output  backend/

What it produces
----------------
  cinnamon_faiss.index      – faiss.IndexFlatIP of normalised 1280-d embeddings
  faiss_label_map.json      – {"0": "healthy_cinnamon", "1": "leaf_blight", ...}

Architecture note
-----------------
  cinnamon_multi_part_model.h5  contains layers:
    input_image (224,224,3) -> efficientnetb0 -> global_average_pooling (1280-d)
    -> classification_batch_norm -> classification_dropout -> disease_predictions (7)

  We truncate at global_average_pooling to get raw 1280-d feature vectors.
  All vectors are L2-normalised before indexing so that inner-product search
  is equivalent to cosine similarity.

Requirements
------------
  pip install faiss-cpu tensorflow pillow numpy
"""

import argparse
import json
import sys
from pathlib import Path

import faiss
import numpy as np
import tensorflow as tf
from PIL import Image, ImageOps

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

IMAGE_SIZE   = (224, 224)
EMBEDDING_DIM = 1280          # EfficientNetB0 global_average_pooling output
BATCH_SIZE   = 32
SUPPORTED    = {".jpg", ".jpeg", ".png", ".bmp", ".webp", ".tif", ".tiff"}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def build_embedding_model(h5_path: Path) -> tf.keras.Model:
    """
    Load the full inference model and truncate it at global_average_pooling.

    Returns a Model whose output is the 1280-d embedding vector.
    """
    full_model = tf.keras.models.load_model(
        str(h5_path),
        compile=False,
    )

    print("Full model input  :", full_model.input_shape)
    print("Full model output :", full_model.output_shape)

    # Grab the pooling layer output directly — works even if the layer is
    # embedded inside the efficientnetb0 sub-model.
    try:
        pool_output = full_model.get_layer("global_average_pooling").output
    except ValueError:
        # Fallback: search the efficientnetb0 sub-model
        eff_model   = full_model.get_layer("efficientnetb0")
        pool_output = eff_model.get_layer("global_average_pooling").output

    embedding_model = tf.keras.Model(
        inputs=full_model.input,
        outputs=pool_output,
        name="embedding_extractor",
    )

    print(f"Embedding model output shape : {embedding_model.output_shape}")
    assert embedding_model.output_shape[-1] == EMBEDDING_DIM, (
        f"Expected {EMBEDDING_DIM}-d output, got {embedding_model.output_shape}"
    )

    return embedding_model


def preprocess(image_path: Path) -> np.ndarray:
    """
    Load, EXIF-rotate, resize to 224x224, convert to RGB float32 [0,255].
    Returns shape (1, 224, 224, 3).
    """
    with Image.open(image_path) as img:
        img = ImageOps.exif_transpose(img).convert("RGB").resize(
            IMAGE_SIZE, resample=Image.Resampling.BILINEAR
        )
    return np.expand_dims(
        np.asarray(img, dtype=np.float32), axis=0
    )


def collect_images(train_dir: Path) -> tuple[list[Path], list[str]]:
    """
    Walk train_dir/<class_name>/*.jpg and collect paths + string labels.
    """
    paths: list[Path] = []
    labels: list[str] = []

    class_dirs = sorted(d for d in train_dir.iterdir() if d.is_dir())

    if not class_dirs:
        sys.exit(f"No class subdirectories found in: {train_dir}")

    for cls_dir in class_dirs:
        cls_paths = [
            p for p in cls_dir.iterdir()
            if p.is_file() and p.suffix.lower() in SUPPORTED
        ]
        if not cls_paths:
            print(f"  [WARN] No images found in {cls_dir.name}, skipping.")
            continue
        paths.extend(cls_paths)
        labels.extend([cls_dir.name] * len(cls_paths))
        print(f"  {cls_dir.name:30s} : {len(cls_paths)} images")

    print(f"\nTotal images to index : {len(paths)}")
    return paths, labels


def extract_embeddings(
    embedding_model: tf.keras.Model,
    image_paths: list[Path],
) -> np.ndarray:
    """
    Extract 1280-d embeddings in mini-batches.
    Returns float32 array of shape (N, 1280).
    """
    all_embeddings = []

    for start in range(0, len(image_paths), BATCH_SIZE):
        batch_paths = image_paths[start : start + BATCH_SIZE]

        batch_arrays = np.concatenate(
            [preprocess(p) for p in batch_paths], axis=0
        )  # (B, 224, 224, 3)

        embeddings = embedding_model.predict(batch_arrays, verbose=0)
        all_embeddings.append(embeddings)

        done = min(start + BATCH_SIZE, len(image_paths))
        print(f"  Embedded {done:5d} / {len(image_paths)} images", end="\r")

    print()
    return np.concatenate(all_embeddings, axis=0).astype(np.float32)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build FAISS index from cinnamon training images."
    )
    parser.add_argument(
        "--model",
        type=Path,
        default=Path(__file__).resolve().parent / "cinnamon_multi_part_model.h5",
        help="Path to cinnamon_multi_part_model.h5",
    )
    parser.add_argument(
        "--dataset",
        type=Path,
        required=True,
        help="Path to the 70%% training split directory (contains class sub-folders).",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).resolve().parent,
        help="Directory to save cinnamon_faiss.index and faiss_label_map.json.",
    )

    args = parser.parse_args()

    # ---- Validate paths ---------------------------------------------------
    if not args.model.exists():
        sys.exit(f"Model file not found: {args.model}")

    if not args.dataset.is_dir():
        sys.exit(f"Dataset directory not found: {args.dataset}")

    args.output.mkdir(parents=True, exist_ok=True)

    index_path    = args.output / "cinnamon_faiss.index"
    labelmap_path = args.output / "faiss_label_map.json"

    # ---- Build embedding extractor ----------------------------------------
    print("\n[1/5] Loading model and building embedding extractor ...")
    embedding_model = build_embedding_model(args.model)

    # ---- Collect training images ------------------------------------------
    print("\n[2/5] Collecting training images ...")
    image_paths, string_labels = collect_images(args.dataset)

    # ---- Extract embeddings -----------------------------------------------
    print("\n[3/5] Extracting 1280-d embeddings ...")
    embeddings = extract_embeddings(embedding_model, image_paths)

    print(f"  Embedding matrix shape : {embeddings.shape}")
    print(f"  dtype                  : {embeddings.dtype}")

    # ---- L2-normalise (cosine similarity via inner product) ---------------
    print("\n[4/5] Normalising vectors (L2) ...")
    faiss.normalize_L2(embeddings)   # in-place, makes ||v|| = 1

    # Verify: all norms should be ~1.0
    norms = np.linalg.norm(embeddings, axis=1)
    print(f"  Post-normalisation norm  min={norms.min():.6f}  max={norms.max():.6f}")

    # ---- Build FAISS IndexFlatIP ------------------------------------------
    print("\n[5/5] Building FAISS index and saving files ...")

    index = faiss.IndexFlatIP(EMBEDDING_DIM)   # cosine sim via inner product
    index.add(embeddings)

    print(f"  Vectors in index : {index.ntotal}")

    faiss.write_index(index, str(index_path))
    print(f"  Saved index      : {index_path}")

    # ---- Save label map (int string -> class string) ----------------------
    label_map = {str(i): label for i, label in enumerate(string_labels)}

    with open(labelmap_path, "w", encoding="utf-8") as f:
        json.dump(label_map, f, indent=2)

    print(f"  Saved label map  : {labelmap_path}")

    # ---- Quick self-check -------------------------------------------------
    print("\n[Self-check] Querying first vector against the index ...")
    query = embeddings[0:1].copy()
    distances, indices = index.search(query, k=2)

    print(f"  Top-1 index    : {indices[0][0]}  label = {label_map[str(indices[0][0])]}")
    print(f"  Top-1 similarity (should be ~1.0) : {distances[0][0]:.6f}")
    print(f"  Top-2 index    : {indices[0][1]}  label = {label_map[str(indices[0][1])]}")
    print(f"  Top-2 similarity : {distances[0][1]:.6f}")

    print("\n✓ FAISS index built successfully.\n")
    print("=" * 60)
    print(f"  Index file  : {index_path}")
    print(f"  Label map   : {labelmap_path}")
    print(f"  Index size  : {index.ntotal} vectors × {EMBEDDING_DIM} dims")
    print("=" * 60)


if __name__ == "__main__":
    main()
