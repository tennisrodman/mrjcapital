#!/bin/bash
set -euo pipefail

SERVICE_TYPE=${SERVICE_TYPE:-web}
echo "Starting mrj (service: $SERVICE_TYPE)..."

export DJANGO_SETTINGS_MODULE=mrj.settings.production

[ -z "${DJANGO_SECRET_KEY:-}" ] && { echo "DJANGO_SECRET_KEY is required" >&2; exit 1; }
[ -z "${DATABASE_URL:-}${DB_NAME:-}" ] && { echo "DATABASE_URL or DB_NAME is required" >&2; exit 1; }

# Celery services must not silently fall back to redis://localhost in production.
if [ "$SERVICE_TYPE" = "worker" ] || [ "$SERVICE_TYPE" = "beat" ]; then
  [ -z "${CELERY_BROKER_URL:-}" ] && { echo "CELERY_BROKER_URL is required for $SERVICE_TYPE" >&2; exit 1; }
fi

python3 manage.py migrate

if [ "${SEED_DEMO_DATA:-false}" = "true" ]; then
  python3 manage.py seed_demo_data
fi

if [ "$SERVICE_TYPE" = "web" ]; then
  gunicorn \
    --workers "${GUNICORN_WORKERS:-3}" \
    --timeout "${GUNICORN_TIMEOUT:-60}" \
    --max-requests 1000 \
    --max-requests-jitter 200 \
    --access-logfile - \
    --error-logfile - \
    --bind "0.0.0.0:${PORT:-8000}" \
    mrj.wsgi:application
elif [ "$SERVICE_TYPE" = "worker" ]; then
  celery -A mrj worker -l info --concurrency=2 --prefetch-multiplier=1 --max-tasks-per-child=100
elif [ "$SERVICE_TYPE" = "beat" ]; then
  celery -A mrj beat -l info
else
  echo "SERVICE_TYPE must be 'web', 'worker', or 'beat'" >&2; exit 1
fi
