// AI Assistance Disclosure: ChatGPT (GPT-6), 2026-09-30.
// Scope: Redirect visitors to first-administrator setup when bootstrap is available. Author review: Done.
function isNotFound(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if ("statusCode" in error && error.statusCode === 404) return true;
  if ("status" in error && error.status === 404) return true;
  return "response" in error &&
    typeof error.response === "object" &&
    error.response !== null &&
    "status" in error.response &&
    error.response.status === 404;
}

export default defineNuxtRouteMiddleware(async (to) => {
  if (to.path === "/setup/admin") return;

  try {
    await useRequestFetch()("/api/user-service/bootstrap");
    return navigateTo("/setup/admin", { replace: true });
  } catch (error) {
    if (isNotFound(error)) return;
    throw error;
  }
});
