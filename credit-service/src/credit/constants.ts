export const COMMAND_KIND = {
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

export const COMMAND_TYPES = {
  RESERVE: "credit.reserve",
  RELEASE: "credit.release",
  TRANSFER: "credit.transfer",
} as const;
