import Dexie, { type EntityTable } from "dexie";
import type {
  CalendarConnection,
  DailyLayout,
  ExternalCalendarEvent,
  RecurrenceException,
  Task,
  TimeBlockDefinition,
  TimeBlockOccurrence,
  UserPreferences,
} from "../../domain/models";
export class TimeBlockDB extends Dexie {
  definitions!: EntityTable<TimeBlockDefinition, "id">;
  occurrences!: EntityTable<TimeBlockOccurrence, "id">;
  tasks!: EntityTable<Task, "id">;
  exceptions!: EntityTable<RecurrenceException, "id">;
  connections!: EntityTable<CalendarConnection, "id">;
  events!: EntityTable<ExternalCalendarEvent, "id">;
  preferences!: EntityTable<UserPreferences, "id">;
  layouts!: EntityTable<DailyLayout, "date">;
  constructor(name = "timeblock") {
    super(name);
    this.version(1).stores({
      definitions: "id",
      occurrences: "id, definitionId, date, start, end",
      tasks: "id, occurrenceId, order",
      exceptions: "id, &[definitionId+date]",
      connections: "id",
      events: "id, connectionId, &[calendarId+externalId], start, end",
      preferences: "id",
      layouts: "date",
    });
    this.version(2).stores({
      events:
        "id, connectionId, &[connectionId+calendarId+externalId], start, end",
    });
  }
}
export const db = new TimeBlockDB();
export function defaultPreferences(): UserPreferences {
  return {
    id: "user",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    visibleStart: 7,
    visibleEnd: 22,
    increment: 15,
    theme: "light",
  };
}
