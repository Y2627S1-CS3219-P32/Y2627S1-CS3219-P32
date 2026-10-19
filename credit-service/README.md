# Credit Service

Credit owns four PostgreSQL tables. Commands commit the saved JSON result, movement, balances, and outcome together. Balance reads require a user JWT. Reserve, release, and transfer arrive through authenticated Pub/Sub push delivery. Operation lookup requires an authorized internal identity. User events provision accounts once. No request creates an account.

## Source layout

| Location | Responsibility |
|---|---|
| `src/index.ts` | Validate configuration and start the API. |
| `src/app.ts` | Configure Express, mount routes, and register error handling. |
| `src/http-handler/` | HTTP read and health handlers, caller authentication, and error responses. |
| `src/event-handler/` | Incoming message handlers, Pub/Sub envelope decoding, and payload validation. |
| `src/services/` | Credit operations, account lifecycle, eligibility, reads, and outcome construction. |
| `src/repositories/` | Account, operation, ledger, outbox, and readiness SQL. |
| `src/outbox-publisher/` | Publish saved outbox messages and check publisher dependencies. |
| `src/scripts/` | Pub/Sub provisioning and command publishing tools. |
| `src/db/` | Connection, transaction and lock primitives, schema, and migrations. |
| `src/common/types.ts`, `src/common/constants.ts` | Shared business types and operation names. |
| `src/common/validation.ts` | Shared UUID and positive-integer validation rules. |

`createApp()` mounts the HTTP and event routers, without injected services. Each handler module defines its own routes. Event handlers authenticate the delivery, decode and validate its message, then map the external payload to business inputs. Both handler boundaries call business functions directly: `initializeAccount`, `deactivateAccount`, `reserveCredits`, `releaseCredits`, and `transferCredits`. The user-event adapter maps event IDs to request IDs; business functions accept operation inputs without knowing which transport delivered them. Account initialization creates the account and grants initial credits in one transaction. Services pass the transaction client to repositories so balances, operation results, movements, and outbox entries commit together. Repositories do not choose business errors or open independent financial transactions.

Credit services check recorded reserve, release, and transfer facts rather than branching on reservation states. They describe financial movements once. Read services interpret history and format the existing reservation-state responses. Business errors carry codes; HTTP middleware maps them to statuses. The persisted outcome's existing `httpStatus` field remains compatibility data, produced by the outcome serializer.

The publisher holds one database session lock across loading pending outbox entries, publishing, and marking acknowledgments. Repository functions own that SQL; the publisher owns network delivery and retry behavior.

## Local startup

