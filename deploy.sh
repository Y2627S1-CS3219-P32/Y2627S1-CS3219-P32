#!/usr/bin/env bash
# AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-09-30.
# Scope: Manual Cloud Run deployment commands (one-time setup, migrations, services, seed).
# Author review: Done.
# Claude Code (Opus 5.5), 2026-10-18: supplier event worker and its push subscription;
# supplier-service verifies tokens with jwt-secret instead of calling user-service.
# Author review: Pending.
# Claude Code (Opus 5.5), 2026-10-18: supplier-events topic, supplier-service publishing, and a
# Cloud Scheduler job for the worker's outbox sweep. Author review: Pending.
# Claude Code (Opus 5.5), 2026-10-18. Scope: order, notification, credit and saga services:
# databases, topics, push subscriptions, Cloud Scheduler jobs and frontend wiring.
# Author review: Pending.
# ChatGPT (GPT-6), 2026-11-04: deploy mail-service and authenticated user-events subscription.
# Author review: Pending.
# ChatGPT (GPT-6), 2026-11-05: securely provision Mailjet Secret Manager versions.
# Author review: Pending.
# Claude Code (Opus 5.5), 2026-10-18: `github` command setting up Workload Identity Federation
# for the GitHub Actions deploy workflow. Author review: Pending.
#
# Usage (from the repository root, after `gcloud builds submit --config cloudbuild.yaml`):
#   ./deploy.sh setup   # one-time: Cloud SQL, databases, secrets, IAM, networking
#   ./deploy.sh         # create anything new, run migrations, then deploy every service
#   ./deploy.sh seed    # run the supplier seed job (safe to repeat)
#   ./deploy.sh github  # one-time: let .github/workflows/deploy.yml deploy from main
#   ./deploy.sh mailjet # securely add/update Mailjet secrets for mail-service
#   ./deploy.sh soclass # securely configure SoC LLaaS credentials for agent-service
#
# Override any setting below with an environment variable, e.g. TAG=<build id> ./deploy.sh
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null)}"
REGION="${REGION:-asia-southeast1}"
REPOSITORY="${REPOSITORY:-foc}"
TAG="${TAG:-latest}"
AGENT_REDIS_INSTANCE="${AGENT_REDIS_INSTANCE:-agent-redis}"
AGENT_ROUTER="${AGENT_ROUTER:-agent-router}"
AGENT_NAT="${AGENT_NAT:-agent-nat}"
SQL_INSTANCE="${SQL_INSTANCE:-foc-db}"
SQL_TIER="${SQL_TIER:-db-f1-micro}"
NETWORK="${NETWORK:-default}"
SUBNET="${SUBNET:-default}"
PUBSUB_TOPIC="${PUBSUB_TOPIC:-user-events}"
PASSWORD_RESET_TOPIC="${PASSWORD_RESET_TOPIC:-password-reset-requests}"
AGENT_TURN_TOPIC="${AGENT_TURN_TOPIC:-agent-turns}"
AGENT_TURN_SUBSCRIPTION="${AGENT_TURN_SUBSCRIPTION:-agent-orchestrator-turns}"
AGENT_APPROVAL_TOPIC="${AGENT_APPROVAL_TOPIC:-mandate-events}"
AGENT_APPROVAL_SUBSCRIPTION="${AGENT_APPROVAL_SUBSCRIPTION:-agent-chat-approvals}"
PUBSUB_SUBSCRIPTION="${PUBSUB_SUBSCRIPTION:-user-events-worker}"
SUPPLIER_USER_EVENTS_SUBSCRIPTION="${SUPPLIER_USER_EVENTS_SUBSCRIPTION:-supplier-service-user-events}"
MAIL_SERVICE_SUBSCRIPTION="${MAIL_SERVICE_SUBSCRIPTION:-mail-service-user-events}"
PASSWORD_RESET_SUBSCRIPTION="${PASSWORD_RESET_SUBSCRIPTION:-password-reset-mail}"
SUPPLIER_EVENTS_TOPIC="${SUPPLIER_EVENTS_TOPIC:-supplier-events}"
PUBSUB_PUSH_SERVICE_ACCOUNT="${PUBSUB_PUSH_SERVICE_ACCOUNT:-user-event-push@${PROJECT_ID}.iam.gserviceaccount.com}"
# Identity Cloud Scheduler uses to call the services' internal routes.
SCHEDULER_SERVICE_ACCOUNT="${SCHEDULER_SERVICE_ACCOUNT:-foc-scheduler@${PROJECT_ID}.iam.gserviceaccount.com}"
INITIAL_CREDITS="${INITIAL_CREDITS:-1000}"
RESERVE_TIMEOUT_SECONDS="${RESERVE_TIMEOUT_SECONDS:-60}"
# Custom domains the frontend is served on, allowed to open notification WebSockets.
# (Claude Code (Opus 5.5), 2026-10-18; author review: Pending.)
PUBLIC_ORIGINS="${PUBLIC_ORIGINS:-https://nusfoc.com}"

