import { CreditError } from './types.js';

export function parseUuid(value: unknown, errorCode: string): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    throw new CreditError(errorCode);
  return value.toLowerCase();
}

export function parsePositiveInt32(value: unknown, errorCode: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > 2147483647
  )
    throw new CreditError(errorCode);
  return value;
}
