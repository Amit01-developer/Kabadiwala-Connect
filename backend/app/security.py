from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import ACCESS_TOKEN_HOURS, APP_SECRET
from .models import AuthSession, User


def hash_password(password: str, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 310_000)
    return "pbkdf2_sha256$310000${}${}".format(
        base64.urlsafe_b64encode(salt).decode(),
        base64.urlsafe_b64encode(digest).decode(),
    )


def verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, iterations, salt_text, digest_text = encoded.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        salt = base64.urlsafe_b64decode(salt_text.encode())
        expected = base64.urlsafe_b64decode(digest_text.encode())
        actual = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, int(iterations))
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _encode_token(payload: dict) -> str:
    body = _b64url(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode())
    signature = _b64url(hmac.new(APP_SECRET.encode(), body.encode(), hashlib.sha256).digest())
    return f"{body}.{signature}"


def _decode_token(token: str) -> dict:
    try:
        body, supplied = token.split(".", 1)
        expected = _b64url(hmac.new(APP_SECRET.encode(), body.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(supplied, expected):
            raise ValueError("signature")
        padding = "=" * (-len(body) % 4)
        return json.loads(base64.urlsafe_b64decode(body + padding))
    except (ValueError, TypeError, json.JSONDecodeError) as error:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Your session is invalid or has expired.") from error


def create_session(db: Session, user: User) -> tuple[str, datetime]:
    session_id = str(uuid4())
    expires_at = datetime.now(timezone.utc) + timedelta(hours=ACCESS_TOKEN_HOURS)
    token = _encode_token({"sub": user.id, "sid": session_id, "exp": int(expires_at.timestamp())})
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    db.add(AuthSession(id=session_id, user_id=user.id, token_hash=token_hash, expires_at=expires_at))
    db.commit()
    return token, expires_at


def get_user_for_token(db: Session, token: str) -> User:
    payload = _decode_token(token)
    if int(payload.get("exp", 0)) < int(datetime.now(timezone.utc).timestamp()):
        raise HTTPException(status_code=401, detail="Your session has expired. Please sign in again.")
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    session_row = db.scalar(select(AuthSession).where(
        AuthSession.id == payload.get("sid"),
        AuthSession.user_id == payload.get("sub"),
        AuthSession.token_hash == token_hash,
        AuthSession.revoked_at.is_(None),
    ))
    if session_row is None:
        raise HTTPException(status_code=401, detail="Your session is no longer active.")
    expires_at = session_row.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at <= datetime.now(timezone.utc):
        raise HTTPException(status_code=401, detail="Your session has expired. Please sign in again.")
    user = db.get(User, session_row.user_id)
    if user is None:
        raise HTTPException(status_code=401, detail="This account is no longer available.")
    return user
