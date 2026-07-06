"""Deal document blob storage (Cloudflare R2 or local filesystem)."""

from __future__ import annotations

import hashlib
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.test.signals import setting_changed

_STORAGE_BACKENDS: dict[str, 'DocumentStorageBackend'] = {}


def _clear_storage_cache(**kwargs):
    _STORAGE_BACKENDS.clear()

_FILENAME_SAFE = re.compile(r'[^a-zA-Z0-9._-]+')

ALLOWED_FILE_TYPES = frozenset({
    'pdf', 'docx', 'xlsx', 'xls', 'png', 'jpg', 'jpeg', 'csv', 'txt', 'zip',
})

FILE_TYPE_CONTENT_TYPES = {
    'pdf': 'application/pdf',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'xls': 'application/vnd.ms-excel',
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'csv': 'text/csv',
    'txt': 'text/plain',
    'zip': 'application/zip',
}


@dataclass(frozen=True)
class ObjectMeta:
    size: int
    content_type: str
    etag: str


@dataclass(frozen=True)
class PresignedUpload:
    url: str
    method: str
    headers: dict[str, str]
    expires_in: int


@dataclass(frozen=True)
class PresignedDownload:
    url: str
    expires_in: int


class DocumentStorageBackend(Protocol):
    def presign_upload(self, key: str, content_type: str) -> PresignedUpload: ...

    def presign_download(self, key: str, filename: str, content_type: str) -> PresignedDownload: ...

    def head_object(self, key: str) -> ObjectMeta | None: ...

    def delete_object(self, key: str) -> None: ...

    def write_object(self, key: str, body: bytes, content_type: str) -> ObjectMeta: ...

    def read_object(self, key: str) -> tuple[bytes, ObjectMeta]: ...


def max_upload_bytes() -> int:
    return int(getattr(settings, 'DOCUMENT_MAX_UPLOAD_BYTES', 100 * 1024 * 1024))


def sanitize_filename(name: str) -> str:
    base = os.path.basename(name or '').strip()
    if not base:
        return 'upload.bin'
    stem, dot, ext = base.rpartition('.')
    if dot:
        safe_stem = _FILENAME_SAFE.sub('-', stem).strip('-._') or 'upload'
        safe_ext = _FILENAME_SAFE.sub('', ext.lower())[:16]
        filename = f'{safe_stem[:200]}.{safe_ext}' if safe_ext else safe_stem[:200]
    else:
        filename = _FILENAME_SAFE.sub('-', base).strip('-._')[:200] or 'upload.bin'
    return filename


def build_document_key(deal_id, document_id, version: int, filename: str) -> str:
    safe_name = sanitize_filename(filename)
    return f'deals/{deal_id}/{document_id}/v{version}/{safe_name}'


def normalize_file_type(file_type: str) -> str:
    normalized = (file_type or '').lower().lstrip('.')
    if normalized not in ALLOWED_FILE_TYPES:
        raise ValueError(f'Unsupported file type: {file_type}')
    return normalized


def normalize_content_type(file_type: str, content_type: str | None) -> str:
    normalized_type = normalize_file_type(file_type)
    if content_type:
        return content_type
    return FILE_TYPE_CONTENT_TYPES.get(normalized_type, 'application/octet-stream')


class LocalDocumentStorage:
    def __init__(self, root: Path | None = None):
        self.root = root or Path(settings.MEDIA_ROOT) / 'deal-documents'

    def _path(self, key: str) -> Path:
        root = self.root.resolve()
        path = (root / key).resolve()
        try:
            path.relative_to(root)
        except ValueError as exc:
            raise ValueError('Invalid storage key.') from exc
        return path

    def presign_upload(self, key: str, content_type: str) -> PresignedUpload:
        # Local uploads use authenticated DocumentViewSet blob actions instead.
        raise NotImplementedError('Use build_local_upload_target from the view layer.')

    def presign_download(self, key: str, filename: str, content_type: str) -> PresignedDownload:
        raise NotImplementedError('Use build_local_download_target from the view layer.')

    def head_object(self, key: str) -> ObjectMeta | None:
        path = self._path(key)
        if not path.is_file():
            return None
        stat = path.stat()
        return ObjectMeta(size=stat.st_size, content_type='application/octet-stream', etag=str(stat.st_mtime_ns))

    def delete_object(self, key: str) -> None:
        path = self._path(key)
        if path.is_file():
            path.unlink()

    def write_object(self, key: str, body: bytes, content_type: str) -> ObjectMeta:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(body)
        return ObjectMeta(size=len(body), content_type=content_type, etag=hashlib.sha256(body).hexdigest())

    def read_object(self, key: str) -> tuple[bytes, ObjectMeta]:
        path = self._path(key)
        body = path.read_bytes()
        return body, ObjectMeta(
            size=len(body),
            content_type='application/octet-stream',
            etag=hashlib.sha256(body).hexdigest(),
        )


