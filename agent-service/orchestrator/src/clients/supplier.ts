import * as transport from './transport.js';
import { z } from 'zod';
import type { UserId, Json } from '@campus/agent-contracts/conversation';

export async function searchSuppliers(
  owner: UserId,
  query: string,
  signal: AbortSignal,
  supplierIds: string[] = [],
): Promise<Json> {
  return parseSupplierResults(
    await transport.requestInternalService({
      destination: 'supplier',
      path: '/internal/suppliers/search',
      method: 'POST',
      body: { user_id: owner, query, supplier_ids: supplierIds, limit: 50 },
      operation_key: null,
      signal,
    }),
  );
}

const supplierResultSchema = z
  .array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      type: z.string(),
      buildingName: z.string().nullable(),
      isActive: z.literal(true),
      isOpen: z.boolean(),
    }),
  )
  .max(50);

function parseSupplierResults(response: unknown) {
  return supplierResultSchema.parse(response);
}
