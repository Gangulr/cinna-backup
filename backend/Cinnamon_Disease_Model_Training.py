
# =============================================================================
# CinnaAI - Complete Cinnamon Disease Model Training Script
# =============================================================================
# Run this script in Google Colab with a T4/A100 GPU.
# Runtime -> Change runtime type -> GPU before running.
#
# Pipeline overview
# -----------------
# Phase  1  Mount Google Drive
# Phase  2  Imports and reproducibility
# Phase  3  Path configuration
# Phase  4  Copy dataset ZIP to Colab local storage
# Phase  5  Extract ZIP and locate dataset root
# Phase  6  Detect classes and count raw images
# Phase  7  Clean dataset (EXIF, RGB, dedup, corruption check)
# Phase  8  Report conflicts and corrupted files
# Phase  9  Report clean image counts
# Phase 10  Stratified 70 / 15 / 15  train / val / test split
# Phase 11  Load tf.data pipelines
# Phase 12  Visualise sample images
# Phase 13  Compute class weights (imbalance correction)
# Phase 14  Data augmentation layer
# Phase 15  Build EfficientNetB0 model (frozen backbone)
# Phase 16  First-stage compile  (Adam 1e-3, SparseCategoricalCrossentropy)
# Phase 17  Train 20 epochs (classifier head only)
# Phase 18  Load best checkpoint for fine-tuning
# Phase 19  Selective backbone unfreeze
#             block7a / block7b / top_*  ->  trainable
#             ALL BatchNormalization     ->  frozen (preserves ImageNet stats)
# Phase 20  MixUp augmentation wrapper (tf.data, Beta distribution)
# Phase 21  Fine-tune compile (Adam 1e-5, CategoricalCrossentropy)
# Phase 22  Fine-tune 15 epochs
# Phase 23  Export inference model -> cinnamon_multi_part_model.h5
#           + class_names.json
#           Input contract: RGB 224x224 float32, range [0, 255], NO /255
# =============================================================================


# =============================================================================
# PHASE 1 - Mount Google Drive
# =============================================================================

from google.colab import drive
import os
import shutil

if os.path.exists("/content/drive") and os.path.isdir("/content/drive"):
    print("Removing existing /content/drive directory...")
    shutil.rmtree("/content/drive")

os.makedirs("/content/drive", exist_ok=True)
drive.mount("/content/drive", force_remount=True)


# =============================================================================
# PHASE 2 - Imports and reproducibility seeds
# =============================================================================

import csv
import hashlib
import json
import random
import zipfile
from collections import Counter
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import tensorflow as tf

from PIL import Image, ImageOps
from sklearn.metrics import (
    ConfusionMatrixDisplay,
    classification_report,
    confusion_matrix,
)
from sklearn.model_selection import train_test_split

SEED = 42

random.seed(SEED)
np.random.seed(SEED)
tf.keras.utils.set_random_seed(SEED)

print("TensorFlow version :", tf.__version__)
print("GPU devices        :", tf.config.list_physical_devices("GPU"))


# =============================================================================
# PHASE 3 - Path configuration
# =============================================================================

ZIP_PATH = Path(
    "/content/drive/MyDrive/CinnamonAI/dataset/research_images.zip"
)

LOCAL_ZIP_PATH = Path("/content/research_images.zip")
EXTRACT_PATH   = Path("/content/cinnamon_raw")
CLEAN_PATH     = Path("/content/cinnamon_clean")
SPLIT_PATH     = Path("/content/cinnamon_split")

MODEL_DRIVE_PATH = Path(
    "/content/drive/MyDrive/CinnamonAI/trained_models"
)

MODEL_DRIVE_PATH.mkdir(parents=True, exist_ok=True)

if not ZIP_PATH.exists():
    raise FileNotFoundError(
        f"Dataset ZIP not found at:\n{ZIP_PATH}\n"
        "Check the Google Drive folder and filename."
    )

print("Dataset ZIP found:", ZIP_PATH)


# =============================================================================
# PHASE 4 - Copy dataset ZIP to Colab local storage
# =============================================================================

if LOCAL_ZIP_PATH.exists():
    LOCAL_ZIP_PATH.unlink()

shutil.copy2(ZIP_PATH, LOCAL_ZIP_PATH)

print(
    "ZIP copied to Colab:",
    LOCAL_ZIP_PATH,
    f"({LOCAL_ZIP_PATH.stat().st_size / 1024 ** 2:.2f} MB)",
)


# =============================================================================
# PHASE 5 - Extract ZIP and locate dataset root
# =============================================================================

if EXTRACT_PATH.exists():
    shutil.rmtree(EXTRACT_PATH)

EXTRACT_PATH.mkdir(parents=True, exist_ok=True)

with zipfile.ZipFile(LOCAL_ZIP_PATH, "r") as zip_file:
    zip_file.extractall(EXTRACT_PATH)

print("Dataset extracted successfully.")

