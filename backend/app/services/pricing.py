from __future__ import annotations

from datetime import datetime, timedelta, timezone
from statistics import median
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import PRICE_MODEL_PATH
from ..models import Lot, PriceTrainingRow, Rate, RecyclerProfile, User
from ..schemas import CONDITIONS, MATERIALS, PriceQuoteIn
from ml.features import value_features

CONDITION_FACTOR = {"excellent": 1.0, "good": 0.88, "fair": 0.7, "poor": 0.48}
CONDITION_SCORE = {"poor": 0.0, "fair": 1.0, "good": 2.0, "excellent": 3.0}
STARTER_RATES = {
    "mobile": (420.0, 460.0),
    "laptop": (320.0, 355.0),
    "tv": (48.0, 55.0),
    "battery": (82.0, 92.0),
    "printer": (28.0, 34.0),
    "other": (38.0, 44.0),
}


def seed_rates(db: Session) -> None:
    if db.scalar(select(Rate.id).limit(1)):
        return
    now = datetime.now(timezone.utc)
    for material, (old, current) in STARTER_RATES.items():
        for days_ago, value in ((30, old * 0.94), (14, old), (0, current)):
            db.add(Rate(
                id=str(uuid4()), material=material, rate_per_kg=round(value, 2),
                source="Starter market board (demo)",
                recorded_at=now - timedelta(days=days_ago),
            ))
    db.commit()


def latest_rates(db: Session) -> dict[str, Rate]:
    result: dict[str, Rate] = {}
    for material in MATERIALS:
        rate = db.scalar(select(Rate).where(Rate.material == material).order_by(Rate.recorded_at.desc()).limit(1))
        if rate:
            result[material] = rate
    return result


def rate_board(db: Session) -> list[dict]:
    rates = latest_rates(db)
    board = []
    for material in MATERIALS:
        history = db.scalars(select(Rate).where(Rate.material == material).order_by(Rate.recorded_at.desc()).limit(12)).all()
        history = list(reversed(history))
        current = rates.get(material)
        if current is None:
            continue
        board.append({
            "material": material,
            "rate_per_kg": round(current.rate_per_kg, 2),
            "source": current.source,
            "updated_at": current.recorded_at,
            "history": [{"date": row.recorded_at.isoformat(), "rate_per_kg": round(row.rate_per_kg, 2)} for row in history],
            "change_percent": round(((history[-1].rate_per_kg / history[0].rate_per_kg) - 1) * 100, 1) if len(history) > 1 and history[0].rate_per_kg else 0,
        })
    return board


def _value_model_prediction(db: Session, request: PriceQuoteIn) -> float | None:
    if not PRICE_MODEL_PATH:
        return None
    try:
        import numpy as np
        import xgboost as xgb

        model = xgb.XGBRegressor()
        model.load_model(PRICE_MODEL_PATH)
        row = value_features(request.material, request.weight_kg, request.condition, request.latitude, request.longitude)
        result = float(model.predict(np.asarray([row], dtype="float32"))[0])
        if result <= 0:
            return None
        return result
    except (ImportError, OSError, ValueError, KeyError, RuntimeError):
        return None


def estimate_price(db: Session, request: PriceQuoteIn) -> dict:
    current = latest_rates(db).get(request.material)
    if current is None:
        raise ValueError("No published rate is available for this material yet.")
    history = db.scalars(select(Rate.rate_per_kg).where(Rate.material == request.material).order_by(Rate.recorded_at.desc()).limit(12)).all()
    prices = list(history)
    variation = 0.08
    if len(prices) > 1:
        center = median(prices)
        if center > 0:
            variation = min(0.18, max(0.05, (max(prices) - min(prices)) / center / 2))
    per_kg = current.rate_per_kg * CONDITION_FACTOR[request.condition]
    expected = per_kg * request.weight_kg
    model_value = _value_model_prediction(db, request)
    if model_value is not None:
        expected = min(max(model_value, expected * 0.5), expected * 1.5)
        per_kg = expected / request.weight_kg
    low = max(0.0, expected * (1 - variation))
    high = expected * (1 + variation)
    return {
        "material": request.material,
        "weight_kg": request.weight_kg,
        "condition": request.condition,
        "market_rate_per_kg": round(current.rate_per_kg, 2),
        "condition_factor": CONDITION_FACTOR[request.condition],
        "estimated_rate_per_kg": round(per_kg, 2),
        "estimated_low": round(low, 2),
        "estimated_expected": round(expected, 2),
        "estimated_high": round(high, 2),
        "variation_percent": round(variation * 100, 1),
        "source": "XGBoost trained on verified transactions + current market board" if model_value is not None else current.source,
        "model_used": model_value is not None,
        "updated_at": current.recorded_at,
    }


def add_rate(db: Session, material: str, rate_per_kg: float, source: str, actor: User) -> Rate:
    rate = Rate(id=str(uuid4()), material=material, rate_per_kg=rate_per_kg, source=source, created_by=actor.id)
    db.add(rate)
    db.commit()
    db.refresh(rate)
    return rate


def recycler_rate(profile: RecyclerProfile, material: str, board_rate: float) -> float:
    return round(float(profile.offers.get(material, board_rate)), 2)


def export_price_training(db: Session) -> list[dict]:
    rows = db.scalars(select(PriceTrainingRow).order_by(PriceTrainingRow.created_at)).all()
    return [{
        "material": row.material,
        "weight_kg": row.weight_kg,
        "condition": row.condition,
        "latitude": row.latitude,
        "longitude": row.longitude,
        "paid_price": row.paid_price,
    } for row in rows]
