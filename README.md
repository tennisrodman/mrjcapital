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
