<!-- AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-31.
Scope: Order-ranking-service design, setup, endpoint and event documentation. Author review: Pending.
Claude Code (Opus 5.5), 2026-11-01. Scope: Delivered history, supplier re-embedding and the time reason. Author review: Pending. -->
# Order Ranking Service

Smart request-to-courier matching (nice-to-have). Ranks open orders for each courier
instead of manual filtering, and explains every suggestion. Express, Drizzle, and
PostgreSQL with pgvector, consuming Google Pub/Sub events.

```sh
npm install
npm run db:migrate   # needs DATABASE_URL; the database must have the pgvector extension available
npm run dev
```

## How it works

1. **Local copies.** `order-events` carry the full order, so every event replaces this
   service's copy of the order (only a newer `sequence` applies). `supplier-events` give
   each supplier's pickup coordinates, type and building (latest version only).
2. **Embedding.** Each order's title, description and pickup place are embedded as 1536
   numbers (OpenAI `text-embedding-3-small`). This runs in the background, never inside
   the event handler, so an OpenAI outage cannot hold up order events. Failures back off
   1, 2, 4… minutes, up to `EMBEDDING_MAX_ATTEMPTS`. The order is embedded again when
   its title, description or supplier changes, and when its supplier arrives later or
   changes name or type; an embedding of the old text still in flight is not stored. A
   courier's free-text preference note is embedded the same way.
3. **Ranking.** `GET /rankings` compares each open order (not the caller's own) with the
   caller's past deliveries (their orders in `DELIVERED`, `COMPLETE` or `SETTLED`;
   accepted orders not yet delivered are left out) and preferences, in separate parts,
   each a similarity from 0 to 1:

| Part | Similarity | Reason shown when it reaches the threshold |
| --- | --- | --- |
| `semantic` | Highest cosine similarity to an order the courier delivered, or to their note | `Like 3 orders you've delivered, such as "Gong Cha run"` |
| `distance` | `exp(-metres / 800)` from the courier's location (or, without it, the centre of their past pickups) | `Gong Cha (COM2) is 350 m from you` |
| `time` | How well now fits the hours the courier took the orders they delivered, with past orders similar to this one counting more. Time of day is a point on a circle (sin, cos), so 11pm is close to 1am | `You often take orders like this around 1pm` when a past order at this hour has a similar embedding; otherwise `You often take orders around 1pm` |
| `preference` | Share of the courier's set preferences (types, buildings, minimum reward) the order meets; otherwise the share of their past orders from the same supplier type | `Food/Coffee is one of your preferred types` |
| `reward` | Position among open orders by reward | `Pays more than most open orders (8 credits)` |

   The score is the weighted average of the parts that have data (a new courier has no
   `semantic` or `time` part). A part becomes a reason only when its similarity reaches
   its threshold, so every reason is backed by a number the response also returns.
   Keeping the parts separate, rather than appending time and coordinates to the
   embedding as one longer vector, is what makes each one explainable and lets the
   weights change without re-embedding.

## Endpoints

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/rankings?lat=&lng=&limit=` | Open orders ranked for the caller. `lat`/`lng` optional (both or neither); `limit` 1–100, default 24 |
| `GET` | `/preferences/me` | `{ supplierTypes, buildings, minReward, note }` |
| `PUT` | `/preferences/me` | Same body; all fields optional, `note` up to 500 characters |

`GET /rankings` returns:

```json
{
  "items": [{
    "orderId": "…",
    "score": 0.82,
    "parts": { "semantic": { "similarity": 0.71, "weight": 0.4 }, "distance": { "similarity": 0.9, "weight": 0.25 } },
    "reasons": [{ "part": "semantic", "text": "Like 3 orders you've delivered, such as \"Gong Cha run\"" }]
  }],
  "context": { "personalised": true, "pastOrders": 3, "location": "current", "embeddingProvider": "openai", "unembeddedOrders": 0 }
}
```

The frontend joins each `orderId` with the order from order-service.

## Internal routes

| Route | Caller |
| --- | --- |
| `POST /internal/pubsub/order-events`, `/supplier-events` | Pub/Sub push |
| `POST /internal/embeddings/process` | Cloud Scheduler, every minute (locally `order-ranking-ticker`): retries failed embeddings |

## Configuration

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Ranking database with pgvector (Compose: `postgres://ranking:ranking@localhost:5440/rankings`) |
| `JWT_SECRET` | Same secret as user-service; tokens are verified locally |
| `PORT` | Defaults to `3000` (Compose publishes it on host port `3006`) |
| `OPENAI_API_KEY` | Enables OpenAI embeddings. Without it, a keyless hashing embedder is used, which only matches shared words |
| `EMBEDDING_PROVIDER` | `openai` or `hashing`; defaults to `openai` when a key is set |
| `EMBEDDING_MODEL`, `OPENAI_BASE_URL` | Default `text-embedding-3-small` and `https://api.openai.com/v1` |
| `EMBEDDING_MAX_ATTEMPTS`, `EMBEDDING_BATCH_SIZE` | Default `5` and `50` |
| `RANK_WEIGHT_SEMANTIC`, `_DISTANCE`, `_TIME`, `_PREFERENCE`, `_REWARD` | Part weights; default `0.4`, `0.25`, `0.15`, `0.15`, `0.05` |
| `RANK_THRESHOLD_SEMANTIC`, `_DISTANCE`, `_TIME`, `_REWARD` | Reason thresholds; default `0.5` (`0.3` with hashing), `0.5`, `0.6`, `0.75` |
| `RANK_DISTANCE_SCALE_METRES`, `RANK_HISTORY_SIZE`, `RANK_TIME_ZONE` | Default `800`, `50`, `Asia/Singapore` |
| `INTERNAL_SHARED_SECRET` | Local development only: authenticates internal routes |
| `INTERNAL_AUDIENCE`, `INTERNAL_INVOKER_EMAILS` | Cloud: accepted audience and service accounts for Google OIDC tokens |
| `PUBSUB_EMULATOR_HOST`, `PUBSUB_PROJECT_ID`, `PUBSUB_PUSH_BASE_URL` | Local emulator; push subscriptions are created at startup |

Tests need a PostgreSQL server with pgvector that can create a disposable database. OpenAI
is replaced by a local stand-in server, so no key is needed:

```sh
docker run -d --name ranking-test-db -e POSTGRES_PASSWORD=test -p 127.0.0.1:5499:5432 pgvector/pgvector:pg17
TEST_DATABASE_URL=postgres://postgres:test@127.0.0.1:5499/postgres npm test
```
