from datetime import datetime, timezone
from typing import Literal
import re

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

MATERIALS = ("mobile", "laptop", "tv", "battery", "printer", "other")
CONDITIONS = ("excellent", "good", "fair", "poor")


class InputModel(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")


class RegisterIn(InputModel):
    name: str = Field(min_length=2, max_length=120)
    email: str = Field(min_length=5, max_length=254)
    password: str = Field(min_length=10, max_length=128)
    phone: str | None = Field(default=None, max_length=32)
    preferred_language: Literal["en", "hi", "mr"] = "en"
    account_type: Literal["collector", "recycler"] = "collector"
    organization: str | None = Field(default=None, min_length=2, max_length=160)
    license_number: str | None = Field(default=None, min_length=3, max_length=80)

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        value = value.lower()
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value):
            raise ValueError("Enter a valid email address.")
        return value

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, value: str | None) -> str | None:
        if value and not re.fullmatch(r"[+0-9() .-]{7,32}", value):
            raise ValueError("Enter a valid phone number.")
        return value

    @model_validator(mode="after")
    def recycler_registration_fields(self):
        if self.account_type == "recycler" and (not self.organization or not self.license_number):
            raise ValueError("Recycler registrations need an organization and authorization number.")
        return self


class LoginIn(InputModel):
    email: str = Field(min_length=5, max_length=254)
    password: str = Field(min_length=1, max_length=128)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        return value.lower()


class PriceQuoteIn(InputModel):
    material: Literal["mobile", "laptop", "tv", "battery", "printer", "other"]
    weight_kg: float = Field(gt=0, le=5000)
    condition: Literal["excellent", "good", "fair", "poor"]
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)

    @model_validator(mode="after")
    def validate_location_pair(self):
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("Latitude and longitude must be provided together.")
        return self


class CreateLotIn(PriceQuoteIn):
    recycler_id: str
    description: str = Field(default="", max_length=1000)
    collection_mode: Literal["pickup", "dropoff"] = "pickup"
    scheduled_at: datetime | None = None
    image_data_url: str | None = Field(default=None, max_length=3_000_000)
    predicted_material: Literal["mobile", "laptop", "tv", "battery", "printer", "other"] | None = None
    prediction_confidence: float | None = Field(default=None, ge=0, le=1)
    client_ref: str = Field(min_length=8, max_length=64)

    @model_validator(mode="after")
    def validate_prediction(self):
        if self.predicted_material is None and self.prediction_confidence is not None:
            raise ValueError("Prediction confidence requires a predicted material.")
        if self.scheduled_at is not None:
            if self.scheduled_at.tzinfo is None:
                self.scheduled_at = self.scheduled_at.replace(tzinfo=timezone.utc)
            if self.scheduled_at <= datetime.now(timezone.utc):
                raise ValueError("Choose a future collection time.")
        return self


class PaymentIn(InputModel):
    amount: float = Field(gt=0, le=10_000_000)
    method: Literal["cash", "upi", "bank_transfer", "other"]
    reference: str = Field(default="", max_length=120)
    idempotency_key: str = Field(min_length=8, max_length=64)


class HandoverIn(InputModel):
    lot_code: str = Field(min_length=6, max_length=32)
    confirmed_material: Literal["mobile", "laptop", "tv", "battery", "printer", "other"] | None = None
    note: str = Field(default="", max_length=500)
    idempotency_key: str = Field(min_length=8, max_length=64)


class ScheduleIn(InputModel):
    collection_mode: Literal["pickup", "dropoff"]
    scheduled_at: datetime

    @field_validator("scheduled_at")
    @classmethod
    def schedule_is_future(cls, value: datetime) -> datetime:
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        if value <= datetime.now(timezone.utc):
            raise ValueError("Choose a future date and time.")
        return value


class RateUpsertIn(InputModel):
    material: Literal["mobile", "laptop", "tv", "battery", "printer", "other"]
    rate_per_kg: float = Field(gt=0, le=1_000_000)
    source: str = Field(min_length=2, max_length=120)


class VerifyRecyclerIn(InputModel):
    verified: bool
    note: str = Field(default="", max_length=500)


class ReviewFeedbackIn(InputModel):
    validation_state: Literal["validated", "rejected"]
    reviewer_note: str = Field(default="", max_length=500)


class RecyclerProfileIn(InputModel):
    organization: str = Field(min_length=2, max_length=160)
    license_number: str = Field(min_length=3, max_length=80)
    address: str = Field(min_length=3, max_length=240)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    materials: list[Literal["mobile", "laptop", "tv", "battery", "printer", "other"]] = Field(min_length=1, max_length=6)
    offers: dict[str, float] = Field(default_factory=dict)
    pickup_available: bool = True
    dropoff_available: bool = True

    @field_validator("offers")
    @classmethod
    def validate_offers(cls, offers: dict[str, float]) -> dict[str, float]:
        if any(key not in MATERIALS or not 0 < value <= 1_000_000 for key, value in offers.items()):
            raise ValueError("Offers must use a supported material and a positive rate.")
        return offers

    @model_validator(mode="after")
    def validate_profile(self):
        if not set(self.offers).issubset(self.materials):
            raise ValueError("Recycler offers must match materials they accept.")
        if not self.pickup_available and not self.dropoff_available:
            raise ValueError("Enable pickup or drop-off availability.")
        return self


class CreateRecyclerIn(InputModel):
    name: str = Field(min_length=2, max_length=120)
    email: str = Field(min_length=5, max_length=254)
    password: str = Field(min_length=10, max_length=128)
    organization: str = Field(min_length=2, max_length=160)
    license_number: str = Field(min_length=3, max_length=80)
    address: str = Field(default="", max_length=240)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    materials: list[Literal["mobile", "laptop", "tv", "battery", "printer", "other"]] = Field(default_factory=lambda: list(MATERIALS))
    offers: dict[str, float] = Field(default_factory=dict)
    verified: bool = False

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        value = value.lower()
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value):
            raise ValueError("Enter a valid email address.")
        return value

    @model_validator(mode="after")
    def validate_location_pair(self):
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("Latitude and longitude must be provided together.")
        return self


class ClassifyIn(InputModel):
    image_data_url: str = Field(min_length=100, max_length=3_000_000)


class PasswordChangeIn(InputModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=10, max_length=128)


class PreferenceIn(InputModel):
    preferred_language: Literal["en", "hi", "mr"]
