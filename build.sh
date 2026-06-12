#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Building frontend..."
(cd "$ROOT_DIR/frontend" && npm ci)
(cd "$ROOT_DIR/frontend" && npm run build)

echo "Staging build into Django..."
rm -rf "$ROOT_DIR/build"
mkdir -p "$ROOT_DIR/build/static"
cp "$ROOT_DIR/frontend/build/index.html" "$ROOT_DIR/build/index.html"
find "$ROOT_DIR/frontend/build" -mindepth 1 -maxdepth 1 ! -name index.html \
  -exec cp -R {} "$ROOT_DIR/build/static/" \;

echo "Setting up Django..."
cd "$ROOT_DIR"

export DJANGO_SETTINGS_MODULE=mrj.settings.production
[ -z "${DJANGO_SECRET_KEY:-}" ] && { echo "DJANGO_SECRET_KEY not set" >&2; exit 1; }

python3 manage.py collectstatic --noinput -v 1
echo "Build complete."
