import * as repository from './repository.js';
import type { UserId, Mandate, ExactAction, CoverageRequest, Coverage } from './common/validation.js';
export const { listMandates, getMandate, createMandate, approveMandate, transitionMandate } = repository;
export async function listMandateContext(owner: UserId): Promise<Mandate[]> {
  const items: Mandate[] = [];
  let cursor: string | null = null;
  do {
    const page = await repository.listMandates(owner, cursor);
    items.push(...page.items);
    cursor = page.next_cursor;
  } while (cursor && items.length < 500);
  return items;
}

export async function checkMandateCoverage(input: CoverageRequest): Promise<Coverage> {
  if (input.action.action !== 'order.create')
    return { covered: false, reason: 'Cancellation does not require a mandate' };
  let cursor: string | null = null;
  let reason = 'No active mandate covers this order';
  do {
    const page = await repository.listMandates(input.user_id, cursor);
    for (const mandate of page.items) {
      const result = evaluateMandateCoverage({
        mandate,
        user_id: input.user_id,
        action: input.action,
        now: new Date().toISOString(),
      });
      if (result.covered) return result;
      if (mandate.status === 'active') reason = result.reason;
    }
    cursor = page.next_cursor;
  } while (cursor !== null);
  return { covered: false, reason };
}

interface CoverageInput {
  mandate: Mandate;
  user_id: UserId;
  action: Extract<ExactAction, { action: 'order.create' }>;
  now: string;
}

export function evaluateMandateCoverage({ mandate, user_id, action, now }: CoverageInput): Coverage {
  if (mandate.user_id !== user_id) return { covered: false, reason: 'Mandate owner mismatch' };
  if (mandate.status !== 'active') return { covered: false, reason: 'Mandate is not active' };
  const time = Date.parse(now);
  const starts = Date.parse(mandate.terms.starts_at);
  const expires = mandate.terms.expires_at === null ? Infinity : Date.parse(mandate.terms.expires_at);
  if (time < starts)
    return { covered: false, reason: `Mandate is not valid until ${mandate.terms.starts_at}` };
  if (!(time >= starts && time < expires))
    return { covered: false, reason: 'Outside mandate validity' };

  const suppliers = mandate.terms.constraints.filter(
    (constraint) => constraint.type === 'supplier_id',
  );
  if (
    suppliers.length > 0 &&
    !suppliers.some((constraint) => constraint.value === action.supplier_id)
  ) {
    return { covered: false, reason: 'Supplier is not allowed' };
  }
  const maxAmount = mandate.terms.constraints.find(
    (constraint) => constraint.type === 'max_credit_amount',
  );
  if (maxAmount && action.credit_amount > maxAmount.value) {
    return { covered: false, reason: 'Amount exceeds mandate limit' };
  }
  return { covered: true, mandate };
}
