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
│   ├── documents.py         document action policy
│   ├── deal_properties.py   relationship replacement and audit snapshots
│   ├── entity_facts.py      authorized/audited fact updates
│   ├── audit.py             shared activity writer and sensitive reads
│   └── storage.py           local/R2 object storage
├── policies.py              shared staff and deal-access decisions
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

Documents use an intent → blob upload → complete sequence. The server owns storage keys, versions, type normalization, size limits, storage status, and download targets. Local development writes under `media/deal-documents`; production can use Cloudflare R2.

The serialized document includes `can_edit`, `can_delete`, and block reasons. Executed evidence metadata is immutable. Closing-linked and executed-quote evidence cannot be deleted. Clients render these capabilities instead of reconstructing policy.

## Frontend boundaries

```
frontend/src/
├── config/          API/auth/data-mode boundary
├── lib/api/         TanStack Query resources and generic pagination
├── components/      reusable workflow and UI components
├── pages/           route composition
├── mocks/           dynamically loaded Demo adapters and feature stores
└── types/           API response and controlled-choice contracts
```

Routes are lazy-loaded. The Demo engine is dynamically imported only when Demo mode handles a request, so Live does not statically depend on it. The production entry chunk is limited to 450 KiB by `frontend/scripts/check-entry-bundle.mjs`.

The shared paginator batches all DRF pages without a silent row ceiling. Feature queries must distinguish loading, error, empty, and success states and invalidate every affected cache after mutation.

## Demo and Live

The header/login toggle persists the chosen data mode. Demo uses `shared/demo_seed.json` and the in-memory adapters under `frontend/src/mocks`; Live calls Django. `shared/workflow_contracts.json` is the parity contract for lifecycle graphs and document-upload validation, tested from both runtimes.

Demo is a product workflow simulator, not a second source of business truth. New reachable behavior must first be encoded in backend services and then mirrored behind shared contract tests.

## Authentication

The SPA uses SimpleJWT; `/admin/` uses Django sessions.

1. `POST /api/auth/login/` returns access/refresh tokens.
2. `apiRequest()` refreshes a `401 token_not_valid` once and persists rotated refresh tokens.
3. Logout uses raw `fetch` with the current refresh token so an implicit retry cannot blacklist a stale token.
4. `ProtectedRoute` guards routes; DRF permissions and scoped querysets enforce server access.

## Verification

CI uses the hermetic SQLite settings and does not provision PostgreSQL. PostgreSQL-only concurrency/JSON behavior remains in explicit test modules for a later release gate.

```bash
python manage.py test --settings=mrj.settings.test
python manage.py makemigrations --check --dry-run --settings=mrj.settings.test

cd frontend
npm test -- --run
npm run typecheck
npm run lint
npm run build
```
