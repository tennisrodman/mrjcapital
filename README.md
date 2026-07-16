# MRJ Capital

Full-stack deal workflow for MRJ Capital LLC. It covers debt-deal intake, screening, versioned quotes, closing checklists, document evidence, internal notes/activity, and pipeline/syndication lifecycle management.

## Stack

- **Backend:** Django 6.0, Django REST Framework, SimpleJWT (access + refresh, blacklist on logout)
- **Frontend:** React 19 + Vite + TypeScript, Tailwind 4, shadcn-style components, TanStack Query, React Router 7
- **Data:** Postgres via `psycopg[binary]` 3.x
- **Async:** Celery + Redis (separate Redis DBs for broker vs. cache)
- **Serving in prod:** Gunicorn, WhiteNoise (SPA + static assets), Django admin
- **Deploy:** Railway with Railpack (`railpack.json` + `railway.json`)

## Layout

```
api/               Django domain models, services, policies, serializers, viewsets, and tests
frontend/          Vite React SPA; built into ../build/ and served by Django in production
shared/            Versioned workflow seed manifest and lifecycle contracts
scripts/           Python utilities importable from Django management commands
mrj/               Django project: settings, urls, wsgi, celery
build.sh           Builds the frontend, stages it into build/, runs collectstatic
start.sh           Migrates + launches gunicorn (web), celery worker, or beat
setup.sh           One-shot local setup (pip + npm + optional DB create + superuser)
dev.sh             tmux-based dev loop: Django + Vite + Celery side by side
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for system boundaries and [SYSTEM_REVIEW.md](./SYSTEM_REVIEW.md) for the staged remediation record.

## Local setup

Requirements: Python 3.12+, Node 24.18.0+, Postgres, Redis, tmux (for `dev.sh`).

```bash
cp .env.example .env    # edit values
./setup.sh --with-db    # creates venv, installs deps, optionally creates DB + superuser
./dev.sh                # Django @ :8000, Vite @ :3000, Celery worker
```

`setup.sh --with-db` seeds a superuser when `DJANGO_SUPERUSER_USERNAME` / `DJANGO_SUPERUSER_EMAIL` / `DJANGO_SUPERUSER_PASSWORD` are set in `.env`.

## Development data

The frontend always uses the Django API. The former browser-only Demo mode was removed so normal UI use exercises the same persistence, permissions, audit, upload, and readiness boundaries as normal API operation. The automated frontend suite is component-level; it does not replace a literal browser walkthrough.

For coherent development examples, use the guarded service-driven workflow seed. It requires `DEBUG=True`, local document storage, and an existing staff actor:

```bash
source .venv/bin/activate

# Exercise Sourced through Exited, including expected readiness failures.
# Database writes and the evidence blob are rolled back by default.
python manage.py exercise_deal_lifecycle --actor tchen

# Persist an append-only, idempotent development matrix for UI inspection.
python manage.py seed_development_scenarios --actor tchen

# Or seed selected stages only; --target may be repeated.
python manage.py seed_development_scenarios --actor tchen --target screening --target closing
```

The durable scenarios are declared in `shared/workflow_seed.v1.json`, start at Sourced, and use screening, quote, transition, syndication, document, and closing services. They create real local evidence with verified size and SHA-256 checksums. Scenario history is intentionally append-only; there is no rebuild command that bypasses protected screening, quote, or closing evidence.

## Local MCP server

MRJ includes a read-only MCP server for local Codex/admin deal queries. It runs over stdio and requires an active staff or superuser account.

```bash
export DJANGO_SETTINGS_MODULE=mrj.settings.development
export MRJ_MCP_USERNAME=staff
# or: export MRJ_MCP_USER_ID=1
python3 manage.py run_mcp
```

Example local MCP config:

```json
{
  "mcpServers": {
    "mrj": {
      "command": "python3",
      "args": ["manage.py", "run_mcp"],
      "cwd": "/absolute/path/to/mrj",
      "env": {
        "DJANGO_SETTINGS_MODULE": "mrj.settings.development",
        "MRJ_MCP_USERNAME": "staff"
      }
    }
  }
}
```

V1 exposes read-only tools for searching deals, reading one deal, listing status vocabularies, checking allowed transitions, and summarizing the pipeline.

Local MCP trust boundary: any local process that can launch this command with `MRJ_MCP_USER_ID` or `MRJ_MCP_USERNAME` acts as that staff user, so configure it only on trusted developer/admin machines.

Deal detail policy: `mrj_get_deal` omits `Deal.details` by default; callers can request it with `include_details=true`, so `Deal.details` should remain free of PII or sensitive identifiers unless audit logging is added for those reads.

## Environment variables

| Var | Purpose |
|---|---|
| `DATABASE_URL` | Full Postgres URL (preferred). Otherwise set `DB_*` vars. |
| `REDIS_URL` | Django cache Redis URL (typically `/1`). |
| `CELERY_BROKER_URL`, `CELERY_RESULT_BACKEND` | Celery queue/result (typically `/0`). |
| `DJANGO_SECRET_KEY` | Required in production. |
| `ALLOWED_HOSTS` | Comma-separated hostnames (no scheme). |
| `CORS_ALLOWED_ORIGINS` | Comma-separated origins with `https://`. |
| `DJANGO_SUPERUSER_*` | Auto superuser on `setup.sh --with-db`. |
| `MRJ_MCP_USER_ID`, `MRJ_MCP_USERNAME` | Local MCP staff user selector. `MRJ_MCP_USER_ID` takes precedence. |
| `DOCUMENT_STORAGE_BACKEND` | `local` for development/tests or `r2` for Cloudflare R2. |
| `DOCUMENT_MAX_UPLOAD_BYTES` | Server-enforced document upload limit; default 50 MB. |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` | Required when document storage uses R2. |
| `R2_PRESIGN_UPLOAD_EXPIRY`, `R2_PRESIGN_DOWNLOAD_EXPIRY`, `R2_PRESIGN_DELETE_SAFETY_SKEW` | Signed URL TTLs and the deletion replay-safety margin. |

For browser uploads, the R2 bucket CORS policy must allow `PUT` from the SPA origin and the signed request headers `Content-Type`, `x-amz-checksum-sha256`, and `If-None-Match`. R2 upload intents bind the exact file length and checksum, so clients must use the returned method and headers unchanged.

## Testing

```bash
source .venv/bin/activate
pip install -r requirements-dev.txt
python manage.py test api --settings=mrj.settings.test
# or: pytest api/

cd frontend
npm test -- --run
npm run typecheck
npm run lint
npm run build   # includes the production entry-bundle budget check
```

The fast local checkpoint uses in-memory SQLite. CI also provisions PostgreSQL and runs the production-database contract/concurrency modules with `mrj.settings.test_postgres`.

## Deploying to Railway

1. Create a Railway project with Postgres and Redis plugins.
2. Set environment variables. Split Redis DBs:
   ```
   CELERY_BROKER_URL=${{ Redis.REDIS_URL }}/0
   CELERY_RESULT_BACKEND=${{ Redis.REDIS_URL }}/0
   REDIS_URL=${{ Redis.REDIS_URL }}/1
   ALLOWED_HOSTS=your-app.up.railway.app
   CORS_ALLOWED_ORIGINS=https://your-app.up.railway.app
   ```
3. Connect the repo. `railway.json` pins the Railpack builder.
4. Duplicate the service for background work:
   - **Worker:** `SERVICE_TYPE=worker`
   - **Beat:** `SERVICE_TYPE=beat` (exactly one instance)
