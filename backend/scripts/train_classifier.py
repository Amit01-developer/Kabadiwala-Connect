from __future__ import annotations

import argparse
import json
import shutil
import tempfile
from collections import Counter
from pathlib import Path
from uuid import uuid4

MATERIALS = {"mobile", "laptop", "tv", "battery", "printer", "other"}


def main() -> None:
    parser = argparse.ArgumentParser(description="Fine-tune EfficientNetB0 using admin-validated material photos.")
    parser.add_argument("--manifest", required=True, type=Path, help="JSONL exported by /api/admin/feedback/export")
    parser.add_argument("--output", required=True, type=Path, help="Directory for model.keras and labels.json")
    parser.add_argument("--epochs", type=int, default=12)
    parser.add_argument("--weights", choices=("imagenet", "none"), default="imagenet")
    args = parser.parse_args()
    if not args.manifest.is_file():
        parser.error("The manifest file does not exist.")
    try:
        import tensorflow as tf
    except ImportError as error:
        raise SystemExit("Install backend/requirements-ml.txt before training.") from error

    records = []
    for line in args.manifest.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        label = row.get("label")
        image_path = Path(row.get("image_path", ""))
        if row.get("validation_state") == "validated" and label in MATERIALS and image_path.is_file():
            records.append((label, image_path))
    counts = Counter(label for label, _ in records)
    labels = sorted(counts)
    if len(labels) < 2 or any(counts[label] < 5 for label in labels):
        raise SystemExit("Training needs at least five admin-validated photos in each of two or more material categories.")

    with tempfile.TemporaryDirectory(prefix="kabadiwala-ml-") as temp_name:
        data_dir = Path(temp_name)
        for label, image_path in records:
            label_dir = data_dir / label
            label_dir.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(image_path, label_dir / f"{uuid4().hex}{image_path.suffix.lower()}")
        train_ds = tf.keras.utils.image_dataset_from_directory(
            data_dir, validation_split=0.2, subset="training", seed=2026,
            image_size=(224, 224), batch_size=16, label_mode="categorical",
        )
        valid_ds = tf.keras.utils.image_dataset_from_directory(
            data_dir, validation_split=0.2, subset="validation", seed=2026,
            image_size=(224, 224), batch_size=16, label_mode="categorical",
        )
        labels = list(train_ds.class_names)
        base = tf.keras.applications.EfficientNetB0(
            include_top=False, weights=args.weights, input_shape=(224, 224, 3), pooling="avg",
        )
        base.trainable = False
        inputs = tf.keras.Input(shape=(224, 224, 3))
        features = base(inputs, training=False)
        features = tf.keras.layers.Dropout(0.25)(features)
        outputs = tf.keras.layers.Dense(len(labels), activation="softmax")(features)
        model = tf.keras.Model(inputs, outputs)
        model.compile(optimizer=tf.keras.optimizers.Adam(1e-3), loss="categorical_crossentropy", metrics=["accuracy"])
        model.fit(train_ds, validation_data=valid_ds, epochs=args.epochs)
        args.output.mkdir(parents=True, exist_ok=True)
        model.save(args.output / "model.keras")
        (args.output / "labels.json").write_text(json.dumps(labels, indent=2), encoding="utf-8")
        print(f"Saved {args.output / 'model.keras'} with labels {labels}")


if __name__ == "__main__":
    main()
