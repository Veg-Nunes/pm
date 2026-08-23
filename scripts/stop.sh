#!/usr/bin/env bash
# Stop and remove the Kanban PM app container. For Mac and Linux.
set -euo pipefail

docker rm -f pm-app
