import { Temporal } from "@js-temporal/polyfill";
import type { ExternalCalendarEvent, TimeBlockOccurrence } from "./models";
import { intersects } from "./time";

export function dayRange(date: string, timezone: string) {
  const start = Temporal.PlainDate.from(date).toZonedDateTime(timezone);
  const end = start.add({ days: 1 });
  return {
    start: start.toInstant().toString(),
    end: end.toInstant().toString(),
  };
}
export function eventOnDay(
  event: ExternalCalendarEvent,
  date: string,
  timezone: string,
) {
  return event.allDay
    ? event.start < Temporal.PlainDate.from(date).add({ days: 1 }).toString() &&
        event.end > date
    : intersects(event, dayRange(date, timezone));
}
export function associatedBlocks(
  event: ExternalCalendarEvent,
  blocks: TimeBlockOccurrence[],
) {
  // All-day dates have no meeting time and are deliberately not assigned to a block.
  return event.allDay ? [] : blocks.filter((b) => intersects(event, b));
}
export function hasClockChange(date: string, timezone: string) {
  const range = dayRange(date, timezone);
  return Date.parse(range.end) - Date.parse(range.start) !== 86400000;
}
export function meetingLabel(
  event: Pick<ExternalCalendarEvent, "start" | "end" | "allDay">,
  timezone: string,
) {
  if (event.allDay)
    return `All day · ${event.start} to ${Temporal.PlainDate.from(event.end).subtract({ days: 1 })}`;
  const format = (instant: string) => {
    const local = Temporal.Instant.from(instant).toZonedDateTimeISO(timezone);
    return `${local.toPlainDate()} ${local.toPlainTime().toString(local.second || local.millisecond || local.microsecond || local.nanosecond ? {} : { smallestUnit: "minute" })} (${local.offset})`;
  };
  return `${format(event.start)} – ${format(event.end)}`;
}
export function safeEventUrl(value?: string) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      (url.hostname === "calendar.google.com" ||
        url.hostname === "www.google.com")
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

export function containsMeeting(
  event: ExternalCalendarEvent,
  block: TimeBlockOccurrence,
) {
  return (
    !event.allDay &&
    Date.parse(block.start) <= Date.parse(event.start) &&
    Date.parse(block.end) >= Date.parse(event.end)
  );
}
/** One owner only: explicit choice, otherwise shortest containing block, then start/ID. */
export function meetingOwner(
  event: ExternalCalendarEvent,
  blocks: TimeBlockOccurrence[],
  placements: import("./models").MeetingPlacement[],
) {
  const choice = placements.find((p) => p.id === event.id);
  if (choice)
    return (
      blocks.find(
        (b) => b.id === choice.occurrenceId && containsMeeting(event, b),
      )?.id ?? null
    );
  return (
    blocks
      .filter((b) => containsMeeting(event, b))
      .sort(
        (a, b) =>
          Date.parse(a.end) -
            Date.parse(a.start) -
            (Date.parse(b.end) - Date.parse(b.start)) ||
          a.start.localeCompare(b.start) ||
          a.id.localeCompare(b.id),
      )[0]?.id ?? null
  );
}
export function safeMeetingUrl(value?: string) {
  try {
    const url = new URL(value ?? "");
    return url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}
