// AI Assistance Disclosure: ChatGPT (GPT-6), 2026-09-29.
// Scope: Protect every administrator route. Author review: Done.
function isUnauthorized(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if ("statusCode" in error && error.statusCode === 401) return true;
  if ("status" in error && error.status === 401) return true;
  return "response" in error &&
    typeof error.response === "object" &&
    error.response !== null &&
    "status" in error.response &&
    error.response.status === 401;
}

export default defineNuxtRouteMiddleware(async (to) => {
  if (to.path !== "/admin" && !to.path.startsWith("/admin/")) return;

  try {
    const user = await useRequestFetch()<{ role: string }>("/api/user-service/me");
    if (user.role !== "admin") {
      return navigateTo("/profile");
    }
  } catch (error) {
    if (isUnauthorized(error)) {
      return navigateTo({ path: "/login", query: { redirect: to.fullPath } });
    }
    throw error;
  }
});
