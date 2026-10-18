# Credit Service

Credit owns four PostgreSQL tables. Commands commit the saved JSON result, movement, balances, and outcome together. The API requires a user JWT for the caller's balance and an authorized internal identity for commands and operation lookup. User events provision accounts once. No request creates an account.

## Source layout

`src/credit/commands.ts` owns reservation commands and their atomic transaction. `accounts.ts` handles account locks and user lifecycle events. `queries.ts` reads balances, operations, and reservation history. `orders.ts` stores operation results. `types.ts` defines Credit types and shared value helpers.

`src/events/` owns outbox envelopes, publishing, Pub/Sub provisioning, and publisher health. `src/db/` owns connections, transactions, locks, and migration. The HTTP adapter, authentication, configuration, API startup, and backfill entry point stay at the source root.

## Local startup

From the repository root, start the Pub/Sub emulator and Credit database, then migration and provisioning jobs before starting registration traffic.

```sh
docker compose up -d pubsub-emulator credit-db
docker compose run --rm credit-db-migrate
docker compose run --rm credit-pubsub-provision
docker compose up -d credit-service credit-publisher
```

Credit exposes host port 3004 and PostgreSQL host port 5438. Credit’s PostgreSQL volume preserves data across restarts. `docker compose down -v` deletes that data.

The API listens on port 3000 inside the container. `GET /health/live` checks the process. `GET /health/ready` checks PostgreSQL only. Broker outages leave committed results in the outbox. `node dist/events/publisher-health.js` checks the publisher’s database and broker dependencies. The publisher logs retry failures and processes stored envelopes in order under one database advisory lock. Every retry resumes the failed Pub/Sub ordering key. A crash after acknowledgment can deliver the same event ID again. Consumers deduplicate that ID.

## Configuration

Set `DATABASE_URL`, `JWT_SECRET`, and `INITIAL_CREDITS` (default 1000). Set `PORT` if needed. Balance JWTs require HS256, `typ=JWT`, an unexpired integer `exp`, and positive integer string `sub`.

Cloud internal callers require `INTERNAL_AUDIENCE` and comma-separated `INTERNAL_INVOKER_EMAILS`. Set `PUBSUB_PUSH_SERVICE_ACCOUNT` to the dedicated push identity. Only that identity may ingest user events. Grant it Pub/Sub token-creation and service invocation permissions in deployment. Local `INTERNAL_SHARED_SECRET` works only when `PUBSUB_EMULATOR_HOST` is set. Commands use `x-internal-secret`. The local push subscription uses a token query parameter.

Set `PUBSUB_PROJECT_ID` (default foc-local), `PUBSUB_EMULATOR_HOST`, and `PUBSUB_PUSH_BASE_URL`. Topic defaults are `USER_EVENTS_TOPIC=user-events` and `CREDIT_EVENTS_TOPIC=credit-events`. The durable subscription defaults to `USER_EVENTS_SUBSCRIPTION=credit-service-user-events`. Provisioning is idempotent and preserves an existing subscription. It sets seven-day retention and retry backoff. In Cloud, configure a dead-letter topic, grant forwarding permissions to the Pub/Sub service agent, and alert on undelivered messages and oldest unacknowledged age. Repair failed events before retention expires. The emulator is development infrastructure, not an existing-user recovery store.

## Operations

`POST /internal/pubsub/user-events` accepts the standard Pub/Sub wrapper containing base64 JSON. Creation uses `{eventId,type:"user.created",user:{id:1}}`. Deletion uses `{eventId,type:"user.deleted",userId:1}`. Upstream version fields are ignored. Trusted backfill invokes the same handler with stable source event IDs and cannot reactivate deleted accounts. Run `npm run backfill -- trusted-user-created.jsonl` against a trusted JSONL export of user.created envelopes. Establish the durable subscription before backfill and live traffic. The importer accepts creation events only and preserves tombstones.

`GET /api/v1/credits/me` returns `totalCredits`, `reservedCredits`, and `availableCredits` for the bearer JWT owner.

Internal endpoints require internal authentication.

