import type { User } from "#shared/services/user-service/types";

export function useUsers() {
  return useFetch<User[]>("/api/user-service/users", {
    default: () => [],
  });
}