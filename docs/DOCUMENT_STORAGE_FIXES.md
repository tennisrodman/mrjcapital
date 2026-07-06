# Document Storage Review Fix Hitlist

Working list of fixes from the code review of `feature/document-storage-r2`.
All items below are implemented and verified (`python manage.py test api
--settings=mrj.settings.test` → 78 OK; `frontend && npm run build` → green).

> **Superseded in places by `DOCUMENT_STORAGE_CLEANUP.md`.** A later
> simplification pass removed the legacy direct-create path (so `C1`, `M4`, `M8`
> and `validate_file_url` no longer apply), collapsed the `I1` version-retry loop
> to a single locked transaction, and dropped the `I2` R2 re-download in favour of
> size verification. This file is kept as the historical hardening record.

## Critical

- [x] **C1 — `file_url` writable on update → cross-tenant blob IDOR**
  - `api/serializers.py`: `file_url` is now blocked from change on update (along
    with `deal`, `category`, `document_name`) in `DocumentSerializer.validate`.
    `file_url` remains writable only for the legacy direct-create path
    (`DOCUMENT_ALLOW_DIRECT_CREATE=true`), and `validate_file_url` still rejects
    absolute / scheme / `../` paths. The auto-generated `UniqueTogetherValidator`
    for the new `(deal, category, document_name, version)` constraint is disabled
    via `validators = []` because `version` is read-only and allocated server-side.
  - Regression test: `test_document_file_url_and_identity_fields_are_immutable_on_update`.

## Important

- [x] **I1 — Versioning race**
  - `api/viewsets.py`: `perform_create` and `upload_intent` now lock the deal row
    (`Deal.objects.select_for_update()`) inside `transaction.atomic()` before
    allocating the next version, and retry up to 3 times on `IntegrityError` from
    the new `unique_document_version` constraint.
  - `api/models/document.py` + `api/migrations/0003_document_version_unique.py`:
    added `UniqueConstraint(['deal','category','document_name','version'])`.

- [x] **I2 — R2 uploads skip checksum verification**
  - `api/viewsets.py:complete`: for the R2 backend, the object is now read and
    SHA-256 hashed and compared to the declared checksum. Local backend trusts
    the digest computed during `blob` PUT (see M3).

- [x] **I3 — R2 client constructed per call**
  - `api/services/storage.py`: `get_document_storage()` now caches backends in a
    module-level dict; cache is invalidated on `setting_changed` (test overrides).

- [x] **I4 — `perform_destroy` orphans blobs on R2 failure**
  - `api/viewsets.py:perform_destroy`: blob is deleted first, then the DB row
    inside `transaction.atomic()`. If blob delete fails, the row survives for
    retry (R2 `delete_object` is idempotent on missing keys).

- [x] **I5 — Non-staff cannot complete/download non-`internal` docs they create**
  - `api/viewsets.py:upload_intent`: for non-staff, `internal` is appended to
    `visibility_roles` when missing, so the creating analyst can still reach
    their doc through `complete`/`blob`/`list`.
  - Regression test: `test_non_staff_upload_intent_forces_internal_visibility`.

- [x] **I6 — `Document.details` accepts sensitive JSON unguarded**
  - `api/serializers.py`: added `DocumentSerializer.validate_details` reusing
    `_reject_sensitive_details`.
  - Regression test: `test_document_details_rejects_sensitive_identifiers`.

## Minor / nitpicks

- [x] **M1 — `_path` prefix check** (`api/services/storage.py`): uses
  `Path.relative_to` instead of string `startswith`.
- [x] **M2 — `blob` PUT content-type** (`api/viewsets.py`): asserts the request
  Content-Type matches `document.content_type` (parameters stripped) when set.
- [x] **M3 — Local `complete` re-read** (`api/viewsets.py`): the SHA-256 is
  computed during `blob` PUT and stored on `document.checksum_sha256`; `complete`
  compares against it without re-reading for local, reads+hashes for R2.
- [x] **M4 — Disabled direct create** (`api/viewsets.py`): returns `403` not `405`.
  Test updated.
- [x] **M5 — Local blob `expires_in`** (`api/viewsets.py`): local upload/download
  targets now return `expires_in=0`.
- [x] **M6 — Cleanup task resilience** (`api/tasks.py`): each document is wrapped
  in try/except + `logger.exception`; the sweep continues past failures.
- [x] **M7 — Audit attribution** (`api/viewsets.py:_log_document_upload`):
  `performed_by` now uses `request.user` (the completer) with `uploaded_by`
  fallback.
- [x] **M8 — Single insert per intent** (`api/viewsets.py:upload_intent`): UUID
  generated up front, key built before `Document.objects.create`.
- [x] **M9 — `validate_file_size_bytes` message** (`api/serializers.py`): default
  is now the actual cap, not the rejected size.
- [x] **M10 — Pin `boto3`** (`requirements.txt`): `boto3==1.35.99`.
- [x] **M11 — `DOCUMENT_PENDING_MAX_AGE_HOURS`** added to `.env.example` and the
  env table in `docs/DOCUMENT_STORAGE.md`.
- [x] **M12 — Redundant visibility re-check** removed from `download`
  (`get_queryset` already enforces internal-visibility for non-staff). The
  `blob` GET check is retained because `blob` bypasses `get_queryset`.

## Verification

- [x] `python manage.py test api --settings=mrj.settings.test` → 78 OK
- [x] `cd frontend && npm run build` → green
- [x] New regression tests: C1 (file_url/category/document_name immutability),
  I5 (non-staff internal visibility), I6 (sensitive details), cleanup task.

## Not done (out of scope for this pass)

- R2 bucket CORS / scoped-token / startup `check()` — operational, no code
  change in this pass.
- R2 multipart upload (>50 MB) — phase 2 per `docs/DOCUMENT_STORAGE.md`.
- Download audit logging — phase 2.
