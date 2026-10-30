<!-- AI Assistance Disclosure: Codex (GPT-6), 2026-10-18.
Scope: Credit frontend service boundary. Author review: Pending. -->
# Credit service frontend

`components/CreditBalance.vue` fetches the current user's balance on the client.
The profile supplies `userId` to keep the fetch cache scoped to that user.
The component shows available, reserved, and total credits, with loading, setup pending,
and retry states. It does not poll or subscribe to events.

`server/api/credit-service/me.get.ts` requires the login cookie and forwards its bearer
token through `server/services/credit-service/client.ts` to `GET /api/v1/credits/me`.
The client validates the response against `shared/services/credit-service/types.ts`
and hides dependency error details. Only HTTP 503 with `ACCOUNT_PENDING` means setup pending.

`NUXT_CREDIT_SERVICE_BASE_URL` configures the private upstream URL. It defaults to
`http://127.0.0.1:3004` locally. Compose uses `http://credit-service:3000`.
