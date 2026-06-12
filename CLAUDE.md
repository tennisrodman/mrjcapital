# CLAUDE.md

Operational notes for MRJ Capital LLC. See `README.md` for the user-facing overview.

## Purpose

Django + React + Celery scaffold for MRJ Capital. Add deal workflow and document features in `api/` and `frontend/src/pages/`.

## Architecture in one screen

- Django (`mrj/`) serves `/api/` and `/admin/`.
- Production SPA catchall: `^(?!admin\b|api\b).*$` → `index.html`.
- WhiteNoise serves Vite assets from `build/` after `build.sh` + `collectstatic`.
- Celery worker/beat use the same image via `SERVICE_TYPE` in `start.sh`.

## Settings split

- `mrj/settings/base.py` — `_database_config()`, Celery, Beat schedule, WhiteNoise
- `mrj/settings/development.py` — local dev (`AllowAny` API permissions)
- `mrj/settings/production.py` — env-driven hosts/CORS, Redis cache, JWT rotation + blacklist
- `mrj/settings/test.py` — in-memory SQLite for API tests

## Deploy gotchas

- No venv at runtime — use `python3` in `build.sh` / `start.sh` (Railpack).
- `$PORT` from Railway, not hardcoded 8000.
- `DATABASE_URL` parsed in settings, not in shell scripts.
- `ALLOWED_HOSTS` is hostname-only; `CORS_ALLOWED_ORIGINS` includes scheme.

## Conventions

- Shell scripts use `set -euo pipefail`.
- Frontend build: `frontend/build/` → staged to `build/` by `build.sh`.
- JWT token keys: `mrj_access_token`, `mrj_refresh_token` in `frontend/src/config/api.ts`.
