from __future__ import annotations

import argparse
import json
from pathlib import Path

from ml.features import value_features


def main() -> None:
    parser = argparse.ArgumentParser(description="Train XGBoost on completed, verified lot payments.")
    parser.add_argument("--manifest", required=True, type=Path, help="JSONL exported by /api/admin/price-training/export")
    parser.add_argument("--output", required=True, type=Path, help="Path for XGBoost JSON model")
    args = parser.parse_args()
    if not args.manifest.is_file():
        parser.error("The manifest file does not exist.")
    try:
        import numpy as np
        import xgboost as xgb
    except ImportError as error:
        raise SystemExit("Install backend/requirements-ml.txt before training.") from error

    rows = [json.loads(line) for line in args.manifest.read_text(encoding="utf-8").splitlines() if line.strip()]
    if len(rows) < 20:
        raise SystemExit("Training needs at least 20 completed, verified transactions.")
    features = np.asarray([
        value_features(row["material"], row["weight_kg"], row["condition"], row.get("latitude"), row.get("longitude"))
        for row in rows
    ], dtype="float32")
    target = np.asarray([float(row["paid_price"]) for row in rows], dtype="float32")
    model = xgb.XGBRegressor(
        n_estimators=350, max_depth=4, learning_rate=0.035,
        subsample=0.85, colsample_bytree=0.9, objective="reg:squarederror",
        reg_lambda=3.0, random_state=2026,
    )
    model.fit(features, target)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    model.save_model(args.output)
    print(f"Trained on {len(rows)} verified transactions; saved {args.output}")


if __name__ == "__main__":
    main()