matching_directories = list(EXTRACT_PATH.rglob("leaves_diseases"))

if not matching_directories:
    raise FileNotFoundError(
        "Could not find the 'leaves_diseases' folder inside the extracted ZIP. "
        "Check the ZIP structure."
    )

DATASET_ROOT = matching_directories[0]
print("Dataset root:", DATASET_ROOT)


# =============================================================================
# PHASE 6 - Detect classes and count raw images
# =============================================================================

SUPPORTED_EXTENSIONS = {
    ".jpg", ".jpeg", ".png",
    ".bmp", ".gif", ".webp",
    ".tif", ".tiff",
}

class_directories = sorted(
    directory
    for directory in DATASET_ROOT.iterdir()
    if directory.is_dir()
)

class_names_from_folders = [
    directory.name
    for directory in class_directories
]

print("Classes detected:")
for index, class_name in enumerate(class_names_from_folders):
    print(f"  {index}: {class_name}")

print("\nNumber of classes:", len(class_names_from_folders))

original_class_counts = {}

for class_directory in class_directories:
    image_paths = [
        path
        for path in class_directory.rglob("*")
        if path.is_file()
        and path.suffix.lower() in SUPPORTED_EXTENSIONS
    ]
    original_class_counts[class_directory.name] = len(image_paths)

print("\nRaw images per class:\n")
for class_name, count in original_class_counts.items():
    print(f"  {class_name:25s}: {count}")

print("\nTotal raw images:", sum(original_class_counts.values()))


# =============================================================================
# PHASE 7 - Clean dataset
#           . Correct EXIF rotation
#           . Convert all images to RGB JPEG
#           . Deduplicate using SHA-256 pixel hashes
#           . Filter corrupted / unreadable files
#           . Detect cross-class label conflicts
# =============================================================================

if CLEAN_PATH.exists():
    shutil.rmtree(CLEAN_PATH)

CLEAN_PATH.mkdir(parents=True, exist_ok=True)

converted_count = 0
corrupted_files = []
duplicate_files = []
label_conflicts = []
seen_hashes     = {}   # pixel_hash -> (class_name, path_str)

for class_directory in class_directories:
    destination_class = CLEAN_PATH / class_directory.name
    destination_class.mkdir(parents=True, exist_ok=True)

    image_paths = [
        path
        for path in class_directory.rglob("*")
        if path.is_file()
        and path.suffix.lower() in SUPPORTED_EXTENSIONS
    ]

    for image_path in image_paths:
        try:
            with Image.open(image_path) as image:
                # Correct phone-camera EXIF rotation.
                image = ImageOps.exif_transpose(image)

                # Normalise colour mode to RGB (handles L, RGBA, P).
                image = image.convert("RGB")

                # Build a normalised pixel hash for deduplication.
                image_array = np.asarray(image)
                pixel_hash  = hashlib.sha256(
                    image_array.tobytes()
                    + str(image.size).encode()
                ).hexdigest()

                if pixel_hash in seen_hashes:
                    previous_class, previous_path = seen_hashes[pixel_hash]

                    if previous_class != class_directory.name:
                        label_conflicts.append({
                            "image"          : str(image_path),
                            "current_class"  : class_directory.name,
                            "previous_image" : previous_path,
                            "previous_class" : previous_class,
                        })
                    else:
                        duplicate_files.append(str(image_path))

                    continue

                seen_hashes[pixel_hash] = (
                    class_directory.name,
                    str(image_path),
                )

                destination_path = (
                    destination_class
                    / f"{class_directory.name}_{converted_count:07d}.jpg"
                )

                image.save(
                    destination_path,
                    format="JPEG",
                    quality=95,
                    optimize=True,
                )

                converted_count += 1

        except Exception as error:
            corrupted_files.append({
                "path" : str(image_path),
                "error": str(error),
            })

print("Clean images created         :", converted_count)
print("Same-class duplicates skipped:", len(duplicate_files))
print("Corrupted / unreadable files :", len(corrupted_files))
print("Cross-class label conflicts  :", len(label_conflicts))


# =============================================================================
# PHASE 8 - Report conflicts and corrupted files
# =============================================================================

if label_conflicts:
    print("\nCross-class label conflicts (first 20):\n")
    for conflict in label_conflicts[:20]:
        print("  Current :", conflict["image"])
        print("  Class   :", conflict["current_class"])
        print("  Clashes :", conflict["previous_image"])
        print("  Class   :", conflict["previous_class"])
        print()

if corrupted_files:
    print("\nCorrupted files (first 20):\n")
    for item in corrupted_files[:20]:
        print(f"  {item['path']} -> {item['error']}")


# =============================================================================
# PHASE 9 - Clean image counts
# =============================================================================

clean_class_directories = sorted(
    directory
    for directory in CLEAN_PATH.iterdir()
    if directory.is_dir()
)

clean_class_counts = {}

