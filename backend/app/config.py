from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / ".env")

APP_ENV = os.getenv("APP_ENV", "development").lower()
APP_SECRET = os.getenv("APP_SECRET", "local-development-secret-change-me")
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{(ROOT / '.data' / 'kabadwala.sqlite3').as_posix()}")
UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", str(ROOT / ".data" / "uploads"))).resolve()
ACCESS_TOKEN_HOURS = int(os.getenv("ACCESS_TOKEN_HOURS", "12"))
SEED_DEMO = os.getenv("SEED_DEMO", "true").lower() in {"true", "1", "yes"}
CLASSIFIER_MODEL_PATH = os.getenv("CLASSIFIER_MODEL_PATH", "").strip()
PRICE_MODEL_PATH = os.getenv("PRICE_MODEL_PATH", "").strip()
S3_BUCKET = os.getenv("S3_BUCKET", "").strip()
AWS_REGION = os.getenv("AWS_REGION", "ap-south-1").strip()
REDIS_URL = os.getenv("REDIS_URL", "").strip()
POSTGIS_ENABLED = os.getenv("POSTGIS_ENABLED", "false").lower() in {"true", "1", "yes"}
CORS_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
    ).split(",")
    if origin.strip()
]

if APP_ENV == "production" and (
    APP_SECRET in {"local-development-secret-change-me", "replace-with-a-long-random-secret"}
    or len(APP_SECRET) < 32
):
    raise RuntimeError("Set APP_SECRET to a private random value of at least 32 characters in production.")
