import { CreditError, type CreditOperation } from '../common/types.js';
import { OPERATION_KIND } from '../common/constants.js';
import { parseUuid, parsePositiveInt32 } from '../common/validation.js';

export function decodeMessage(body: unknown): unknown {
  if (
    typeof body !== 'object' ||
    body === null ||
    !('message' in body) ||
    typeof body.message !== 'object' ||
    body.message === null ||
    !('data' in body.message) ||
    typeof body.message.data !== 'string' ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(body.message.data)
  )
    throw new CreditError('INVALID_EVENT');
  try {
    return JSON.parse(
      Buffer.from(body.message.data, 'base64').toString('utf8'),
    );
  } catch {
    throw new CreditError('INVALID_EVENT');
  }
}

type UserEvent = {
  type: 'user.created' | 'user.deleted' | 'user.updated';
  eventId: string;
  userId: number;
};

export function parseUserEvent(value: unknown): UserEvent {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('type' in value) ||
    (value.type !== 'user.created' &&
      value.type !== 'user.deleted' &&
      value.type !== 'user.updated') ||
    !('eventId' in value)
  )
    throw new CreditError('INVALID_EVENT');
  const userId =
    value.type === 'user.deleted'
      ? 'userId' in value
        ? value.userId
        : undefined
      : 'user' in value &&
          typeof value.user === 'object' &&
          value.user !== null &&
          'id' in value.user
        ? value.user.id
        : undefined;
  return {
    type: value.type,
    eventId: parseUuid(value.eventId, 'INVALID_EVENT'),
    userId: parsePositiveInt32(userId, 'INVALID_EVENT'),
  };
}

export const COMMAND_TYPES = {
  RESERVE: 'credit.reserve',
  RELEASE: 'credit.release',
  TRANSFER: 'credit.transfer',
} as const;

export function parseCommand(value: unknown): CreditOperation {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('type' in value) ||
    !('requestId' in value) ||
    !('correlationId' in value) ||
    !('orderId' in value)
  )
    throw new CreditError('INVALID_COMMAND');
  const base = {
    requestId: parseUuid(value.requestId, 'INVALID_COMMAND'),
    correlationId: parseUuid(value.correlationId, 'INVALID_COMMAND'),
    orderId: parseUuid(value.orderId, 'INVALID_COMMAND'),
  };
  if (value.type === COMMAND_TYPES.TRANSFER && 'courierId' in value)
    return {
      ...base,
      kind: OPERATION_KIND.TRANSFER,
      courierId: parsePositiveInt32(value.courierId, 'INVALID_COMMAND'),
    };
  if (
    (value.type === COMMAND_TYPES.RESERVE ||
      value.type === COMMAND_TYPES.RELEASE) &&
    'requesterId' in value &&
    'amount' in value
  ) {
    const fields = {
      requesterId: parsePositiveInt32(value.requesterId, 'INVALID_COMMAND'),
      amount: parsePositiveInt32(value.amount, 'INVALID_COMMAND'),
    };
    if (value.type === COMMAND_TYPES.RESERVE)
      return { ...base, ...fields, kind: OPERATION_KIND.RESERVE };
    if (
      'reason' in value &&
      typeof value.reason === 'string' &&
      value.reason.trim() &&
      value.reason.length <= 200
    )
      return {
        ...base,
        ...fields,
        kind: OPERATION_KIND.RELEASE,
        reason: value.reason,
      };
  }
  throw new CreditError('INVALID_COMMAND');
}