for class_directory in clean_class_directories:
    count = len(list(class_directory.glob("*.jpg")))
    clean_class_counts[class_directory.name] = count

print("Clean dataset counts:\n")
for class_name, count in clean_class_counts.items():
    print(f"  {class_name:25s}: {count}")

print("\nTotal clean images:", sum(clean_class_counts.values()))


# =============================================================================
# PHASE 10 - Stratified 70 / 15 / 15  train / validation / test split
# =============================================================================

if SPLIT_PATH.exists():
    shutil.rmtree(SPLIT_PATH)

for split_name in ["train", "validation", "test"]:
    (SPLIT_PATH / split_name).mkdir(parents=True, exist_ok=True)

MINIMUM_IMAGES = 10
split_summary  = {}

for class_directory in clean_class_directories:
    class_name  = class_directory.name
    image_paths = sorted(class_directory.glob("*.jpg"))

    if len(image_paths) < MINIMUM_IMAGES:
        raise ValueError(
            f"Class '{class_name}' has only {len(image_paths)} usable images. "
            f"At least {MINIMUM_IMAGES} are required."
        )

    # 70 % training
    train_paths, temporary_paths = train_test_split(
        image_paths,
        test_size=0.30,
        random_state=SEED,
        shuffle=True,
    )

    # Split the remaining 30 % equally -> 15 % val / 15 % test
    validation_paths, test_paths = train_test_split(
        temporary_paths,
        test_size=0.50,
        random_state=SEED,
        shuffle=True,
    )

    split_groups   = {
        "train"     : train_paths,
        "validation": validation_paths,
        "test"      : test_paths,
    }

    split_summary[class_name] = {}

    for split_name, paths in split_groups.items():
        destination_directory = SPLIT_PATH / split_name / class_name
        destination_directory.mkdir(parents=True, exist_ok=True)

        for source_path in paths:
            shutil.copy2(
                source_path,
                destination_directory / source_path.name,
            )

        split_summary[class_name][split_name] = len(paths)

print("Split summary:\n")
for class_name, counts in split_summary.items():
    print(
        f"  {class_name:25s}  "
        f"Train={counts['train']:4d} | "
        f"Val={counts['validation']:4d} | "
        f"Test={counts['test']:4d}"
    )


# =============================================================================
# PHASE 11 - Load tf.data pipelines
# =============================================================================

IMAGE_SIZE = (224, 224)
BATCH_SIZE = 32
AUTOTUNE   = tf.data.AUTOTUNE

# First-stage training uses integer labels (SparseCategoricalCrossentropy).
# NOTE: drop_remainder is NOT available in image_dataset_from_directory in TF 2.20.
# The partial-batch fix for MixUp is handled inside apply_mixup() using
# .unbatch().batch(BATCH_SIZE, drop_remainder=True).
train_dataset = tf.keras.utils.image_dataset_from_directory(
    SPLIT_PATH / "train",
    labels="inferred",
    label_mode="int",
    image_size=IMAGE_SIZE,
    batch_size=BATCH_SIZE,
    shuffle=True,
    seed=SEED,
)

validation_dataset = tf.keras.utils.image_dataset_from_directory(
    SPLIT_PATH / "validation",
    labels="inferred",
    label_mode="int",
    image_size=IMAGE_SIZE,
    batch_size=BATCH_SIZE,
    shuffle=False,
)

test_dataset = tf.keras.utils.image_dataset_from_directory(
    SPLIT_PATH / "test",
    labels="inferred",
    label_mode="int",
    image_size=IMAGE_SIZE,
    batch_size=BATCH_SIZE,
    shuffle=False,
)

class_names       = train_dataset.class_names
NUMBER_OF_CLASSES = len(class_names)

print("\nTensorFlow class order (alphabetical):")
for index, class_name in enumerate(class_names):
    print(f"  {index}: {class_name}")

print("\nNumber of classes:", NUMBER_OF_CLASSES)

train_dataset      = train_dataset.prefetch(AUTOTUNE)
validation_dataset = validation_dataset.prefetch(AUTOTUNE)
test_dataset       = test_dataset.prefetch(AUTOTUNE)

print("Datasets prefetched.")


# =============================================================================
# PHASE 12 - Visualise sample images from the training set
# =============================================================================

plt.figure(figsize=(12, 10))

for images, labels in train_dataset.take(1):
    for index in range(min(12, len(images))):
        plt.subplot(3, 4, index + 1)
        plt.imshow(images[index].numpy().astype("uint8"))
        plt.title(class_names[int(labels[index])], fontsize=9)
        plt.axis("off")

plt.suptitle("Training Set - Sample Images", fontsize=13, y=1.02)
plt.tight_layout()
plt.show()


# =============================================================================
# PHASE 13 - Compute class weights
#            Balances rare classes (leaf_miner_attack, galls) vs. majority
# =============================================================================

training_counts = []

for class_name in class_names:
    class_directory = SPLIT_PATH / "train" / class_name
    count           = len(list(class_directory.glob("*.jpg")))
    training_counts.append(count)

