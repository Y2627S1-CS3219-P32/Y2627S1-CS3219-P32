// AI Assistance Disclosure: ChatGPT (GPT-6), 2026-09-28.
// Scope: Nuxt runtime and frontend configuration. Author review: pending.
export default defineNuxtConfig({
  compatibilityDate: "2026-09-28",
  devtools: { enabled: false },
  css: ["~/assets/css/main.css"],
  runtimeConfig: {
    supplierServiceBaseUrl: "http://127.0.0.1:3000",
  },
  nitro: { preset: "node-server" },
  typescript: { strict: true },
  app: {
    head: {
      title: "Explore suppliers · Friend on Campus",
      htmlAttrs: { lang: "en" },
      meta: [{ name: "description", content: "Find food, essentials and services around campus with Friend on Campus." }],
    },
  },
});
