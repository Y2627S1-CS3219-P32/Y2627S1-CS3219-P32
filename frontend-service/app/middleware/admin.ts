// AI Assistance Disclosure: ChatGPT (GPT-6), 2026-09-29.
// Scope: Restrict administrator-only pages to users with the admin role. Author review: Pending.
export default defineNuxtRouteMiddleware(async () => {
  const user = await useRequestFetch()<{ role: string }>("/api/user-service/me");
  if (user.role !== "admin") {
    return navigateTo("/profile");
  }
});
