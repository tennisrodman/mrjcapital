#!/bin/bash
set -euo pipefail

for cmd in python npm tmux; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "$cmd is required but not found" >&2
    [ "$cmd" = "tmux" ] && echo "Install: brew install tmux"
    exit 1
  fi
done

[ ! -d ".venv" ] && { echo "Run ./setup.sh first" >&2; exit 1; }
[ ! -d "frontend/node_modules" ] && { echo "Run ./setup.sh first" >&2; exit 1; }

VENV_DIR=".venv"
[ -d "venv" ] && VENV_DIR="venv"

tmux kill-session -t mrj 2>/dev/null || true
tmux new-session -d -s mrj
tmux split-window -h -t mrj
tmux split-window -v -t mrj:0.1

# Left: Vite
tmux send-keys -t mrj:0.0 "cd frontend && export BROWSER=none && npm run dev" C-m
# Top-right: Django
tmux send-keys -t mrj:0.1 "source ${VENV_DIR}/bin/activate && export DJANGO_SETTINGS_MODULE=mrj.settings.development && python manage.py runserver 0.0.0.0:8000" C-m
# Bottom-right: Celery
tmux send-keys -t mrj:0.2 "source ${VENV_DIR}/bin/activate && export DJANGO_SETTINGS_MODULE=mrj.settings.development && celery -A mrj worker -l info" C-m

tmux rename-window -t mrj:0 'Development'

tmux set -g status-left "MRJ Capital Dev | #[fg=green]Vite: http://localhost:3000 #[fg=yellow]| #[fg=blue]Django: http://localhost:8000 #[fg=magenta]| Celery"
tmux set -g status-left-length 120
tmux set -g status-right "#[fg=red]Ctrl+B D detach | Ctrl+B X exit"
tmux set -g status-right-length 100

echo "Opening tmux session: Left=Vite | TopRight=Django | BottomRight=Celery"
echo "Detach: Ctrl+B, D   Exit: Ctrl+B, X"
echo ""

tmux attach-session -t mrj
