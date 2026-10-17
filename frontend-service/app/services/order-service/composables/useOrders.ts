// AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-17.
// Scope: The signed-in user's id for order views, and running order actions with error
// messages and a login redirect on 401. Author review: Pending.
import type { Order, OrderAction } from "#shared/services/order-service/types";
import type { User } from "#shared/services/user-service/types";

export function statusOf(value: unknown): number | undefined {
  return typeof value === "object" && value !== null && "statusCode" in value && typeof value.statusCode === "number"
    ? value.statusCode
    : undefined;
}

// app.vue loads the signed-in user for the navigation bar.
export function useViewerId() {
  const { data } = useNuxtData<User | null>("navigation-user");
  return computed(() => data.value?.id);
}

export function useOrderActions() {
  const route = useRoute();
  const busy = ref(false);
  const error = ref("");

  async function run<T>(request: () => Promise<T>, fallback: string): Promise<T | undefined> {
    busy.value = true;
    error.value = "";
    try {
      return await request();
    } catch (failure) {
      if (statusOf(failure) === 401) {
        await navigateTo({ path: "/login", query: { redirect: route.fullPath } });
        return undefined;
      }
      error.value = getApiErrorMessage(failure) ?? fallback;
      return undefined;
    } finally {
      busy.value = false;
    }
  }

  const perform = (orderId: string, action: OrderAction) => run(
    () => $fetch<Order>(`/api/order-service/orders/${encodeURIComponent(orderId)}/${action}`, { method: "POST" }),
    "The order could not be updated. Please try again.",
  );

  return { busy, error, run, perform };
}
