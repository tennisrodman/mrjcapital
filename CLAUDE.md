# CLAUDE.md

Operational notes for MRJ Capital LLC. See `README.md` for the user-facing overview.

## Purpose

Django + React + Celery deal workflow for MRJ Capital. Core paths cover intake, screening, quotes, closing, evidence, notes/activity, and pipeline/syndication transitions.

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
- Demo/Live data mode is controlled by the header/login toggle, defaults from `frontend/.env` `VITE_USE_MOCKS`, and uses `shared/demo_seed.json` for mock data.
- `shared/workflow_contracts.json` is the tested Live/Demo lifecycle and upload contract. Update both runtime tests when it changes.
- Put workflow invariants and atomic audit writes in `api/services/`; put shared authorization decisions in `api/policies.py`.
- Frontend routes and the Demo engine are lazy/dynamic. Do not reintroduce a static production import from `frontend/src/mocks/handlers.ts`.
- `frontend/npm run build` enforces a 450 KiB entry-chunk budget.
- Generic DRF collection loading belongs in `frontend/src/lib/api/pagination.ts`; do not add hidden page caps.
- JWT token keys: `mrj_access_token`, `mrj_refresh_token` in `frontend/src/config/authKeys.ts`.