REGISTRY="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}"
SQL_CONNECTION="${PROJECT_ID}:${REGION}:${SQL_INSTANCE}"

run() { gcloud --project "$PROJECT_ID" "$@"; }

secret_exists() { run secrets describe "$1" >/dev/null 2>&1; }

require_agent_secrets() {
  local secret
  for secret in soclaas-api-key soclaas-model; do
    if ! secret_exists "$secret"; then
      echo "Missing $secret. Run './deploy.sh soclass' first." >&2
      return 1
    fi
  done
}

# Runtime logins are created after migrations define their restricted roles.
create_runtime_database_url() {
  local user="$1" database="$2" secret="$3"
  if ! secret_exists "$secret"; then
    database_url socket "$user" "$(openssl rand -hex 24)" "$database" |
      run secrets create "$secret" --replication-policy automatic --data-file -
  fi
}

ensure_agent_resources() {
  create_database socket conversation_owner conversations agent-chat-database-url
  create_database socket mandate_owner mandates mandate-database-url
  create_runtime_database_url agent_chat_login conversations agent-chat-runtime-database-url
  create_runtime_database_url agent_execution_login conversations agent-execution-runtime-database-url
  create_runtime_database_url mandate_login mandates mandate-runtime-database-url

  run services enable redis.googleapis.com
  if ! run redis instances describe "$AGENT_REDIS_INSTANCE" --region "$REGION" >/dev/null 2>&1; then
    run redis instances create "$AGENT_REDIS_INSTANCE" --region "$REGION" \
      --size 1 --network "$NETWORK" --connect-mode private-service-access \
      --enable-auth --transit-encryption-mode server-authentication
  fi
  if [ "$(run redis instances describe "$AGENT_REDIS_INSTANCE" --region "$REGION" --format 'value(transitEncryptionMode)')" != SERVER_AUTHENTICATION ]; then
    echo "Agent Redis must have TLS enabled." >&2
    return 1
  fi
  local host port password ca
  host="$(run redis instances describe "$AGENT_REDIS_INSTANCE" --region "$REGION" --format 'value(host)')"
  port="$(run redis instances describe "$AGENT_REDIS_INSTANCE" --region "$REGION" --format 'value(port)')"
  password="$(run redis instances get-auth-string "$AGENT_REDIS_INSTANCE" --region "$REGION" --format 'value(authString)')"
  ca="$(run redis instances describe "$AGENT_REDIS_INSTANCE" --region "$REGION" --flatten serverCaCerts --format 'value(serverCaCerts.cert)')"
  if [ -z "$password" ] || [ -z "$ca" ]; then
    echo "Agent Redis must provide AUTH credentials and a TLS CA certificate." >&2
    return 1
  fi
  store_secret agent-redis-url "rediss://:${password}@${host}:${port}"
  store_secret agent-redis-ca "$ca"

  # Orchestrator routes internal Cloud Run calls through the VPC; NAT lets it also reach the model API.
  if ! run compute routers describe "$AGENT_ROUTER" --region "$REGION" >/dev/null 2>&1; then
    run compute routers create "$AGENT_ROUTER" --region "$REGION" --network "$NETWORK"
  fi
  if ! run compute routers nats describe "$AGENT_NAT" --router "$AGENT_ROUTER" --region "$REGION" >/dev/null 2>&1; then
    run compute routers nats create "$AGENT_NAT" --router "$AGENT_ROUTER" --region "$REGION" \
      --nat-custom-subnet-ip-ranges "$SUBNET" --auto-allocate-nat-external-ips
  fi
}

