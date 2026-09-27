from __future__ import annotations

import json
import logging
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, PlainTextResponse, StreamingResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session, selectinload
from starlette.background import BackgroundTask

from .cache_layer import cached_json, invalidate_cache
from .config import APP_ENV, CORS_ORIGINS, POSTGIS_ENABLED, S3_BUCKET, UPLOAD_DIR
from .database import Base, SessionLocal, engine, get_db
from .models import AuthSession, Lot, LotEvent, Payment, PriceTrainingRow, Rate, RecyclerProfile, TrainingFeedback, User
from .object_storage import s3_object
from .schemas import (
    CONDITIONS, MATERIALS, ClassifyIn, CreateLotIn, CreateRecyclerIn, HandoverIn,
    LoginIn, PasswordChangeIn, PaymentIn, PreferenceIn, PriceQuoteIn, RateUpsertIn,
    RecyclerProfileIn, RegisterIn, ReviewFeedbackIn, ScheduleIn, VerifyRecyclerIn,
)
from .security import create_session, get_user_for_token, hash_password, verify_password
from .seed import seed_demo_data
from .services.classification import ClassifierUnavailable, classify_image
from .services.lots import (
    assert_lot_access, create_lot, handover, list_recyclers, record_payment,
    serialize_lot, serialize_recycler, serialize_user,
)
from .services.pricing import add_rate, estimate_price, export_price_training, latest_rates, rate_board, recycler_rate

logging.basicConfig(level=logging.INFO if APP_ENV != "production" else logging.WARNING)
logger = logging.getLogger("kabadwala")
bearer = HTTPBearer(auto_error=False)
login_attempts: dict[str, deque[float]] = defaultdict(deque)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    if POSTGIS_ENABLED and engine.dialect.name == "postgresql":
        with engine.begin() as connection:
            connection.execute(text("CREATE EXTENSION IF NOT EXISTS postgis"))
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        seed_demo_data(db)
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    yield


app = FastAPI(
    title="Kabadiwala Connect API",
    version="1.0.0",
    description="Collector-to-authorized-recycler e-waste workflow API.",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(self), microphone=(self), geolocation=(self)"
    if request.url.scheme == "https":
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response


@app.exception_handler(SQLAlchemyError)
async def database_error_handler(_request: Request, error: SQLAlchemyError):
    logger.exception("Database operation failed", exc_info=error)
    return Response(content='{"detail":"The request could not be saved. Please try again."}', status_code=503, media_type="application/json")


def current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> User:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=401, detail="Sign in to continue.")
    return get_user_for_token(db, credentials.credentials)


