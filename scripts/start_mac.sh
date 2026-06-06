#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
IMAGE="parkinsondiet"
CONTAINER="parkinsondiet"

echo "==> Stopping any running container..."
docker rm -f "$CONTAINER" 2>/dev/null || true

echo "==> Building image..."
docker build -t "$IMAGE" "$REPO_ROOT"

echo "==> Starting container..."
docker run -d \
  --name "$CONTAINER" \
  -p 3000:3000 \
  --env-file "$REPO_ROOT/.env" \
  "$IMAGE"

echo ""
echo "ParkinsonDiet running at http://localhost:3000"
echo "Admin at http://localhost:3000/admin"
echo ""
echo "Logs: docker logs -f $CONTAINER"
echo "Stop: bash scripts/stop_mac.sh"
