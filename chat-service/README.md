# Chat service

The chat service creates one Pub/Sub topic (`order-chat-<order-id>`) per order.
It consumes `order.created` and `order.accepted` from `order-events` to create
the room and add the assigned courier. `order.deleted`, `order.cancelled`,
`order.expired`, and `order.completed` make the room read-only and retain its
messages for 30 days before removing the room and message history.
Chat messages are published to the room's topic and persisted from its Pub/Sub
subscription in PostgreSQL.

Every read and send checks the authenticated user against the room participants:
the requester is allowed from order creation, and the courier is added after
acceptance. Other users receive `403`. The browser polls the message history and
the chat UI is a separate page at `/orders/:id/chat`.

The event subscription name is versioned to apply the updated Pub/Sub filter to
existing deployments.

## Local development

`docker compose up -d --build` starts the chat database, applies migrations,
starts the Pub/Sub subscriber, and configures the frontend proxy. The service is
available at `http://127.0.0.1:3005`. Messages are retained in the chat database
until an order cancellation, expiry, completion, or deletion event removes the room.
