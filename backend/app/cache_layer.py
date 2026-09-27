from __future__ import annotations

import json
import time
from typing import Callable, TypeVar

from fastapi.encoders import jsonable_encoder

from .config import REDIS_URL

T = TypeVar("T")
_memory: dict[str, tuple[float, object]] = {}
_redis = None


def _client():
    global _redis
    if not REDIS_URL:
        return None
    if _redis is None:
        try:
            import redis
            _redis = redis.Redis.from_url(REDIS_URL, decode_responses=True, socket_timeout=0.35, socket_connect_timeout=0.35)
        except ImportError:
            return None
    return _redis


def cached_json(key: str, ttl_seconds: int, load: Callable[[], T]) -> T:
    client = _client()
    if client is not None:
        try:
            value = client.get(key)
            if value:
                return json.loads(value)
        except Exception:
            pass
    cached = _memory.get(key)
    if cached and cached[0] > time.monotonic():
        return cached[1]  # type: ignore[return-value]
    payload = jsonable_encoder(load())
    _memory[key] = (time.monotonic() + ttl_seconds, payload)
    if client is not None:
        try:
            client.setex(key, ttl_seconds, json.dumps(payload, separators=(",", ":")))
        except Exception:
            pass
    return payload  # type: ignore[return-value]


def invalidate_cache(prefix: str) -> None:
    for key in [key for key in _memory if key.startswith(prefix)]:
        _memory.pop(key, None)
    client = _client()
    if client is not None:
        try:
            keys = list(client.scan_iter(match=f"{prefix}*", count=100))
            if keys:
                client.delete(*keys)
        except Exception:
            pass