ensure_pubsub() {
  run services enable pubsub.googleapis.com
  run beta services identity create --service pubsub.googleapis.com >/dev/null
  if ! run pubsub topics describe "$PUBSUB_TOPIC" >/dev/null 2>&1; then
    run pubsub topics create "$PUBSUB_TOPIC"
  fi
  if ! run pubsub topics describe "$SUPPLIER_EVENTS_TOPIC" >/dev/null 2>&1; then
    run pubsub topics create "$SUPPLIER_EVENTS_TOPIC"
  fi
  if ! run pubsub topics describe "$PASSWORD_RESET_TOPIC" >/dev/null 2>&1; then
    run pubsub topics create "$PASSWORD_RESET_TOPIC"
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

  # supplier-service and its event worker use VPC egress, which also carries their
  # database traffic, so they connect over the private IP instead of the connector.
  create_database private supplier_service suppliers supplier-database-url
  create_database socket user_service users user-database-url
  create_database socket chat_service chats chat-database-url

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

  ensure_agent_resources

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
  local invokers="${PUBSUB_PUSH_SERVICE_ACCOUNT},${SCHEDULER_SERVICE_ACCOUNT},$(project_number)-compute@developer.gserviceaccount.com"

  run_job order-migrate "${REGISTRY}/order-service-tooling:${TAG}" order-database-url \
    "${SOCKET_DB_FLAGS[@]}" --command npm --args run,db:migrate
  run_job chat-migrate "${REGISTRY}/chat-service-tooling:${TAG}" chat-database-url \
    "${SOCKET_DB_FLAGS[@]}" --command npm --args run,db:migrate
  run_job notification-migrate "${REGISTRY}/notification-service-tooling:${TAG}" notification-database-url \
    "${SOCKET_DB_FLAGS[@]}" --command npm --args run,db:migrate
  run_job credit-migrate "${REGISTRY}/credit-service:${TAG}" credit-database-url \
    "${SOCKET_DB_FLAGS[@]}" --command npm --args run,db:migrate
  run_job saga-migrate "${REGISTRY}/saga-orchestrator-tooling:${TAG}" saga-database-url \
    "${SOCKET_DB_FLAGS[@]}" --command npm --args run,db:migrate

  # Internal ingress: reached by the frontend over the VPC, and by Pub/Sub push and Cloud
  # Scheduler (same project). Internal routes check the caller's Google OIDC token.
  # (`^|^` makes | the separator, since the invoker list contains commas and @.)
  run run deploy chat-service --region "$REGION" --image "${REGISTRY}/chat-service:${TAG}" \
    --port 3000 --ingress internal --allow-unauthenticated \
    --min-instances 1 --no-cpu-throttling \
    --startup-probe=httpGet.path=/health,httpGet.port=3000,periodSeconds=2,timeoutSeconds=1,failureThreshold=30 \
    --add-cloudsql-instances "$SQL_CONNECTION" \
    --set-env-vars "PUBSUB_PROJECT_ID=${PROJECT_ID}" \
    --set-secrets "DATABASE_URL=chat-database-url:latest,JWT_SECRET=jwt-secret:latest"

  local order_url
  order_url="$(run_url order-service)"
  run run deploy order-service --region "$REGION" --image "${REGISTRY}/order-service:${TAG}" \
    --port 3000 --ingress internal --allow-unauthenticated \
    --add-cloudsql-instances "$SQL_CONNECTION" \
    --set-env-vars "^|^PUBSUB_PROJECT_ID=${PROJECT_ID}|INTERNAL_AUDIENCE=${order_url}|INTERNAL_INVOKER_EMAILS=${invokers}" \
    --set-secrets "DATABASE_URL=order-database-url:latest,JWT_SECRET=jwt-secret:latest"
  ensure_push_subscription order-service-user-events user-events "${order_url}/internal/pubsub/user-events" "$order_url" --enable-message-ordering
  ensure_push_subscription order-service-supplier-events supplier-events "${order_url}/internal/pubsub/supplier-events" "$order_url" --enable-message-ordering
  ensure_push_subscription order-service-order-commands order-commands "${order_url}/internal/pubsub/order-commands" "$order_url" --enable-message-ordering

  # credit-service creates its own push subscriptions (credit-provision).
  local credit_url credit_env credit_invokers
  credit_url="$(run_url credit-service)"
  credit_invokers="${CREDIT_INTERNAL_INVOKER_EMAILS:-}"
  [ -n "$credit_invokers" ] && credit_invokers="${credit_invokers},"
  credit_invokers="${credit_invokers}$(project_number)-compute@developer.gserviceaccount.com"
  credit_env="^|^PUBSUB_PROJECT_ID=${PROJECT_ID}|INTERNAL_AUDIENCE=${credit_url}"
  credit_env="${credit_env}|PUBSUB_PUSH_SERVICE_ACCOUNT=${PUBSUB_PUSH_SERVICE_ACCOUNT}|PUBSUB_PUSH_BASE_URL=${credit_url}|INITIAL_CREDITS=${INITIAL_CREDITS}"
  credit_env="${credit_env}|INTERNAL_INVOKER_EMAILS=${credit_invokers}"
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
    --set-env-vars "^|^PUBSUB_PROJECT_ID=${PROJECT_ID}|INTERNAL_AUDIENCE=${saga_url}|INTERNAL_INVOKER_EMAILS=${invokers}|RESERVE_TIMEOUT_SECONDS=${RESERVE_TIMEOUT_SECONDS}" \
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
  [ -n "$PUBLIC_ORIGINS" ] && origins="${origins},${PUBLIC_ORIGINS}"
  run run deploy notification-service --region "$REGION" --image "${REGISTRY}/notification-service:${TAG}" \
    --port 3000 --ingress all --allow-unauthenticated \
    --min-instances 1 --no-cpu-throttling --timeout 3600 \
    --add-cloudsql-instances "$SQL_CONNECTION" \
    --set-env-vars "^|^PUBSUB_PROJECT_ID=${PROJECT_ID}|ALLOWED_ORIGINS=${origins}" \
    --set-secrets "DATABASE_URL=notification-database-url:latest,JWT_SECRET=jwt-secret:latest,NOTIFICATION_TICKET_SECRET=notification-ticket-secret:latest"

  ensure_scheduler_job order-expire-overdue "${order_url}/internal/orders/expire-overdue" "$order_url"
  ensure_scheduler_job order-outbox-publish "${order_url}/internal/outbox/publish" "$order_url"
  ensure_scheduler_job saga-abort-overdue "${saga_url}/internal/sagas/abort-overdue" "$saga_url"
  ensure_scheduler_job saga-outbox-publish "${saga_url}/internal/outbox/publish" "$saga_url"
}

