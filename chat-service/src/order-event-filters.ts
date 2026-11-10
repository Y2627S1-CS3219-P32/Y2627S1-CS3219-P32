export const ORDER_EVENT_TYPES = [
  "order.group_started",
  "order.member_joined",
  "order.created",
  "order.accepted",
  "order.deleted",
  "order.cancelled",
  "order.expired",
  "order.completed",
] as const;

export const ORDER_EVENTS_FILTERS = Array.from(
  { length: Math.ceil(ORDER_EVENT_TYPES.length / 4) },
  (_, index) => ORDER_EVENT_TYPES
    .slice(index * 4, index * 4 + 4)
    .map((type) => `attributes.type = "${type}"`)
    .join(" OR "),
);
