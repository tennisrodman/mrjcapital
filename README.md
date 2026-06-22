# MRJ Capital

Full-stack Django + React application for MRJ Capital LLC. The scaffold includes JWT authentication, a React SPA shell, Celery background job plumbing, and Railway deployment configuration.

## Stack

- **Backend:** Django 6.0, Django REST Framework, SimpleJWT (access + refresh, blacklist on logout)
- **Frontend:** React 19 + Vite + TypeScript, Tailwind 4, shadcn-style components, TanStack Query, React Router 7
- **Data:** Postgres via `psycopg[binary]` 3.x
- **Async:** Celery + Redis (separate Redis DBs for broker vs. cache)
- **Serving in prod:** Gunicorn, WhiteNoise (SPA + static assets), Django admin
- **Deploy:** Railway with Railpack (`railpack.json` + `railway.json`)

## Layout

```
api/               Django app: auth endpoints + catchall 404
frontend/          Vite React SPA; built into ../build/ and served by Django in production
scripts/           Python utilities importable from Django management commands
mrj/               Django project: settings, urls, wsgi, celery
build.sh           Builds the frontend, stages it into build/, runs collectstatic
start.sh           Migrates + launches gunicorn (web), celery worker, or beat
setup.sh           One-shot local setup (pip + npm + optional DB create + superuser)
dev.sh             tmux-based dev loop: Django + Vite + Celery side by side
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for topology and auth details.

## Local setup

Requirements: Python 3.12+, Node 22+, Postgres, Redis, tmux (for `dev.sh`).

```bash
cp .env.example .env    # edit values
./setup.sh --with-db    # creates venv, installs deps, optionally creates DB + superuser
./dev.sh                # Django @ :8000, Vite @ :3000, Celery worker
```

`setup.sh --with-db` seeds a superuser when `DJANGO_SUPERUSER_USERNAME` / `DJANGO_SUPERUSER_EMAIL` / `DJANGO_SUPERUSER_PASSWORD` are set in `.env`.

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

## Testing

```bash
source .venv/bin/activate
pip install -r requirements-dev.txt
python manage.py test api --settings=mrj.settings.test
# or: pytest api/
```

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
