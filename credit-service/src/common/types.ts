import { randomUUID } from 'node:crypto';

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

export function formatOutcome(
  data: Omit<Outcome, 'status' | 'httpStatus'>,
): Outcome {
  return {
    ...data,
    status: data.code === 'OK' ? 'SUCCEEDED' : 'REJECTED',
    httpStatus: data.code === 'OK' ? 200 : 409,
  };
}

export function outcomeEvent(
  kind: Kind | 'ALLOCATE',
  correlationId: string,
  result: Outcome,
): OutcomeEvent {
  const types = {
    ALLOCATE: 'credit.account_allocated',
    [OPERATION_KIND.RESERVE]: 'credit.reserved',
    [OPERATION_KIND.RELEASE]: 'credit.released',
    [OPERATION_KIND.TRANSFER]: 'credit.transferred',
  };
  const type =
    result.status === 'REJECTED'
      ? kind === OPERATION_KIND.RESERVE
        ? 'credit.reservation_rejected'
        : 'credit.order_rejected'
      : result.applied
        ? types[kind]
        : 'credit.order_succeeded';
  return {
    eventId: randomUUID(),
    type,
    occurredAt: new Date().toISOString(),
    requestId: result.requestId,
    correlationId,
    ...(result.orderId ? { orderId: result.orderId } : {}),
    data: result,
  };
}
