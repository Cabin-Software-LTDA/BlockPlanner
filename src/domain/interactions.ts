import { Temporal } from "@js-temporal/polyfill";
import type { TimeBlockOccurrence } from "./models";
import { minuteOnDay } from "./time";

export const PIXELS_PER_HOUR = 100;
export type BlockAction = "move" | "resize-start" | "resize-end";
export function dateOf(instant: string, timezone: string) {
  return Temporal.Instant.from(instant)
    .toZonedDateTimeISO(timezone)
    .toPlainDate()
    .toString();
}
function wallTime(instant: string, timezone: string) {
  return Temporal.Instant.from(instant)
    .toZonedDateTimeISO(timezone)
    .toPlainDateTime();
}
export function validateRange(start: string, end: string, timezone: string) {
  const duration = wallTime(start, timezone)
    .until(wallTime(end, timezone))
    .total("minutes");
  if (
    Temporal.Instant.compare(start, end) >= 0 ||
    duration < 15 ||
    duration > 1440
  )
    throw new Error("Blocks must last between 15 minutes and 24 hours.");
}
/** Wall-clock movement matches the visible grid. Reject DST gaps/folds instead of guessing. */
export function adjustBlock(
  block: TimeBlockOccurrence,
  action: BlockAction,
  deltaMinutes: number,
  increment: 15 | 30,
) {
  const origin = dateOf(block.start, block.timezone);
  const originalStart = minuteOnDay(block.start, origin, block.timezone);
  const originalEnd = minuteOnDay(block.end, origin, block.timezone);
  const snap = (value: number) => Math.round(value / increment) * increment;
  let start = originalStart;
  let end = originalEnd;
  if (action === "move") {
    start = snap(start + deltaMinutes);
    end += start - originalStart;
  } else if (action === "resize-start") {
    start = Math.max(
      end - 1440,
      Math.min(end - increment, snap(start + deltaMinutes)),
    );
  } else {
    end = Math.min(
      start + 1440,
      Math.max(start + increment, snap(end + deltaMinutes)),
    );
  }
  const instant = (minutes: number) =>
    Temporal.PlainDate.from(origin)
      .toPlainDateTime()
      .add({ minutes })
      .toZonedDateTime(block.timezone, { disambiguation: "reject" })
      .toInstant()
      .toString();
  const range = { start: instant(start), end: instant(end) };
  validateRange(range.start, range.end, block.timezone);
  return range;
}