provision_runtime_login() {
  local name="$1" owner_secret="$2" runtime_secret="$3" role="$4"
  run run jobs deploy "${name}-runtime-login" --region "$REGION" \
    --image "${REGISTRY}/agent-chat-tooling:${TAG}" --max-retries 0 --execute-now --wait \
    "${SOCKET_DB_FLAGS[@]}" \
    --set-secrets "DATABASE_URL=${owner_secret}:latest,RUNTIME_DATABASE_URL=${runtime_secret}:latest" \
    --set-env-vars "RUNTIME_ROLE=${role}" \
    --command node --args agent-service/scripts/provision-runtime-login.mjs
}

deploy_agent_services() {
  ensure_agent_resources
  local invoker="$(project_number)-compute@developer.gserviceaccount.com"

  ensure_topic "$AGENT_TURN_TOPIC"
  ensure_topic "${AGENT_TURN_TOPIC}-dead-letter"
  ensure_topic "$AGENT_APPROVAL_TOPIC"
  local number pubsub_agent
  number="$(project_number)"
  pubsub_agent="service-${number}@gcp-sa-pubsub.iam.gserviceaccount.com"
  run pubsub topics add-iam-policy-binding "${AGENT_TURN_TOPIC}-dead-letter" \
    --member "serviceAccount:${pubsub_agent}" --role roles/pubsub.publisher >/dev/null
  if ! run pubsub subscriptions describe "$AGENT_TURN_SUBSCRIPTION" >/dev/null 2>&1; then
    run pubsub subscriptions create "$AGENT_TURN_SUBSCRIPTION" --topic "$AGENT_TURN_TOPIC" \
      --enable-message-ordering
  fi
  if ! run pubsub subscriptions describe "$AGENT_APPROVAL_SUBSCRIPTION" >/dev/null 2>&1; then
    run pubsub subscriptions create "$AGENT_APPROVAL_SUBSCRIPTION" --topic "$AGENT_APPROVAL_TOPIC"
  fi
  for subscription in "$AGENT_TURN_SUBSCRIPTION" "$AGENT_APPROVAL_SUBSCRIPTION"; do
    run pubsub subscriptions add-iam-policy-binding "$subscription" \
      --member "serviceAccount:${invoker}" --role roles/pubsub.subscriber >/dev/null
  done
  run pubsub subscriptions add-iam-policy-binding "$AGENT_TURN_SUBSCRIPTION" \
    --member "serviceAccount:${pubsub_agent}" --role roles/pubsub.subscriber >/dev/null
  run pubsub subscriptions update "$AGENT_TURN_SUBSCRIPTION" \
    --dead-letter-topic "${AGENT_TURN_TOPIC}-dead-letter" --max-delivery-attempts 5
  for topic in "$AGENT_TURN_TOPIC" "$AGENT_APPROVAL_TOPIC"; do
    run pubsub topics add-iam-policy-binding "$topic" \
      --member "serviceAccount:${invoker}" --role roles/pubsub.publisher >/dev/null
  done

  run_job agent-chat-migrate "${REGISTRY}/agent-chat-tooling:${TAG}" agent-chat-database-url \
    "${SOCKET_DB_FLAGS[@]}" --command npm --args run,db:migrate,--workspace,@campus/agent-contracts
  run_job mandate-migrate "${REGISTRY}/mandate-service-tooling:${TAG}" mandate-database-url \
    "${SOCKET_DB_FLAGS[@]}" --command npm --args run,db:migrate,--workspace,mandate-service

  provision_runtime_login agent-chat agent-chat-database-url agent-chat-runtime-database-url agent_chat
  provision_runtime_login agent-execution agent-chat-database-url agent-execution-runtime-database-url agent_execution
  provision_runtime_login mandate mandate-database-url mandate-runtime-database-url mandate_runtime

  deploy_agent_service_images true
}

