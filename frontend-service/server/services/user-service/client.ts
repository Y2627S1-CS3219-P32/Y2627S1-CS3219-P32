// AI Assistance Disclosure: ChatGPT (GPT-6), 2026-09-29.
// Scope: Server-side client for the user service. Author review: Done.
import type { User } from "#shared/services/user-service/types";

export function fetchUsers(baseURL: string) {
  return $fetch<User[]>("/users", {
    baseURL,
    timeout: 5000,
    retry: 0,
  });
}