training_counts       = np.array(training_counts)
total_training_images = int(training_counts.sum())

class_weights = {
    class_index: (
        total_training_images
        / (NUMBER_OF_CLASSES * class_count)
    )
    for class_index, class_count in enumerate(training_counts)
}

print("Training image counts and class weights:\n")
for class_index, class_name in enumerate(class_names):
    print(
        f"  {class_index}  {class_name:25s}  "
        f"count={training_counts[class_index]:4d}  "
        f"weight={class_weights[class_index]:.4f}"
    )


# =============================================================================
# PHASE 14 - Data augmentation layer
#            Applied inside the model graph only during training.
# =============================================================================

data_augmentation = tf.keras.Sequential(
    [
        tf.keras.layers.RandomFlip(mode="horizontal"),
        tf.keras.layers.RandomRotation(factor=0.08),
        tf.keras.layers.RandomZoom(
            height_factor=0.12,
            width_factor=0.12,
        ),
        tf.keras.layers.RandomTranslation(
            height_factor=0.08,
            width_factor=0.08,
        ),
        tf.keras.layers.RandomContrast(factor=0.15),
    ],
    name="data_augmentation",
)

print("Data augmentation layer created.")


# =============================================================================
# PHASE 15 - Build EfficientNetB0 model
#            Backbone is frozen; only the classification head trains
#            in Phase 17.
# =============================================================================

base_model = tf.keras.applications.EfficientNetB0(
    include_top=False,
    weights="imagenet",
    input_shape=IMAGE_SIZE + (3,),
)

# Freeze the entire backbone for the first training stage.
base_model.trainable = False

# ------ Functional model graph -----------------------------------------------
inputs = tf.keras.Input(
    shape=IMAGE_SIZE + (3,),
    name="input_image",
)

# Augmentation applied with training=True so the random ops fire during fit().
x = data_augmentation(inputs, training=True)

# Backbone in inference mode even during head training -
# this keeps BN running statistics stable.
x = base_model(x, training=False)

x = tf.keras.layers.GlobalAveragePooling2D(
    name="global_average_pooling"
)(x)

x = tf.keras.layers.BatchNormalization(
    name="classification_batch_norm"
)(x)

x = tf.keras.layers.Dropout(
    rate=0.35,
    name="classification_dropout",
)(x)

outputs = tf.keras.layers.Dense(
    NUMBER_OF_CLASSES,
    activation="softmax",
    name="disease_predictions",
)(x)

model = tf.keras.Model(
    inputs=inputs,
    outputs=outputs,
    name="cinnamon_leaf_condition_model",
)

model.summary()


# =============================================================================
# PHASE 16 - First-stage compile
#            Adam 1e-3  |  SparseCategoricalCrossentropy (integer labels)
# =============================================================================

model.compile(
    optimizer=tf.keras.optimizers.Adam(learning_rate=1e-3),
    loss=tf.keras.losses.SparseCategoricalCrossentropy(),
    metrics=[
        tf.keras.metrics.SparseCategoricalAccuracy(name="accuracy"),
        tf.keras.metrics.SparseTopKCategoricalAccuracy(
            k=min(3, NUMBER_OF_CLASSES),
            name="top_3_accuracy",
        ),
    ],
)

print("Model compiled - Adam 1e-3 | SparseCategoricalCrossentropy.")


# =============================================================================
# PHASE 17 - Train 20 epochs (classifier head only, backbone frozen)
# =============================================================================

BEST_MODEL_PATH = MODEL_DRIVE_PATH / "best_cinnamon_leaf_model.keras"
INITIAL_EPOCHS  = 20

callbacks = [
    tf.keras.callbacks.ModelCheckpoint(
        filepath=str(BEST_MODEL_PATH),
        monitor="val_loss",
        save_best_only=True,
        verbose=1,
    ),
    tf.keras.callbacks.EarlyStopping(
        monitor="val_loss",
        patience=6,
        restore_best_weights=True,
        verbose=1,
    ),
    tf.keras.callbacks.ReduceLROnPlateau(
        monitor="val_loss",
        factor=0.3,
        patience=3,
        min_lr=1e-7,
        verbose=1,
    ),
]

print(f"Starting Phase 17 - initial training for {INITIAL_EPOCHS} epochs...")

initial_history = model.fit(
    train_dataset,
    validation_data=validation_dataset,
    epochs=INITIAL_EPOCHS,
    class_weight=class_weights,
    callbacks=callbacks,
)

print("\nPhase 17 complete.")

# ------ Training curves ------------------------------------------------------
history_dict = initial_history.history
epochs_ran   = range(1, len(history_dict["accuracy"]) + 1)

fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 5))

