import os
import random
from pathlib import Path

import fiftyone as fo
import fiftyone.zoo as foz
from PIL import Image, ImageFilter


# ================= CONFIG =================

BASE_DIR = Path(__file__).resolve().parent

OUTPUT_DIR = (
    BASE_DIR
    / "Dataset"
    / "invalid_non_cinnamon"
)

CLASSES = [
    "Person",
    "Car",
    "Food",
    "Animal",
    "Building",
    "Plant",
]

MAX_SAMPLES = 150

MIN_WIDTH = 250
MAX_WIDTH = 400

MIN_BLUR_RADIUS = 0.5
MAX_BLUR_RADIUS = 1.5

MIN_JPEG_QUALITY = 10
MAX_JPEG_QUALITY = 20

RANDOM_SEED = 51


# ================= SETUP =================

random.seed(RANDOM_SEED)

OUTPUT_DIR.mkdir(
    parents=True,
    exist_ok=True,
)

print("පින්තූර බාගත කිරීම ආරම්භ වේ...")


# ================= DOWNLOAD DATASET =================

dataset = foz.load_zoo_dataset(
    "open-images-v7",
    split="train",
    classes=CLASSES,
    max_samples=MAX_SAMPLES,
    seed=RANDOM_SEED,
    shuffle=True,
    only_matching=True,
)

print(
    "බාගත කිරීම අවසන්. "
    "දැන් Quality එක අඩු කරයි..."
)


# ================= PROCESS IMAGES =================

processed_count = 0
skipped_count = 0

for index, sample in enumerate(dataset):
    try:
        if (
            sample.ground_truth is None
            or not hasattr(
                sample.ground_truth,
                "detections",
            )
            or len(
                sample.ground_truth.detections
            ) == 0
        ):
            skipped_count += 1
            print(
                f"⚠️ Detection නොමැති image එක skip කළා: "
                f"{index + 1}"
            )
            continue

        input_path = sample.filepath

        label = (
            sample.ground_truth
            .detections[0]
            .label
            .replace(" ", "_")
        )

        output_filename = (
            f"{label}_{index}.jpg"
        )

        output_path = (
            OUTPUT_DIR
            / output_filename
        )

        with Image.open(input_path) as image:
            image = image.convert("RGB")

            base_width = random.randint(
                MIN_WIDTH,
                MAX_WIDTH,
            )

            width_percentage = (
                base_width
                / float(image.size[0])
            )

            height = int(
                float(image.size[1])
                * width_percentage
            )

            if height <= 0:
                skipped_count += 1
                print(
                    f"⚠️ Invalid image size: "
                    f"{output_filename}"
                )
                continue

            low_quality_image = image.resize(
                (
                    base_width,
                    height,
                ),
                Image.Resampling.NEAREST,
            )

            blur_radius = random.uniform(
                MIN_BLUR_RADIUS,
                MAX_BLUR_RADIUS,
            )

            low_quality_image = (
                low_quality_image.filter(
                    ImageFilter.GaussianBlur(
                        radius=blur_radius
                    )
                )
            )

            jpeg_quality = random.randint(
                MIN_JPEG_QUALITY,
                MAX_JPEG_QUALITY,
            )

            low_quality_image.save(
                output_path,
                "JPEG",
                quality=jpeg_quality,
            )

        processed_count += 1

        print(
            f"✅ {processed_count}/{MAX_SAMPLES} "
            f"processed: {output_filename}"
        )

    except Exception as error:
        skipped_count += 1

        print(
            f"❌ Error processing "
            f"{index + 1}: {error}"
        )


# ================= CLEANUP =================

try:
    dataset_name = dataset.name

    if fo.dataset_exists(dataset_name):
        fo.delete_dataset(dataset_name)

    print(
        "✅ Temporary FiftyOne dataset "
        "cleanup completed"
    )

except Exception as error:
    print(
        "⚠️ FiftyOne dataset cleanup "
        f"failed: {error}"
    )


# ================= FINAL RESULT =================

print("\n✅ සාර්ථකයි!")

print(
    f"Processed images: {processed_count}"
)

print(
    f"Skipped images: {skipped_count}"
)

print(
    f"Output folder: {OUTPUT_DIR}"
)