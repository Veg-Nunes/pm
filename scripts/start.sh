#!/usr/bin/env bash
# Build and start the Kanban PM app container. For Mac and Linux.
set -euo pipefail
cd "$(dirname "$0")/.."

mkdir -p backend/data

docker build -t pm-app .
docker rm -f pm-app >/dev/null 2>&1 || true
docker run -d --name pm-app -p 8000:8000 --env-file .env \
  -v "$(pwd)/backend/data:/app/backend/data" pm-app

echo "Kanban PM running at http://localhost:8000"
