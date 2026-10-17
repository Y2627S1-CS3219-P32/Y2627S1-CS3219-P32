// AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-15.
// Scope: Next opening time label for closed suppliers. Author review: Pending.
import type { OperatingPeriod } from "#shared/services/supplier-service/types";

// supplier-service decides isOpen in Singapore time, so the label uses it too.
const TIME_ZONE = "Asia/Singapore";
const MINUTES_PER_DAY = 24 * 60;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function singaporeNow(at: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? "";
  return {
    day: WEEKDAYS.indexOf(part("weekday")),
    minutes: Number(part("hour")) * 60 + Number(part("minute")),
  };
}

function toMinutes(time: string) {
  const [hours = 0, minutes = 0] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

// "Opens today, 17:00", "Opens tomorrow, 09:00" or "Opens Thu, 09:00"; null when
// the supplier has no operating hours.
export function nextOpeningLabel(periods: OperatingPeriod[], at = new Date()): string | null {
  const now = singaporeNow(at);
  let next: { wait: number; period: OperatingPeriod } | null = null;
  for (const period of periods) {
    const daysAhead = (period.day - now.day + 7) % 7;
    let wait = daysAhead * MINUTES_PER_DAY + toMinutes(period.openingHrs) - now.minutes;
    // An opening time already passed this week comes round again next week.
    if (wait <= 0) wait += 7 * MINUTES_PER_DAY;
    if (!next || wait < next.wait) next = { wait, period };
  }
  if (!next) return null;

  const daysAhead = (next.period.day - now.day + 7) % 7;
  const when = next.wait > 6 * MINUTES_PER_DAY && daysAhead === 0
    ? `next ${WEEKDAYS[next.period.day]}`
    : daysAhead === 0 ? "today" : daysAhead === 1 ? "tomorrow" : WEEKDAYS[next.period.day];
  return `Opens ${when}, ${next.period.openingHrs}`;
}