deploy_agent_service_images() {
  local configure_iam="${1:-false}"
  local invoker="$(project_number)-compute@developer.gserviceaccount.com"
  local mandate_url order_url supplier_url credit_url
  mandate_url="$(run_url mandate-service)"
  order_url="$(run_url order-service)"
  supplier_url="$(run_url supplier-service)"
  credit_url="$(run_url credit-service)"

  local agent_invokers="${PUBSUB_PUSH_SERVICE_ACCOUNT},${SCHEDULER_SERVICE_ACCOUNT},${invoker}"
  run run deploy mandate-service --region "$REGION" --image "${REGISTRY}/mandate-service:${TAG}" \
    --port 3000 --ingress internal --allow-unauthenticated \
    --min-instances 1 --no-cpu-throttling --timeout 3600 \
    --add-cloudsql-instances "$SQL_CONNECTION" \
    --set-env-vars "^|^SERVICE_AUTH_MODE=google|PUBSUB_PROJECT_ID=${PROJECT_ID}|MANDATE_TOPIC=${AGENT_APPROVAL_TOPIC}|MANDATE_SERVICE_AUDIENCE=${mandate_url}|INTERNAL_INVOKER_EMAILS=${agent_invokers}|ORDER_SERVICE_URL=${order_url}|SUPPLIER_SERVICE_URL=${supplier_url}" \
    --set-secrets "DATABASE_URL=mandate-runtime-database-url:latest,JWT_SECRET=jwt-secret:latest"
  if [ "$configure_iam" = true ]; then
    run run services add-iam-policy-binding mandate-service --region "$REGION" \
      --member "serviceAccount:${invoker}" --role roles/run.invoker >/dev/null
  fi

  run run deploy agent-chat-service --region "$REGION" --image "${REGISTRY}/agent-chat-service:${TAG}" \
    --port 3000 --ingress internal --allow-unauthenticated \
    --min-instances 1 --no-cpu-throttling --timeout 3600 \
    --add-cloudsql-instances "$SQL_CONNECTION" \
    --network "$NETWORK" --subnet "$SUBNET" --vpc-egress private-ranges-only \
    --set-env-vars "PUBSUB_PROJECT_ID=${PROJECT_ID},TURN_TOPIC=${AGENT_TURN_TOPIC},APPROVAL_SUBSCRIPTION=${AGENT_APPROVAL_SUBSCRIPTION},NODE_EXTRA_CA_CERTS=/secrets/redis/ca.pem" \
    --set-secrets "DATABASE_URL=agent-chat-runtime-database-url:latest,JWT_SECRET=jwt-secret:latest,REDIS_URL=agent-redis-url:latest,/secrets/redis/ca.pem=agent-redis-ca:latest"

  local agent_env="^|^NODE_EXTRA_CA_CERTS=/secrets/redis/ca.pem|SERVICE_AUTH_MODE=google|PUBSUB_PROJECT_ID=${PROJECT_ID}|TURN_SUBSCRIPTION=${AGENT_TURN_SUBSCRIPTION}|MANDATE_SERVICE_URL=${mandate_url}|MANDATE_SERVICE_AUDIENCE=${mandate_url}|ORDER_SERVICE_URL=${order_url}|ORDER_SERVICE_AUDIENCE=${order_url}|SUPPLIER_SERVICE_URL=${supplier_url}|SUPPLIER_SERVICE_AUDIENCE=${supplier_url}|CREDIT_SERVICE_URL=${credit_url}|CREDIT_SERVICE_AUDIENCE=${credit_url}"
  local agent_secrets="DATABASE_URL=agent-execution-runtime-database-url:latest,REDIS_URL=agent-redis-url:latest,SOCLAAS_API_KEY=soclaas-api-key:latest,SOCLAAS_MODEL=soclaas-model:latest,/secrets/redis/ca.pem=agent-redis-ca:latest"
  if secret_exists soclaas-base-url; then
    agent_secrets="${agent_secrets},SOCLAAS_BASE_URL=soclaas-base-url:latest"
  fi
  run run deploy agent-orchestrator-service --region "$REGION" --image "${REGISTRY}/agent-orchestrator-service:${TAG}" \
    --port 3000 --ingress internal --allow-unauthenticated \
    --min-instances 1 --no-cpu-throttling \
    --add-cloudsql-instances "$SQL_CONNECTION" \
    --network "$NETWORK" --subnet "$SUBNET" --vpc-egress all-traffic \
    --set-env-vars "$agent_env" \
    --set-secrets "$agent_secrets"
  if [ "$configure_iam" = true ]; then
    for service in agent-chat-service agent-orchestrator-service; do
      run run services add-iam-policy-binding "$service" --region "$REGION" \
        --member "serviceAccount:${PUBSUB_PUSH_SERVICE_ACCOUNT}" --role roles/run.invoker >/dev/null
    done
  fi
}

