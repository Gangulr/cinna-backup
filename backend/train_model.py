import json
import tensorflow as tf
from tensorflow.keras.preprocessing.image import ImageDataGenerator
from tensorflow.keras import layers, models
from tensorflow.keras.applications import MobileNetV2
from tensorflow.keras.callbacks import (
    EarlyStopping,
    ModelCheckpoint,
    ReduceLROnPlateau,
)
from tensorflow.keras.optimizers import Adam
import matplotlib.pyplot as plt
import os

# ================= CONFIG =================
DATASET_DIR = "dataset"

IMG_SIZE = 224
BATCH_SIZE = 16
EPOCHS = 25

MODEL_NAME = "cinnamon_multi_part_model.h5"
CLASS_FILE = "class_names.json"

# ================= DATA AUGMENTATION =================
train_datagen = ImageDataGenerator(
    rescale=1.0 / 255,
    validation_split=0.2,

    rotation_range=30,
    zoom_range=0.25,
    width_shift_range=0.15,
    height_shift_range=0.15,
    shear_range=0.1,

    horizontal_flip=True,

    brightness_range=[0.75, 1.25],

    fill_mode="nearest",
)

# ================= TRAIN DATA =================
train_data = train_datagen.flow_from_directory(
    DATASET_DIR,
    target_size=(IMG_SIZE, IMG_SIZE),
    batch_size=BATCH_SIZE,
    class_mode="categorical",
    subset="training",
    shuffle=True,
)

# ================= VALIDATION DATA =================
val_data = train_datagen.flow_from_directory(
    DATASET_DIR,
    target_size=(IMG_SIZE, IMG_SIZE),
    batch_size=BATCH_SIZE,
    class_mode="categorical",
    subset="validation",
    shuffle=False,
)

# ================= SAVE CLASS NAMES =================
class_names = list(train_data.class_indices.keys())

with open(CLASS_FILE, "w") as f:
    json.dump(class_names, f)

print("✅ Classes Saved:")
print(class_names)

# ================= BASE MODEL =================
base_model = MobileNetV2(
    input_shape=(IMG_SIZE, IMG_SIZE, 3),
    include_top=False,
    weights="imagenet",
)

# Freeze first
base_model.trainable = False

# ================= MODEL =================
model = models.Sequential([
    base_model,

    layers.GlobalAveragePooling2D(),

    layers.BatchNormalization(),

    layers.Dropout(0.35),

    layers.Dense(256, activation="relu"),

    layers.BatchNormalization(),

    layers.Dropout(0.25),

    layers.Dense(
        len(class_names),
        activation="softmax"
    ),
])

# ================= COMPILE =================
model.compile(
    optimizer=Adam(learning_rate=0.0005),

    loss="categorical_crossentropy",

    metrics=[
        "accuracy"
    ],
)

# ================= CALLBACKS =================
callbacks = [

    ModelCheckpoint(
        MODEL_NAME,
        monitor="val_accuracy",
        save_best_only=True,
        verbose=1,
    ),

    EarlyStopping(
        monitor="val_loss",
        patience=6,
        restore_best_weights=True,
        verbose=1,
    ),

    ReduceLROnPlateau(
        monitor="val_loss",
        factor=0.3,
        patience=3,
        verbose=1,
    ),
]

# ================= TRAIN =================
history = model.fit(
    train_data,

    validation_data=val_data,

    epochs=EPOCHS,

    callbacks=callbacks,
)

# ================= FINE TUNING =================
print("🔥 Starting Fine Tuning...")

base_model.trainable = True

for layer in base_model.layers[:-30]:
    layer.trainable = False

model.compile(
    optimizer=Adam(learning_rate=0.0001),

    loss="categorical_crossentropy",

    metrics=["accuracy"],
)

fine_tune_history = model.fit(
    train_data,

    validation_data=val_data,

    epochs=10,

    callbacks=callbacks,
)

# ================= SAVE FINAL MODEL =================
model.save(MODEL_NAME)

print("\n✅ Improved Model Saved:", MODEL_NAME)
print("✅ Class File Saved:", CLASS_FILE)

# ================= ACCURACY GRAPH =================
acc = history.history["accuracy"] + fine_tune_history.history["accuracy"]

val_acc = (
    history.history["val_accuracy"]
    + fine_tune_history.history["val_accuracy"]
)

loss = history.history["loss"] + fine_tune_history.history["loss"]

val_loss = (
    history.history["val_loss"]
    + fine_tune_history.history["val_loss"]
)

plt.figure(figsize=(10, 5))

plt.plot(acc, label="Train Accuracy")
plt.plot(val_acc, label="Validation Accuracy")

plt.title("Model Accuracy")
plt.xlabel("Epoch")
plt.ylabel("Accuracy")

plt.legend()

plt.savefig("training_accuracy.png")

print("✅ Accuracy graph saved")

# ================= FINAL EVALUATION =================
final_loss, final_acc = model.evaluate(val_data)

print("\n🔥 FINAL MODEL RESULTS")
print(f"Validation Accuracy : {final_acc * 100:.2f}%")
print(f"Validation Loss     : {final_loss:.4f}")

# ================= INVALID CLASS CHECK =================
if "invalid_non_cinnamon" in class_names:
    print("✅ Invalid image detection ENABLED")
else:
    print("⚠️ invalid_non_cinnamon class NOT FOUND")

# ================= MODEL SUMMARY =================
print("\n📌 MODEL SUMMARY")
model.summary()