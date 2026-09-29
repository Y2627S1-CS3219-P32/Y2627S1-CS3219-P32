// AI Assistance Disclosure: ChatGPT (GPT-6), 2026-09-29.
// Scope: Clear the HttpOnly cookie holding the user-service JWT. Author review: Done.
export default defineEventHandler((event) => {
  deleteCookie(event, "user_access_token", { path: "/" });
  return { success: true };
});
