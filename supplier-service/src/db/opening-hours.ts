/**
 * AI Assistance Disclosure: ChatGPT (GPT-6), 2026-09-28.
 * Scope: Evaluate documented daily and overnight supplier opening periods.
 * Author review: pending.
 */
import { sql } from "drizzle-orm";
import { operatingHours, suppliers } from "./schema.js";

export function openingHoursMatch(at: Date, timezone: string) {
  const localNow = sql`(${at.toISOString()}::timestamptz at time zone ${timezone})`;
  const day = sql`extract(dow from ${localNow})::integer`;
  const previousDay = sql`((${day} + 6) % 7)`;
  const time = sql`${localNow}::time`;

  // Opening is inclusive, closing is exclusive. EXISTS avoids duplicate
  // suppliers when more than one operating period matches.
  return sql<boolean>`exists (
    select 1 from ${operatingHours}
    where ${operatingHours.supplierId} = ${suppliers.id}
      and (
        (
          ${operatingHours.day} = ${day}
          and ${operatingHours.openingHrs} < ${operatingHours.closingHrs}
          and ${operatingHours.openingHrs} <= ${time}
          and ${time} < ${operatingHours.closingHrs}
        )
        or (
          ${operatingHours.openingHrs} > ${operatingHours.closingHrs}
          and (
            (${operatingHours.day} = ${day} and ${operatingHours.openingHrs} <= ${time})
            or (${operatingHours.day} = ${previousDay} and ${time} < ${operatingHours.closingHrs})
          )
        )
      )
  )`;
}
