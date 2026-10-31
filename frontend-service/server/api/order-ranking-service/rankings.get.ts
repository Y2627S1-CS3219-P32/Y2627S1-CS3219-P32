// AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-31.
// Scope: Nuxt endpoint for the "For You" list: the ranking from order-ranking-service,
// with each order's details from order-service (the ranking service keeps only what it
// needs to rank). Orders that are no longer open are left out. Author review: Pending.
import type { RankedOrderList } from "#shared/services/order-ranking-service/types";
import { getRankings, rankingQuery } from "../../services/order-ranking-service/client";
import { getOrder } from "../../services/order-service/client";

export default defineEventHandler(async (event): Promise<RankedOrderList> => {
  const ranking = await getRankings(event, rankingQuery(event));
  const orders = await Promise.all(ranking.items.map(async (item) => {
    try {
      return await getOrder(event, item.orderId);
    } catch {
      // Just accepted or removed since it was ranked.
      return null;
    }
  }));
  return {
    items: ranking.items.flatMap((item, index) => {
      const order = orders[index];
      return order && order.state === "OPEN" ? [{ order, score: item.score, parts: item.parts, reasons: item.reasons }] : [];
    }),
    context: ranking.context,
  };
});