ax1.plot(epochs_ran, history_dict["accuracy"],     label="Train accuracy")
ax1.plot(epochs_ran, history_dict["val_accuracy"], label="Val accuracy")
ax1.set_title("Accuracy - Initial Training (Phase 17)")
ax1.set_xlabel("Epoch")
ax1.set_ylabel("Accuracy")
ax1.legend()
ax1.grid(True, alpha=0.3)

ax2.plot(epochs_ran, history_dict["loss"],     label="Train loss")
ax2.plot(epochs_ran, history_dict["val_loss"], label="Val loss")
ax2.set_title("Loss - Initial Training (Phase 17)")
ax2.set_xlabel("Epoch")
ax2.set_ylabel("Loss")
ax2.legend()
ax2.grid(True, alpha=0.3)

plt.tight_layout()
plt.show()


# =============================================================================
# PHASE 18 - Load the best checkpoint for fine-tuning
# =============================================================================

if not BEST_MODEL_PATH.exists():
    raise FileNotFoundError(
        f"best_cinnamon_leaf_model.keras not found at:\n{BEST_MODEL_PATH}\n"
        "Phase 17 training must complete successfully first."
    )

# Load without compiling - we will recompile in Phase 21.
model = tf.keras.models.load_model(
    str(BEST_MODEL_PATH),
    compile=False,
)

print("best_cinnamon_leaf_model.keras loaded for fine-tuning.")
print("Input  shape:", model.input_shape)
print("Output shape:", model.output_shape)
model.summary(expand_nested=False)


# =============================================================================
# PHASE 19 - Selective backbone unfreeze
#
# Strategy:
#   Unfreeze : block7a_*, block7b_*, top_*   <- learn cinnamon-specific textures
#   Freeze   : ALL other EfficientNetB0 layers
#   CRITICAL : ALL BatchNormalization layers ALWAYS remain frozen.
#              Unfreezing BN on a small dataset corrupts ImageNet running stats
#              and causes accuracy degradation on minority classes.
#
# Rationale:
#   block7a / block7b encode high-level texture patterns such as galls,
#   patches, and blights that are domain-specific to cinnamon.
#   top_* contains the final convolutions before global pooling.
# =============================================================================

base_model = model.get_layer("efficientnetb0")

# Open the backbone globally first.
base_model.trainable = True

UNFREEZE_PREFIXES = ("block7a_", "block7b_", "top_")

frozen_count     = 0
trainable_count  = 0
bn_forced_frozen = 0

for layer in base_model.layers:
    is_bn              = isinstance(layer, tf.keras.layers.BatchNormalization)
    starts_with_target = layer.name.startswith(UNFREEZE_PREFIXES)

    if is_bn:
        # CRITICAL: ALL BN layers remain frozen regardless of block prefix.
        layer.trainable  = False
        bn_forced_frozen += 1
        frozen_count     += 1

    elif starts_with_target:
        layer.trainable = True
        trainable_count += 1

    else:
        layer.trainable = False
        frozen_count    += 1

print("Selective freeze complete.")
print(f"  Trainable (non-BN top blocks) : {trainable_count}")
print(f"  Frozen layers                 : {frozen_count}")
print(f"  BatchNorm layers force-frozen : {bn_forced_frozen}")
print()

# Boundary inspection - last 30 EfficientNetB0 layers.
print("Last 30 EfficientNetB0 layers:\n")
for layer in base_model.layers[-30:]:
    status = "TRAIN " if layer.trainable else "FROZEN"
    print(f"  [{status}]  {layer.name:50s}  {type(layer).__name__}")


# =============================================================================
# PHASE 20 - MixUp augmentation tf.data wrapper
#
# Why MixUp for cinnamon disease classification?
# ----------------------------------------------
# The rare classes (leaf_miner_attack, lower_leaf_gall, upper_leaf_gall)
# share nearly identical green-leaf backgrounds. Without MixUp the model
# learns background colour/texture as a shortcut instead of actual lesion
# signatures. MixUp blends two images at a random ratio lambda ~ Beta(a,a),
# forcing the network to interpolate between lesion patterns.
#
# Because the resulting labels are soft float vectors (not integer indices)
# we switch the loss to CategoricalCrossentropy in Phase 21.
# =============================================================================

MIXUP_ALPHA = 0.4   # Beta(a,a) concentration.
                     # 0.4 gives strong mixing while keeping blended images
                     # visually meaningful.


