import { z } from 'zod';
import { mandateId, userId } from './ids.js';
import type { UserId, Id, Json } from './conversation.js';
export type MandateId = Id<'mandate'>;
export type MandateConstraint =
  | { type: 'supplier_id'; value: string }
  | { type: 'max_credit_amount'; value: number };
export interface MandateTerms {
  // An absent constraint type is unrestricted. Supplier values are verified stable IDs.
  constraints: MandateConstraint[];
  starts_at: string; expires_at: string | null;
}
export interface CreateMandate { business_key_id: string; title: string; terms: MandateTerms }
export interface ApprovalRequest { mandate_id: MandateId; terms_hash: string; consent: true }
export interface Mandate extends CreateMandate {
  id: MandateId; user_id: UserId; terms_hash: string; approval_expires_at?: string | null; revoked_at?: string | null;
  status: 'pending' | 'active' | 'paused' | 'revoked' | 'expired';
}
export type ExactAction =
  | { action: 'order.create'; supplier_id: string; credit_amount: number; order: Json }
  | { action: 'order.cancel'; order_id: string };
export interface CoverageRequest { user_id: UserId; action: ExactAction }
export type Coverage = { covered: true; mandate: Mandate } | { covered: false; reason: string };

export const termsSchema = z
  .object({
    constraints: z
      .array(
        z.discriminatedUnion('type', [
          z.object({ type: z.literal('supplier_id'), value: z.uuid() }).strict(),
          z
            .object({
              type: z.literal('max_credit_amount'),
              value: z.number().int().nonnegative().safe(),
            })
            .strict(),
        ]),
      )
      .max(50)
      .refine((items) => items.filter((item) => item.type === 'max_credit_amount').length <= 1),
    starts_at: z.iso.datetime(),
    expires_at: z.iso.datetime().nullable().optional(),
  })
  .strict()
  .transform(value => ({ ...value, expires_at: value.expires_at === undefined ? new Date(Date.parse(value.starts_at) + 30 * 86400000).toISOString() : value.expires_at }))
  .refine(
    (value) => value.expires_at === null || Date.parse(value.expires_at) > Date.parse(value.starts_at),
    'Invalid validity interval',
  );
export const mandateSchema = z.object({
  id: mandateId,
  user_id: userId,
  business_key_id: z.string().min(1).max(200),
  title: z.string().trim().min(1).max(100).default('Order authorization'),
  revoked_at: z.iso.datetime().nullable().default(null),
  approval_expires_at: z.iso.datetime().nullable().default(null),
  terms_hash: z.string().min(1),
  status: z.enum(['pending', 'active', 'paused', 'revoked', 'expired']),
  terms: termsSchema,
});
export const orderInputSchema = z
  .object({
    supplierId: z.uuid(),
    title: z.string().trim().min(1).max(100),
    description: z.string().trim().min(1).max(500),
    deliveryLocation: z.string().trim().min(1).max(256),
    creditReward: z.number().int().positive().max(2147483647),
    isGroupOrder: z.literal(false).default(false),
  })
  .strict();
export const actionSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('order.create'),
      supplier_id: z.uuid(),
      credit_amount: z.number().int().positive().max(2147483647),
      order: orderInputSchema,
    })
    .strict()
    .refine(
      (value) =>
        value.supplier_id === value.order.supplierId &&
        value.credit_amount === value.order.creditReward,
      'Order terms mismatch',
    ),
  z.object({ action: z.literal('order.cancel'), order_id: z.uuid() }).strict(),
]);
