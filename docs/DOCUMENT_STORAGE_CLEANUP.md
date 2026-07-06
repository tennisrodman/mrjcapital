# Document Storage Simplification Pass

Follow-up to `DOCUMENT_STORAGE_FIXES.md`. That pass hardened the feature; this
one **removes complexity** now that the design has settled. MRJ is a small,
internal tool — the goal is code that is obviously correct and easy to read, not
maximum enterprise generality.

All items below are implemented and verified
(`python manage.py test api --settings=mrj.settings.test` and
`cd frontend && npm run build`).

## Removed: legacy direct-create path (`DOCUMENT_ALLOW_DIRECT_CREATE`)

The only supported way to create a document is now `upload-intent` → PUT bytes →
`complete`. `POST /api/documents/` always returns `403`.

Deleting the escape hatch removed a whole class of surface area:

- `DocumentViewSet.perform_create` (client-supplied `file_url` + its own version
  retry loop) — gone.
- `file_url` is now **read-only** on `DocumentSerializer`; the server generates
  every storage key. `validate_file_url` (scheme / `../` / absolute-path
  rejection) is gone because a client can no longer supply the value at all.
- The `DOCUMENT_ALLOW_DIRECT_CREATE` setting is removed from `base.py`,
  `test.py`, and `.env.example`.

This was the exact surface of the original `C1` cross-tenant IDOR. Removing it is
strictly safer than guarding it.

## Simplified: version allocation

`upload_intent` previously combined **four** mechanisms for one race: a
`select_for_update` row lock, the `unique_document_version` DB constraint, a 3×
retry loop, and nested `atomic()` savepoints.

With the deal row locked, concurrent uploads for a deal are already serialized,
so the retry/savepoint machinery was unreachable. It now reads:

```python
with transaction.atomic():
    Deal.objects.select_for_update().filter(pk=deal.pk).first()
    next_version = _next_document_version(deal, category, document_name)
    document = Document.objects.create(..., version=next_version)
```

The `unique_document_version` constraint stays as a database backstop.

## Simplified: `complete` no longer re-downloads from R2

The previous `complete` read the **entire object back from R2** (up to 100 MB)
to hash it server-side — even when the client declared no checksum. That defeats
the point of direct-to-R2 upload.

Now `complete`:

1. `HEAD`s the object and verifies it exists and its size matches the declared
   `file_size_bytes`.
2. For **local** storage, the SHA-256 is already computed from the received
   bytes during the `blob` PUT; if a checksum was declared it is compared.
3. For **R2**, the store is trusted (the client uploaded directly); a declared
   checksum is stored for reference but not re-verified by download.

Size verification via `HEAD` is the pragmatic integrity check for an internal
tool. (If we ever want end-to-end integrity on R2, bind `ChecksumSHA256` into the
presigned PUT so R2 verifies it — no Django download required.)

## Minor cleanups

- **Download filename**: a single `_download_filename` helper appends the file
  extension only when the name lacks it, so downloads no longer produce
  `term-sheet.pdf.pdf`, and the presigned and local `blob` paths agree.
- **`storage_status` default → `pending`**: a `Document` is only `ready` once
  its bytes are verified. Nothing creates a document outside `upload-intent`
  anymore, so the safe default prevents a stray/admin row from looking ready
  with no blob. Migration `0004`.
- **Dead code**: removed unused `verify_checksum` from `services/storage.py`.
- **Deduplicated** the identical `validate_visibility_roles` logic shared by the
  intent and model serializers.

## Not changed (intentionally)

- `content_type` stays a client-provided, server-normalized field — the frontend
  already sends it and it drives the download `Content-Type`. Not worth the churn
  to derive it purely server-side.
- Postgres `visibility_roles` GIN filtering vs. the Python fallback for SQLite is
  kept; the fallback is test-only.
- R2 bucket CORS / scoped tokens — operational, still out of scope.