deploy_agent_services_only() {
  require_agent_secrets
  deploy_agent_service_images
}

deploy() {
  require_agent_secrets
  ensure_pubsub

  if secret_exists mailjet-api-key && secret_exists mailjet-secret-key && secret_exists mailjet-from; then
    local mail_service_url
    mail_service_url="$(run_url mail-service)"
    run run deploy mail-service --region "$REGION" --image "${REGISTRY}/mail-service:${TAG}" \
      --port 3335 --no-allow-unauthenticated \
      --set-env-vars "PUBSUB_PROJECT_ID=${PROJECT_ID},PUBSUB_TOPIC=${PUBSUB_TOPIC},PUBSUB_SUBSCRIPTION=${MAIL_SERVICE_SUBSCRIPTION},PASSWORD_RESET_TOPIC=${PASSWORD_RESET_TOPIC},PASSWORD_RESET_SUBSCRIPTION=${PASSWORD_RESET_SUBSCRIPTION},FRONTEND_BASE_URL=${PUBLIC_ORIGINS%%,*}" \
      --set-secrets "MAILJET_API_KEY=mailjet-api-key:latest,MAILJET_SECRET_KEY=mailjet-secret-key:latest,MAILJET_FROM=mailjet-from:latest"
    run run services add-iam-policy-binding mail-service --region "$REGION" \
      --member "serviceAccount:${PUBSUB_PUSH_SERVICE_ACCOUNT}" --role roles/run.invoker >/dev/null
    ensure_push_subscription "$MAIL_SERVICE_SUBSCRIPTION" "$PUBSUB_TOPIC" \
      "${mail_service_url}/pubsub/user-events" "$mail_service_url"
    ensure_push_subscription "$PASSWORD_RESET_SUBSCRIPTION" "$PASSWORD_RESET_TOPIC" \
      "${mail_service_url}/pubsub/password-reset" "$mail_service_url"
  else
    echo "Mail service deployment skipped: create mailjet-api-key, mailjet-secret-key, and mailjet-from secrets to enable it."
  fi

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
    --set-env-vars "JWT_ACCESS_TOKEN_TTL=900,PUBSUB_PROJECT_ID=${PROJECT_ID},PUBSUB_TOPIC=${PUBSUB_TOPIC},PASSWORD_RESET_TOPIC=${PASSWORD_RESET_TOPIC}" \
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

  # Copies user-events into the supplier database, which supplier-service reads to authorize callers.
  # (Claude Code (Opus 5.5), 2026-11-04: `npm run worker` loads OpenTelemetry first, which stays
  # off without OTEL_EXPORTER_OTLP_ENDPOINT; author review: Pending.)
  run run deploy supplier-event-worker --region "$REGION" --image "${REGISTRY}/supplier-service:${TAG}" \
    --command npm --args run,worker \
    --port 3004 --no-allow-unauthenticated \
    --clear-cloudsql-instances \
    --network "$NETWORK" --subnet "$SUBNET" --vpc-egress private-ranges-only \
    --set-env-vars "PUBSUB_PROJECT_ID=${PROJECT_ID},USER_EVENTS_TOPIC=${PUBSUB_TOPIC},PUBSUB_SUBSCRIPTION=${SUPPLIER_USER_EVENTS_SUBSCRIPTION},SUPPLIER_EVENTS_TOPIC=${SUPPLIER_EVENTS_TOPIC}" \
    --set-secrets "DATABASE_URL=supplier-database-url:latest"
  local supplier_worker_url
  supplier_worker_url="$(service_url supplier-event-worker)"
  run run services add-iam-policy-binding supplier-event-worker --region "$REGION" \
    --member "serviceAccount:${PUBSUB_PUSH_SERVICE_ACCOUNT}" --role roles/run.invoker >/dev/null

  if run pubsub subscriptions describe "$SUPPLIER_USER_EVENTS_SUBSCRIPTION" >/dev/null 2>&1; then
    run pubsub subscriptions update "$SUPPLIER_USER_EVENTS_SUBSCRIPTION" \
      --push-endpoint "${supplier_worker_url}/pubsub/user-events" \
      --push-auth-service-account "$PUBSUB_PUSH_SERVICE_ACCOUNT" \
      --push-auth-token-audience "$supplier_worker_url"
  else
    run pubsub subscriptions create "$SUPPLIER_USER_EVENTS_SUBSCRIPTION" --topic "$PUBSUB_TOPIC" \
      --push-endpoint "${supplier_worker_url}/pubsub/user-events" \
      --push-auth-service-account "$PUBSUB_PUSH_SERVICE_ACCOUNT" \
      --push-auth-token-audience "$supplier_worker_url" \
      --enable-message-ordering
  fi

  run run deploy supplier-service --region "$REGION" --image "${REGISTRY}/supplier-service:${TAG}" \
    --port 3000 --ingress internal --allow-unauthenticated \
    --clear-cloudsql-instances \
    --network "$NETWORK" --subnet "$SUBNET" --vpc-egress all-traffic \
    --set-env-vars "^|^PUBSUB_PROJECT_ID=${PROJECT_ID}|SUPPLIER_EVENTS_TOPIC=${SUPPLIER_EVENTS_TOPIC}|SERVICE_AUTH_MODE=google|SERVICE_READ_AUDIENCE=$(run_url supplier-service)|SERVICE_READ_INVOKERS=$(project_number)-compute@developer.gserviceaccount.com" \
    --set-secrets "DATABASE_URL=supplier-database-url:latest,JWT_SECRET=jwt-secret:latest"
  local supplier_url
  supplier_url="$(service_url supplier-service)"

  # Publishes supplier-events the API's relay missed (for example after a Pub/Sub error).
  run services enable cloudscheduler.googleapis.com
  local sweep_flags=(--location "$REGION" --schedule "* * * * *"
    --uri "${supplier_worker_url}/outbox/publish" --http-method POST
    --oidc-service-account-email "$PUBSUB_PUSH_SERVICE_ACCOUNT" --oidc-token-audience "$supplier_worker_url")
  if run scheduler jobs describe supplier-outbox-sweep --location "$REGION" >/dev/null 2>&1; then
    run scheduler jobs update http supplier-outbox-sweep "${sweep_flags[@]}"
  else
    run scheduler jobs create http supplier-outbox-sweep "${sweep_flags[@]}"
  fi

  deploy_event_services
  deploy_agent_services
  local notification_url
  notification_url="$(service_url notification-service)"

  run run deploy frontend-service --region "$REGION" --image "${REGISTRY}/frontend-service:${TAG}" \
    --port 3000 --ingress all --allow-unauthenticated \
    --network "$NETWORK" --subnet "$SUBNET" --vpc-egress all-traffic \
    --set-env-vars "NUXT_USER_SERVICE_BASE_URL=${user_url},NUXT_SUPPLIER_SERVICE_BASE_URL=${supplier_url},NUXT_ORDER_SERVICE_BASE_URL=$(service_url order-service),NUXT_CHAT_SERVICE_BASE_URL=$(service_url chat-service),NUXT_CREDIT_SERVICE_BASE_URL=$(service_url credit-service),NUXT_NOTIFICATION_SERVICE_BASE_URL=${notification_url},NUXT_AGENT_SERVICE_BASE_URL=$(service_url agent-chat-service),NUXT_MANDATE_SERVICE_BASE_URL=$(service_url mandate-service),NUXT_PUBLIC_NOTIFICATION_SERVICE_URL=${notification_url/https:/wss:}"

  echo "Frontend: $(service_url frontend-service)"
}

