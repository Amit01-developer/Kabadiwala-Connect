from __future__ import annotations

from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import APP_ENV, SEED_DEMO
from .models import RecyclerProfile, User
from .security import hash_password
from .services.pricing import latest_rates, seed_rates


def seed_demo_data(db: Session) -> None:
    if not SEED_DEMO or APP_ENV == "production":
        return
    seed_rates(db)
    if db.scalar(select(User.id).limit(1)):
        return

    collector = User(
        id=str(uuid4()), name="Demo Collector", email="collector@demo.kabadwala.local",
        phone="+91 90000 00001", password_hash=hash_password("DemoCollector2026!"),
        role="collector", preferred_language="en",
    )
    admin = User(
        id=str(uuid4()), name="Demo Administrator", email="admin@demo.kabadwala.local",
        password_hash=hash_password("DemoAdmin2026!"), role="admin", preferred_language="en",
    )
    db.add_all([collector, admin])
    rates = latest_rates(db)
    recyclers = [
        ("GreenCycle Pune", "recycler.green@demo.kabadwala.local", "DEMO-EW-001", 18.5308, 73.8475, "Shivajinagar, Pune", 1.04),
        ("EcoIndia Recovery", "recycler.eco@demo.kabadwala.local", "DEMO-EW-002", 18.6298, 73.7997, "Pimpri, Pune", 1.08),
        ("CleanTech Solutions", "recycler.clean@demo.kabadwala.local", "DEMO-EW-003", 18.5089, 73.9260, "Hadapsar, Pune", 1.02),
    ]
    for index, (organization, email, license_number, lat, lon, address, factor) in enumerate(recyclers):
        user = User(
            id=str(uuid4()), name=f"Recycler Partner {index + 1}", email=email,
            phone=f"+91 90000 0000{index + 2}", password_hash=hash_password("DemoRecycler2026!"),
            role="recycler", preferred_language="en",
        )
        offers = {material: round(rate.rate_per_kg * factor, 2) for material, rate in rates.items()}
        profile = RecyclerProfile(
            user_id=user.id, organization=organization, license_number=license_number,
            verified=True, latitude=lat, longitude=lon, address=address,
            materials=list(rates), offers=offers,
            pickup_available=index != 2, dropoff_available=True,
        )
        db.add_all([user, profile])
    db.commit()
