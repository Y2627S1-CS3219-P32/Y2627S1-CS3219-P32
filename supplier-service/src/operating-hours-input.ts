/**AI Assistance Disclosure:
Tool: Claude Code (model: Opus 5.5), date: 2026-09-30
Scope: Validation of the operating hours sent with POST /suppliers, including the
service-layer non-overlap check described in docs/database_schemas.md.
Author review: Pending. **/

import { HttpError } from "./errors.js";

export interface OperatingPeriodInput {
  day: number;
  openingHrs: string;
  closingHrs: string;
}

const MAX_PERIODS = 50;
const DAY_MINUTES = 24 * 60;
const WEEK_MINUTES = 7 * DAY_MINUTES;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

// "HH:MM" to minutes after midnight. Only a closing time may be 24:00 (end of day).
function minutes(value: unknown, field: string, allowEndOfDay: boolean): number {
  if (allowEndOfDay && value === "24:00") return DAY_MINUTES;
  const match = typeof value === "string" ? TIME_PATTERN.exec(value) : null;
  if (!match) throw new HttpError(400, `${field} must be a time in HH:MM format`);
  return Number(match[1]) * 60 + Number(match[2]);
}

// A period's [start, end) in minutes from Sunday 00:00. A closing time at or before
// the opening time runs past midnight into the next day.
function weekInterval(day: number, opening: number, closing: number): [number, number] {
  const start = day * DAY_MINUTES + opening;
  const length = closing > opening ? closing - opening : closing + DAY_MINUTES - opening;
  return [start, start + length];
}

function overlaps([aStart, aEnd]: [number, number], [bStart, bEnd]: [number, number]): boolean {
  // Saturday overnight periods wrap into Sunday, so also compare a week later/earlier.
  return [-WEEK_MINUTES, 0, WEEK_MINUTES].some(shift => aStart < bEnd + shift && bStart + shift < aEnd);
}

// Omitted means no hours, so the supplier shows as closed.
export function parseOperatingHours(body: unknown): OperatingPeriodInput[] {
  const value = typeof body === "object" && body !== null ? (body as Record<string, unknown>).operatingHours : undefined;
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new HttpError(400, "operatingHours must be an array");
  if (value.length > MAX_PERIODS) throw new HttpError(400, `operatingHours must have at most ${MAX_PERIODS} periods`);

  const periods = value.map((item: unknown, index) => {
    const field = `operatingHours[${index}]`;
    if (typeof item !== "object" || item === null || Array.isArray(item)) throw new HttpError(400, `${field} must be an object`);
    const { day, openingHrs, closingHrs } = item as Record<string, unknown>;
    if (typeof day !== "number" || !Number.isInteger(day) || day < 0 || day > 6) {
      throw new HttpError(400, `${field}.day must be an integer from 0 (Sunday) to 6 (Saturday)`);
    }
    const opening = minutes(openingHrs, `${field}.openingHrs`, false);
    const closing = minutes(closingHrs, `${field}.closingHrs`, true);
    if (opening === closing) throw new HttpError(400, `${field} must have different opening and closing times`);
    return { day, openingHrs: openingHrs as string, closingHrs: closingHrs as string, interval: weekInterval(day, opening, closing) };
  });

  for (let i = 0; i < periods.length; i++) {
    for (let j = i + 1; j < periods.length; j++) {
      if (overlaps(periods[i]!.interval, periods[j]!.interval)) {
        throw new HttpError(400, `operatingHours[${i}] and operatingHours[${j}] overlap`);
      }
    }
  }

  return periods.map(({ day, openingHrs, closingHrs }) => ({ day, openingHrs, closingHrs }));
}
