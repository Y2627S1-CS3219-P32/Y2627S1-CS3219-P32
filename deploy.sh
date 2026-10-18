#!/usr/bin/env bash
# AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-09-30.
# Scope: Manual Cloud Run deployment commands (one-time setup, migrations, services, seed).
# Author review: Done.
# Claude Code (Opus 5.5), 2026-10-18. Scope: order, notification, credit and saga services:
# databases, topics, push subscriptions, Cloud Scheduler jobs and frontend wiring.
# Author review: Pending.
#
# Usage (from the repository root, after `gcloud builds submit --config cloudbuild.yaml`):
#   ./deploy.sh setup   # one-time: Cloud SQL, databases, secrets, IAM, networking
#   ./deploy.sh         # create anything new, run migrations, then deploy every service
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
PUBSUB_TOPIC="${PUBSUB_TOPIC:-user-events}"
PUBSUB_SUBSCRIPTION="${PUBSUB_SUBSCRIPTION:-user-events-worker}"
PUBSUB_PUSH_SERVICE_ACCOUNT="${PUBSUB_PUSH_SERVICE_ACCOUNT:-user-event-push@${PROJECT_ID}.iam.gserviceaccount.com}"
# Identity Cloud Scheduler uses to call the services' internal routes.
SCHEDULER_SERVICE_ACCOUNT="${SCHEDULER_SERVICE_ACCOUNT:-foc-scheduler@${PROJECT_ID}.iam.gserviceaccount.com}"
INITIAL_CREDITS="${INITIAL_CREDITS:-1000}"
RESERVE_TIMEOUT_SECONDS="${RESERVE_TIMEOUT_SECONDS:-60}"

REGISTRY="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}"
SQL_CONNECTION="${PROJECT_ID}:${REGION}:${SQL_INSTANCE}"

run() { gcloud --project "$PROJECT_ID" "$@"; }

secret_exists() { run secrets describe "$1" >/dev/null 2>&1; }

ensure_pubsub() {
  run services enable pubsub.googleapis.com
  run beta services identity create --service pubsub.googleapis.com >/dev/null
  if ! run pubsub topics describe "$PUBSUB_TOPIC" >/dev/null 2>&1; then
    run pubsub topics create "$PUBSUB_TOPIC"
  fi

  local push_service_account_name
  case "$PUBSUB_PUSH_SERVICE_ACCOUNT" in
    *@${PROJECT_ID}.iam.gserviceaccount.com) ;;
    *)
      echo "PUBSUB_PUSH_SERVICE_ACCOUNT must belong to project $PROJECT_ID." >&2
      return 1
      ;;
  esac
  push_service_account_name="${PUBSUB_PUSH_SERVICE_ACCOUNT%@${PROJECT_ID}.iam.gserviceaccount.com}"
  if ! run iam service-accounts describe "$PUBSUB_PUSH_SERVICE_ACCOUNT" >/dev/null 2>&1; then
    run iam service-accounts create "$push_service_account_name" \
      --display-name "Pub/Sub push invoker for user event worker"
  fi

  local project_number service_account
  project_number="$(run projects describe "$PROJECT_ID" --format 'value(projectNumber)')"
  service_account="${project_number}-compute@developer.gserviceaccount.com"
  run projects add-iam-policy-binding "$PROJECT_ID" \
    --member "serviceAccount:${service_account}" --role roles/pubsub.publisher \
    --condition None >/dev/null
  run iam service-accounts add-iam-policy-binding "$PUBSUB_PUSH_SERVICE_ACCOUNT" \
    --member "serviceAccount:service-${project_number}@gcp-sa-pubsub.iam.gserviceaccount.com" \
    --role roles/iam.serviceAccountTokenCreator --condition None >/dev/null
}

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
  ensure_pubsub

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

project_number() {
  run projects describe "$PROJECT_ID" --format 'value(projectNumber)'
}

# Cloud Run's deterministic URL, known before the first deploy (used as token audience).
run_url() {
  echo "https://${1}-$(project_number).${REGION}.run.app"
}

ensure_topic() {
  run pubsub topics describe "$1" >/dev/null 2>&1 || run pubsub topics create "$1"
}

