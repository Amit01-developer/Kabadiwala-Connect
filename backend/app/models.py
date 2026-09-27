from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import Boolean, CheckConstraint, DateTime, Float, ForeignKey, Index, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint("role IN ('collector', 'recycler', 'admin')", name="ck_users_role"),
        CheckConstraint("preferred_language IN ('en', 'hi', 'mr')", name="ck_users_language"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    email: Mapped[str] = mapped_column(String(254), unique=True, index=True)
    phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    password_hash: Mapped[str] = mapped_column(String(256))
    role: Mapped[str] = mapped_column(String(16), index=True)
    preferred_language: Mapped[str] = mapped_column(String(5), default="en")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    recycler_profile: Mapped[RecyclerProfile | None] = relationship(back_populates="user", uselist=False)


class RecyclerProfile(Base):
    __tablename__ = "recycler_profiles"
    __table_args__ = (
        CheckConstraint("(latitude IS NULL AND longitude IS NULL) OR (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)", name="ck_recycler_coordinates"),
    )

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    organization: Mapped[str] = mapped_column(String(160))
    license_number: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    verified: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    address: Mapped[str] = mapped_column(String(240), default="")
    materials: Mapped[list[str]] = mapped_column(JSON, default=list)
    offers: Mapped[dict[str, float]] = mapped_column(JSON, default=dict)
    pickup_available: Mapped[bool] = mapped_column(Boolean, default=True)
    dropoff_available: Mapped[bool] = mapped_column(Boolean, default=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    user: Mapped[User] = relationship(back_populates="recycler_profile")


class Rate(Base):
    __tablename__ = "rate_history"
    __table_args__ = (
        Index("ix_rate_material_date", "material", "recorded_at"),
        CheckConstraint("material IN ('mobile', 'laptop', 'tv', 'battery', 'printer', 'other')", name="ck_rate_material"),
        CheckConstraint("rate_per_kg > 0", name="ck_rate_positive"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    material: Mapped[str] = mapped_column(String(24), index=True)
    rate_per_kg: Mapped[float] = mapped_column(Float)
    source: Mapped[str] = mapped_column(String(120), default="Verified recycler offers")
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    created_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)


class Lot(Base):
    __tablename__ = "lots"
    __table_args__ = (
        Index("ix_lots_collector_created", "collector_id", "created_at"),
        Index("ix_lots_recycler_status", "recycler_id", "status"),
        CheckConstraint("material IN ('mobile', 'laptop', 'tv', 'battery', 'printer', 'other')", name="ck_lots_material"),
        CheckConstraint("weight_kg > 0", name="ck_lots_weight_positive"),
        CheckConstraint("condition IN ('excellent', 'good', 'fair', 'poor')", name="ck_lots_condition"),
        CheckConstraint("collection_mode IN ('pickup', 'dropoff')", name="ck_lots_collection_mode"),
        CheckConstraint("status IN ('requested', 'accepted', 'declined', 'scheduled', 'handed_over', 'paid')", name="ck_lots_status"),
        CheckConstraint("estimated_low >= 0 AND estimated_high >= estimated_low", name="ck_lots_estimate_range"),
        CheckConstraint("quoted_price IS NULL OR quoted_price >= 0", name="ck_lots_quoted_price"),
        CheckConstraint("final_price IS NULL OR final_price >= 0", name="ck_lots_final_price"),
        CheckConstraint("prediction_confidence IS NULL OR prediction_confidence BETWEEN 0 AND 1", name="ck_lots_prediction_confidence"),
        CheckConstraint("(latitude IS NULL AND longitude IS NULL) OR (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)", name="ck_lots_coordinates"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    lot_code: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    client_ref: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True)
    collector_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), index=True)
    recycler_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    material: Mapped[str] = mapped_column(String(24), index=True)
    weight_kg: Mapped[float] = mapped_column(Float)
    condition: Mapped[str] = mapped_column(String(16))
    description: Mapped[str] = mapped_column(Text, default="")
    image_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    predicted_material: Mapped[str | None] = mapped_column(String(24), nullable=True)
    prediction_confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    collection_mode: Mapped[str] = mapped_column(String(16))
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    estimated_low: Mapped[float] = mapped_column(Float)
    estimated_high: Mapped[float] = mapped_column(Float)
    quoted_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    final_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    status: Mapped[str] = mapped_column(String(24), default="requested", index=True)
    anomaly_flag: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    events: Mapped[list[LotEvent]] = relationship(back_populates="lot", cascade="all, delete-orphan", order_by="LotEvent.created_at")
    payment: Mapped[Payment | None] = relationship(back_populates="lot", uselist=False)


class LotEvent(Base):
    __tablename__ = "lot_events"
    __table_args__ = (UniqueConstraint("idempotency_key", name="uq_lot_event_idempotency"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    lot_id: Mapped[str] = mapped_column(ForeignKey("lots.id", ondelete="CASCADE"), index=True)
    actor_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    kind: Mapped[str] = mapped_column(String(32), index=True)
    note: Mapped[str] = mapped_column(String(500), default="")
    details: Mapped[dict] = mapped_column(JSON, default=dict)
    idempotency_key: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    lot: Mapped[Lot] = relationship(back_populates="events")


class Payment(Base):
    __tablename__ = "payments"
    __table_args__ = (
        CheckConstraint("amount > 0", name="ck_payments_amount_positive"),
        CheckConstraint("status IN ('paid', 'pending', 'failed', 'refunded')", name="ck_payments_status"),
        CheckConstraint("method IN ('cash', 'upi', 'bank_transfer', 'other')", name="ck_payments_method"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    lot_id: Mapped[str] = mapped_column(ForeignKey("lots.id", ondelete="CASCADE"), unique=True, index=True)
    amount: Mapped[float] = mapped_column(Float)
    status: Mapped[str] = mapped_column(String(16), default="paid")
    method: Mapped[str] = mapped_column(String(20))
    reference: Mapped[str] = mapped_column(String(120), default="")
    idempotency_key: Mapped[str] = mapped_column(String(64), unique=True)
    updated_by: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    lot: Mapped[Lot] = relationship(back_populates="payment")


class TrainingFeedback(Base):
    __tablename__ = "training_feedback"
    __table_args__ = (
        CheckConstraint("true_label IN ('mobile', 'laptop', 'tv', 'battery', 'printer', 'other')", name="ck_feedback_label"),
        CheckConstraint("validation_state IN ('pending', 'validated', 'rejected')", name="ck_feedback_state"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    lot_id: Mapped[str] = mapped_column(ForeignKey("lots.id", ondelete="CASCADE"), unique=True, index=True)
    image_path: Mapped[str] = mapped_column(String(500))
    true_label: Mapped[str] = mapped_column(String(24), index=True)
    validation_state: Mapped[str] = mapped_column(String(16), default="pending", index=True)
    reviewer_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    reviewer_note: Mapped[str] = mapped_column(String(500), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AuthSession(Base):
    __tablename__ = "auth_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class PriceTrainingRow(Base):
    __tablename__ = "price_training_rows"
    __table_args__ = (
        CheckConstraint("material IN ('mobile', 'laptop', 'tv', 'battery', 'printer', 'other')", name="ck_price_training_material"),
        CheckConstraint("weight_kg > 0 AND paid_price > 0", name="ck_price_training_positive_values"),
        CheckConstraint("condition IN ('excellent', 'good', 'fair', 'poor')", name="ck_price_training_condition"),
        CheckConstraint("(latitude IS NULL AND longitude IS NULL) OR (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)", name="ck_price_training_coordinates"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    lot_id: Mapped[str] = mapped_column(ForeignKey("lots.id", ondelete="CASCADE"), unique=True, index=True)
    material: Mapped[str] = mapped_column(String(24))
    weight_kg: Mapped[float] = mapped_column(Float)
    condition: Mapped[str] = mapped_column(String(16))
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    paid_price: Mapped[float] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
