import { generateMandateTitle } from '../model.js';
import { createHash } from 'node:crypto';
import * as mandates from '../../clients/mandate.js';
import * as orders from '../../clients/order.js';
import * as credits from '../../clients/credit.js';
import * as suppliers from '../../clients/supplier.js';
import { encodeBusinessKey } from '@campus/agent-contracts/conversation';
import { z } from 'zod';
import type { MandateTerms, MandateId, ExactAction } from '@campus/agent-contracts/mandates';
import { orderInputSchema } from '@campus/agent-contracts/mandates';
import type { ToolContext, ToolResult } from '@campus/agent-contracts/tools';
export async function get_credit_balance(
  _input: Record<string, never>,
  context: ToolContext,
): Promise<ToolResult> {
  return { ok: true, data: await credits.getBalance(context.user_id, context.signal) };
}

export async function search_suppliers(
  input: { query: string; supplier_ids: string[] },
  context: ToolContext,
): Promise<ToolResult> {
  return {
    ok: true,
    data: await suppliers.searchSuppliers(context.user_id, input.query, context.signal, input.supplier_ids),
  };
}
export async function get_order(
  input: { order_id: string },
  context: ToolContext,
): Promise<ToolResult> {
  return { ok: true, data: await orders.getOrder(context.user_id, input.order_id, context.signal) };
}
export async function get_mandate(
  input: { mandate_id: MandateId },
  context: ToolContext,
): Promise<ToolResult> {
  return {
    ok: true,
    data: { ...(await mandates.getMandate(context.user_id, input.mandate_id, context.signal)) },
  };
}
export async function propose_mandate(
  terms: MandateTerms,
  context: ToolContext,
): Promise<ToolResult> {
  const ids = terms.constraints
    .filter((value) => value.type === 'supplier_id')
    .map((value) => value.value);
  let supplierNames: string[] = [];
  if (ids.length) {
    const found = z
      .array(z.object({ id: z.string(), name: z.string() }))
      .parse(await suppliers.searchSuppliers(context.user_id, '', context.signal, ids));
    supplierNames = found.map(supplier => supplier.name);
    if (ids.some((id) => !found.some((supplier) => supplier.id === id)))
      return {
        ok: false,
        error: {
          code: 'INVALID_SUPPLIER',
          message: 'Choose existing active supplier IDs',
          retryable: false,
        },
      };
  }
  const title = await generateMandateTitle(
    JSON.stringify({ suppliers: supplierNames, terms }),
    'Order Authorisation', context.signal,
  );
  const mandate = await mandates.createMandate(
    context.user_id,
    { business_key_id: encodeBusinessKey(context.conversation_id, context.turn_id), title, terms },
    context.signal,
  );
  return { ok: true, data: { ...mandate } };
}
export async function place_order(
  input: z.infer<typeof orderInputSchema>,
  context: ToolContext,
): Promise<ToolResult> {
  const action: Extract<ExactAction, { action: 'order.create' }> = {
    action: 'order.create', supplier_id: input.supplierId, credit_amount: input.creditReward, order: input,
  };
  const coverage = await mandates.checkMandateCoverage(
    { user_id: context.user_id, action },
    context.signal,
  );
  if (!coverage.covered)
    return {
      ok: false,
      error: { code: 'MANDATE_REQUIRED', message: coverage.reason, retryable: false },
    };
  const order = await orders.submitOrderCommand(context.user_id, action, context.turn_id, context.signal);
  return { ok: true, data: order, resource_id: order.id };
}
export async function cancel_order(
  input: { order_id: string },
  context: ToolContext,
): Promise<ToolResult> {
  const hash = createHash('sha256')
    .update(`${context.turn_id}:cancel:${input.order_id}`)
    .digest('hex');
  const commandId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-8${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  const order = await orders.submitOrderCommand(context.user_id, { action: 'order.cancel', order_id: input.order_id }, commandId, context.signal);
  return { ok: true, data: order, resource_id: order.id };
}
