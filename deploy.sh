#!/usr/bin/env bash
# AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-09-30.
# Scope: Manual Cloud Run deployment commands (one-time setup, migrations, services, seed).
# Author review: Done.
#
# Usage (from the repository root, after `gcloud builds submit --config cloudbuild.yaml`):
#   ./deploy.sh setup   # one-time: Cloud SQL, databases, secrets, IAM, networking
#   ./deploy.sh         # run migrations, then deploy user, supplier, and frontend services
#   ./deploy.sh seed    # run the supplier seed job (safe to repeat)
#
# Override any setting below with an environment variable, e.g. TAG=<build id> ./deploy.sh
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null)}"
REGION="${REGION:-asia-southeast1}"
REPOSITORY="${REPOSITORY:-foc}"
TAG="${TAG:-latest}"
SQL_INSTANCE="${SQL_INSTANCE:-foc-db}"
SQL_TIER="${SQL_TIER:-db-f1-micro}"
NETWORK="${NETWORK:-default}"
SUBNET="${SUBNET:-default}"

REGISTRY="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}"
SQL_CONNECTION="${PROJECT_ID}:${REGION}:${SQL_INSTANCE}"

run() { gcloud --project "$PROJECT_ID" "$@"; }

secret_exists() { run secrets describe "$1" >/dev/null 2>&1; }

sql_private_ip() {
  run sql instances describe "$SQL_INSTANCE" \
    --format 'value(ipAddresses.filter("type:PRIVATE").extract(ipAddress).flatten())'
}

# `socket` connects through Cloud Run's Cloud SQL connector (/cloudsql Unix socket).
# `private` connects to the instance's private IP, for callers with VPC egress.
database_url() {
  local mode="$1" user="$2" password="$3" database="$4"
  if [ "$mode" = private ]; then
    echo "postgres://${user}:${password}@$(sql_private_ip):5432/${database}"
  else
    echo "postgres://${user}:${password}@localhost/${database}?host=/cloudsql/${SQL_CONNECTION}"
  fi
}

create_database() {
  local mode="$1" user="$2" database="$3" secret="$4"
  if secret_exists "$secret"; then
    echo "Secret $secret exists; skipping database $database."
    return
  fi
  local password
  password="$(openssl rand -hex 24)"
  run sql databases create "$database" --instance "$SQL_INSTANCE"
  run sql users create "$user" --instance "$SQL_INSTANCE" --password "$password"
  database_url "$mode" "$user" "$password" "$database" |
    run secrets create "$secret" --replication-policy automatic --data-file -
}

setup() {
  # Private Service Access, so Cloud SQL can have a private IP on the VPC.
  run services enable servicenetworking.googleapis.com
  if ! run compute addresses describe google-managed-services-default --global >/dev/null 2>&1; then
    run compute addresses create google-managed-services-default --global \
      --purpose VPC_PEERING --prefix-length 16 --network "$NETWORK"
  fi
  run services vpc-peerings connect --service servicenetworking.googleapis.com \
    --ranges google-managed-services-default --network "$NETWORK"

  if ! run sql instances describe "$SQL_INSTANCE" >/dev/null 2>&1; then
    run sql instances create "$SQL_INSTANCE" --network "$NETWORK" \
      --database-version POSTGRES_17 --edition enterprise --tier "$SQL_TIER" --region "$REGION"
  elif [ -z "$(sql_private_ip)" ]; then
    run sql instances patch "$SQL_INSTANCE" --network "$NETWORK" --quiet
  fi

  # supplier-service uses VPC egress (to reach user-service), which also carries its
  # database traffic, so it connects over the private IP instead of the connector.
  create_database private supplier_service suppliers supplier-database-url
  create_database socket user_service users user-database-url

  if ! secret_exists jwt-secret; then
    openssl rand -hex 32 | tr -d '\n' |
      run secrets create jwt-secret --replication-policy automatic --data-file -
  fi

  # Default Cloud Run identity: allow reading secrets and connecting to Cloud SQL.
  local project_number service_account
  project_number="$(run projects describe "$PROJECT_ID" --format 'value(projectNumber)')"
  service_account="${project_number}-compute@developer.gserviceaccount.com"
  for role in roles/secretmanager.secretAccessor roles/cloudsql.client; do
    run projects add-iam-policy-binding "$PROJECT_ID" \
      --member "serviceAccount:${service_account}" --role "$role" --condition None >/dev/null
  done

  # Lets services with VPC egress reach internal-ingress *.run.app URLs.
  run compute networks subnets update "$SUBNET" --region "$REGION" --enable-private-ip-google-access

  echo "Setup complete. To enable first-administrator setup, create a bootstrap-secret"
  echo "(at least 32 bytes) and re-run ./deploy.sh; delete it after the admin exists."
}

