export type LocalDate = string; // ISO YYYY-MM-DD in the definition's timezone
export type Color = "sage" | "lavender" | "peach" | "blue" | "rose";
export type BlockIcon = "book" | "briefcase" | "coffee" | "sparkles";
export interface TimeBlockDefinition {
  id: string;
  title: string;
  color: Color;
  icon: BlockIcon;
  timezone: string;
  startTime: string;
  endTime: string;
  endDayOffset: 0 | 1;
  recurrence: {
    frequency: "daily" | "weekly";
    weekdays: number[];
    startsOn: LocalDate;
    endsOn?: LocalDate;
  } | null;
}
export interface TimeBlockOccurrence {
  id: string;
  definitionId: string;
  date: LocalDate; // Original recurrence date; moving the occurrence never changes its identity.
  timezone: string;
  start: string;
  end: string;
  title: string;
  color: Color;
  icon: BlockIcon;
  overridden: boolean;
}
export interface RecurrenceException {
  id: string;
  definitionId: string;
  date: LocalDate;
  kind: "skip" | "override";
  occurrenceId?: string;
}
export interface Task {
  id: string;
  occurrenceId: string | null;
  title: string;
  completed: boolean;
  notes: string;
  estimatedMinutes?: number;
  schedule?: { offsetMinutes: number; durationMinutes: number };
  checklist?: { id: string; title: string; completed: boolean }[];
  notesFormat?: "markdown";
  order: number;
  createdAt: string;
}
export interface CalendarConnection {
  id: string;
  provider: "google";
  accountLabel: string;
  calendarIds: string[];
  lastSyncedAt?: string;
  revision?: string;
  calendars?: { id: string; title: string; primary?: boolean }[];
  syncedRanges?: Record<string, string>;
} // Never stores OAuth credentials.
export interface ExternalCalendarEvent {
  id: string;
  connectionId: string;
  calendarId: string;
  externalId: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean; // When true, start/end are ISO dates (exclusive end), never instants.
  sourceUrl?: string;
  meetingUrl?: string;
}
export interface UserPreferences {
  id: "user";
  timezone: string;
  visibleStart: number;
  visibleEnd: number;
  increment: 15 | 30;
  theme: "light" | "dark";
}
export interface DailyLayout {
  date: LocalDate;
  visibleStart?: number;
  visibleEnd?: number;
}

export interface MeetingPlacement {
  id: string; // Stable external event identity, including account/calendar.
  connectionId: string;
  occurrenceId: string | null; // null explicitly keeps the meeting outside blocks.
}