# A push subscription authenticated with the push identity's OIDC token. Extra arguments
# (ordering, filter) apply on creation only: Pub/Sub cannot change a filter later.
ensure_push_subscription() {
  local name="$1" topic="$2" endpoint="$3" audience="$4"; shift 4
  if run pubsub subscriptions describe "$name" >/dev/null 2>&1; then
    run pubsub subscriptions update "$name" --push-endpoint "$endpoint" \
      --push-auth-service-account "$PUBSUB_PUSH_SERVICE_ACCOUNT" --push-auth-token-audience "$audience"
  else
    run pubsub subscriptions create "$name" --topic "$topic" --push-endpoint "$endpoint" \
      --push-auth-service-account "$PUBSUB_PUSH_SERVICE_ACCOUNT" --push-auth-token-audience "$audience" \
      --ack-deadline 30 --min-retry-delay 1s --max-retry-delay 60s "$@"
  fi
}

# An every-minute POST to an internal route, authenticated with the scheduler's OIDC token.
ensure_scheduler_job() {
  local name="$1" uri="$2" audience="$3" verb=create
  run scheduler jobs describe "$name" --location "$REGION" >/dev/null 2>&1 && verb=update
  run scheduler jobs "$verb" http "$name" --location "$REGION" --schedule "* * * * *" \
    --uri "$uri" --http-method POST \
    --oidc-service-account-email "$SCHEDULER_SERVICE_ACCOUNT" --oidc-token-audience "$audience" >/dev/null
}

# Everything the order, notification, credit and saga services need. Safe to repeat.
ensure_service_resources() {
  create_database socket order_service orders order-database-url
  create_database socket notification_service notifications notification-database-url
  create_database socket credit_service credits credit-database-url
  create_database socket saga_orchestrator sagas saga-database-url
  if ! secret_exists notification-ticket-secret; then
    openssl rand -hex 32 | tr -d '\n' |
      run secrets create notification-ticket-secret --replication-policy automatic --data-file -
  fi

  for topic in order-events order-commands supplier-events credit-commands credit-events; do
    ensure_topic "$topic"
  done

  run services enable cloudscheduler.googleapis.com
  if ! run iam service-accounts describe "$SCHEDULER_SERVICE_ACCOUNT" >/dev/null 2>&1; then
    run iam service-accounts create "${SCHEDULER_SERVICE_ACCOUNT%@*}" --display-name "Cloud Scheduler invoker"
  fi
  local number
  number="$(project_number)"
  run iam service-accounts add-iam-policy-binding "$SCHEDULER_SERVICE_ACCOUNT" \
    --member "serviceAccount:service-${number}@gcp-sa-cloudscheduler.iam.gserviceaccount.com" \
    --role roles/iam.serviceAccountTokenCreator --condition None >/dev/null
  # notification-service creates and deletes a subscription per instance.
  run projects add-iam-policy-binding "$PROJECT_ID" \
    --member "serviceAccount:${number}-compute@developer.gserviceaccount.com" \
    --role roles/pubsub.editor --condition None >/dev/null
}

