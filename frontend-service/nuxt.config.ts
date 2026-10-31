// AI Assistance Disclosure: ChatGPT (GPT-6), 2026-09-28.
// Scope: Nuxt runtime and frontend configuration. Author review: Done.
// Claude Code (Opus 5.5), 2026-10-17: order-service base URL. Author review: Pending.
// Claude Code (Opus 5.5), 2026-10-17: notification-service URLs. Author review: Pending.
// Claude Code (Opus 5.5), 2026-10-31: order-ranking-service base URL. Author review: Pending.
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
    orderRankingServiceBaseUrl: "http://127.0.0.1:3006",
    // Server-side, for issuing tickets.
    notificationServiceBaseUrl: "http://127.0.0.1:3003",
    public: {
      // Browser-side WebSocket base URL (wss://… in Cloud).
      notificationServiceUrl: "ws://127.0.0.1:3003",
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
