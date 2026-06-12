#!/bin/bash
set -euo pipefail

echo "Setting up mrj..."

WITH_DB=false
for arg in "$@"; do
  case $arg in
    --with-db) WITH_DB=true; shift ;;
  esac
done

for cmd in python npm; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "$cmd is required but not found" >&2; exit 1
  fi
done

if [ "$WITH_DB" = true ]; then
  if ! command -v psql >/dev/null 2>&1; then
    echo "psql is required for --with-db" >&2; exit 1
  fi
  [ -f .env ] && source .env
  DB_NAME=${DB_NAME:-mrj}
  DB_USER=${DB_USER:-postgres}
  DB_HOST=${DB_HOST:-localhost}
  DB_PORT=${DB_PORT:-5432}
  if ! psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -lqt | cut -d\| -f1 | grep -qw "$DB_NAME"; then
    createdb -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" "$DB_NAME"
  fi
fi

[ ! -d ".venv" ] && python -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

if [ "$WITH_DB" = true ]; then
  python manage.py migrate
  if [ -z "${DJANGO_SUPERUSER_PASSWORD:-}" ]; then
    echo "Skipping superuser creation (set DJANGO_SUPERUSER_PASSWORD to create one automatically)"
  else
    python manage.py createsuperuser --noinput \
      --username "${DJANGO_SUPERUSER_USERNAME:-admin}" \
      --email "${DJANGO_SUPERUSER_EMAIL:-admin@example.com}"
  fi
fi

cd frontend && npm install && cd ..

echo "Setup complete. Start dev with: ./dev.sh"