# Flags for reaching the database: the connector (socket) or the VPC (private IP).
SOCKET_DB_FLAGS=(--set-cloudsql-instances "$SQL_CONNECTION")
PRIVATE_DB_FLAGS=(--set-cloudsql-instances "" --network "$NETWORK" --subnet "$SUBNET" --vpc-egress private-ranges-only)

run_job() {
  local name="$1" image="$2" secret="$3"; shift 3
  run run jobs deploy "$name" --region "$REGION" --image "$image" \
    --set-secrets "DATABASE_URL=${secret}:latest" \
    --max-retries 0 --execute-now --wait "$@"
}

service_url() {
  run run services describe "$1" --region "$REGION" --format 'value(status.url)'
}

deploy() {
  run_job supplier-migrate "${REGISTRY}/supplier-service-tooling:${TAG}" supplier-database-url \
    "${PRIVATE_DB_FLAGS[@]}" --command npm --args run,db:migrate
  run_job user-migrate "${REGISTRY}/user-service:${TAG}" user-database-url \
    "${SOCKET_DB_FLAGS[@]}" --command npm --args run,db:migrate

  local user_secrets="DATABASE_URL=user-database-url:latest,JWT_SECRET=jwt-secret:latest"
  if secret_exists bootstrap-secret; then
    user_secrets="${user_secrets},BOOTSTRAP_SECRET=bootstrap-secret:latest"
  fi

  # Backends accept only internal traffic; callers reach them through Direct VPC egress.
  run run deploy user-service --region "$REGION" --image "${REGISTRY}/user-service:${TAG}" \
    --port 3333 --ingress internal --allow-unauthenticated \
    --add-cloudsql-instances "$SQL_CONNECTION" \
    --set-env-vars "JWT_ACCESS_TOKEN_TTL=900" \
    --set-secrets "$user_secrets"
  local user_url
  user_url="$(service_url user-service)"

  run run deploy supplier-service --region "$REGION" --image "${REGISTRY}/supplier-service:${TAG}" \
    --port 3000 --ingress internal --allow-unauthenticated \
    --clear-cloudsql-instances \
    --network "$NETWORK" --subnet "$SUBNET" --vpc-egress all-traffic \
    --set-env-vars "USER_SERVICE_BASE_URL=${user_url}" \
    --set-secrets "DATABASE_URL=supplier-database-url:latest"
  local supplier_url
  supplier_url="$(service_url supplier-service)"

  run run deploy frontend-service --region "$REGION" --image "${REGISTRY}/frontend-service:${TAG}" \
    --port 3000 --ingress all --allow-unauthenticated \
    --network "$NETWORK" --subnet "$SUBNET" --vpc-egress all-traffic \
    --set-env-vars "NUXT_USER_SERVICE_BASE_URL=${user_url},NUXT_SUPPLIER_SERVICE_BASE_URL=${supplier_url}"

  echo "Frontend: $(service_url frontend-service)"
}

seed() {
  run_job supplier-seed "${REGISTRY}/supplier-service-tooling:${TAG}" supplier-database-url \
    "${PRIVATE_DB_FLAGS[@]}" --command npm --args run,db:seed
}

case "${1:-deploy}" in
  setup) setup ;;
  deploy) deploy ;;
  seed) seed ;;
  *) echo "Usage: $0 [setup|deploy|seed]" >&2; exit 1 ;;
esac
