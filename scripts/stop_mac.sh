#!/usr/bin/env bash
set -euo pipefail
CONTAINER="parkinsondiet"
docker rm -f "$CONTAINER" 2>/dev/null && echo "Stopped $CONTAINER" || echo "Container not running."
