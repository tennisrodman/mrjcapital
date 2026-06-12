# Architecture

How MRJ Capital is built, deployed, and wired together. See [README.md](./README.md) for setup commands.

## Project structure

```
mrj/
├── api/                 # Django API app (auth, tasks, future domain models)
├── mrj/                 # Django project package
│   ├── settings/        # base.py, development.py, production.py, test.py
│   ├── urls.py
│   ├── celery.py
│   └── wsgi.py
├── scripts/             # Importable Python utilities
├── frontend/            # React 19 SPA (Vite, TypeScript)
├── manage.py
├── setup.sh / dev.sh / build.sh / start.sh
└── railpack.json / railway.json
```

## Development topology

`./dev.sh` spawns tmux session `mrj` with three processes:

1. **Vite** on :3000 — React SPA with hot-reload
2. **Django** on :8000 — API and admin
3. **Celery worker** — background jobs (requires Redis)

Vite proxies `/api` and `/admin` to Django.

Run Celery Beat manually when testing scheduled tasks:

```bash
source .venv/bin/activate
export DJANGO_SETTINGS_MODULE=mrj.settings.development
celery -A mrj beat -l info
```

## Production topology

| `SERVICE_TYPE` | Process |
|----------------|---------|
| `web` (default) | gunicorn on `$PORT` |
| `worker` | Celery worker |
| `beat` | Celery Beat (one instance only) |

Deploy uses Railway + Railpack. No Docker.

## Authentication

JWT via SimpleJWT for the SPA; Django session auth for `/admin/`.

1. `POST /api/auth/login/` → tokens stored in `localStorage` (`mrj_*` keys)
2. `apiRequest()` refreshes on `401 token_not_valid` and persists rotated refresh tokens
3. Logout sends the current refresh token to `POST /api/auth/logout/` via raw `fetch` (not `apiRequest`) so the correct token is blacklisted
4. `ProtectedRoute` guards client routes; production API uses `IsAuthenticated`

## Celery + Redis

| Redis DB | Purpose |
|----------|---------|
| `/0` | Celery broker + result backend |
| `/1` | Django cache (production) |

Beat schedule: `heartbeat` every 60s in `mrj/settings/base.py`.
