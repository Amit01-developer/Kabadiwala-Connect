from __future__ import annotations

import math
import statistics
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..config import POSTGIS_ENABLED
from ..models import Lot, LotEvent, Payment, PriceTrainingRow, Rate, RecyclerProfile, TrainingFeedback, User
from ..schemas import CreateLotIn, HandoverIn, PaymentIn, PriceQuoteIn, CONDITIONS
from ..object_storage import save_data_url
from .pricing import CONDITION_FACTOR, estimate_price, latest_rates, recycler_rate


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    radius = 6371.0088
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lon2 - lon1)
    a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    return 2 * radius * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def serialize_user(user: User) -> dict:
    return {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "phone": user.phone,
        "role": user.role,
        "preferred_language": user.preferred_language,
        "created_at": user.created_at,
    }


def serialize_recycler(user: User, profile: RecyclerProfile, current_rate: float, material: str, origin: tuple[float, float] | None = None) -> dict:
    distance = None
    if origin and profile.latitude is not None and profile.longitude is not None:
        distance = round(haversine_km(origin[0], origin[1], profile.latitude, profile.longitude), 1)
    rate = recycler_rate(profile, material, current_rate)
    return {
        "id": user.id,
        "name": user.name,
        "organization": profile.organization,
        "license_number": profile.license_number,
        "verified": profile.verified,
        "address": profile.address,
        "latitude": profile.latitude,
        "longitude": profile.longitude,
        "materials": profile.materials,
        "offer_per_kg": rate,
        "pickup_available": profile.pickup_available,
        "dropoff_available": profile.dropoff_available,
        "distance_km": distance,
        "maps_url": f"https://www.openstreetmap.org/?mlat={profile.latitude}&mlon={profile.longitude}#map=14/{profile.latitude}/{profile.longitude}" if profile.latitude is not None and profile.longitude is not None else None,
    }


def serialize_lot(db: Session, lot: Lot) -> dict:
    collector = db.get(User, lot.collector_id)
    recycler = db.get(User, lot.recycler_id) if lot.recycler_id else None
    payment = db.scalar(select(Payment).where(Payment.lot_id == lot.id))
    return {
        "id": lot.id,
        "lot_code": lot.lot_code,
        "collector_id": lot.collector_id,
        "collector_name": collector.name if collector else "",
        "recycler_id": lot.recycler_id,
        "recycler_name": recycler.recycler_profile.organization if recycler and recycler.recycler_profile else (recycler.name if recycler else None),
        "material": lot.material,
        "weight_kg": lot.weight_kg,
        "condition": lot.condition,
        "description": lot.description,
        "has_photo": bool(lot.image_path),
        "photo_url": f"/api/lots/{lot.id}/photo" if lot.image_path else None,
        "predicted_material": lot.predicted_material,
        "prediction_confidence": lot.prediction_confidence,
        "latitude": lot.latitude,
        "longitude": lot.longitude,
        "collection_mode": lot.collection_mode,
        "scheduled_at": lot.scheduled_at,
        "estimated_low": round(lot.estimated_low, 2),
        "estimated_high": round(lot.estimated_high, 2),
        "quoted_price": round(lot.quoted_price, 2) if lot.quoted_price is not None else None,
        "final_price": round(lot.final_price, 2) if lot.final_price is not None else None,
        "payment": {
            "amount": payment.amount,
            "status": payment.status,
            "method": payment.method,
            "reference": payment.reference,
            "updated_at": payment.updated_at,
        } if payment else None,
        "status": lot.status,
        "anomaly_flag": lot.anomaly_flag,
        "created_at": lot.created_at,
        "updated_at": lot.updated_at,
        "events": [{
            "id": event.id,
            "kind": event.kind,
            "note": event.note,
            "details": event.details,
            "created_at": event.created_at,
        } for event in lot.events],
    }


def _save_image(data_url: str | None) -> str | None:
    return save_data_url(data_url)


