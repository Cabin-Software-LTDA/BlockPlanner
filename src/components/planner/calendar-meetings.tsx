"use client";
import { CalendarDays } from "lucide-react";
import type {
  ExternalCalendarEvent,
  TimeBlockOccurrence,
  UserPreferences,
} from "@/domain/models";
import {
  associatedBlocks,
  hasClockChange,
  meetingLabel,
  safeEventUrl,
} from "@/domain/calendar";
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
  const url = safeEventUrl(event.sourceUrl);
  const label = meetingLabel(event, timezone);
  return (
    <div className="meeting-entry" title={`${event.title} · ${label}`}>
      <CalendarDays size={13} aria-hidden="true" />
      <span>
        {url ? (
          <a href={url} target="_blank" rel="noreferrer">
            {event.title}
          </a>
        ) : (
          <strong>{event.title}</strong>
        )}
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
  const meetings = events.filter((e) => associatedBlocks(e, [block]).length);
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
  date,
  preferences,
  blocks,
}: {
  calendar: CalendarState;
  date: string;
  preferences: UserPreferences;
  blocks: TimeBlockOccurrence[];
}) {
  if (!calendar.connection) return null;
  const { timezone, visibleStart, visibleEnd } = preferences;
  const clockChange = hasClockChange(date, timezone);
  const events = [...calendar.events].sort((a, b) =>
    a.start.localeCompare(b.start),
  );
  const outside = (event: ExternalCalendarEvent) =>
    !event.allDay &&
    (minuteOnDay(event.start, date, timezone) < visibleStart * 60 ||
      minuteOnDay(event.end, date, timezone) > visibleEnd * 60);
  return (
    <section className="calendar-agenda" aria-label="Meetings for this day">
      <div className="section-heading">
        <h2>
          <CalendarDays size={15} /> Meetings · {events.length}
        </h2>
        <small>
          {calendar.syncedAt
            ? `Cached · refreshed ${new Date(calendar.syncedAt).toLocaleString()}`
            : "This day has not been refreshed"}
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
        .filter((e) => e.allDay || clockChange || outside(e))
        .map((event) => (
          <div key={event.id}>
            <MeetingEntry event={event} timezone={timezone} />
            {!event.allDay && (
              <small className="muted">
                {associatedBlocks(event, blocks)
                  .map((b) => b.title)
                  .join(" · ") || "Outside planned blocks"}
                {outside(event) ? " · Extends outside visible hours" : ""}
              </small>
            )}
          </div>
        ))}
      {events.some((e) => !e.allDay) && !clockChange && (
        <details className="meeting-details">
          <summary>Meeting details · full times and block associations</summary>
          {events
            .filter((e) => !e.allDay)
            .map((event) => (
              <div key={event.id}>
                <MeetingEntry event={event} timezone={timezone} />
                <small className="muted">
                  {associatedBlocks(event, blocks)
                    .map((b) => b.title)
                    .join(" · ") || "Outside planned blocks"}
                </small>
              </div>
            ))}
        </details>
      )}
      {events.some((e) => !e.allDay) && !clockChange && (
        <p className="muted">
          Timed meetings appear in the calendar lane; matching blocks show the
          same read-only meeting.
        </p>
      )}
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
  if (hasClockChange(date, preferences.timezone)) return null;
  const timed = events.filter(
    (e) =>
      !e.allDay &&
      minuteOnDay(e.end, date, preferences.timezone) >
        preferences.visibleStart * 60 &&
      minuteOnDay(e.start, date, preferences.timezone) <
        preferences.visibleEnd * 60,
  );
  // Reuse interval partitioning: meetings are independent entities, never persisted as blocks.
  const placements = layoutBlocks(timed);
  return (
    <div className="meeting-lane" aria-label="Calendar timeline">
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
        const names = associatedBlocks(event, blocks).map((b) => b.title);
        return (
          <article
            className={`meeting-card ${end - start < 15 ? "meeting-short" : ""}`}
            key={event.id}
            aria-label={`Meeting ${event.title} · ${meetingLabel(event, preferences.timezone)}`}
            title={`${event.title} · ${meetingLabel(event, preferences.timezone)}`}
            tabIndex={end - start < 15 ? 0 : undefined}
            style={{
              top: ((start - preferences.visibleStart * 60) * 100) / 60,
              height: ((end - start) * 100) / 60,
              left: `${(lane * 100) / lanes}%`,
              width: `calc(${100 / lanes}% - 4px)`,
            }}
          >
            <MeetingEntry
              event={event}
              timezone={preferences.timezone}
              compact
            />
            <small>{names.join(" · ") || "Outside planned blocks"}</small>
          </article>
        );
      })}
    </div>
  );
}
