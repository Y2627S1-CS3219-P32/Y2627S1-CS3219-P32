import { z } from 'zod';
import { orderInputSchema } from '@campus/agent-contracts/mandates';
import * as transport from './transport.js';
import type { UserId } from '@campus/agent-contracts/conversation';
import type { ExactAction } from '@campus/agent-contracts/mandates';
const orderSchema = z.object({
  id: z.uuid(),
  requester: z.object({ id: z.number().int().positive(), displayName: z.string().nullable() }),
  supplier: z.object({ id: z.uuid(), name: z.string() }),
  title: z.string(),
  description: z.string(),
  deliveryLocation: z.string(),
  creditReward: z.number().int().positive(),
  state: z.string(),
});
async function requestOrderService(
  owner: UserId,
  path: string,
  body: unknown,
  commandId: string | null,
  signal: AbortSignal,
) {
  const response = await transport.requestInternalService({
    destination: 'order',
    path,
    method: 'POST',
    body,
    operation_key: commandId,
    signal,
  });
  const order = orderSchema.parse(response);
  if (order.requester.id !== owner) throw new Error('Mismatched order owner');
  return order;
}
export async function getOrder(owner: UserId, id: string, signal: AbortSignal) {
  const order = await requestOrderService(
    owner,
    '/internal/orders/get',
    { user_id: owner, order_id: id },
    null,
    signal,
  );
  if (order.id !== id) throw new Error('Mismatched order response');
  return order;
}
export async function submitOrderCommand(
  owner: UserId,
  action: ExactAction,
  commandId: string,
  signal: AbortSignal,
) {
  const isCreateOrder = action.action === 'order.create';
  const body = {
    ...(isCreateOrder ? orderInputSchema.parse(action.order) : { order_id: action.order_id }),
    user_id: owner,
    command_id: commandId,
  };
  const order = await requestOrderService(
    owner,
    isCreateOrder ? '/internal/orders/create' : '/internal/orders/cancel',
    body,
    commandId,
    signal,
  );
  if (!isCreateOrder && order.id !== action.order_id)
    throw new Error('Mismatched order response');
  return order;
}
