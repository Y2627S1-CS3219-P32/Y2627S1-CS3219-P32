export const OPERATION_KIND = {
  RESERVE: "RESERVE",
  RELEASE: "RELEASE",
  TRANSFER: "TRANSFER",
} as const;

export const RESERVATION_STATE = {
  NONE: "NONE",
  HELD: "HELD",
  RELEASED: "RELEASED",
  CANCELLED: "CANCELLED",
  TRANSFERRED: "TRANSFERRED",
} as const;

export type Kind = (typeof OPERATION_KIND)[keyof typeof OPERATION_KIND];
export type State = (typeof RESERVATION_STATE)[keyof typeof RESERVATION_STATE];
type CreditRequest = { requestId: string; correlationId: string; orderId: string };
export type ReserveCreditsInput = CreditRequest & { requesterId: number; amount: number };
export type ReleaseCreditsInput = ReserveCreditsInput & { reason: string };
export type TransferCreditsInput = CreditRequest & { courierId: number };
export type CreditOperation =
  | (ReserveCreditsInput & { kind: typeof OPERATION_KIND.RESERVE })
  | (ReleaseCreditsInput & { kind: typeof OPERATION_KIND.RELEASE })
  | (TransferCreditsInput & { kind: typeof OPERATION_KIND.TRANSFER });
export type Reservation = {
  reservationState: State;
  requesterId?: number;
  amount?: number;
  courierId?: number;
};
export class CreditError extends Error {
  constructor(public code: string) {
    super(code);
  }
}
export const MAX = 9007199254740991n;
export function money(value: string | bigint): number {
  const amount = BigInt(value);
  if (amount < 0n || amount > MAX) throw new Error("Invalid stored balance");
  return Number(amount);
}
export function operationPayload(operation: CreditOperation) {
  const { requestId, correlationId, ...payload } = operation;
  return payload;
}

export type Account =
  typeof import("../db/schema.js").creditAccounts.$inferSelect;
export type Outcome = {
  requestId: string;
  status: "SUCCEEDED" | "REJECTED";
  httpStatus: number;
  code: string;
  orderId?: string;
  reservationState: State;
  applied: boolean;
  transactionIds: string[];
  requesterId: number;
  amount: number;
  courierId?: number;
  deltas: {
    requesterTotal: number;
    requesterReserved: number;
    courierTotal: number;
  };
};

export type OutcomeEvent = {
  eventId: string;
  type: string;
  occurredAt: string;
  requestId: string;
  correlationId: string;
  orderId?: string;
  data: Outcome;
};