deploy_event_services() {
  ensure_service_resources
  local invokers="${PUBSUB_PUSH_SERVICE_ACCOUNT},${SCHEDULER_SERVICE_ACCOUNT}"

  run_job order-migrate "${REGISTRY}/order-service-tooling:${TAG}" order-database-url \
    "${SOCKET_DB_FLAGS[@]}" --command npm --args run,db:migrate
  run_job notification-migrate "${REGISTRY}/notification-service-tooling:${TAG}" notification-database-url \
    "${SOCKET_DB_FLAGS[@]}" --command npm --args run,db:migrate
  run_job credit-migrate "${REGISTRY}/credit-service:${TAG}" credit-database-url \
    "${SOCKET_DB_FLAGS[@]}" --command npm --args run,db:migrate
  run_job saga-migrate "${REGISTRY}/saga-orchestrator-tooling:${TAG}" saga-database-url \
    "${SOCKET_DB_FLAGS[@]}" --command npm --args run,db:migrate

  # Internal ingress: reached by the frontend over the VPC, and by Pub/Sub push and Cloud
  # Scheduler (same project). Internal routes check the caller's Google OIDC token.
  # (`^@^` makes @ the separator, since the invoker list contains commas.)
  local order_url
  order_url="$(run_url order-service)"
  run run deploy order-service --region "$REGION" --image "${REGISTRY}/order-service:${TAG}" \
    --port 3000 --ingress internal --allow-unauthenticated \
    --add-cloudsql-instances "$SQL_CONNECTION" \
    --set-env-vars "^@^PUBSUB_PROJECT_ID=${PROJECT_ID}@INTERNAL_AUDIENCE=${order_url}@INTERNAL_INVOKER_EMAILS=${invokers}" \
    --set-secrets "DATABASE_URL=order-database-url:latest,JWT_SECRET=jwt-secret:latest"
  ensure_push_subscription order-service-user-events user-events "${order_url}/internal/pubsub/user-events" "$order_url" --enable-message-ordering
  ensure_push_subscription order-service-supplier-events supplier-events "${order_url}/internal/pubsub/supplier-events" "$order_url" --enable-message-ordering
  ensure_push_subscription order-service-order-commands order-commands "${order_url}/internal/pubsub/order-commands" "$order_url" --enable-message-ordering

  # credit-service creates its own push subscriptions (credit-provision).
  local credit_url credit_env
  credit_url="$(run_url credit-service)"
  credit_env="^@^PUBSUB_PROJECT_ID=${PROJECT_ID}@INTERNAL_AUDIENCE=${credit_url}@INTERNAL_INVOKER_EMAILS=${invokers}"
  credit_env="${credit_env}@PUBSUB_PUSH_SERVICE_ACCOUNT=${PUBSUB_PUSH_SERVICE_ACCOUNT}@PUBSUB_PUSH_BASE_URL=${credit_url}@INITIAL_CREDITS=${INITIAL_CREDITS}"
  run run deploy credit-service --region "$REGION" --image "${REGISTRY}/credit-service:${TAG}" \
    --port 3000 --ingress internal --allow-unauthenticated \
    --add-cloudsql-instances "$SQL_CONNECTION" \
    --set-env-vars "$credit_env" \
    --set-secrets "DATABASE_URL=credit-database-url:latest,JWT_SECRET=jwt-secret:latest"
  run_job credit-provision "${REGISTRY}/credit-service:${TAG}" credit-database-url \
    "${SOCKET_DB_FLAGS[@]}" --set-env-vars "$credit_env" --command npm --args run,pubsub:provision
  # The outbox publisher loops in the background: exactly one instance, CPU always on.
  run run deploy credit-publisher --region "$REGION" --image "${REGISTRY}/credit-service:${TAG}" \
    --command npm --args run,publisher \
    --port 3000 --ingress internal --no-allow-unauthenticated \
    --min-instances 1 --max-instances 1 --no-cpu-throttling \
    --add-cloudsql-instances "$SQL_CONNECTION" \
    --set-env-vars "$credit_env" \
    --set-secrets "DATABASE_URL=credit-database-url:latest,JWT_SECRET=jwt-secret:latest"

  local saga_url
  saga_url="$(run_url saga-orchestrator)"
  run run deploy saga-orchestrator --region "$REGION" --image "${REGISTRY}/saga-orchestrator:${TAG}" \
    --port 3000 --ingress internal --allow-unauthenticated \
    --add-cloudsql-instances "$SQL_CONNECTION" \
    --set-env-vars "^@^PUBSUB_PROJECT_ID=${PROJECT_ID}@INTERNAL_AUDIENCE=${saga_url}@INTERNAL_INVOKER_EMAILS=${invokers}@RESERVE_TIMEOUT_SECONDS=${RESERVE_TIMEOUT_SECONDS}" \
    --set-secrets "DATABASE_URL=saga-database-url:latest"
  ensure_push_subscription saga-orchestrator-order-events order-events "${saga_url}/internal/pubsub/order-events" "$saga_url" \
    --enable-message-ordering \
    --message-filter 'attributes.type = "order.created" OR attributes.type = "order.cancelled" OR attributes.type = "order.expired" OR attributes.type = "order.completed"'
  ensure_push_subscription saga-orchestrator-credit-events credit-events "${saga_url}/internal/pubsub/credit-events" "$saga_url" --enable-message-ordering

  # Browsers open WebSockets to it directly, so it is public; its pull subscriptions need
  # CPU between requests, and a WebSocket lasts at most the request timeout (60 minutes).
  # The frontend answers on both its deterministic and its hashed run.app URL.
  local origins
  origins="$(run_url frontend-service)"
  run run services describe frontend-service --region "$REGION" >/dev/null 2>&1 &&
    origins="${origins},$(service_url frontend-service)"
  run run deploy notification-service --region "$REGION" --image "${REGISTRY}/notification-service:${TAG}" \
    --port 3000 --ingress all --allow-unauthenticated \
    --min-instances 1 --no-cpu-throttling --timeout 3600 \
    --add-cloudsql-instances "$SQL_CONNECTION" \
    --set-env-vars "^@^PUBSUB_PROJECT_ID=${PROJECT_ID}@ALLOWED_ORIGINS=${origins}" \
    --set-secrets "DATABASE_URL=notification-database-url:latest,JWT_SECRET=jwt-secret:latest,NOTIFICATION_TICKET_SECRET=notification-ticket-secret:latest"

  ensure_scheduler_job order-expire-overdue "${order_url}/internal/orders/expire-overdue" "$order_url"
  ensure_scheduler_job order-outbox-publish "${order_url}/internal/outbox/publish" "$order_url"
  ensure_scheduler_job saga-abort-overdue "${saga_url}/internal/sagas/abort-overdue" "$saga_url"
  ensure_scheduler_job saga-outbox-publish "${saga_url}/internal/outbox/publish" "$saga_url"
}

