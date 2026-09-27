# API Reference

Base URL: `http://127.0.0.1:8000`. Interactive OpenAPI docs are served at `/docs`; the raw schema is `/openapi.json`.

Except for health, registration, login, rates, and the quote endpoint, requests require `Authorization: Bearer <access_token>`. JSON errors use `{ "detail": "..." }`. Validation errors return HTTP 422. Unauthenticated requests return 401, role or ownership violations return 403 (or 404 for an inaccessible lot), conflicts return 409, rate limits return 429, and unavailable model/storage services return 503.

## Accounts

| Method | Endpoint | Access | Purpose |
| --- | --- | --- | --- |
| `POST` | `/api/auth/register` | Public | Create a collector account or an unverified recycler account. Recycler sign-up also needs `organization` and `license_number`. |
| `POST` | `/api/auth/login` | Public | Email/password sign-in; returns a bearer token and user profile. |
| `GET` | `/api/auth/me` | Any signed-in user | Return the current user. |
| `PATCH` | `/api/auth/preferences` | Any signed-in user | Set `preferred_language` to `en`, `hi`, or `mr`. |
| `POST` | `/api/auth/change-password` | Any signed-in user | Change password and revoke active sessions. |
| `POST` | `/api/auth/logout` | Any signed-in user | Revoke the current bearer session. |
| `GET` | `/api/health` | Public | Health and database check. |

Example login body: `{ "email": "collector@example.test", "password": "a-long-password" }`.

## Collector and recycler workflows

| Method | Endpoint | Access | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/dashboard` | Any signed-in user | Role-scoped totals and recent lots. |
| `GET` | `/api/prices` | Public | Latest published material rates and rate history. Starter entries are explicitly marked as demo data. |
| `POST` | `/api/prices/quote` | Any signed-in user | Estimate value from material, weight, condition, location and current rate history. |
| `GET` | `/api/recyclers?material=mobile&latitude=18.52&longitude=73.85&collection_mode=pickup` | Any signed-in user | Verified compatible partners, offers, distance and map links. |
| `GET` / `PUT` | `/api/recycler/profile` | Recycler | Read or update service address, coordinates, accepted materials, offers and collection modes. |
| `POST` | `/api/ai/classify` | Collector | Run the configured EfficientNet model on a JPG, PNG or WebP data URL. Returns 503 when no trained model is installed. |
| `POST` | `/api/lots` | Collector | Create a lot request with a unique `client_ref`, chosen verified recycler, item details, optional image and requested collection time. Repeated `client_ref` submissions return the original lot. |
| `GET` | `/api/lots` | Any signed-in user | List own lots, assigned recycler lots, or all lots for an administrator. Supports a `status` filter. |
| `GET` | `/api/lots/{lot_id}` | Lot participants or admin | Read item, payment and audit history. |
| `GET` | `/api/lots/{lot_id}/photo` | Lot participants or admin | Read the private local or S3 photo. |
| `POST` | `/api/lots/{lot_id}/accept` | Assigned recycler | Accept a requested lot. |
| `POST` | `/api/lots/{lot_id}/reject` | Assigned recycler | Decline a requested lot. |
| `POST` | `/api/lots/{lot_id}/schedule` | Collector or assigned recycler | Set pickup/drop-off mode and future date/time. |
| `POST` | `/api/lots/{lot_id}/handover` | Assigned recycler | Confirm scanned/manual lot code and material; `idempotency_key` prevents duplicate events. |
| `POST` | `/api/lots/{lot_id}/payment` | Assigned recycler or admin | Record amount, method and reference after verified handover. Returns statistical anomaly analysis. |

The create-lot request accepts `material` (`mobile`, `laptop`, `tv`, `battery`, `printer`, `other`), `weight_kg`, `condition` (`excellent`, `good`, `fair`, `poor`), `recycler_id`, `collection_mode`, `scheduled_at`, `latitude`, `longitude`, `description`, optional `image_data_url`, optional `predicted_material`/`prediction_confidence`, and `client_ref`.

## Administration

| Method | Endpoint | Access | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/admin/analytics` | Admin | Network totals by material, paid value, recycler counts and feedback queue size. |
| `GET` / `POST` | `/api/admin/recyclers` | Admin | Review recycler profiles or create a recycler account. New accounts default to unverified. |
| `PATCH` | `/api/admin/recyclers/{user_id}/verification` | Admin | Verify or revoke a recycler. |
| `POST` | `/api/admin/prices` | Admin | Publish a new rate-history entry; invalidates cached boards and matches. |
| `GET` | `/api/admin/feedback` | Admin | List recycler-confirmed item photos after handover. |
| `PATCH` | `/api/admin/feedback/{sample_id}` | Admin | Mark a sample validated or rejected. |
| `GET` | `/api/admin/feedback/export` | Admin | Download validated image paths as JSONL for classifier training. |
| `GET` | `/api/admin/price-training/export` | Admin | Download completed transaction features as JSONL for XGBoost training. |
| `GET` | `/api/admin/anomalies` | Admin | Review payments flagged by the median/MAD outlier check. |

## Data and safeguards

- Lot and payment actions check both user role and database ownership.
- Passwords are PBKDF2-HMAC-SHA256 hashes. Bearer tokens are signed and stored as hashes in revocable server sessions.
- Login attempts are throttled per source address and account for 15 minutes.
- Photo upload accepts only JPEG, PNG or WebP bytes and caps decoded content at 2 MB.
- S3 objects remain private; access is streamed through an authenticated API route.
- Quotes and recycler search are cached briefly in Redis when configured, with a bounded in-process cache fallback.
- Location filtering uses PostGIS `ST_DistanceSphere` on PostgreSQL when `POSTGIS_ENABLED=true`, otherwise an application Haversine calculation.
