// AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-17.
// Scope: Display rules for orders after the student's mockups: tab groups, state colours
// and labels, the action each viewer can take, history wording, and Singapore-time
// formatting. order-service enforces the rules; these only decide what to show.
// Author review: Pending.
// Claude Code (Opus 5.5), 2026-10-17: group orders. Author review: Pending.
// Claude Code (Opus 5.5), 2026-10-17: Mine tab (the viewer's own requests). Author review: Pending.
import type { Order, OrderAction, OrderEvent, OrderState } from "#shared/services/order-service/types";

// Mine lists the viewer's own requests (GET /orders/me) in every state.
export const ORDER_TABS = [
  { key: "all", label: "All", states: "", mine: false },
  { key: "open", label: "Open", states: "OPEN", mine: false },
  { key: "in-progress", label: "In Progress", states: "ACCEPTED,PICKED_UP,DELIVERED", mine: false },
  { key: "done", label: "Done", states: "COMPLETE,SETTLED,CANCELLED,EXPIRED,REJECTED,ABORTED", mine: false },
  { key: "mine", label: "Mine", states: "", mine: true },
] as const;

const STATES: Record<OrderState, { label: string; accent: string }> = {
  SYNCHRONISING: { label: "Group Draft", accent: "bg-[#7a5cc2]" },
  PENDING: { label: "Pending", accent: "bg-[#8a9099]" },
  OPEN: { label: "Open", accent: "bg-[#3b78c4]" },
  ACCEPTED: { label: "Accepted", accent: "bg-[#d4a03a]" },
  PICKED_UP: { label: "Picked Up", accent: "bg-[#d4a03a]" },
  DELIVERED: { label: "Delivered", accent: "bg-[#d4a03a]" },
  COMPLETE: { label: "Completed", accent: "bg-[#3f9a62]" },
  SETTLED: { label: "Completed", accent: "bg-[#3f9a62]" },
  CANCELLED: { label: "Cancelled", accent: "bg-[#d9534f]" },
  EXPIRED: { label: "Expired", accent: "bg-[#d9534f]" },
  REJECTED: { label: "Rejected", accent: "bg-[#d9534f]" },
  ABORTED: { label: "Failed", accent: "bg-[#d9534f]" },
};

export const stateLabel = (state: OrderState) => STATES[state].label;
export const stateAccent = (state: OrderState) => STATES[state].accent;

// The grey status bar under a card.
export function statusText(order: Order, viewerId: number | undefined): string {
  switch (order.state) {
    case "SYNCHRONISING": return "The group is writing the order";
    case "PENDING": return "Reserving credits…";
    case "OPEN": return isMember(order, viewerId) ? "You cannot accept your own order" : "Open";
    case "ACCEPTED":
    case "PICKED_UP": return "In Progress";
    case "DELIVERED": return order.requester.id === viewerId ? "Marked as Delivered" : "Awaiting Confirmation";
    case "REJECTED": return "Rejected: not enough credits";
    case "ABORTED": return "Could not be created";
    default: return stateLabel(order.state);
  }
}

export interface ActionChoice {
  action: OrderAction;
  label: string;
  tone: "primary" | "danger";
}

// The action this viewer can take now, if any.
export function availableAction(order: Order, viewerId: number | undefined): ActionChoice | null {
  if (viewerId === undefined) return null;
  const isRequester = order.requester.id === viewerId;
  const isCourier = order.courier?.id === viewerId;
  switch (order.state) {
    case "SYNCHRONISING":
    case "PENDING": return isRequester ? { action: "cancel", label: "Cancel Order", tone: "danger" } : null;
    case "OPEN":
      if (isRequester) return { action: "cancel", label: "Cancel Order", tone: "danger" };
      // Group members are part of the request, so they cannot accept it.
      return isMember(order, viewerId) ? null : { action: "accept", label: "Accept", tone: "primary" };
    case "ACCEPTED": return isCourier ? { action: "pickup", label: "Mark as Picked Up", tone: "primary" } : null;
    case "PICKED_UP": return isCourier ? { action: "deliver", label: "Mark as Delivered", tone: "primary" } : null;
    case "DELIVERED": return isRequester ? { action: "confirm", label: "Mark as Completed", tone: "primary" } : null;
    default: return null;
  }
}

export const canEdit = (order: Order, viewerId: number | undefined) =>
  order.state === "OPEN" && order.requester.id === viewerId;

export const isMember = (order: Order, viewerId: number | undefined) =>
  viewerId !== undefined && (order.requester.id === viewerId || order.members.some(member => member.id === viewerId));

export const personName = (person: { displayName: string | null } | null) => person?.displayName || "Unknown user";

// "The order was accepted by" + actor name (bold in the UI).
export function historyText(event: OrderEvent): { text: string; actor: string | null } {
  const by = (text: string) => ({ text: `${text} by`, actor: personName(event.actor) });
  switch (event.type) {
    // A group order's order.created comes later, when the requester places it.
    case "order.created": return event.sequence > 1 ? by("The group order was placed") : { text: "The order was created", actor: null };
    case "order.group_started": return { text: "The group order was started", actor: null };
    case "order.member_joined": return { text: "The group order was joined by", actor: personName(event.actor) };
    case "order.opened": return { text: "The order was opened to couriers", actor: null };
    case "order.rejected": return { text: "The order was rejected: not enough credits", actor: null };
    case "order.aborted": return { text: "The order could not be created", actor: null };
    case "order.edited": return { text: "The order was edited", actor: null };
    case "order.accepted": return by("The order was accepted");
    case "order.cancelled": return { text: "The order was cancelled", actor: null };
    case "order.expired": return { text: "The order expired", actor: null };
    case "order.picked_up": return by("The order was picked up");
    case "order.delivered": return by("The order was marked delivered");
    case "order.completed": return { text: "The order was completed", actor: null };
    case "order.settled": return { text: "The reward was transferred", actor: null };
    default: return { text: event.type, actor: null };
  }
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"];
const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const parts = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Singapore",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function singaporeParts(value: string) {
  const fields = Object.fromEntries(parts.formatToParts(new Date(value)).map((part) => [part.type, part.value]));
  return {
    day: Number(fields.day),
    month: Number(fields.month) - 1,
    year: fields.year ?? "",
    time: `${fields.hour}${fields.minute}`,
  };
}

// "9 Sept 2026"
export function formatDay(value: string): string {
  const { day, month, year } = singaporeParts(value);
  return `${day} ${MONTHS[month]} ${year}`;
}

// "10 Sept 2026 1800"
export function formatDateTime(value: string): string {
  return `${formatDay(value)} ${singaporeParts(value).time}`;
}

// "09-Sep-2026 1130"
export function formatStamp(value: string): string {
  const { day, month, year, time } = singaporeParts(value);
  return `${String(day).padStart(2, "0")}-${SHORT_MONTHS[month]}-${year} ${time}`;
}
