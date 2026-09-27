from __future__ import annotations

from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException

from .config import AWS_REGION, S3_BUCKET, UPLOAD_DIR
from .services.classification import decode_image_data_url


def save_data_url(data_url: str | None) -> str | None:
    if not data_url:
        return None
    try:
        raw, mime = decode_image_data_url(data_url)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    extension = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}[mime]
    if S3_BUCKET:
        try:
            import boto3
            key = f"lots/{uuid4().hex}{extension}"
            client = boto3.client("s3", region_name=AWS_REGION)
            client.put_object(
                Bucket=S3_BUCKET, Key=key, Body=raw, ContentType=mime,
                ServerSideEncryption="AES256",
            )
            return f"s3://{S3_BUCKET}/{key}"
        except ImportError as error:
            raise HTTPException(status_code=503, detail="S3 storage is configured but the AWS SDK is unavailable.") from error
        except Exception as error:
            raise HTTPException(status_code=503, detail="The item photo could not be stored securely.") from error
    target_dir = UPLOAD_DIR / "lots"
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / f"{uuid4().hex}{extension}"
    target.write_bytes(raw)
    return str(target)


def s3_object(path: str):
    if not S3_BUCKET or not path.startswith(f"s3://{S3_BUCKET}/"):
        raise HTTPException(status_code=404, detail="Photo not found.")
    try:
        import boto3
        key = path.removeprefix(f"s3://{S3_BUCKET}/")
        return boto3.client("s3", region_name=AWS_REGION).get_object(Bucket=S3_BUCKET, Key=key)
    except ImportError as error:
        raise HTTPException(status_code=503, detail="S3 storage is configured but the AWS SDK is unavailable.") from error
    except Exception as error:
        raise HTTPException(status_code=404, detail="Photo not found.") from error