def require_role(*roles: str):
    def dependency(user: User = Depends(current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(status_code=403, detail="Your account cannot perform this action.")
        return user
    return dependency


def _new_user(payload: RegisterIn) -> User:
    user = User(
        id=str(uuid4()), name=payload.name, email=payload.email, phone=payload.phone,
        password_hash=hash_password(payload.password), role=payload.account_type,
        preferred_language=payload.preferred_language,
    )
    return user


def _get_lot(db: Session, lot_id: str) -> Lot:
    lot = db.scalar(select(Lot).options(selectinload(Lot.events)).where(Lot.id == lot_id))
    if lot is None:
        raise HTTPException(status_code=404, detail="Lot not found.")
    return lot


def _safe_datetime(value: datetime | None) -> datetime | None:
    if value is not None and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


@app.get("/api/health")
def health(db: Session = Depends(get_db)):
    db.execute(select(1))
    return {"status": "ok", "database": "ok", "environment": APP_ENV}


@app.post("/api/auth/register", status_code=201)
def register(payload: RegisterIn, db: Session = Depends(get_db)):
    user = _new_user(payload)
    db.add(user)
    if payload.account_type == "recycler":
        db.add(RecyclerProfile(
            user_id=user.id, organization=payload.organization or "",
            license_number=payload.license_number or "", verified=False,
            materials=list(MATERIALS), offers={}, address="", pickup_available=True,
            dropoff_available=True,
        ))
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(status_code=409, detail="An account with this email or authorization number already exists.") from error
    token, expires_at = create_session(db, user)
    return {"access_token": token, "token_type": "bearer", "expires_at": expires_at, "user": serialize_user(user)}


@app.post("/api/auth/login")
def login(payload: LoginIn, request: Request, db: Session = Depends(get_db)):
    client_key = f"{request.client.host if request.client else 'unknown'}:{payload.email}"
    now = time.monotonic()
    attempts = login_attempts[client_key]
    while attempts and attempts[0] < now - 900:
        attempts.popleft()
    if len(attempts) >= 10:
        raise HTTPException(status_code=429, detail="Too many sign-in attempts. Please wait 15 minutes and try again.")
    attempts.append(now)
    user = db.scalar(select(User).where(User.email == payload.email))
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Email or password is incorrect.")
    login_attempts.pop(client_key, None)
    token, expires_at = create_session(db, user)
    return {"access_token": token, "token_type": "bearer", "expires_at": expires_at, "user": serialize_user(user)}


@app.get("/api/auth/me")
def me(user: User = Depends(current_user)):
    return serialize_user(user)


@app.patch("/api/auth/preferences")
def update_preferences(payload: PreferenceIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    user.preferred_language = payload.preferred_language
    db.commit()
    return serialize_user(user)


@app.post("/api/auth/change-password", status_code=204)
def change_password(payload: PasswordChangeIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect.")
    user.password_hash = hash_password(payload.new_password)
    db.query(AuthSession).filter(AuthSession.user_id == user.id, AuthSession.revoked_at.is_(None)).update({"revoked_at": datetime.now(timezone.utc)})
    db.commit()
    return Response(status_code=204)


@app.post("/api/auth/logout", status_code=204)
def logout(credentials: HTTPAuthorizationCredentials | None = Depends(bearer), db: Session = Depends(get_db)):
    if credentials and credentials.scheme.lower() == "bearer":
        import hashlib
        token_hash = hashlib.sha256(credentials.credentials.encode()).hexdigest()
        session_row = db.scalar(select(AuthSession).where(AuthSession.token_hash == token_hash))
        if session_row and session_row.revoked_at is None:
            session_row.revoked_at = datetime.now(timezone.utc)
            db.commit()
    return Response(status_code=204)


@app.get("/api/dashboard")
def dashboard(db: Session = Depends(get_db), user: User = Depends(current_user)):
    conditions = []
    if user.role == "collector":
        conditions.append(Lot.collector_id == user.id)
    elif user.role == "recycler":
        conditions.append(Lot.recycler_id == user.id)
    lots = list(db.scalars(select(Lot).options(selectinload(Lot.events)).where(*conditions).order_by(Lot.created_at.desc()).limit(6)).all())
    total_lots = db.scalar(select(func.count()).select_from(Lot).where(*conditions)) or 0
    active_lots = db.scalar(select(func.count()).select_from(Lot).where(*conditions, Lot.status.in_({"requested", "accepted", "scheduled", "handed_over"}))) or 0
    paid_lots = db.scalar(select(func.count()).select_from(Lot).where(*conditions, Lot.status == "paid")) or 0
    weight_total = db.scalar(select(func.coalesce(func.sum(Lot.weight_kg), 0)).where(*conditions, Lot.status.in_({"handed_over", "paid"}))) or 0
    paid_total = db.scalar(select(func.coalesce(func.sum(Lot.final_price), 0)).where(*conditions, Lot.status == "paid")) or 0
    anomaly_total = db.scalar(select(func.count()).select_from(Lot).where(*conditions, Lot.anomaly_flag.is_(True))) or 0
    handover_total = db.scalar(select(func.count()).select_from(Lot).where(*conditions, Lot.status.in_({"handed_over", "paid"}))) or 0
    totals = {
        "lots": total_lots,
        "active": active_lots,
        "paid": paid_lots,
        "weight_kg": round(float(weight_total), 1),
        "earnings": round(float(paid_total), 2),
        "anomalies": anomaly_total,
        "formal_handovers": handover_total,
    }
    profile = user.recycler_profile
    return {
        "totals": totals,
        "recent_lots": [serialize_lot(db, lot) for lot in lots],
        "recycler_profile": {
            "verified": profile.verified,
            "organization": profile.organization,
        } if profile else None,
        "online_seed_rates": len(rate_board(db)),
    }


@app.get("/api/prices")
def get_prices(db: Session = Depends(get_db)):
    return cached_json("prices:v1", 30, lambda: {
        "rates": rate_board(db), "currency": "INR",
        "notice": "Starter board values are demo data until an administrator publishes local rates.",
    })


@app.post("/api/prices/quote")
def quote_price(payload: PriceQuoteIn, db: Session = Depends(get_db), _user: User = Depends(current_user)):
    try:
        return estimate_price(db, payload)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@app.get("/api/recyclers")
def get_recyclers(
    material: str = Query(..., pattern="^(mobile|laptop|tv|battery|printer|other)$"),
    latitude: float | None = Query(default=None, ge=-90, le=90),
    longitude: float | None = Query(default=None, ge=-180, le=180),
    collection_mode: str | None = Query(default=None, pattern="^(pickup|dropoff)$"),
    db: Session = Depends(get_db),
    _user: User = Depends(current_user),
):
    latitude_key = f"{latitude:.3f}" if latitude is not None else "na"
    longitude_key = f"{longitude:.3f}" if longitude is not None else "na"
    key = f"recyclers:v1:{material}:{latitude_key}:{longitude_key}:{collection_mode or 'any'}"
    return cached_json(key, 30, lambda: {"recyclers": list_recyclers(db, material, latitude, longitude, collection_mode)})


@app.get("/api/recycler/profile")
def get_recycler_profile(db: Session = Depends(get_db), user: User = Depends(require_role("recycler"))):
    profile = db.get(RecyclerProfile, user.id)
    if profile is None:
        raise HTTPException(status_code=404, detail="Recycler profile not found.")
    return {"user": serialize_user(user), "profile": {
        "organization": profile.organization, "license_number": profile.license_number,
        "verified": profile.verified, "latitude": profile.latitude, "longitude": profile.longitude,
        "address": profile.address, "materials": profile.materials, "offers": profile.offers,
        "pickup_available": profile.pickup_available, "dropoff_available": profile.dropoff_available,
    }}


@app.put("/api/recycler/profile")
def update_recycler_profile(payload: RecyclerProfileIn, db: Session = Depends(get_db), user: User = Depends(require_role("recycler"))):
    profile = db.get(RecyclerProfile, user.id)
    if profile is None:
        raise HTTPException(status_code=404, detail="Recycler profile not found.")
    if profile.license_number != payload.license_number or profile.organization != payload.organization:
        collision = db.scalar(select(RecyclerProfile.user_id).where(RecyclerProfile.license_number == payload.license_number, RecyclerProfile.user_id != user.id))
        if collision:
            raise HTTPException(status_code=409, detail="This authorization number is already registered.")
        profile.verified = False
    profile.organization = payload.organization
    profile.license_number = payload.license_number
    profile.address = payload.address
    profile.latitude = payload.latitude
    profile.longitude = payload.longitude
    profile.materials = list(dict.fromkeys(payload.materials))
    profile.offers = payload.offers
    profile.pickup_available = payload.pickup_available
    profile.dropoff_available = payload.dropoff_available
    db.commit()
    db.refresh(profile)
    invalidate_cache("recyclers:")
    return {"verified": profile.verified, "profile": {
        "organization": profile.organization, "license_number": profile.license_number,
        "latitude": profile.latitude, "longitude": profile.longitude, "address": profile.address,
        "materials": profile.materials, "offers": profile.offers,
        "pickup_available": profile.pickup_available, "dropoff_available": profile.dropoff_available,
    }}


@app.post("/api/ai/classify")
def classify(payload: ClassifyIn, _user: User = Depends(require_role("collector"))):
    try:
        return classify_image(payload.image_data_url)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except ClassifierUnavailable as error:
        raise HTTPException(status_code=503, detail=str(error)) from error


@app.post("/api/lots", status_code=201)
def post_lot(payload: CreateLotIn, db: Session = Depends(get_db), user: User = Depends(require_role("collector"))):
    lot = create_lot(db, user, payload)
    return serialize_lot(db, lot)


@app.get("/api/lots")
def get_lots(
    status_filter: str | None = Query(default=None, alias="status", max_length=24),
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    query = select(Lot).options(selectinload(Lot.events))
    if user.role == "collector":
        query = query.where(Lot.collector_id == user.id)
    elif user.role == "recycler":
        query = query.where(Lot.recycler_id == user.id)
    if status_filter:
        query = query.where(Lot.status == status_filter)
    lots = db.scalars(query.order_by(Lot.created_at.desc()).limit(250)).all()
    return {"lots": [serialize_lot(db, lot) for lot in lots]}


@app.get("/api/lots/{lot_id}")
def get_lot(lot_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    lot = _get_lot(db, lot_id)
    assert_lot_access(lot, user)
    return serialize_lot(db, lot)


@app.get("/api/lots/{lot_id}/photo")
def get_lot_photo(lot_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    lot = _get_lot(db, lot_id)
    assert_lot_access(lot, user)
    if not lot.image_path:
        raise HTTPException(status_code=404, detail="This lot has no photo.")
    if lot.image_path.startswith("s3://"):
        if not S3_BUCKET:
            raise HTTPException(status_code=404, detail="Photo not found.")
        item = s3_object(lot.image_path)
        body = item["Body"]
        return StreamingResponse(
            body.iter_chunks(chunk_size=64 * 1024),
            media_type=item.get("ContentType", "application/octet-stream"),
            headers={"Cache-Control": "private, max-age=300"},
            background=BackgroundTask(body.close),
        )
    path = Path(lot.image_path).resolve()
    if UPLOAD_DIR not in path.parents or not path.is_file():
        raise HTTPException(status_code=404, detail="Photo not found.")
    media_type = {".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}.get(path.suffix.lower(), "application/octet-stream")
    return FileResponse(path, media_type=media_type, headers={"Cache-Control": "private, max-age=300"})


@app.post("/api/lots/{lot_id}/accept")
def accept_lot(lot_id: str, db: Session = Depends(get_db), user: User = Depends(require_role("recycler"))):
    lot = _get_lot(db, lot_id)
    if lot.recycler_id != user.id:
        raise HTTPException(status_code=403, detail="This collection request belongs to another recycler.")
    if lot.status != "requested":
        raise HTTPException(status_code=409, detail="This request can no longer be accepted.")
    lot.status = "accepted"
    lot.updated_at = datetime.now(timezone.utc)
    lot.events.append(LotEvent(id=str(uuid4()), actor_id=user.id, kind="request_accepted", note="Recycler accepted the collection request."))
    db.commit()
    return serialize_lot(db, _get_lot(db, lot.id))


@app.post("/api/lots/{lot_id}/reject")
def reject_lot(lot_id: str, db: Session = Depends(get_db), user: User = Depends(require_role("recycler"))):
    lot = _get_lot(db, lot_id)
    if lot.recycler_id != user.id:
        raise HTTPException(status_code=403, detail="This collection request belongs to another recycler.")
    if lot.status != "requested":
        raise HTTPException(status_code=409, detail="This request can no longer be declined.")
    lot.status = "declined"
    lot.updated_at = datetime.now(timezone.utc)
    lot.events.append(LotEvent(id=str(uuid4()), actor_id=user.id, kind="request_declined", note="Recycler declined the collection request."))
    db.commit()
    return serialize_lot(db, _get_lot(db, lot.id))


@app.post("/api/lots/{lot_id}/schedule")
def schedule_lot(lot_id: str, payload: ScheduleIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    lot = _get_lot(db, lot_id)
    assert_lot_access(lot, user)
    if user.role == "admin" or lot.status not in {"requested", "accepted", "scheduled"}:
        raise HTTPException(status_code=409, detail="This collection can no longer be scheduled.")
    if user.role == "recycler" and lot.recycler_id != user.id:
        raise HTTPException(status_code=403, detail="This request belongs to another recycler.")
    profile = db.get(RecyclerProfile, lot.recycler_id) if lot.recycler_id else None
    if profile and ((payload.collection_mode == "pickup" and not profile.pickup_available) or (payload.collection_mode == "dropoff" and not profile.dropoff_available)):
        raise HTTPException(status_code=422, detail="The selected recycler does not support this collection mode.")
    lot.collection_mode = payload.collection_mode
    lot.scheduled_at = payload.scheduled_at
    lot.status = "scheduled" if lot.status != "requested" else "requested"
    lot.updated_at = datetime.now(timezone.utc)
    lot.events.append(LotEvent(id=str(uuid4()), actor_id=user.id, kind="collection_scheduled", note="Collection time updated.", details={"mode": payload.collection_mode, "scheduled_at": payload.scheduled_at.isoformat()}))
    db.commit()
    return serialize_lot(db, _get_lot(db, lot.id))


@app.post("/api/lots/{lot_id}/handover")
def verify_handover(lot_id: str, payload: HandoverIn, db: Session = Depends(get_db), user: User = Depends(require_role("recycler"))):
    lot = _get_lot(db, lot_id)
    lot = handover(db, lot, user, payload)
    return serialize_lot(db, lot)


@app.post("/api/lots/{lot_id}/payment")
def record_lot_payment(lot_id: str, payload: PaymentIn, db: Session = Depends(get_db), user: User = Depends(require_role("recycler", "admin"))):
    lot = _get_lot(db, lot_id)
    assert_lot_access(lot, user)
    lot, anomaly = record_payment(db, lot, user, payload)
    return {"lot": serialize_lot(db, lot), "anomaly": anomaly}


@app.get("/api/admin/recyclers")
def admin_recyclers(db: Session = Depends(get_db), _user: User = Depends(require_role("admin"))):
    profiles = db.scalars(select(RecyclerProfile).order_by(RecyclerProfile.verified, RecyclerProfile.organization)).all()
    board = latest_rates(db)
    fallback = board.get("other").rate_per_kg if board.get("other") else 0
    return {"recyclers": [serialize_recycler(
        db.get(User, profile.user_id), profile,
        board.get("mobile").rate_per_kg if board.get("mobile") else fallback,
        "mobile",
    ) | {"email": (db.get(User, profile.user_id).email if db.get(User, profile.user_id) else "")} for profile in profiles if db.get(User, profile.user_id)]}


@app.post("/api/admin/recyclers", status_code=201)
def create_recycler(payload: CreateRecyclerIn, db: Session = Depends(get_db), _admin: User = Depends(require_role("admin"))):
    user = User(
        id=str(uuid4()), name=payload.name, email=payload.email,
        password_hash=hash_password(payload.password), role="recycler",
    )
    profile = RecyclerProfile(
        user_id=user.id, organization=payload.organization, license_number=payload.license_number,
        verified=payload.verified, latitude=payload.latitude, longitude=payload.longitude,
        address=payload.address, materials=payload.materials, offers=payload.offers,
        pickup_available=True, dropoff_available=True,
    )
    db.add_all([user, profile])
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(status_code=409, detail="An account or authorization number already exists.") from error
    invalidate_cache("recyclers:")
    return {"user": serialize_user(user), "verified": profile.verified}


@app.patch("/api/admin/recyclers/{recycler_id}/verification")
def set_recycler_verification(recycler_id: str, payload: VerifyRecyclerIn, db: Session = Depends(get_db), admin: User = Depends(require_role("admin"))):
    profile = db.get(RecyclerProfile, recycler_id)
    if profile is None:
        raise HTTPException(status_code=404, detail="Recycler profile not found.")
    profile.verified = payload.verified
    profile.updated_at = datetime.now(timezone.utc)
    db.commit()
    invalidate_cache("recyclers:")
    return {"user_id": recycler_id, "verified": profile.verified}


@app.post("/api/admin/prices", status_code=201)
def publish_rate(payload: RateUpsertIn, db: Session = Depends(get_db), admin: User = Depends(require_role("admin"))):
    rate = add_rate(db, payload.material, payload.rate_per_kg, payload.source, admin)
    invalidate_cache("prices:")
    invalidate_cache("recyclers:")
    return {"id": rate.id, "material": rate.material, "rate_per_kg": rate.rate_per_kg, "source": rate.source, "recorded_at": rate.recorded_at}


@app.get("/api/admin/feedback")
def feedback_queue(db: Session = Depends(get_db), _admin: User = Depends(require_role("admin"))):
    rows = db.scalars(select(TrainingFeedback).order_by(TrainingFeedback.validation_state, TrainingFeedback.created_at.desc()).limit(500)).all()
    result = []
    for row in rows:
        lot = db.get(Lot, row.lot_id)
        collector = db.get(User, lot.collector_id) if lot else None
        recycler = db.get(User, lot.recycler_id) if lot and lot.recycler_id else None
        if not lot or lot.status not in {"handed_over", "paid"}:
            continue
        result.append({
            "id": row.id, "lot_id": row.lot_id, "lot_code": lot.lot_code,
            "material": row.true_label, "validation_state": row.validation_state,
            "reviewer_note": row.reviewer_note, "collector_name": collector.name if collector else "",
            "recycler_name": recycler.recycler_profile.organization if recycler and recycler.recycler_profile else "",
            "created_at": row.created_at, "photo_url": f"/api/lots/{lot.id}/photo",
        })
    return {"samples": result}


@app.patch("/api/admin/feedback/{feedback_id}")
def review_feedback(feedback_id: str, payload: ReviewFeedbackIn, db: Session = Depends(get_db), admin: User = Depends(require_role("admin"))):
    row = db.get(TrainingFeedback, feedback_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Training sample not found.")
    row.validation_state = payload.validation_state
    row.reviewer_id = admin.id
    row.reviewer_note = payload.reviewer_note
    row.reviewed_at = datetime.now(timezone.utc)
    db.commit()
    return {"id": row.id, "validation_state": row.validation_state, "reviewed_at": row.reviewed_at}


@app.get("/api/admin/feedback/export")
def export_feedback(db: Session = Depends(get_db), _admin: User = Depends(require_role("admin"))):
    rows = db.scalars(select(TrainingFeedback).where(TrainingFeedback.validation_state == "validated").order_by(TrainingFeedback.created_at)).all()
    lines = []
    for row in rows:
        lot = db.get(Lot, row.lot_id)
        if lot and lot.status == "paid" and row.image_path and Path(row.image_path).is_file():
            lines.append(json.dumps({"image_path": row.image_path, "label": row.true_label, "validation_state": "validated"}, ensure_ascii=False))
    return PlainTextResponse("\n".join(lines) + ("\n" if lines else ""), media_type="application/x-ndjson", headers={"Content-Disposition": "attachment; filename=validated-material-images.jsonl"})


@app.get("/api/admin/price-training/export")
def export_price_data(db: Session = Depends(get_db), _admin: User = Depends(require_role("admin"))):
    return PlainTextResponse("\n".join(json.dumps(row) for row in export_price_training(db)) + "\n", media_type="application/x-ndjson", headers={"Content-Disposition": "attachment; filename=verified-transactions.jsonl"})


@app.get("/api/admin/anomalies")
def get_anomalies(db: Session = Depends(get_db), _admin: User = Depends(require_role("admin"))):
    lots = db.scalars(select(Lot).options(selectinload(Lot.events)).where(Lot.anomaly_flag.is_(True)).order_by(Lot.updated_at.desc())).all()
    return {"lots": [serialize_lot(db, lot) for lot in lots]}


@app.get("/api/admin/analytics")
def admin_analytics(db: Session = Depends(get_db), _admin: User = Depends(require_role("admin"))):
    lots = db.scalars(select(Lot)).all()
    by_material = []
    for material in MATERIALS:
        matching = [lot for lot in lots if lot.material == material]
        by_material.append({
            "material": material,
            "lots": len(matching),
            "weight_kg": round(sum(lot.weight_kg for lot in matching), 1),
            "paid_value": round(sum(lot.final_price or 0 for lot in matching), 2),
        })
    return {
        "lots_total": len(lots),
        "weight_total_kg": round(sum(lot.weight_kg for lot in lots), 1),
        "paid_total": round(sum(lot.final_price or 0 for lot in lots), 2),
        "recyclers_total": db.scalar(select(func.count()).select_from(RecyclerProfile)) or 0,
        "recyclers_verified": db.scalar(select(func.count()).select_from(RecyclerProfile).where(RecyclerProfile.verified.is_(True))) or 0,
        "awaiting_review": db.scalar(select(func.count()).select_from(TrainingFeedback).where(TrainingFeedback.validation_state == "pending")) or 0,
        "by_material": by_material,
    }
