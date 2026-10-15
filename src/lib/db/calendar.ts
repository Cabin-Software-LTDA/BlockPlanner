import type {
  CalendarConnection,
  ExternalCalendarEvent,
} from "@/domain/models";
import { eventOnDay } from "../../domain/calendar";
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
    async () => {
      const existing = await database.connections.get(connection.id);
      if (!isCurrent()) return;
      await database.connections.clear();
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
    async () => {
      await database.connections.clear();
      await database.events.clear();
    },
  );
}
