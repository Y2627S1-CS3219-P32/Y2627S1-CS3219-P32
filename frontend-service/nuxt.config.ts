// AI Assistance Disclosure: ChatGPT (GPT-6), 2026-09-28.
// Scope: Nuxt runtime and frontend configuration. Author review: Done.
// Claude Code (Opus 5.5), 2026-10-17: order-service base URL. Author review: Pending.
// Claude Code (Opus 5.5), 2026-10-17: notification-service URLs. Author review: Pending.
// Claude Code (Opus 5.5), 2026-10-17: sync-service URLs. Author review: Pending.
import tailwindcss from "@tailwindcss/vite";

export default defineNuxtConfig({
  compatibilityDate: "2026-09-28",
  devtools: { enabled: false },
  css: ["~/assets/css/main.css"],
  runtimeConfig: {
    supplierServiceBaseUrl: "http://127.0.0.1:3000",
    userServiceBaseUrl: "http://127.0.0.1:3333",
    creditServiceBaseUrl: "http://127.0.0.1:3004",
    orderServiceBaseUrl: "http://127.0.0.1:3002",
    // Server-side, for issuing tickets.
    notificationServiceBaseUrl: "http://127.0.0.1:3003",
    syncServiceBaseUrl: "http://127.0.0.1:3005",
    public: {
      // Browser-side WebSocket base URL (wss://… in Cloud).
      notificationServiceUrl: "ws://127.0.0.1:3003",
      // Browser-side base for group order documents (wss://… in Cloud).
      syncServiceUrl: "ws://127.0.0.1:3005",
    },
  },
  nitro: { preset: "node-server" },
  typescript: { strict: true },
  vite: {
    plugins: [tailwindcss()],
  },
  app: {
    head: {
      title: "Friends of Campus",
      htmlAttrs: { lang: "en" },
      meta: [{ name: "description", content: "A place for your campus errands." }],
    },
  },
});
