"use client";
import { useDroppable } from "@dnd-kit/core";
import { MeetingCard } from "./meeting-card";
import { usePlannerInteractions } from "./planner-interactions";
import { CalendarDays } from "lucide-react";
import type {
  ExternalCalendarEvent,
  TimeBlockOccurrence,
  UserPreferences,
} from "@/domain/models";
import { hasClockChange, meetingLabel } from "@/domain/calendar";
import { layoutBlocks, minuteOnDay, timeLabel } from "@/domain/time";
import type { CalendarState } from "./use-google-calendar";

export function MeetingEntry({
  event,
  timezone,
  compact = false,
}: {
  event: ExternalCalendarEvent;
  timezone: string;
  compact?: boolean;
}) {
  const { openMeeting } = usePlannerInteractions();
  const label = meetingLabel(event, timezone);
  return (
    <div className="meeting-entry" title={`${event.title} · ${label}`}>
      <CalendarDays size={13} aria-hidden="true" />
      <span>
        <button
          className="meeting-open"
          onClick={() => openMeeting(event.id)}
          aria-label={`Open meeting ${event.title}`}
        >
          {event.title}
        </button>
        <small>
          {compact && !event.allDay
            ? `${timeLabel(event.start, timezone)}–${timeLabel(event.end, timezone)}`
            : label}
        </small>
        {compact && <span className="sr-only">{label}</span>}
      </span>
    </div>
  );
}
export function BlockMeetings({
  events,
  block,
  timezone,
}: {
  events: ExternalCalendarEvent[];
  block: TimeBlockOccurrence;
  timezone: string;
}) {
  const { ownerOf } = usePlannerInteractions();
  const meetings = events.filter((e) => ownerOf(e) === block.id);
  if (!meetings.length) return null;
  return (
    <div
      className="block-meetings"
      aria-label={`Meetings intersecting ${block.title}`}
    >
      {meetings.map((event) => (
        <MeetingEntry
          key={event.id}
          event={event}
          timezone={timezone}
          compact
        />
      ))}
    </div>
  );
}
export function CalendarAgenda({
  calendar,
  listView = false,
  date,
  preferences,
  blocks,
}: {
  calendar: Pick<CalendarState, "connection" | "events" | "syncedAt">;
  listView?: boolean;
  date: string;
  preferences: UserPreferences;
  blocks: TimeBlockOccurrence[];
}) {
  const { ownerOf } = usePlannerInteractions();
  if (!calendar.connection) return null;
  const { timezone, visibleStart, visibleEnd } = preferences;
  const clockChange = hasClockChange(date, timezone);
  const events = [...calendar.events].sort((a, b) =>
    a.start.localeCompare(b.start),
  );
  const outside = (event: ExternalCalendarEvent) =>
    !event.allDay &&
    (minuteOnDay(event.end, date, timezone) <= visibleStart * 60 ||
      minuteOnDay(event.start, date, timezone) >= visibleEnd * 60);
  return (
    <section className="calendar-agenda" aria-label="Meetings for this day">
      <div className="section-heading">
        <h2>
          <CalendarDays size={15} /> Meetings · {events.length}
        </h2>
        <small>
          {calendar.syncedAt
            ? `Cached · refreshed ${new Date(calendar.syncedAt).toLocaleString()}`
            : "Cached on this device · refresh from calendar controls"}
        </small>
      </div>
      {clockChange && (
        <p className="muted">
          Clocks change today. Meetings are shown below with exact UTC offsets
          instead of on the wall-clock grid.
        </p>
      )}
      {!events.length && (
        <p className="muted">
          {calendar.syncedAt
            ? "No meetings in the selected calendars."
            : "Connect and refresh to retrieve this day’s meetings."}
        </p>
      )}
      {events
        .filter(
          (e) =>
            e.allDay ||
            (listView ? ownerOf(e) === null : clockChange ? true : outside(e)),
        )
        .map((event) => (
          <div key={event.id}>
            <MeetingEntry event={event} timezone={timezone} />
            {!event.allDay && (
              <small className="muted">
                {blocks.find((b) => b.id === ownerOf(event))?.title ||
                  "Outside planned blocks"}
                {outside(event) ? " · Extends outside visible hours" : ""}
              </small>
            )}
          </div>
        ))}
      <p className="muted">
        Click a meeting for details and links. Drag its grip to a containing
        block or Outside blocks; its time stays fixed.
      </p>
    </section>
  );
}
export function MeetingLane({
  events,
  date,
  preferences,
  blocks,
}: {
  events: ExternalCalendarEvent[];
  date: string;
  preferences: UserPreferences;
  blocks: TimeBlockOccurrence[];
}) {
  const { ownerOf, busy, draggingMeeting } = usePlannerInteractions();
  const drop = useDroppable({
    id: "meeting-outside",
    data: { kind: "meeting-outside" },
    disabled: busy,
  });
  if (
    hasClockChange(date, preferences.timezone) ||
    !events.some((e) => !e.allDay)
  )
    return null;
  const timed = events.filter(
    (e) =>
      !e.allDay &&
      ownerOf(e) === null &&
      minuteOnDay(e.end, date, preferences.timezone) >
        preferences.visibleStart * 60 &&
      minuteOnDay(e.start, date, preferences.timezone) <
        preferences.visibleEnd * 60,
  );
  if (!timed.length && !draggingMeeting) return null;
  // Reuse interval partitioning: meetings are independent entities, never persisted as blocks.
  const placements = layoutBlocks(timed);
  return (
    <div
      ref={drop.setNodeRef}
      className={`meeting-lane ${drop.isOver ? "block-drop-over" : ""}`}
      aria-label="Outside blocks"
    >
      <span className="meeting-lane-label">
        Outside blocks · drop meetings here
      </span>
      {placements.map(({ block, lane, lanes }) => {
        const event = timed.find((e) => e.id === block.id)!;
        const start = Math.max(
          preferences.visibleStart * 60,
          minuteOnDay(event.start, date, preferences.timezone),
        );
        const end = Math.min(
          preferences.visibleEnd * 60,
          minuteOnDay(event.end, date, preferences.timezone),
        );
        return (
          <MeetingCard
            event={event}
            timezone={preferences.timezone}
            className={end - start < 15 ? "meeting-short" : ""}
            key={event.id}
            style={{
              top: ((start - preferences.visibleStart * 60) * 100) / 60,
              height: ((end - start) * 100) / 60,
              left: `${(lane * 100) / lanes}%`,
              width: `calc(${100 / lanes}% - 4px)`,
            }}
          />
        );
      })}
    </div>
  );
}