deploy() {
  ensure_pubsub

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
    --set-env-vars "JWT_ACCESS_TOKEN_TTL=900,PUBSUB_PROJECT_ID=${PROJECT_ID},PUBSUB_TOPIC=${PUBSUB_TOPIC}" \
    --set-secrets "$user_secrets"
  local user_url
  user_url="$(service_url user-service)"

  run run deploy user-event-worker --region "$REGION" --image "${REGISTRY}/user-service:${TAG}" \
    --command npm --args run,worker \
    --port 3334 --no-allow-unauthenticated \
    --add-cloudsql-instances "$SQL_CONNECTION" \
    --set-env-vars "PUBSUB_PROJECT_ID=${PROJECT_ID},PUBSUB_TOPIC=${PUBSUB_TOPIC},PUBSUB_SUBSCRIPTION=${PUBSUB_SUBSCRIPTION}" \
    --set-secrets "DATABASE_URL=user-database-url:latest"
  local worker_url
  worker_url="$(service_url user-event-worker)"
  run run services add-iam-policy-binding user-event-worker --region "$REGION" \
    --member "serviceAccount:${PUBSUB_PUSH_SERVICE_ACCOUNT}" --role roles/run.invoker >/dev/null

  if run pubsub subscriptions describe "$PUBSUB_SUBSCRIPTION" >/dev/null 2>&1; then
    run pubsub subscriptions update "$PUBSUB_SUBSCRIPTION" \
      --push-endpoint "${worker_url}/pubsub/user-events" \
      --push-auth-service-account "$PUBSUB_PUSH_SERVICE_ACCOUNT" \
      --push-auth-token-audience "$worker_url"
  else
    run pubsub subscriptions create "$PUBSUB_SUBSCRIPTION" --topic "$PUBSUB_TOPIC" \
      --push-endpoint "${worker_url}/pubsub/user-events" \
      --push-auth-service-account "$PUBSUB_PUSH_SERVICE_ACCOUNT" \
      --push-auth-token-audience "$worker_url" \
      --enable-message-ordering
  fi

  run run deploy supplier-service --region "$REGION" --image "${REGISTRY}/supplier-service:${TAG}" \
    --port 3000 --ingress internal --allow-unauthenticated \
    --clear-cloudsql-instances \
    --network "$NETWORK" --subnet "$SUBNET" --vpc-egress all-traffic \
    --set-env-vars "USER_SERVICE_BASE_URL=${user_url}" \
    --set-secrets "DATABASE_URL=supplier-database-url:latest"
  local supplier_url
  supplier_url="$(service_url supplier-service)"

  deploy_event_services
  local notification_url
  notification_url="$(service_url notification-service)"

  run run deploy frontend-service --region "$REGION" --image "${REGISTRY}/frontend-service:${TAG}" \
    --port 3000 --ingress all --allow-unauthenticated \
    --network "$NETWORK" --subnet "$SUBNET" --vpc-egress all-traffic \
    --set-env-vars "NUXT_USER_SERVICE_BASE_URL=${user_url},NUXT_SUPPLIER_SERVICE_BASE_URL=${supplier_url},NUXT_ORDER_SERVICE_BASE_URL=$(service_url order-service),NUXT_CREDIT_SERVICE_BASE_URL=$(service_url credit-service),NUXT_NOTIFICATION_SERVICE_BASE_URL=${notification_url},NUXT_PUBLIC_NOTIFICATION_SERVICE_URL=${notification_url/https:/wss:}"

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
