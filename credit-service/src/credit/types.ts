export type Kind = "RESERVE" | "RELEASE" | "TRANSFER";
export type State = "NONE" | "HELD" | "RELEASED" | "CANCELLED" | "TRANSFERRED";
type Base = { requestId: string; correlationId: string; orderId: string };
export type Command = Base &
  (
    | { kind: "RESERVE"; requesterId: number; amount: number }
    | { kind: "RELEASE"; requesterId: number; amount: number; reason: string }
    | { kind: "TRANSFER"; courierId: number }
  );
export type Reservation = {
  reservationState: State;
  requesterId?: number;
  amount?: number;
  courierId?: number;
};
export class CreditError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}
export const MAX = 9007199254740991n;
export function money(value: string | bigint): number {
  const amount = BigInt(value);
  if (amount < 0n || amount > MAX) throw new Error("Invalid stored balance");
  return Number(amount);
}
export function canonical(command: Command) {
  const { requestId, correlationId, ...payload } = command;
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
