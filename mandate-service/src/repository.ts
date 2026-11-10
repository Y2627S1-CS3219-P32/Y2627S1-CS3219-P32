import { createHash, randomUUID } from 'node:crypto';
import type { MandateConstraint, MandateId, CreateMandate, ApprovalRequest, UserId } from './common/validation.js';
import { z } from 'zod';
import { sql, rows, transaction } from './db/client.js';
import {
  approvalSchema,
  HttpError,
  mandateId,
  userId,
  mandateSchema,
  termsSchema,
} from './common/validation.js';
interface CreateInput { owner: UserId; request: CreateMandate }
interface ApprovalInput { owner: UserId; request: ApprovalRequest }
interface LifecycleInput {
  owner: UserId; mandate: MandateId; action: 'pause' | 'resume' | 'revoke';
}
const mandateRecordSchema = z
  .object({
    id: mandateId,
    user_id: userId,
    business_key_id: z.string(),
    title: z.string(),
    terms_hash: z.string(),
    status: z.enum(['pending', 'active', 'paused', 'revoked', 'expired']),
    revoked_at: z.coerce.date().nullable(),
    approval_expires_at: z.coerce.date(),
    starts_at: z.coerce.date(),
    expires_at: z.coerce.date().nullable(),
    constraints: z.array(z.object({ constraintType: z.string(), value: z.string() })),
  })
  .transform((value) =>
    mandateSchema.parse({
      ...value,
      status: value.status === 'pending' && value.approval_expires_at.getTime() <= Date.now() ? 'expired' : value.status,
      revoked_at: value.revoked_at?.toISOString() ?? null,
      approval_expires_at: value.approval_expires_at.toISOString(),
      terms: {
        starts_at: value.starts_at.toISOString(),
        expires_at: value.expires_at?.toISOString() ?? null,
        constraints: decodeMandateConstraints(value.constraints),
      },
    }),
  );
