from __future__ import annotations

import base64
import io
import json
from functools import lru_cache
from pathlib import Path

from ..config import CLASSIFIER_MODEL_PATH
from ..schemas import MATERIALS


class ClassifierUnavailable(RuntimeError):
    pass


def decode_image_data_url(data_url: str) -> tuple[bytes, str]:
    try:
        header, encoded = data_url.split(",", 1)
        mime = header.removeprefix("data:").split(";", 1)[0].lower()
        if mime not in {"image/jpeg", "image/png", "image/webp"}:
            raise ValueError("Choose a JPG, PNG, or WebP image.")
        raw = base64.b64decode(encoded, validate=True)
    except (ValueError, TypeError) as error:
        raise ValueError("The selected image could not be read.") from error
    if not raw or len(raw) > 2_000_000:
        raise ValueError("Images must be smaller than 2 MB.")
    signatures = {
        "image/jpeg": raw.startswith(b"\xff\xd8\xff"),
        "image/png": raw.startswith(b"\x89PNG\r\n\x1a\n"),
        "image/webp": len(raw) > 12 and raw[:4] == b"RIFF" and raw[8:12] == b"WEBP",
    }
    if not signatures[mime]:
        raise ValueError("The image content does not match its file type.")
    return raw, mime


@lru_cache(maxsize=2)
def _load_model(model_path: str, labels_path: str):
    try:
        import tensorflow as tf
    except ImportError as error:
        raise ClassifierUnavailable("Install backend/requirements-ml.txt to enable image classification.") from error
    path = Path(model_path)
    label_file = Path(labels_path)
    if not path.is_file() or not label_file.is_file():
        raise ClassifierUnavailable("A trained classifier model and labels.json are not configured.")
    try:
        labels = json.loads(label_file.read_text(encoding="utf-8"))
        model = tf.keras.models.load_model(path, compile=False)
    except Exception as error:
        raise ClassifierUnavailable("The configured classifier could not be loaded.") from error
    if not isinstance(labels, list) or len(labels) < 2 or any(label not in MATERIALS for label in labels):
        raise ClassifierUnavailable("Classifier labels must contain supported material names.")
    return model, labels


def classify_image(data_url: str) -> dict:
    raw, _mime = decode_image_data_url(data_url)
    if not CLASSIFIER_MODEL_PATH:
        raise ClassifierUnavailable("Image classification is not configured. Add a trained model to enable it.")
    labels_path = str(Path(CLASSIFIER_MODEL_PATH).with_name("labels.json"))
    model, labels = _load_model(CLASSIFIER_MODEL_PATH, labels_path)
    try:
        import cv2
        import numpy as np

        image = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)
        if image is None:
            raise ValueError("Image decode failed")
        image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        image = cv2.resize(image, (224, 224), interpolation=cv2.INTER_AREA)
        predictions = model.predict(np.expand_dims(image, 0), verbose=0)[0]
    except ImportError as error:
        raise ClassifierUnavailable("Install backend/requirements-ml.txt to enable image classification.") from error
    except Exception as error:
        raise ClassifierUnavailable("The classifier could not process this image.") from error
    ranked = sorted(zip(labels, predictions.tolist()), key=lambda item: item[1], reverse=True)
    label, confidence = ranked[0]
    return {
        "material": label if confidence >= 0.4 else None,
        "confidence": round(float(confidence), 4),
        "alternatives": [{"material": key, "confidence": round(float(value), 4)} for key, value in ranked[:3]],
        "model": "EfficientNetB0 fine-tuned on validated field images",
        "needs_confirmation": confidence < 0.65,
    }
