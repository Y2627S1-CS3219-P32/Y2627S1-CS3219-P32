<!-- AI Assistance Disclosure: ChatGPT (GPT-6), 2026-09-28.
Scope: Service-specific frontend boundary. Author review: Done.
Claude Code (Opus 5.5), 2026-10-17: describe the order pages. Author review: Pending. -->
# Order service frontend

Order components, composables and display rules (`order-view.ts`) live here. Pages are in
`app/pages/orders/`, shared request/response types in `shared/services/order-service/`, and
the Nuxt server client and routes (which forward the user's token to order-service) in
`server/services/order-service/` and `server/api/order-service/`.
