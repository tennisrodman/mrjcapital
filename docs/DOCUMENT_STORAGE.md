# Document Storage (Cloudflare R2)

Reference for deal document blob storage in MRJ Capital. Metadata lives in Postgres (`api.models.Document`); file bytes live in Cloudflare R2 (production) or local disk (development/tests).

## Architecture

```
React SPA  ──JWT──►  Django API  ──metadata──►  Postgres
     │                    │
     └── presigned ───────┴── boto3 S3 API ──►  Cloudflare R2
         PUT/GET              (or local MEDIA_ROOT)
```

- **Postgres** is the system of record: labels, permissions, versions, audit.
- **R2** is a private object store addressed by `Document.file_url` (relative storage key).
- Clients never choose storage keys; the server generates them at upload-intent time.

## Storage key format

```
deals/{deal_uuid}/{document_uuid}/v{version}/{safe_filename}
```

Example:

```
deals/a1b2c3d4-.../e5f6g7h8-.../v2/term-sheet-executed.pdf
```

## Document model fields

| Field | Purpose |
|-------|---------|
| `file_url` | Relative R2/local key (not a public URL) |
| `storage_status` | `pending` → `ready` \| `failed` |
| `file_size_bytes` | Declared at intent; verified at complete |
| `content_type` | MIME type for download headers |
| `checksum_sha256` | Optional integrity check |
| `subcategory` | e.g. `phase_1`, `term_sheet` under a category |
| `pipeline_stage_at_upload` | Snapshot of `deal.pipeline_status` at upload |
| `visibility_roles` | `internal`, `investor`, `borrower`, `counsel` |
| `is_executed` | Signed/authoritative version (staff action) |
| `version` | Auto-incremented per `(deal, category, document_name)` |

See `api/models/document.py` and migration `0002_document_storage_fields`.

## Upload flow

1. **`POST /api/documents/upload-intent/`** — validate metadata, create `Document` (`pending`), return presigned PUT URL.
2. **Client `PUT`** file bytes to R2 (or local blob endpoint in dev).
3. **`POST /api/documents/{id}/complete/`** — server `HEAD`s object, verifies size, sets `ready`, writes `ActivityLog`.

Documents are created **only** through this flow; `POST /api/documents/` returns `403`. The server generates every storage key, so `file_url` is read-only.

Activity log is written on **complete**, not on intent, so abandoned uploads do not pollute audit.

`complete` does not re-download the object from R2 to hash it: it verifies existence + size via `HEAD`. For local storage the SHA-256 is computed from the received bytes during the `blob` PUT. See `docs/DOCUMENT_STORAGE_CLEANUP.md`.

## Download flow

1. **`GET /api/documents/{id}/download/`** — RBAC + visibility check.
2. Returns short-lived presigned GET URL (15 min default).
3. Client fetches file directly from R2.

List/detail endpoints only return `storage_status=ready` documents by default (staff can filter pending).

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `DOCUMENT_STORAGE_BACKEND` | `local` | `r2` or `local` |
| `DOCUMENT_MAX_UPLOAD_BYTES` | `104857600` | 100 MB cap |
| `DOCUMENT_PENDING_MAX_AGE_HOURS` | `24` | Stale pending cleanup cutoff |
| `R2_ACCOUNT_ID` | — | Cloudflare account ID |
| `R2_ACCESS_KEY_ID` | — | R2 API token |
| `R2_SECRET_ACCESS_KEY` | — | R2 API token secret |
| `R2_BUCKET_NAME` | — | Bucket name |
| `R2_PRESIGN_UPLOAD_EXPIRY` | `3600` | Upload URL TTL (seconds) |
| `R2_PRESIGN_DOWNLOAD_EXPIRY` | `900` | Download URL TTL (seconds) |

Configure R2 bucket CORS for `PUT`, `GET`, `HEAD` from your SPA origins before browser direct upload works in production.

## Allowed file types (v1)

`pdf`, `docx`, `xlsx`, `xls`, `png`, `jpg`, `jpeg`, `csv`, `txt`, `zip`

## Lifecycle alignment

Documents are organized by **category** in the UI (not pipeline stage). Categories map to lifecycle stages — see the platform guide in `docs/AI Investment Manager_Deal_Lifecycle_Platform_Guide_SR CLEAN.pdf`.

`pipeline_stage_at_upload` captures deal stage at upload time for analytics only.

## Celery maintenance

- **`cleanup_stale_pending_documents`** (hourly) — deletes `pending` rows older than `DOCUMENT_PENDING_MAX_AGE_HOURS` (default 24h) and their orphan blobs.

## Related code

| Path | Role |
|------|------|
| `api/services/storage.py` | R2/local backends, key builder, presigned URLs |
| `api/viewsets.py` | `DocumentViewSet` upload/download actions |
| `api/serializers.py` | Upload intent / complete serializers |
| `api/tasks.py` | Stale pending cleanup |
| `frontend/src/lib/api/documents.ts` | Upload/download hooks |
| `frontend/src/components/deals/DocumentUploadDialog.tsx` | Upload UI |

## Phase 2+ (not yet implemented)

- `mark-executed` staff workflow
- DD checklist FK on documents
- DocuSign webhook → executed document
- R2 event notifications → AI DD review
- Multipart upload for files > 50 MB