# One-time: lets GitHub Actions in GITHUB_REPOSITORY deploy from main through Workload
# Identity Federation (no service account keys), then prints the variables the workflow reads.
github_ci() {
  local repository="${GITHUB_REPOSITORY:-Y2627S1-CS3219-P32/Y2627S1-CS3219-P32}"
  local deployer="${DEPLOYER_SERVICE_ACCOUNT:-github-deployer@${PROJECT_ID}.iam.gserviceaccount.com}"
  local pool=github provider=github number
  number="$(project_number)"

  run services enable iamcredentials.googleapis.com sts.googleapis.com cloudbuild.googleapis.com
  if ! run iam service-accounts describe "$deployer" >/dev/null 2>&1; then
    run iam service-accounts create "${deployer%@*}" --display-name "GitHub Actions deployer"
  fi
  # deploy.sh creates databases, secrets, topics, service accounts and IAM bindings as it goes.
  for role in roles/viewer roles/cloudbuild.builds.editor roles/storage.admin roles/run.admin \
    roles/iam.serviceAccountUser roles/iam.serviceAccountAdmin roles/resourcemanager.projectIamAdmin \
    roles/secretmanager.admin roles/cloudsql.admin roles/pubsub.admin roles/cloudscheduler.admin roles/redis.admin \
    roles/serviceusage.serviceUsageAdmin roles/compute.networkAdmin; do
    run projects add-iam-policy-binding "$PROJECT_ID" \
      --member "serviceAccount:${deployer}" --role "$role" --condition None >/dev/null
  done

  if ! run iam workload-identity-pools describe "$pool" --location global >/dev/null 2>&1; then
    run iam workload-identity-pools create "$pool" --location global --display-name "GitHub Actions"
  fi
  if ! run iam workload-identity-pools providers describe "$provider" --location global \
    --workload-identity-pool "$pool" >/dev/null 2>&1; then
    run iam workload-identity-pools providers create-oidc "$provider" --location global \
      --workload-identity-pool "$pool" --display-name "GitHub" \
      --issuer-uri https://token.actions.githubusercontent.com \
      --attribute-mapping "google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
      --attribute-condition "assertion.repository == '${repository}' && assertion.ref == 'refs/heads/main'"
  fi
  run iam service-accounts add-iam-policy-binding "$deployer" --role roles/iam.workloadIdentityUser \
    --member "principalSet://iam.googleapis.com/projects/${number}/locations/global/workloadIdentityPools/${pool}/attribute.repository/${repository}" \
    --condition None >/dev/null

  echo "Add these GitHub repository variables (Settings > Secrets and variables > Actions):"
  echo "  GCP_PROJECT_ID=${PROJECT_ID}"
  echo "  GCP_WORKLOAD_IDENTITY_PROVIDER=projects/${number}/locations/global/workloadIdentityPools/${pool}/providers/${provider}"
  echo "  GCP_SERVICE_ACCOUNT=${deployer}"
}

