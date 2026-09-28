// AI Assistance Disclosure: ChatGPT (GPT-6), 2026-09-28.
// Scope: Nuxt runtime and frontend configuration. Author review: pending.
import tailwindcss from "@tailwindcss/vite";

export default defineNuxtConfig({
  compatibilityDate: "2026-09-28",
  devtools: { enabled: false },
  css: ["~/assets/css/main.css"],
  runtimeConfig: {
    supplierServiceBaseUrl: "http://127.0.0.1:3000",
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
