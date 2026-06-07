#!/usr/bin/env bash
# Deploy ParkinsonDiet to AWS App Runner via ECR.
# Run from anywhere — finds the repo root automatically.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Load REGION and ACCOUNT from .env
REGION=$(grep -E '^AWS_REGION=' "$REPO_ROOT/.env" | head -1 | cut -d= -f2- | tr -d '"'"'" | xargs)
ACCOUNT=$(grep -E '^AWS_ACCOUNT=' "$REPO_ROOT/.env" | head -1 | cut -d= -f2- | tr -d '"'"'" | xargs)

if [ -z "$REGION" ] || [ -z "$ACCOUNT" ]; then
  echo "ERROR: AWS_REGION and AWS_ACCOUNT must be set in .env" >&2
  exit 1
fi

APP="parkinsondiet"
ECR_REPO="${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com/${APP}"
ROLE_NAME="${APP}-apprunner-ecr-role"

# ── helpers ────────────────────────────────────────────────────────────────────
load_env() {
  grep -E "^${1}=" "$REPO_ROOT/.env" | head -1 | cut -d= -f2- | sed 's/^"//;s/"$//;s/^'"'"'//;s/'"'"'$//'
}

# ── 1. ECR login ───────────────────────────────────────────────────────────────
echo "==> Logging into ECR..."
aws ecr get-login-password --region "$REGION" | \
  docker login --username AWS --password-stdin "${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com"

# ── 2. ECR repo ────────────────────────────────────────────────────────────────
echo "==> Ensuring ECR repository..."
aws ecr describe-repositories --repository-names "$APP" --region "$REGION" \
  >/dev/null 2>&1 || \
  aws ecr create-repository --repository-name "$APP" --region "$REGION" \
    --image-scanning-configuration scanOnPush=true >/dev/null

# ── 3. Build & push ────────────────────────────────────────────────────────────
echo "==> Building Docker image..."
docker build --platform linux/amd64 -t "${APP}:latest" "$REPO_ROOT"

echo "==> Pushing to ECR..."
docker tag "${APP}:latest" "${ECR_REPO}:latest"
docker push "${ECR_REPO}:latest"

# ── 4. IAM role ────────────────────────────────────────────────────────────────
echo "==> Ensuring IAM role for App Runner ECR access..."
if ! aws iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
  aws iam create-role --role-name "$ROLE_NAME" \
    --assume-role-policy-document '{
      "Version":"2012-10-17",
      "Statement":[{
        "Effect":"Allow",
        "Principal":{"Service":"build.apprunner.amazonaws.com"},
        "Action":"sts:AssumeRole"
      }]
    }' >/dev/null
  aws iam attach-role-policy --role-name "$ROLE_NAME" \
    --policy-arn "arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess"
  echo "Waiting for IAM role to propagate..."
  sleep 12
fi
ROLE_ARN="arn:aws:iam::${ACCOUNT}:role/${ROLE_NAME}"

# ── 5. Build env-vars JSON (uses Python for safe quoting) ──────────────────────
ENV_JSON=$(python3 - <<PYEOF
import json, subprocess, re

def load(key):
    with open("$REPO_ROOT/.env") as f:
        for line in f:
            m = re.match(rf'^{key}=(.+)', line.strip())
            if m:
                v = m.group(1).strip().strip('"').strip("'")
                return v
    return ""

print(json.dumps({
    "COOKIE_SECURE":      "1",
    "OPENROUTER_API_KEY": load("OPENROUTER_API_KEY"),
    "MODEL":              load("MODEL"),
    "OWNER_NAME":         load("OWNER_NAME"),
    "ADMIN_PASSWORD":     load("ADMIN_PASSWORD"),
    "PUSHOVER_USER":      load("PUSHOVER_USER"),
    "PUSHOVER_TOKEN":     load("PUSHOVER_TOKEN"),
    "SUPABASE_URL":       load("SUPABASE_URL"),
    "SUPABASE_KEY":       load("SUPABASE_KEY"),
    "SESSION_SECRET":     load("SESSION_SECRET"),
}))
PYEOF
)

SRC_CONFIG=$(python3 -c "
import json
env = $ENV_JSON
print(json.dumps({
  'ImageRepository': {
    'ImageIdentifier': '${ECR_REPO}:latest',
    'ImageConfiguration': {
      'Port': '3000',
      'RuntimeEnvironmentVariables': env
    },
    'ImageRepositoryType': 'ECR'
  },
  'AutoDeploymentsEnabled': False,
  'AuthenticationConfiguration': {
    'AccessRoleArn': '${ROLE_ARN}'
  }
}))
")

# ── 6. Create or update App Runner service ─────────────────────────────────────
EXISTING=$(aws apprunner list-services --region "$REGION" \
  --query "ServiceSummaryList[?ServiceName=='${APP}'].ServiceArn" \
  --output text 2>/dev/null || true)

if [ -n "$EXISTING" ] && [ "$EXISTING" != "None" ]; then
  echo "==> Updating existing App Runner service..."
  aws apprunner update-service --region "$REGION" \
    --service-arn "$EXISTING" \
    --source-configuration "$SRC_CONFIG" >/dev/null
  SERVICE_URL=$(aws apprunner describe-service --region "$REGION" \
    --service-arn "$EXISTING" \
    --query "Service.ServiceUrl" --output text)
else
  echo "==> Creating App Runner service..."
  RESULT=$(aws apprunner create-service --region "$REGION" \
    --service-name "$APP" \
    --source-configuration "$SRC_CONFIG" \
    --instance-configuration '{"Cpu":"1 vCPU","Memory":"2 GB"}' \
    --health-check-configuration '{"Protocol":"HTTP","Path":"/","Interval":10,"Timeout":5,"HealthyThreshold":1,"UnhealthyThreshold":5}')
  SERVICE_URL=$(echo "$RESULT" | python3 -c "import json,sys; print(json.load(sys.stdin)['Service']['ServiceUrl'])")
fi

echo ""
echo "================================================================"
echo "  Deployment triggered!"
echo "  URL:   https://${SERVICE_URL}"
echo "  Admin: https://${SERVICE_URL}/admin"
echo ""
echo "  Status: aws apprunner list-services --region ${REGION}"
echo "  Logs:   aws apprunner list-operations --service-arn \$ARN --region ${REGION}"
echo "================================================================"