def apply_mixup(
    dataset,
    num_classes,
    batch_size,
    alpha=0.4,
):
    """
    Wrap a batched tf.data.Dataset to apply per-batch MixUp augmentation.

    Input  : dataset yielding (image_batch [float32 0-255], int_label_batch)
    Output : dataset yielding (mixed_image_batch, soft_one_hot_label_batch)

    The function internally calls .unbatch().batch(batch_size, drop_remainder=True)
    to guarantee every batch is exactly batch_size images.  This is required
    because MixUp blends two batches element-wise; if the two zipped streams
    land on batches of different sizes (e.g. 32 vs 14 at the end of an epoch)
    TF raises InvalidArgumentError: Incompatible shapes.
    (image_dataset_from_directory does not support drop_remainder in TF 2.20.)

    Args:
        dataset     : Batched, prefetched Dataset with integer labels.
        num_classes : Total number of output disease classes.
        batch_size  : Must match the batch size used to create the dataset.
        alpha       : Beta(a,a) concentration.  Recommended range: 0.2-0.5.

    Returns:
        A new tf.data.Dataset producing MixUp-blended batches.
    """

    def _one_hot_encode(images, labels):
        return images, tf.one_hot(
            tf.cast(labels, tf.int32),
            depth=num_classes,
        )

    def _mixup_batch(batch_a, batch_b):
        # Beta sampling via Gamma ratio: Beta(a,b) = G_a / (G_a + G_b)
        # XLA-compatible — no Python random state.
        images_a, labels_a = batch_a
        images_b, labels_b = batch_b

        g1  = tf.squeeze(tf.random.gamma(shape=(1,), alpha=alpha))
        g2  = tf.squeeze(tf.random.gamma(shape=(1,), alpha=alpha))
        lam = g1 / (g1 + g2 + 1e-8)

        # Both image batches are raw 0-255 float32 - pixel range preserved.
        mixed_images = lam * images_a + (1.0 - lam) * images_b
        mixed_labels = lam * labels_a + (1.0 - lam) * labels_b

        return mixed_images, mixed_labels

    # Step 1: Convert integer labels to one-hot, then rebatch with
    #         drop_remainder=True so every batch is exactly batch_size.
    #         This prevents the Incompatible shapes crash during MixUp zip.
    one_hot_ds = (
        dataset
        .map(_one_hot_encode, num_parallel_calls=tf.data.AUTOTUNE)
        .unbatch()
        .batch(batch_size, drop_remainder=True)
    )

    # Step 2: Create a differently-shuffled view for independent pair sampling.
    one_hot_ds_shuffled = one_hot_ds.shuffle(
        buffer_size=128,
        reshuffle_each_iteration=True,
    )

    # Step 3: Zip and mix.
    return (
        tf.data.Dataset
        .zip((one_hot_ds, one_hot_ds_shuffled))
        .map(_mixup_batch, num_parallel_calls=tf.data.AUTOTUNE)
        .prefetch(tf.data.AUTOTUNE)
    )


# ------ Build fine-tuning data pipelines -------------------------------------

mixup_train_dataset = apply_mixup(
    train_dataset,
    num_classes=NUMBER_OF_CLASSES,
    batch_size=BATCH_SIZE,
    alpha=MIXUP_ALPHA,
)

# Validation uses clean labels converted to one-hot (no MixUp).
val_dataset_one_hot = validation_dataset.map(
    lambda images, labels: (
        images,
        tf.one_hot(tf.cast(labels, tf.int32), depth=NUMBER_OF_CLASSES),
    ),
    num_parallel_calls=AUTOTUNE,
).prefetch(AUTOTUNE)

# Sanity check.
for batch_images, batch_labels in mixup_train_dataset.take(1):
    print("MixUp train batch - images :", batch_images.shape, batch_images.dtype)
    print("MixUp train batch - labels :", batch_labels.shape, batch_labels.dtype)
    print("Label row 0 sum (== 1.0)   :", batch_labels[0].numpy().sum())

print(f"\nMixUp pipeline ready  (alpha={MIXUP_ALPHA})")


# =============================================================================
# PHASE 21 - Recompile for fine-tuning
#            Adam 1e-5  |  CategoricalCrossentropy  (required by MixUp)
# =============================================================================

FINETUNE_LR = 1e-5   # Micro learning-rate: prevents catastrophic forgetting
                      # while allowing top EfficientNetB0 blocks to adapt to
                      # cinnamon gall / patch / blight textures.

model.compile(
    optimizer=tf.keras.optimizers.Adam(learning_rate=FINETUNE_LR),
    # CategoricalCrossentropy required because MixUp produces soft float
    # label vectors. from_logits=False as Dense head already applies softmax.
    # label_smoothing=0.05 adds additional regularisation for minority classes.
    loss=tf.keras.losses.CategoricalCrossentropy(
        from_logits=False,
        label_smoothing=0.05,
    ),
    metrics=[
        tf.keras.metrics.CategoricalAccuracy(name="accuracy"),
        tf.keras.metrics.TopKCategoricalAccuracy(
            k=min(3, NUMBER_OF_CLASSES),
            name="top_3_accuracy",
        ),
    ],
)

trainable_params     = int(np.sum([np.prod(v.shape) for v in model.trainable_weights]))
non_trainable_params = int(np.sum([np.prod(v.shape) for v in model.non_trainable_weights]))

print(f"Compiled - Adam lr={FINETUNE_LR} | CategoricalCrossentropy(label_smoothing=0.05)")
print(f"Trainable parameters     : {trainable_params:,}")
print(f"Non-trainable parameters : {non_trainable_params:,}")


