CREATE TABLE IF NOT EXISTS credit_accounts (
 user_id INTEGER PRIMARY KEY CHECK(user_id > 0),
 total_credits BIGINT NOT NULL CHECK(total_credits BETWEEN 0 AND 9007199254740991),
 reserved_credits BIGINT NOT NULL CHECK(reserved_credits BETWEEN 0 AND total_credits),
 deleted_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS credit_orders (
 request_id UUID PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('ALLOCATE','RESERVE','TRANSFER','RELEASE')),
 initial_grant BIGINT CHECK(initial_grant BETWEEN 1 AND 9007199254740991), request_payload JSONB NOT NULL,
 order_id UUID, user_id INTEGER NOT NULL REFERENCES credit_accounts(user_id),
 status TEXT NOT NULL CHECK(status IN ('SUCCEEDED','REJECTED')), result JSONB NOT NULL,
 correlation_id UUID NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK((kind = 'ALLOCATE' AND initial_grant IS NOT NULL AND order_id IS NULL) OR (kind <> 'ALLOCATE' AND initial_grant IS NULL AND order_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS credit_one_allocation ON credit_orders(user_id) WHERE kind='ALLOCATE' AND status='SUCCEEDED';
CREATE UNIQUE INDEX IF NOT EXISTS credit_one_movement ON credit_orders(order_id,kind) WHERE status='SUCCEEDED' AND result->>'applied'='true';
CREATE INDEX IF NOT EXISTS credit_history ON credit_orders(order_id,kind,status);
CREATE TABLE IF NOT EXISTS credit_transactions (
 transaction_id UUID PRIMARY KEY, credit_order_request_id UUID NOT NULL UNIQUE REFERENCES credit_orders(request_id),
 debit_user_id INTEGER REFERENCES credit_accounts(user_id), credit_user_id INTEGER NOT NULL REFERENCES credit_accounts(user_id),
 debit_bucket TEXT NOT NULL CHECK(debit_bucket IN ('AVAILABLE','RESERVED','ISSUANCE')),
 credit_bucket TEXT NOT NULL CHECK(credit_bucket IN ('AVAILABLE','RESERVED')),
 amount BIGINT NOT NULL CHECK(amount BETWEEN 1 AND 9007199254740991), created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK((debit_user_id IS NULL) = (debit_bucket='ISSUANCE'))
);
CREATE TABLE IF NOT EXISTS credit_outbox (
 event_id UUID PRIMARY KEY, request_id UUID NOT NULL UNIQUE REFERENCES credit_orders(request_id), payload JSONB NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(), published_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS credit_unpublished ON credit_outbox(created_at) WHERE published_at IS NULL;