configure_mailjet() {
  if [ ! -t 0 ]; then
    echo "Run './deploy.sh mailjet' in an interactive terminal to enter Mailjet settings securely." >&2
    return 1
  fi

  local api_key secret_key sender
  read -r -s -p "Mailjet API key: " api_key
  printf '\n' >&2
  read -r -s -p "Mailjet secret key: " secret_key
  printf '\n' >&2
  read -r -p "Verified Mailjet sender address: " sender

  if [ -z "$api_key" ] || [ -z "$secret_key" ] || [ -z "$sender" ]; then
    unset api_key secret_key sender
    echo "All three Mailjet settings are required; no secrets were changed." >&2
    return 1
  fi

  local name value
  for name in mailjet-api-key mailjet-secret-key mailjet-from; do
    case "$name" in
      mailjet-api-key) value="$api_key" ;;
      mailjet-secret-key) value="$secret_key" ;;
      mailjet-from) value="$sender" ;;
    esac

    if secret_exists "$name"; then
      printf '%s' "$value" | run secrets versions add "$name" --data-file -
    else
      printf '%s' "$value" |
        run secrets create "$name" --replication-policy automatic --data-file -
    fi
  done

  unset api_key secret_key sender value
  echo "Mailjet secrets saved to Secret Manager. Run './deploy.sh' to deploy mail-service."
}

store_secret() {
  local name="$1" value="$2"
  if secret_exists "$name"; then
    printf '%s' "$value" | run secrets versions add "$name" --data-file -
  else
    printf '%s' "$value" | run secrets create "$name" --replication-policy automatic --data-file -
  fi
}

configure_soclass() {
  if [ ! -t 0 ]; then
    echo "Run './deploy.sh soclass' in an interactive terminal to enter SoC LLaaS settings securely." >&2
    return 1
  fi

  local api_key model base_url
  read -r -s -p "SoC LLaaS API key: " api_key
  printf '\n' >&2
  read -r -p "Model [default]: " model
  model="${model:-default}"
  read -r -p "Base URL [leave blank to keep current/default]: " base_url

  if [ -z "$api_key" ]; then
    unset api_key model base_url
    echo "API key is required; no secrets were changed." >&2
    return 1
  fi
  if [ -n "$base_url" ] && [[ "$base_url" != https://* ]]; then
    unset api_key model base_url
    echo "Base URL must start with https://; no secrets were changed." >&2
    return 1
  fi

  store_secret soclaas-api-key "$api_key"
  store_secret soclaas-model "$model"
  if [ -n "$base_url" ]; then store_secret soclaas-base-url "$base_url"; fi

  unset api_key model base_url
  echo "SoC LLaaS settings saved to Secret Manager. Run './deploy.sh' to deploy agent-orchestrator-service."
}

seed() {
  run_job supplier-seed "${REGISTRY}/supplier-service-tooling:${TAG}" supplier-database-url \
    "${PRIVATE_DB_FLAGS[@]}" --command npm --args run,db:seed
}

case "${1:-deploy}" in
  setup) setup ;;
  deploy) deploy ;;
  agent-services) deploy_agent_services_only ;;
  seed) seed ;;
  github) github_ci ;;
  mailjet) configure_mailjet ;;
  soclass) configure_soclass ;;
  *) echo "Usage: $0 [setup|deploy|agent-services|seed|github|mailjet|soclass]" >&2; exit 1 ;;
esac
