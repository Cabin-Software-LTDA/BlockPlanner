import { Temporal } from "@js-temporal/polyfill";
import type { TimeBlockOccurrence } from "./models";
export function today(
  timezone = Intl.DateTimeFormat().resolvedOptions().timeZone,
) {
  return Temporal.Now.plainDateISO(timezone).toString();
}
export function shiftDate(date: string, days: number) {
  return Temporal.PlainDate.from(date).add({ days }).toString();
}
export function instantAt(date: string, time: string, timezone: string) {
  return Temporal.PlainDate.from(date)
    .toPlainDateTime(Temporal.PlainTime.from(time))
    .toZonedDateTime(timezone, { disambiguation: "reject" })
    .toInstant()
    .toString();
}
export function interval(
  date: string,
  start: string,
  end: string,
  timezone: string,
  fullDay = false,
) {
  if (start === end && !fullDay)
    throw new Error("Start and end must be different.");
  const endDayOffset = end < start || (start === end && fullDay) ? 1 : 0;
  return {
    start: instantAt(date, start, timezone),
    end: instantAt(shiftDate(date, endDayOffset), end, timezone),
    endDayOffset: endDayOffset as 0 | 1,
  };
}
export function timeLabel(instant: string, timezone: string) {
  return Temporal.Instant.from(instant)
    .toZonedDateTimeISO(timezone)
    .toPlainTime()
    .toString({ smallestUnit: "minute" });
}
export function minuteOnDay(instant: string, date: string, timezone: string) {
  const local = Temporal.Instant.from(instant).toZonedDateTimeISO(timezone);
  const days = Temporal.PlainDate.from(date).until(local.toPlainDate()).days;
  return (
    days * 1440 +
    local.hour * 60 +
    local.minute +
    local.second / 60 +
    local.millisecond / 60000
  );
}
export function intersects(
  a: { start: string; end: string },
  b: { start: string; end: string },
) {
  return (
    Date.parse(a.start) < Date.parse(b.end) &&
    Date.parse(b.start) < Date.parse(a.end)
  );
}
// Half-open intervals: a meeting ending exactly when a block begins does not belong to it.
export function meetingBlocks(
  event: { start: string; end: string },
  blocks: TimeBlockOccurrence[],
) {
  return blocks
    .filter((block) => intersects(event, block))
    .map((block) => block.id);
}
export function layoutBlocks<
  T extends { id: string; start: string; end: string },
>(blocks: T[]) {
  const sorted = [...blocks].sort(
    (a, b) =>
      Date.parse(a.start) - Date.parse(b.start) || a.id.localeCompare(b.id),
  );
  const groups: T[][] = [];
  for (const block of sorted) {
    const group = groups.at(-1);
    if (group && group.some((other) => intersects(block, other)))
      group.push(block);
    else groups.push([block]);
  }
  return groups.flatMap((group) => {
    const ends: number[] = [];
    const placed = group.map((block) => {
      let lane = ends.findIndex((end) => end <= Date.parse(block.start));
      if (lane < 0) lane = ends.length;
      ends[lane] = Date.parse(block.end);
      return { block, lane };
    });
    return placed.map((item) => ({ ...item, lanes: ends.length }));
  });
}