const selectMandatesSql = `SELECT m.*,coalesce((SELECT json_agg(json_build_object('constraintType',constraint_type,'value',value) ORDER BY constraint_type,value) FROM mandate_constraints WHERE mandate_id=m.id),'[]') AS constraints FROM mandates m`;
function normalizeMandateTerms(input: unknown) {
  const terms = termsSchema.parse(input);
  const constraints = [
    ...new Map(terms.constraints.map((value) => [`${value.type}:${value.value}`, value])).values(),
  ].sort((a, b) => `${a.type}:${a.value}`.localeCompare(`${b.type}:${b.value}`));
  return {
    constraints,
    starts_at: new Date(terms.starts_at).toISOString(),
    expires_at: terms.expires_at === null ? null : new Date(terms.expires_at).toISOString(),
  };
}
export async function listMandates(owner: UserId, cursor: string | null, approvedOnly = false) {
  const items = await rows(
    mandateRecordSchema,
    `${selectMandatesSql} WHERE m.user_id=$1 ${approvedOnly ? "AND m.approved_at IS NOT NULL" : ""} AND ($2::uuid IS NULL OR m.id<$2) ORDER BY m.id DESC LIMIT 51`,
    [owner, cursor ? mandateId.parse(cursor) : null],
  );
  const more = items.length > 50;
  items.splice(50);
  return { items, next_cursor: more ? (items.at(-1)?.id ?? null) : null };
}
export async function getMandate(owner: UserId, id: MandateId) {
  const [value] = await rows(mandateRecordSchema, `${selectMandatesSql} WHERE m.user_id=$1 AND m.id=$2`, [owner, id]);
  if (!value) throw new HttpError(404, 'Mandate not found');
  return value;
}
export async function createMandate(input: CreateInput) {
  const terms = normalizeMandateTerms(input.request.terms),
    hash = createHash('sha256').update(JSON.stringify(terms)).digest('hex');
  if (terms.expires_at !== null && Date.parse(terms.expires_at) <= Date.now()) throw new HttpError(400, 'Mandate has expired');
  return transaction(async () => {
    await sql('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `mandate:${input.owner}:${input.request.business_key_id}`,
    ]);
    const [existing] = await rows(mandateRecordSchema, `${selectMandatesSql} WHERE m.user_id=$1 AND m.business_key_id=$2`, [
      input.owner,
      input.request.business_key_id,
    ]);
    if (existing) {
      if (existing.terms_hash !== hash)
        throw new HttpError(409, 'Business key already used for different terms');
      return existing;
    }
    const id = mandateId.parse(randomUUID());
    await sql(
      'INSERT INTO mandates(id,user_id,business_key_id,terms_hash,starts_at,expires_at,title) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [id, input.owner, input.request.business_key_id, hash, terms.starts_at, terms.expires_at, input.request.title],
    );
    for (const constraint of terms.constraints)
      await sql(
        'INSERT INTO mandate_constraints(mandate_id,constraint_type,value) VALUES($1,$2,$3)',
        [id, constraint.type, String(constraint.value)],
      );
    return getMandate(input.owner, id);
  });
}
export async function approveMandate(input: ApprovalInput) {
  return transaction(async () => {
    await sql('SELECT id FROM mandates WHERE id=$1 AND user_id=$2 FOR UPDATE', [
      input.request.mandate_id,
      input.owner,
    ]);
    const mandate = await getMandate(input.owner, input.request.mandate_id);
    if (input.request.consent !== true || mandate.terms_hash !== input.request.terms_hash)
      throw new HttpError(409, 'Consent must match the reviewed terms');
    if (mandate.terms.expires_at !== null && Date.parse(mandate.terms.expires_at) <= Date.now())
      throw new HttpError(409, 'Mandate has expired');
    if (mandate.status === 'active') return mandate;
    if (mandate.status === 'pending' && Date.parse(mandate.approval_expires_at ?? '') <= Date.now())
      throw new HttpError(409, 'Proposal has expired');
    if (mandate.status !== 'pending')
      throw new HttpError(409, 'Only a pending mandate can be approved');
    await sql("UPDATE mandates SET status='active',approved_at=now() WHERE id=$1", [mandate.id]);
    const event = approvalSchema.parse({
      schema_version: 1,
      event_id: randomUUID(),
      event_type: 'mandate.approved',
      mandate_id: mandate.id,
      user_id: input.owner,
      business_key_id: mandate.business_key_id,
      occurred_at: new Date().toISOString(),
    });
    await sql(
      'INSERT INTO mandate_outbox(event_id,mandate_id,event_type,payload) VALUES($1,$2,$3,$4)',
      [event.event_id, mandate.id, event.event_type, JSON.stringify(event)],
    );
    return getMandate(input.owner, mandate.id);
  });
}
export async function transitionMandate(input: LifecycleInput) {
  return transaction(async () => {
    await sql('SELECT id FROM mandates WHERE id=$1 AND user_id=$2 FOR UPDATE', [
      input.mandate,
      input.owner,
    ]);
    const mandate = await getMandate(input.owner, input.mandate);
    const target =
      input.action === 'pause' ? 'paused' : input.action === 'resume' ? 'active' : 'revoked';
    if (mandate.status === target) return mandate;
    if (
      ['revoked', 'expired'].includes(mandate.status) ||
      (mandate.terms.expires_at !== null && Date.parse(mandate.terms.expires_at) <= Date.now()) ||
      (input.action === 'pause' && mandate.status !== 'active') ||
      (input.action === 'resume' && mandate.status !== 'paused')
    )
      throw new HttpError(409, 'Invalid mandate transition');
    await sql(
      "UPDATE mandates SET status=$2,revoked_at=CASE WHEN $2='revoked' THEN now() ELSE revoked_at END WHERE id=$1",
      [mandate.id, target],
    );
    return getMandate(input.owner, mandate.id);
  });
}
export async function listPendingApprovalEvents() {
  return rows(
    z.object({ payload: approvalSchema }),
    'SELECT payload FROM mandate_outbox WHERE published_at IS NULL ORDER BY created_at LIMIT 50',
  );
}
export async function markApprovalPublished(id: string) {
  await sql(
    'UPDATE mandate_outbox SET published_at=now() WHERE event_id=$1 AND published_at IS NULL',
    [id],
  );
}
export async function expireMandates() {
  await sql(
    "UPDATE mandates SET status='expired' WHERE status IN ('pending','active','paused') AND (expires_at<=now() OR (status='pending' AND approval_expires_at<=now()))",
  );
}

function parseMandateConstraints(input: unknown): MandateConstraint[] {
  if (!Array.isArray(input)) throw new Error('Constraints must be an array');
  const constraints: MandateConstraint[] = [];
  const values: unknown[] = input;
  for (const item of values) {
    if (typeof item !== 'object' || item === null || !('type' in item) || !('value' in item)) {
      throw new Error('Invalid mandate constraint');
    }
    if (item.type === 'supplier_id' && typeof item.value === 'string' && item.value.trim().length > 0) {
      if (!constraints.some(existing => existing.type === 'supplier_id' && existing.value === item.value)) {
        constraints.push({ type: 'supplier_id', value: item.value });
      }
    } else if (item.type === 'max_credit_amount' && typeof item.value === 'number' && Number.isSafeInteger(item.value) && item.value >= 0) {
      if (constraints.some(existing => existing.type === 'max_credit_amount')) throw new Error('Only one amount limit is allowed');
      constraints.push({ type: 'max_credit_amount', value: item.value });
    } else {
      throw new Error('Unsupported constraint type or value');
    }
  }
  return constraints;
}

export function decodeMandateConstraints(rows: { constraintType: string; value: string }[]): MandateConstraint[] {
  return parseMandateConstraints(rows.map(row => {
    if (row.constraintType === 'max_credit_amount' && !/^(0|[1-9][0-9]{0,15})$/.test(row.value)) {
      throw new Error('Invalid stored amount constraint');
    }
    return { type: row.constraintType, value: row.constraintType === 'max_credit_amount' ? Number(row.value) : row.value };
  }));
}