# =============================================================================
# PHASE 22 - Fine-tune for 15 additional epochs
# =============================================================================

FINETUNE_EPOCHS     = 15
FINETUNE_MODEL_PATH = MODEL_DRIVE_PATH / "best_cinnamon_leaf_model_finetuned.keras"

# NOTE: class_weight is intentionally omitted.
# The tf.data API cannot apply class_weight to soft float label vectors.
# Class imbalance is handled by:
#   (a) MixUp implicit minority oversampling, and
#   (b) label_smoothing=0.05 in CategoricalCrossentropy.

finetune_callbacks = [
    # Monitor val_accuracy not val_loss because MixUp inflates loss values.
    tf.keras.callbacks.ModelCheckpoint(
        filepath=str(FINETUNE_MODEL_PATH),
        monitor="val_accuracy",
        save_best_only=True,
        mode="max",
        verbose=1,
    ),
    tf.keras.callbacks.EarlyStopping(
        monitor="val_accuracy",
        patience=5,
        restore_best_weights=True,
        mode="max",
        verbose=1,
    ),
    tf.keras.callbacks.ReduceLROnPlateau(
        monitor="val_loss",
        factor=0.5,
        patience=3,
        min_lr=1e-8,
        verbose=1,
    ),
    # Terminate immediately if NaN appears (gradient explosion guard).
    tf.keras.callbacks.TerminateOnNaN(),
]

print(f"Starting fine-tuning - {FINETUNE_EPOCHS} epochs | lr={FINETUNE_LR}")
print(f"Best checkpoint -> {FINETUNE_MODEL_PATH}\n")

finetune_history = model.fit(
    mixup_train_dataset,
    validation_data=val_dataset_one_hot,
    epochs=FINETUNE_EPOCHS,
    callbacks=finetune_callbacks,
    verbose=1,
)

print("\nPhase 22 fine-tuning complete.")

# ------ Fine-tuning curves ---------------------------------------------------
history_dict = finetune_history.history
epochs_ran   = range(1, len(history_dict["accuracy"]) + 1)

fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 5))

ax1.plot(epochs_ran, history_dict["accuracy"],     label="Train accuracy")
ax1.plot(epochs_ran, history_dict["val_accuracy"], label="Val accuracy")
ax1.set_title("Accuracy - Fine-tuning Phase (Phase 22)")
ax1.set_xlabel("Epoch")
ax1.set_ylabel("Accuracy")
ax1.legend()
ax1.grid(True, alpha=0.3)

ax2.plot(epochs_ran, history_dict["loss"],     label="Train loss")
ax2.plot(epochs_ran, history_dict["val_loss"], label="Val loss")
ax2.set_title("Loss - Fine-tuning Phase (Phase 22)")
ax2.set_xlabel("Epoch")
ax2.set_ylabel("Loss")
ax2.legend()
ax2.grid(True, alpha=0.3)

plt.tight_layout()
plt.show()


# =============================================================================
# PHASE 23 - Export inference model
#
# What this phase does:
#   1. Extracts named layers from the trained model.
#   2. Builds a new clean functional graph WITHOUT data_augmentation.
#   3. Runs all layers with training=False so BN uses stored running stats.
#   4. Saves to cinnamon_multi_part_model.h5 (HDF5, no optimizer).
#   5. Saves class_names.json with canonical 7-class alphabetical order.
#   6. Performs round-trip reload and numerical diff verification.
#   7. Runs full test-set evaluation with classification report.
#
# Input contract (must exactly match main.py expectations):
#   dtype  : float32
#   shape  : (batch, 224, 224, 3)
#   range  : [0, 255]  -  NO /255 rescaling applied externally
#   mode   : RGB
#
# Output:
#   softmax probability vector  ->  shape (batch, 7)
# =============================================================================

H5_OUTPUT_PATH = MODEL_DRIVE_PATH / "cinnamon_multi_part_model.h5"
CN_OUTPUT_PATH = MODEL_DRIVE_PATH / "class_names.json"

# ------ Extract named layers from the fine-tuned model -----------------------
# EarlyStopping with restore_best_weights=True means model already holds
# the weights from the best validation epoch.
_base_model          = model.get_layer("efficientnetb0")
_global_pool         = model.get_layer("global_average_pooling")
_classification_bn   = model.get_layer("classification_batch_norm")
_classification_drop = model.get_layer("classification_dropout")
_disease_output      = model.get_layer("disease_predictions")

# ------ Build clean inference graph (no data_augmentation) -------------------
infer_input = tf.keras.Input(
    shape=IMAGE_SIZE + (3,),
    dtype="float32",
    name="input_image",
)

# training=False -> BN uses stored running_mean / running_variance,
# not the current-batch statistics.
x = _base_model(infer_input, training=False)
x = _global_pool(x)
x = _classification_bn(x, training=False)
x = _classification_drop(x, training=False)
infer_output = _disease_output(x)