class R2DocumentStorage:
    def __init__(self):
        import boto3
        from botocore.config import Config

        account_id = settings.R2_ACCOUNT_ID
        if not account_id or not settings.R2_ACCESS_KEY_ID or not settings.R2_SECRET_ACCESS_KEY:
            raise ImproperlyConfigured('R2 credentials are not configured.')
        if not settings.R2_BUCKET_NAME:
            raise ImproperlyConfigured('R2_BUCKET_NAME is not configured.')

        self.bucket = settings.R2_BUCKET_NAME
        self.client = boto3.client(
            's3',
            endpoint_url=f'https://{account_id}.r2.cloudflarestorage.com',
            aws_access_key_id=settings.R2_ACCESS_KEY_ID,
            aws_secret_access_key=settings.R2_SECRET_ACCESS_KEY,
            region_name='auto',
            config=Config(signature_version='s3v4'),
        )

    def presign_upload(self, key: str, content_type: str) -> PresignedUpload:
        expires = int(getattr(settings, 'R2_PRESIGN_UPLOAD_EXPIRY', 3600))
        url = self.client.generate_presigned_url(
            'put_object',
            Params={'Bucket': self.bucket, 'Key': key, 'ContentType': content_type},
            ExpiresIn=expires,
        )
        return PresignedUpload(url=url, method='PUT', headers={'Content-Type': content_type}, expires_in=expires)

    def presign_download(self, key: str, filename: str, content_type: str) -> PresignedDownload:
        expires = int(getattr(settings, 'R2_PRESIGN_DOWNLOAD_EXPIRY', 900))
        url = self.client.generate_presigned_url(
            'get_object',
            Params={
                'Bucket': self.bucket,
                'Key': key,
                'ResponseContentType': content_type,
                'ResponseContentDisposition': f'attachment; filename="{sanitize_filename(filename)}"',
            },
            ExpiresIn=expires,
        )
        return PresignedDownload(url=url, expires_in=expires)

    def head_object(self, key: str) -> ObjectMeta | None:
        try:
            response = self.client.head_object(Bucket=self.bucket, Key=key)
        except self.client.exceptions.ClientError as exc:
            error_code = exc.response.get('Error', {}).get('Code')
            if error_code in {'404', 'NoSuchKey', 'NotFound'}:
                return None
            raise
        return ObjectMeta(
            size=response['ContentLength'],
            content_type=response.get('ContentType') or 'application/octet-stream',
            etag=response.get('ETag', '').strip('"'),
        )

    def delete_object(self, key: str) -> None:
        self.client.delete_object(Bucket=self.bucket, Key=key)

    def write_object(self, key: str, body: bytes, content_type: str) -> ObjectMeta:
        response = self.client.put_object(
            Bucket=self.bucket,
            Key=key,
            Body=body,
            ContentType=content_type,
        )
        return ObjectMeta(
            size=len(body),
            content_type=content_type,
            etag=response.get('ETag', '').strip('"'),
        )

    def read_object(self, key: str) -> tuple[bytes, ObjectMeta]:
        response = self.client.get_object(Bucket=self.bucket, Key=key)
        body = response['Body'].read()
        return body, ObjectMeta(
            size=len(body),
            content_type=response.get('ContentType') or 'application/octet-stream',
            etag=response.get('ETag', '').strip('"'),
        )


def get_document_storage() -> DocumentStorageBackend:
    backend = getattr(settings, 'DOCUMENT_STORAGE_BACKEND', 'local')
    cached = _STORAGE_BACKENDS.get(backend)
    if cached is not None:
        return cached
    if backend == 'r2':
        cached = R2DocumentStorage()
    elif backend == 'local':
        cached = LocalDocumentStorage()
    else:
        raise ImproperlyConfigured(f'Unsupported DOCUMENT_STORAGE_BACKEND: {backend}')
    _STORAGE_BACKENDS[backend] = cached
    return cached


def sha256_hex(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()


setting_changed.connect(_clear_storage_cache)