Start Docker Desktop and configure the repository root `.env` using
[the root setup instructions](../README.md#configure-the-root-environment).
Run these commands from the repository root to start the full application:

```sh
docker compose up -d --build
docker compose ps
curl -fsS http://127.0.0.1:3004/health/ready
```

Compose runs Credit migrations and Pub/Sub provisioning before starting Credit.
The readiness endpoint returns `{"status":"ok"}` once Credit is ready. Open the
frontend at http://127.0.0.1:3001. No separate startup script is needed.

To start only Credit and its dependencies:

```sh
docker compose up -d --build credit-service credit-publisher
```

This also starts the Credit database, emulator, migration, and provisioning jobs.
Use the full application for registration and the Postman demo.

To inspect Credit logs or stop the full stack while keeping database data:

```sh
docker compose logs --tail=50 credit-service credit-publisher
docker compose down
```

Credit exposes host port 3004 and PostgreSQL host port 5438. Credit’s PostgreSQL volume preserves data across restarts. `docker compose down -v` deletes that data.

The API listens on port 3000 inside the container. `GET /health/live` checks the process. `GET /health/ready` checks PostgreSQL only. Broker outages leave committed results in the outbox. `node dist/outbox-publisher/publisher-health.js` checks the publisher’s database and broker dependencies. The publisher logs retry failures and processes stored envelopes in order under one database advisory lock. Every retry resumes the failed Pub/Sub ordering key. A crash after acknowledgment can deliver the same event ID again. Consumers deduplicate that ID.

## View credit data

### Drizzle Studio

With the database running, open a new terminal at the repository root:

```sh
cd credit-service
npm install
DATABASE_URL='postgres://credit:credit@127.0.0.1:5438/credits' npx drizzle-kit studio
```

Open https://local.drizzle.studio. Keep the terminal running while using Studio;
press Ctrl+C to stop it. The explicit connection URL uses the database's host
port rather than the Docker-only `credit-db` hostname.

Browse these tables to inspect your Postman demo results:

| Table | Data |
|---|---|
| `credit_accounts` | Total and reserved balances per user. |
| `credit_orders` | Allocation, reserve, release, and transfer operations and saved outcomes. |
| `credit_transactions` | Credit movements between users and buckets. |
| `credit_outbox` | Outgoing events and publication timestamps. |

### PostgreSQL terminal

From the repository root:

```sh
docker compose exec credit-db psql -U credit -d credits
```

Run these queries inside psql:

```sql
\pset pager off

SELECT user_id, total_credits, reserved_credits,
       total_credits - reserved_credits AS available_credits
FROM credit_accounts
ORDER BY user_id;

SELECT request_id, order_id, user_id, kind, status, result
FROM credit_orders
ORDER BY created_at DESC;

SELECT * FROM credit_transactions;

SELECT event_id, payload->>'type' AS event_type, created_at, published_at
FROM credit_outbox
ORDER BY created_at DESC;
```

Type `\q` to exit. A populated `published_at` records broker acknowledgment;
it does not prove downstream processing completed.

## Database migrations

Credit uses Drizzle ORM with the existing PostgreSQL driver. Balances and movement amounts use `bigint` internally and convert to safe JSON numbers at the API boundary.

Edit `src/db/schema.ts`, then generate and review a migration:

```sh
npm run db:generate
npm run build
npm run db:migrate
```

Commit the generated SQL and `migrations/meta/` together. The initial migration creates the Credit schema. Each migration runs once through the Drizzle migration journal. The migration runner serializes concurrent startup jobs with a PostgreSQL advisory lock.

## Configuration

Set `DATABASE_URL`, `JWT_SECRET`, and `INITIAL_CREDITS` (default 1000). Set `PORT` if needed. Balance JWTs require HS256, `typ=JWT`, an unexpired integer `exp`, and positive integer string `sub`.

Cloud internal callers require `INTERNAL_AUDIENCE` and comma-separated `INTERNAL_INVOKER_EMAILS`. Set `PUBSUB_PUSH_SERVICE_ACCOUNT` to the dedicated push identity. Only that identity may ingest user events and credit commands. Grant it Pub/Sub token-creation and service invocation permissions in deployment. Local `INTERNAL_SHARED_SECRET` works only when `PUBSUB_EMULATOR_HOST` is set. Internal reads accept `x-internal-secret`. Local push subscriptions use a token query parameter.

Set `PUBSUB_PROJECT_ID` (default foc-local), `PUBSUB_EMULATOR_HOST`, and `PUBSUB_PUSH_BASE_URL`. Topic defaults are `USER_EVENTS_TOPIC=user-events`, `CREDIT_COMMANDS_TOPIC=credit-commands`, and `CREDIT_EVENTS_TOPIC=credit-events`. Subscription defaults are `USER_EVENTS_SUBSCRIPTION=credit-service-user-events` and `CREDIT_COMMANDS_SUBSCRIPTION=credit-service-commands`. Provisioning creates both subscriptions with seven-day retention and retry backoff. Repeated provisioning updates push configuration without replacing subscriptions. In Cloud, configure a dead-letter topic, grant forwarding permissions to the Pub/Sub service agent, and alert on undelivered messages and oldest unacknowledged age. Repair failed events before retention expires. The emulator is development infrastructure.

## Operations

`POST /internal/pubsub/user-events` accepts the standard Pub/Sub wrapper containing base64 JSON. Creation uses `{eventId,type:"user.created",user:{id:1}}`. Deletion uses `{eventId,type:"user.deleted",userId:1}`. Upstream version fields are ignored. Establish the durable subscription before registration traffic. Creation events provision new accounts; delayed creation events cannot reactivate deleted accounts.

`GET /api/v1/credits/me` returns `totalCredits`, `reservedCredits`, and `availableCredits` for the bearer JWT owner.

### Reserve, release, and transfer commands

Credit owns the command contract. Publish flat JSON envelopes to `credit-commands`. The future saga decides when to publish each command. Credit does not translate Order lifecycle events into commands.

All commands require UUID `requestId`, `correlationId`, and `orderId`.

| Type | Additional fields |
|---|---|
| `credit.reserve` | Positive integer `requesterId` and integer `amount` from 1 to 2147483647 |
| `credit.release` | The same requester and amount fields, plus a nonblank `reason` of at most 200 characters |
| `credit.transfer` | Positive integer `courierId`. Credit derives requester and amount from reserve history. |

User IDs must fit PostgreSQL INTEGER, at most 2147483647. A reserve envelope is:

```json
{
  "type": "credit.reserve",
  "requestId": "6f1c3fc6-183c-4c56-99f9-d6df888ee944",
  "correlationId": "a7a461f2-e5fa-4a30-9699-f834737f38e5",
  "orderId": "4c29bc32-b0ef-4ab4-91dd-0bd579bb9ac8",
  "requesterId": 1,
  "amount": 120
}
```

After building, publish a saved envelope from the service directory:

```sh
npm run command:publish -- command.json
```

For the running Compose stack, pass that file to the container:

```sh
docker compose exec -T credit-service node dist/scripts/send-command.js /dev/stdin < command.json
```

The CLI validates the envelope and uses `orderId` as the ordering key. Its output confirms broker acceptance only. Observe the result on `credit-events` or use authenticated `GET /internal/v1/credit-orders/{requestId}`. `GET /internal/v1/credit-reservations/{orderId}` returns derived reservation state.

The `credit-service-commands` subscription pushes to `POST /internal/pubsub/credit-commands` with the standard base64 Pub/Sub wrapper. There are no direct HTTP reserve, release, or transfer routes. The push handler returns 204 only after the final result and outbox commit, including definitive `REJECTED` outcomes. Missing provisioning and reservation dependencies return retryable `503 ACCOUNT_PENDING` or `503 RESERVATION_NOT_READY`. Unexpected failures return 503. Invalid envelopes and request-ID conflicts return non-2xx for repair or dead-letter handling. Configure Cloud dead-letter forwarding and its Pub/Sub service-agent IAM during deployment.

Keep the entire envelope, including `correlationId`, stable across retries. Redelivery reuses the saved result and original outbox event. It does not create another outcome. Inactive users produce a durable `USER_INACTIVE` rejection. Release remains permitted for an allocated deleted account. Release before reserve records CANCELLED without a movement. Release never reverses transfer.

## Verification

```sh
npm install
npm test
npm run test:pubsub
```

Set `DATABASE_URL` to a disposable migrated PostgreSQL database for integration tests. Pub/Sub verification additionally needs the emulator, provisioned durable user and command subscriptions, and `PUBSUB_PUSH_BASE_URL` reachable from the emulator. For a Docker emulator calling an API on the host, use `http://host.docker.internal:3004` and `PORT=3004`. The test provisions users and executes commands through real push delivery, publishes outcomes through the emulator, attempts delivery to an unavailable broker, then simulates a crash after broker acknowledgment and verifies repeated delivery with the same event ID.

The PostgreSQL and HTTP tests use a disposable database and run serially through `npm test` because they truncate Credit tables. Use the disposable test database, never a database containing work you need. Run that suite before the Pub/Sub proof, because they share that test database. The Pub/Sub proof uses a separate subscription from the container API. It demonstrates an unavailable broker endpoint and simulates failure immediately after broker acknowledgment at the broker-client boundary. It asserts stable event IDs and same-key publication order. The architecture test keeps ORM access inside repositories and database modules and prevents business services from importing transport handlers, message parsers, or an aggregate service contract.

`test/compose.mjs` runs inside the deployed API container through standard input. Set a new `CREDIT_PROOF_USER_ID` for `prepare`, then use the same ID for `verify` after recreating `credit-db`. It checks the real HTTP balance and retained command and movement counts. `test/outbox.mjs` uses `release`, `pending`, and `published` to verify publisher recovery. Pause the publisher first, deliver `release` while the broker is available, then pause the emulator and resume the publisher. Check `pending`, resume the emulator, and check `published`. Input commands cannot arrive while the broker is unavailable. These proof scripts create demo financial history.

```sh
docker compose exec -T -e CREDIT_PROOF_USER_ID=1900000010 credit-service node --input-type=module - prepare < credit-service/test/compose.mjs
docker compose up -d --force-recreate --no-deps credit-db
docker compose exec -T -e CREDIT_PROOF_USER_ID=1900000010 credit-service node --input-type=module - verify < credit-service/test/compose.mjs
```
