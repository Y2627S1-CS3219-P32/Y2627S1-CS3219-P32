# Credit Service

Credit owns four PostgreSQL tables. Commands commit the saved JSON result, movement, balances, and outcome together. Balance reads require a user JWT. Reserve, release, and transfer arrive through authenticated Pub/Sub push delivery. Operation lookup requires an authorized internal identity. User events provision accounts once. No request creates an account.

## Source layout

`src/credit/commands.ts` coordinates the atomic transaction and contains private reserve, release, and transfer decision handlers. `constants.ts` defines shared command kinds, message types, and reservation states. `accounts.ts` handles account locks and user lifecycle events. `queries.ts` reads balances, operations, and reservation history. `orders.ts` stores operation results. `types.ts` defines Credit types and shared value helpers.

`src/events/` owns outbox envelopes, publishing, Pub/Sub provisioning, and publisher health. `src/db/schema.ts` defines the four Drizzle tables and their constraints. `src/db/` owns the PostgreSQL pool, Drizzle transactions, locks, and migration. The HTTP adapter, authentication, configuration, and API startup stay at the source root.

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
docker compose exec -T credit-service node dist/events/send-command.js /dev/stdin < command.json
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

The PostgreSQL test suite truncates Credit tables. Use the disposable test database, never a database containing work you need. Run the database suite before the Pub/Sub proof, because they share that test database. The Pub/Sub proof uses a separate subscription from the container API. It demonstrates an unavailable broker endpoint and injects failure immediately after broker acknowledgment. It asserts stable event IDs and same-key publication order.

`test/compose.mjs` runs inside the deployed API container through standard input. Set a new `CREDIT_PROOF_USER_ID` for `prepare`, then use the same ID for `verify` after recreating `credit-db`. It checks the real HTTP balance and retained command and movement counts. `test/outbox.mjs` uses `release`, `pending`, and `published` to verify publisher recovery. Pause the publisher first, deliver `release` while the broker is available, then pause the emulator and resume the publisher. Check `pending`, resume the emulator, and check `published`. Input commands cannot arrive while the broker is unavailable. These proof scripts create demo financial history.

```sh
docker compose exec -T -e CREDIT_PROOF_USER_ID=1900000010 credit-service node --input-type=module - prepare < credit-service/test/compose.mjs
docker compose up -d --force-recreate --no-deps credit-db
docker compose exec -T -e CREDIT_PROOF_USER_ID=1900000010 credit-service node --input-type=module - verify < credit-service/test/compose.mjs
```