def list_recyclers(
    db: Session,
    material: str,
    latitude: float | None,
    longitude: float | None,
    collection_mode: str | None = None,
) -> list[dict]:
    current = latest_rates(db).get(material)
    if current is None:
        return []
    profiles = db.scalars(select(RecyclerProfile).where(RecyclerProfile.verified.is_(True))).all()
    origin = (latitude, longitude) if latitude is not None and longitude is not None else None
    postgis_distances: dict[str, float] = {}
    if origin and POSTGIS_ENABLED and db.bind and db.bind.dialect.name == "postgresql":
        from sqlalchemy import func
        origin_point = func.ST_SetSRID(func.ST_MakePoint(origin[1], origin[0]), 4326)
        recycler_point = func.ST_SetSRID(func.ST_MakePoint(RecyclerProfile.longitude, RecyclerProfile.latitude), 4326)
        rows = db.execute(select(RecyclerProfile.user_id, func.ST_DistanceSphere(origin_point, recycler_point)).where(
            RecyclerProfile.verified.is_(True), RecyclerProfile.latitude.is_not(None), RecyclerProfile.longitude.is_not(None),
        )).all()
        postgis_distances = {user_id: round(float(distance) / 1000, 1) for user_id, distance in rows if distance is not None}
    results = []
    for profile in profiles:
        if material not in (profile.materials or []):
            continue
        if collection_mode == "pickup" and not profile.pickup_available:
            continue
        if collection_mode == "dropoff" and not profile.dropoff_available:
            continue
        user = db.get(User, profile.user_id)
        if user:
            item = serialize_recycler(user, profile, current.rate_per_kg, material, origin)
            if profile.user_id in postgis_distances:
                item["distance_km"] = postgis_distances[profile.user_id]
            results.append(item)
    return sorted(results, key=lambda item: (item["distance_km"] if item["distance_km"] is not None else float("inf"), -item["offer_per_kg"]))


def _event(lot: Lot, actor: User | None, kind: str, note: str = "", details: dict | None = None, key: str | None = None) -> None:
    lot.events.append(LotEvent(
        id=str(uuid4()), actor_id=actor.id if actor else None, kind=kind,
        note=note, details=details or {}, idempotency_key=key,
    ))


def create_lot(db: Session, actor: User, payload: CreateLotIn) -> Lot:
    previous = db.scalar(select(Lot).where(Lot.client_ref == payload.client_ref))
    if previous:
        if previous.collector_id != actor.id:
            raise HTTPException(status_code=409, detail="This request reference is already in use.")
        return previous
    profile = db.get(RecyclerProfile, payload.recycler_id)
    if profile is None or not profile.verified:
        raise HTTPException(status_code=422, detail="Choose a verified recycler.")
    if payload.material not in profile.materials:
        raise HTTPException(status_code=422, detail="This recycler does not accept the selected material.")
    if payload.collection_mode == "pickup" and not profile.pickup_available:
        raise HTTPException(status_code=422, detail="This recycler does not offer pickup.")
    if payload.collection_mode == "dropoff" and not profile.dropoff_available:
        raise HTTPException(status_code=422, detail="This recycler does not accept drop-offs.")
    if payload.scheduled_at and payload.scheduled_at <= datetime.now(timezone.utc):
        raise HTTPException(status_code=422, detail="Choose a future collection time.")
    quote = estimate_price(db, PriceQuoteIn(
        material=payload.material, weight_kg=payload.weight_kg, condition=payload.condition,
        latitude=payload.latitude, longitude=payload.longitude,
    ))
    lot_id = str(uuid4())
    image_path = _save_image(payload.image_data_url)
    offer_per_kg = recycler_rate(profile, payload.material, quote["market_rate_per_kg"])
    quoted_price = round(offer_per_kg * payload.weight_kg * CONDITION_FACTOR[payload.condition], 2)
    lot_code = f"EW-{datetime.now(timezone.utc):%y}-{uuid4().hex[:8].upper()}"
    lot = Lot(
        id=lot_id, lot_code=lot_code, client_ref=payload.client_ref,
        collector_id=actor.id, recycler_id=payload.recycler_id, material=payload.material,
        weight_kg=payload.weight_kg, condition=payload.condition,
        description=payload.description, image_path=image_path,
        predicted_material=payload.predicted_material,
        prediction_confidence=payload.prediction_confidence,
        latitude=payload.latitude, longitude=payload.longitude,
        collection_mode=payload.collection_mode, scheduled_at=payload.scheduled_at,
        estimated_low=quote["estimated_low"], estimated_high=quote["estimated_high"],
        quoted_price=quoted_price, status="requested",
    )
    _event(lot, actor, "request_created", "Collection request recorded.", {
        "quoted_price": quoted_price, "offer_per_kg": offer_per_kg,
        "market_estimate_low": quote["estimated_low"], "market_estimate_high": quote["estimated_high"],
    })
    if image_path:
        db.add(TrainingFeedback(
            id=str(uuid4()), lot_id=lot_id, image_path=image_path,
            true_label=payload.material, validation_state="pending",
        ))
    db.add(lot)
    db.commit()
    db.refresh(lot)
    return lot


def assert_lot_access(lot: Lot, actor: User) -> None:
    if actor.role == "admin":
        return
    if actor.id == lot.collector_id or actor.id == lot.recycler_id:
        return
    raise HTTPException(status_code=404, detail="Lot not found.")


