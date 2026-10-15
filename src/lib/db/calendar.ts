import type {
  CalendarConnection,
  ExternalCalendarEvent,
} from "@/domain/models";
import { containsMeeting, eventOnDay } from "../../domain/calendar";
import { db, type TimeBlockDB } from "./database";
export const rangeKey = (date: string, timezone: string) =>
  `${date}@${timezone}`;
export async function saveConnection(
  connection: CalendarConnection,
  database: TimeBlockDB = db,
  isCurrent: () => boolean = () => true,
) {
  await database.transaction(
    "rw",
    database.connections,
    database.events,
    database.meetingPlacements,
    async () => {
      const existing = await database.connections.get(connection.id);
      if (!isCurrent()) return;
      await database.connections.clear();
      await database.meetingPlacements
        .filter((p) => p.connectionId !== connection.id)
        .delete();
      await database.events
        .filter(
          (event) =>
            event.connectionId !== connection.id ||
            !connection.calendarIds.includes(event.calendarId),
        )
        .delete();
      await database.connections.put({
        ...connection,
        syncedRanges:
          existing &&
          JSON.stringify(existing.calendarIds) ===
            JSON.stringify(connection.calendarIds)
            ? existing.syncedRanges
            : {},
        lastSyncedAt: existing?.lastSyncedAt,
      });
    },
  );
}
export async function chooseCalendars(
  id: string,
  calendarIds: string[],
  database: TimeBlockDB = db,
) {
  await database.transaction(
    "rw",
    database.connections,
    database.events,
    async () => {
      await database.connections.update(id, {
        calendarIds,
        revision: crypto.randomUUID(),
        syncedRanges: {},
        lastSyncedAt: undefined,
      });
      await database.events
        .where("connectionId")
        .equals(id)
        .filter((e) => !calendarIds.includes(e.calendarId))
        .delete();
    },
  );
}
export async function cacheDay(
  connection: CalendarConnection,
  date: string,
  timezone: string,
  events: ExternalCalendarEvent[],
  isCurrent: () => boolean,
  database: TimeBlockDB = db,
) {
  return database.transaction(
    "rw",
    database.connections,
    database.events,
    async () => {
      const current = await database.connections.get(connection.id);
      if (!isCurrent() || !current || current.revision !== connection.revision)
        return false;
      const syncedAt = new Date().toISOString();
      await database.events
        .where("connectionId")
        .equals(connection.id)
        .filter(
          (event) =>
            connection.calendarIds.includes(event.calendarId) &&
            eventOnDay(event, date, timezone),
        )
        .delete();
      await database.events.bulkPut(
        events.filter(
          (e) =>
            e.connectionId === connection.id &&
            connection.calendarIds.includes(e.calendarId) &&
            eventOnDay(e, date, timezone),
        ),
      );
      await database.connections.update(connection.id, {
        lastSyncedAt: syncedAt,
        syncedRanges: {
          ...current.syncedRanges,
          [rangeKey(date, timezone)]: syncedAt,
        },
      });
      return true;
    },
  );
}
export async function disconnectCalendar(database: TimeBlockDB = db) {
  await database.transaction(
    "rw",
    database.connections,
    database.events,
    database.meetingPlacements,
    async () => {
      await database.connections.clear();
      await database.events.clear();
      await database.meetingPlacements.clear();
    },
  );
}

/** A local visual assignment. Never writes to the Calendar API or event timestamps. */
export async function assignMeeting(
  eventId: string,
  occurrenceId: string | null,
  database: TimeBlockDB = db,
) {
  await database.transaction(
    "rw",
    database.events,
    database.occurrences,
    database.meetingPlacements,
    async () => {
      const event = await database.events.get(eventId);
      if (!event)
        throw new Error(
          "This meeting is no longer cached. Refresh Calendar and retry.",
        );
      if (event.allDay)
        throw new Error("All-day events cannot be placed inside timed blocks.");
      if (occurrenceId !== null) {
        const block = await database.occurrences.get(occurrenceId);
        if (!block || !containsMeeting(event, block))
          throw new Error(
            "Choose a block that contains the meeting’s entire time range. Google Calendar times cannot be changed here.",
          );
      }
      await database.meetingPlacements.put({
        id: event.id,
        connectionId: event.connectionId,
        occurrenceId,
      });
    },
  );
}
