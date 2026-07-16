# Architecture

MRJ Capital is a Django/DRF deal-workflow API with a React SPA. See [README.md](./README.md) for setup and [SYSTEM_REVIEW.md](./SYSTEM_REVIEW.md) for the remediation record and bounded remaining gaps.

## Runtime topology

Local development uses Vite on `:3000`, Django on `:8000`, and an optional Celery worker. Vite proxies `/api` and `/admin` to Django. Production uses Railway/Railpack: Gunicorn serves Django, WhiteNoise serves the staged Vite build, and separate services can run Celery worker and beat processes.

| `SERVICE_TYPE` | Process |
|---|---|
| `web` (default) | Gunicorn on `$PORT` |
| `worker` | Celery worker |
| `beat` | Celery Beat; run exactly one instance |

Redis DB `/0` is used for Celery broker/results and `/1` for the Django production cache.

## Backend boundaries

```
api/
├── models/                  domain records and controlled choices
├── services/                transactional workflow and audit operations
│   ├── deals.py             pipeline/syndication state machine and readiness
│   ├── screening.py         versioning, metrics, and finalization
│   ├── quotes.py            quote lifecycle and execution evidence
│   ├── closing.py           packages, generations, DD/CP mutation
│   ├── documents.py         document action policy and upload lifecycle audit
│   ├── notes.py             internal collaboration and note audit lifecycle
│   ├── deal_properties.py   relationship replacement and audit snapshots
│   ├── entity_facts.py      authorized/audited fact updates
│   ├── audit.py             shared activity writer and sensitive reads
│   └── storage.py           local/R2 object storage
├── policies.py              shared staff and deal-access decisions
├── drf.py                   request parsing and domain-validation translation
├── serializers.py           core deal/supporting-entity API contracts
├── *_serializers.py         feature-specific API contracts
├── viewsets.py              core deal/supporting-entity/document endpoints
├── *_viewsets.py            screening, quote, closing, and contact endpoints
└── mcp/                     read-only staff MCP query surface
```

Business transitions belong in services, not serializer `save()` methods or React. Services that change workflow state use database transactions and write audit evidence in the same transaction. Viewsets scope querysets and translate domain validation into HTTP responses. `api.policies` is the shared authorization vocabulary.

## Deal lifecycle

The main path is:

`Sourced → Screening → Quoting → Negotiating → Signed → Closing → Closed → Servicing → Exited`

On Hold and Dead are off-path states. On Hold remembers the paused stage and only resumes there (or moves to Dead). Dead and Exited are terminal. Screening and quote readiness are checked before their dependent transitions; staff overrides are explicit and audited, except hard integrity blockers such as Exited with unresolved active syndication.

Syndication follows:

`Not started → Raising → Fully subscribed → Closed`

Raising and Fully subscribed can also move to Cancelled. Moving a deal to Dead automatically cancels an active raise. The exact state graphs are mirrored in `shared/workflow_contracts.json`.

## Documents and evidence

Documents use an intent → blob upload → complete sequence. Started, completed, and expired pending uploads are distinct audit events, so interruption never masquerades as a successful upload or disappears without evidence. The server owns storage keys, versions, type normalization, size limits, storage status, deterministic ordering, and download targets. R2 PUT targets bind the exact content length, SHA-256, content type, and create-only precondition into the signature; completion independently streams the object through trusted credentials and verifies its size and digest before marking it ready. Local development writes under `media/deal-documents`; production can use Cloudflare R2.

Deleting a document transactionally removes the database row only after creating a durable blob-deletion outbox entry and a pending-deletion activity event. Celery retries storage deletion with backoff and records confirmed deletion separately. Stale pending-upload cleanup uses the same outbox, so a transient R2 failure cannot silently orphan a blob.

The serialized document includes `can_edit`, `can_delete`, and block reasons. Executed evidence metadata is immutable. Closing-linked and executed-quote evidence cannot be deleted. Clients render these capabilities instead of reconstructing policy.

## Frontend boundaries

```
frontend/src/
├── config/          API/auth and legacy-session migration boundary
├── lib/api/         TanStack Query resources and generic pagination
├── components/      reusable workflow and UI components
├── pages/           route composition
└── types/           API response and controlled-choice contracts
```

Routes are lazy-loaded. The frontend always calls Django through the API adapter, and the production entry chunk is limited to 450 KiB by `frontend/scripts/check-entry-bundle.mjs`.

The shared paginator batches all DRF pages without a silent row ceiling. Feature queries must distinguish loading, error, empty, and success states and invalidate every affected cache after mutation. Complex workspace panels, such as deal notes, live under `components/deals`; route files compose them rather than owning their workflow state.

## Live UI and development scenarios

The React application has one data path: Django. `shared/workflow_contracts.json` remains the backend contract for lifecycle graphs and document-upload validation.

Development scenario inputs live in the versioned `shared/workflow_seed.v1.json` manifest and are replayed by `api/services/lifecycle_scenarios.py`. Scenarios begin at Sourced, advance through domain services, create real local execution evidence, and assert readiness blockers before satisfying them. `exercise_deal_lifecycle` rolls back by default; `seed_development_scenarios` is DEBUG/local-storage-only and append-only.

## Authentication

The SPA uses SimpleJWT; `/admin/` uses Django sessions.

1. `POST /api/auth/login/` returns access/refresh tokens.
2. `apiRequest()` refreshes a `401 token_not_valid` once and persists rotated refresh tokens.
3. Logout is authorized by possession of the current refresh token and deliberately omits the access header, so an expired access token cannot prevent revocation.
4. `ProtectedRoute` guards routes; DRF permissions and scoped querysets enforce server access.

## Verification

CI uses the hermetic SQLite settings for the full fast suite and a separate PostgreSQL 17 service for production-database concurrency/JSON contract modules.

```bash
python manage.py test --settings=mrj.settings.test
python manage.py makemigrations --check --dry-run --settings=mrj.settings.test

DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/mrj \
  python manage.py test api.tests_postgres_contract api.tests_closing_postgres \
  api.tests_deal_updates_postgres \
  --settings=mrj.settings.test_postgres

cd frontend
npm test -- --run
npm run typecheck
npm run lint
npm run build
```