def handover(db: Session, lot: Lot, actor: User, payload: HandoverIn) -> Lot:
    if lot.recycler_id != actor.id:
        raise HTTPException(status_code=403, detail="Only the assigned recycler can verify this handover.")
    existing = db.scalar(select(LotEvent).where(LotEvent.idempotency_key == payload.idempotency_key))
    if existing:
        if existing.lot_id != lot.id:
            raise HTTPException(status_code=409, detail="This verification request was already used.")
        return db.scalar(select(Lot).options(selectinload(Lot.events)).where(Lot.id == lot.id)) or lot
    if payload.lot_code.upper() != lot.lot_code.upper():
        raise HTTPException(status_code=422, detail="The scanned lot ID does not match this request.")
    if lot.status not in {"accepted", "scheduled"}:
        raise HTTPException(status_code=409, detail="Accept the request before recording a handover.")
    lot.status = "handed_over"
    lot.updated_at = datetime.now(timezone.utc)
    confirmed_material = payload.confirmed_material or lot.material
    feedback = db.scalar(select(TrainingFeedback).where(TrainingFeedback.lot_id == lot.id))
    if feedback:
        feedback.true_label = confirmed_material
    _event(lot, actor, "handover_verified", payload.note or "Recycler verified the lot ID and handover.", {
        "lot_code": lot.lot_code, "confirmed_material": confirmed_material,
    }, payload.idempotency_key)
    db.commit()
    db.refresh(lot)
    return lot


def flag_price_anomaly(db: Session, lot: Lot, paid_price: float) -> dict:
    rows = db.execute(select(PriceTrainingRow.paid_price, PriceTrainingRow.weight_kg).join(Lot, Lot.id == PriceTrainingRow.lot_id).where(Lot.material == lot.material).order_by(PriceTrainingRow.created_at.desc()).limit(200)).all()
    unit_prices = [price / weight for price, weight in rows if weight > 0]
    if len(unit_prices) < 5:
        return {"evaluated": False, "reason": "Fewer than five verified transactions are available for comparison."}
    center = statistics.median(unit_prices)
    mad = statistics.median([abs(value - center) for value in unit_prices])
    actual = paid_price / lot.weight_kg
    limit = max(center * 0.25, mad * 3)
    deviation = abs(actual - center)
    return {
        "evaluated": True,
        "flagged": deviation > limit,
        "median_rate_per_kg": round(center, 2),
        "actual_rate_per_kg": round(actual, 2),
        "deviation_percent": round(deviation / center * 100, 1) if center else 0,
    }


def record_payment(db: Session, lot: Lot, actor: User, payload: PaymentIn) -> tuple[Lot, dict]:
    previous = db.scalar(select(Payment).where(Payment.idempotency_key == payload.idempotency_key))
    if previous:
        if previous.lot_id != lot.id:
            raise HTTPException(status_code=409, detail="This payment request was already used.")
        return lot, {"evaluated": lot.anomaly_flag, "flagged": lot.anomaly_flag, "duplicate": True}
    if actor.role != "admin" and actor.id != lot.recycler_id:
        raise HTTPException(status_code=403, detail="Only the assigned recycler can record payment.")
    if lot.status != "handed_over":
        raise HTTPException(status_code=409, detail="Verify the handover before recording payment.")
    if db.scalar(select(Payment.id).where(Payment.lot_id == lot.id)):
        raise HTTPException(status_code=409, detail="This lot already has a payment record.")
    anomaly = flag_price_anomaly(db, lot, payload.amount)
    lot.final_price = payload.amount
    lot.anomaly_flag = bool(anomaly.get("flagged"))
    lot.status = "paid"
    lot.updated_at = datetime.now(timezone.utc)
    db.add(Payment(
        id=str(uuid4()), lot_id=lot.id, amount=payload.amount, status="paid",
        method=payload.method, reference=payload.reference,
        idempotency_key=payload.idempotency_key, updated_by=actor.id,
    ))
    db.add(PriceTrainingRow(
        id=str(uuid4()), lot_id=lot.id, material=lot.material, weight_kg=lot.weight_kg,
        condition=lot.condition, latitude=lot.latitude, longitude=lot.longitude, paid_price=payload.amount,
    ))
    _event(lot, actor, "payment_recorded", "Payment recorded in the earnings ledger.", {
        "amount": payload.amount, "method": payload.method, "reference": payload.reference,
        "anomaly": anomaly,
    }, payload.idempotency_key)
    db.commit()
    db.refresh(lot)
    return lot, anomaly
