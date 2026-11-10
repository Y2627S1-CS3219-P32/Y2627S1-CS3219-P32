// AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-31.
// Scope: Types for the order-ranking-service API and the merged "For You" list. Author review: Pending.
import type { Order } from "../order-service/types";

export type RankingPartName = "semantic" | "distance" | "time" | "preference" | "reward";

export interface RankingReason {
  part: RankingPartName;
  text: string;
}

export interface RankingPart {
  // 0 to 1: how well this order fits the courier on this part.
  similarity: number;
  weight: number;
}

export interface RankingContext {
  personalised: boolean;
  pastOrders: number;
  location: "current" | "usual" | null;
  embeddingProvider: "openai" | "hashing";
  unembeddedOrders: number;
}

// As returned by order-ranking-service GET /rankings.
export interface RankingResponse {
  items: { orderId: string; score: number; parts: Partial<Record<RankingPartName, RankingPart>>; reasons: RankingReason[] }[];
  context: RankingContext;
}

// The frontend's /api/order-ranking-service/rankings: each ranking with its full order.
export interface RankedOrder {
  order: Order;
  score: number;
  parts: Partial<Record<RankingPartName, RankingPart>>;
  reasons: RankingReason[];
}

export interface RankedOrderList {
  items: RankedOrder[];
  context: RankingContext;
}

export interface RankingPreferences {
  supplierTypes: string[];
  buildings: string[];
  minReward: number | null;
  note: string | null;
}