- `POST /internal/v1/credit-reservations` accepts UUID `requestId`, `correlationId`, `orderId`, positive integer `requesterId`, and integer `amount` from 1 to 2147483647.
- `POST /internal/v1/credit-reservations/{orderId}/transfer` accepts UUID `requestId`, `correlationId`, and positive integer `courierId`. Credit derives the amount and requester from committed reserve history.
- `POST /internal/v1/credit-reservations/{orderId}/release` accepts UUID `requestId`, `correlationId`, positive integer `requesterId`, integer `amount`, and nonempty `reason` of at most 200 characters.
- `GET /internal/v1/credit-orders/{requestId}` returns the durable result.
- `GET /internal/v1/credit-reservations/{orderId}` returns derived reservation state.

Reuse request IDs for retries. Changed business fields conflict. Missing provisioning returns retryable `503 ACCOUNT_PENDING`. Definitive business rejections return 409 and remain fixed for that request ID. Release before reserve records CANCELLED without a movement. Release never reverses transfer.

## Verification

```sh
npm install
npm test
npm run test:pubsub
```

Set `DATABASE_URL` to a disposable migrated PostgreSQL database for integration tests. Pub/Sub verification additionally needs the emulator, a provisioned durable subscription, and `PUBSUB_PUSH_BASE_URL` reachable from the emulator. For a Docker emulator calling an API on the host, use `http://host.docker.internal:3004` and `PORT=3004`. The test provisions through real push delivery, publishes through the emulator, attempts delivery to an unavailable broker, then simulates a crash after broker acknowledgment and verifies repeated delivery with the same event ID.

For host-side verification, expose the emulator on loopback with the Credit override. Use this same override for subsequent Compose commands during the run.

```sh
docker compose -f compose.yaml -f credit-service/compose.verify.yaml up -d pubsub-emulator
docker run -d --name credit-test-db -e POSTGRES_USER=credit -e POSTGRES_PASSWORD=credit -e POSTGRES_DB=credits -p 127.0.0.1:5437:5432 postgres:17
cd credit-service
export DATABASE_URL=postgres://credit:credit@127.0.0.1:5437/credits
export JWT_SECRET=replace-with-a-local-test-secret
export INTERNAL_SHARED_SECRET=replace-with-a-local-internal-secret
export PUBSUB_EMULATOR_HOST=127.0.0.1:8085
export PUBSUB_PROJECT_ID=foc-local
export USER_EVENTS_SUBSCRIPTION=credit-verification-user-events
export PUBSUB_PUSH_BASE_URL=http://host.docker.internal:3014
export PORT=3014
npm ci
npm test
npm run pubsub:provision
npm run test:pubsub
```

The PostgreSQL test suite truncates Credit tables. Use the disposable test database, never a database containing work you need. Run the database suite before the Pub/Sub proof, because they share that test database. The Pub/Sub proof uses a separate subscription from the container API. It demonstrates an unavailable broker endpoint and injects failure immediately after broker acknowledgment. It asserts stable event IDs and same-key publication order.

`test/compose.mjs` runs inside the deployed API container through standard input. Set a new `CREDIT_PROOF_USER_ID` for `prepare`, then use the same ID for `verify` after recreating `credit-db`. It checks the real HTTP balance and retained command and movement counts. `test/outbox.mjs` uses `release`, `pending`, and `published` to verify the deployed publisher while the emulator is paused and after it resumes. These proof scripts create demo financial history.

```sh
docker compose exec -T -e CREDIT_PROOF_USER_ID=1900000010 credit-service node --input-type=module - prepare < credit-service/test/compose.mjs
docker compose up -d --force-recreate --no-deps credit-db
docker compose exec -T -e CREDIT_PROOF_USER_ID=1900000010 credit-service node --input-type=module - verify < credit-service/test/compose.mjs
```

Use the two `-f` options above when running these commands during host-side emulator verification. The recorded results are in [verification.txt](docs/verification.txt).

The behavior-preserving source reorganization was checked against the original implementation. See [reorganization verification](docs/reorganization-verification.txt) for the comparison and rerun results.
