// AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-17.
// Scope: Types for the order-service API. Author review: Pending.
// Claude Code (Opus 5.5), 2026-10-17: group orders. Author review: Pending.
export type OrderState =
  | "SYNCHRONISING" | "PENDING" | "OPEN" | "REJECTED" | "ABORTED" | "ACCEPTED" | "CANCELLED"
  | "EXPIRED" | "PICKED_UP" | "DELIVERED" | "COMPLETE" | "SETTLED";

export interface OrderPerson {
  id: number;
  displayName: string | null;
}

export interface Order {
  id: string;
  requester: OrderPerson;
  courier: OrderPerson | null;
  // The supplier as it was when the order was created.
  supplier: {
    id: string;
    version: number;
    name: string;
    type: string;
    buildingName: string | null;
    floor: string | null;
    locationDescription: string | null;
    latitude: string;
    longitude: string;
  };
  title: string;
  description: string;
  deliveryLocation: string;
  creditReward: number;
  isGroupOrder: boolean;
  // Group members other than the requester.
  members: OrderPerson[];
  state: OrderState;
  acceptedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrderPage {
  items: Order[];
  nextCursor: string | null;
}

export interface OrderEvent {
  id: string;
  sequence: number;
  type: string;
  state: OrderState;
  actor: OrderPerson | null;
  createdAt: string;
}

export type OrderSort = "createdAt" | "-createdAt" | "reward" | "-reward";

export interface OrderListQuery {
  // One state or a comma-separated list.
  state?: string;
  supplierId?: string;
  sort?: OrderSort;
  limit?: number;
  cursor?: string;
}

export interface OrderCreate {
  isGroupOrder?: boolean;
  supplierId: string;
  title: string;
  description: string;
  deliveryLocation: string;
  creditReward: number;
}

export type OrderEdit = Partial<Pick<OrderCreate, "title" | "description" | "deliveryLocation">>;

export const ORDER_ACTIONS = ["accept", "cancel", "pickup", "deliver", "confirm"] as const;
export type OrderAction = (typeof ORDER_ACTIONS)[number];