inference_model = tf.keras.Model(
    inputs=infer_input,
    outputs=infer_output,
    name="cinnamon_disease_inference_model",
)

inference_model.summary(expand_nested=False)

# ------ Pre-save numerical sanity check --------------------------------------
# Raw 0-255 float32 pixels - exactly the format main.py sends to the model.
dummy_rgb_0_255 = np.random.randint(
    0, 256, size=(1, 224, 224, 3)
).astype("float32")

test_pred = inference_model.predict(dummy_rgb_0_255, verbose=0)

assert test_pred.shape == (1, NUMBER_OF_CLASSES), (
    f"Unexpected output shape: expected (1, {NUMBER_OF_CLASSES}), "
    f"got {test_pred.shape}"
)
assert abs(test_pred[0].sum() - 1.0) < 1e-4, (
    f"Softmax probabilities must sum to 1.0; got {test_pred[0].sum():.6f}"
)

print("Pre-save sanity check PASSED - shape and probability sum are correct.")

# ------ Save H5 inference model ----------------------------------------------
inference_model.save(
    str(H5_OUTPUT_PATH),
    include_optimizer=False,   # No training state - production-only file.
    save_format="h5",
)

h5_size_mb = H5_OUTPUT_PATH.stat().st_size / 1024 ** 2
print(f"\nInference model saved : {H5_OUTPUT_PATH}")
print(f"  File size           : {h5_size_mb:.2f} MB")

# ------ Save class_names.json ------------------------------------------------
# Alphabetical order matching image_dataset_from_directory default behaviour.
# Must match EXPECTED_DISEASE_CLASS_NAMES in backend/main.py exactly.
class_names_export = [
    "healthy_cinnamon",
    "leaf_blight",
    "leaf_miner_attack",
    "leaf_patches_fungal",
    "lower_leaf_gall",
    "non_cinnamon",
    "upper_leaf_gall",
]

# Runtime guard: TF dataset order must match the export list.
assert class_names == class_names_export, (
    f"Class name mismatch - check dataset folder names!\n"
    f"  Dataset order : {class_names}\n"
    f"  Export order  : {class_names_export}"
)

with open(str(CN_OUTPUT_PATH), "w", encoding="utf-8") as f:
    json.dump(class_names_export, f, indent=2)

print(f"\nclass_names.json saved : {CN_OUTPUT_PATH}")
print(f"  Classes ({len(class_names_export)}): {class_names_export}")

# ------ Round-trip verification ----------------------------------------------
reloaded      = tf.keras.models.load_model(str(H5_OUTPUT_PATH), compile=False)
reloaded_pred = reloaded.predict(dummy_rgb_0_255, verbose=0)
max_diff      = float(np.max(np.abs(test_pred - reloaded_pred)))

print(f"\nRound-trip max prediction diff : {max_diff:.2e}")

if max_diff < 1e-5:
    print("Weights survived H5 serialisation round-trip.")
else:
    print(
        "WARNING: Non-trivial numerical drift detected. "
        "Verify your TF version matches backend/requirements.txt."
    )

# ------ Full test-set evaluation on the exported model -----------------------
print("\nRunning final evaluation on the held-out test set...")

all_true  = []
all_preds = []

for images, labels in test_dataset:
    # Pass raw 0-255 pixels - no rescaling, matching the export contract.
    probabilities = reloaded.predict(images, verbose=0)
    predictions   = np.argmax(probabilities, axis=1)
    all_preds.extend(predictions.tolist())
    all_true.extend(labels.numpy().tolist())

all_true  = np.array(all_true)
all_preds = np.array(all_preds)

print("\nClassification Report:\n")
print(
    classification_report(
        all_true,
        all_preds,
        target_names=class_names_export,
    )
)

# Confusion matrix visualisation.
cm = confusion_matrix(all_true, all_preds)
fig, ax = plt.subplots(figsize=(9, 7))
ConfusionMatrixDisplay(
    confusion_matrix=cm,
    display_labels=class_names_export,
).plot(
    ax=ax,
    colorbar=True,
    xticks_rotation=45,
)
ax.set_title("Confusion Matrix - Test Set (Fine-tuned Model)")
plt.tight_layout()
plt.show()

# ------ Final summary --------------------------------------------------------
print()
print("=" * 65)
print("COMPLETE TRAINING + FINE-TUNING PIPELINE FINISHED")
print("=" * 65)
print(f"  Phase 17 model   : {BEST_MODEL_PATH}")
print(f"  Phase 22 model   : {FINETUNE_MODEL_PATH}")
print(f"  Inference H5     : {H5_OUTPUT_PATH}")
print(f"  class_names.json : {CN_OUTPUT_PATH}")
print()
print("  Input contract   : RGB  224x224  float32  range 0-255  (no /255)")
print(f"  Output           : softmax over {len(class_names_export)} cinnamon disease classes")
print("=" * 65)
