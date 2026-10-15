import { Temporal } from "@js-temporal/polyfill";
import type {
  DailyLayout,
  RecurrenceException,
  Task,
  TimeBlockDefinition,
  TimeBlockOccurrence,
  UserPreferences,
} from "./models";
import { exceptionId, occurrenceId, validateRoutine } from "./recurrence";
import { validateRange } from "./interactions";

export const MAX_BACKUP_BYTES = 20 * 1024 * 1024;
export interface PlannerBackup {
  format: "timeblock";
  version: 1;
  exportedAt: string;
  data: {
    definitions: TimeBlockDefinition[];
    occurrences: TimeBlockOccurrence[];
    exceptions: RecurrenceException[];
    tasks: Task[];
    preferences: UserPreferences[];
    layouts: DailyLayout[];
  };
}
export interface RecoverySnapshot {
  id: "before-restore";
  savedAt: string;
  backup: PlannerBackup;
}
function fail(message: string): never {
  throw new Error(`Invalid backup: ${message}`);
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("expected an object.");
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && !value.trim()))
    fail(`${label} must be text${allowEmpty ? "" : " and cannot be empty"}.`);
  return value;
}
function integer(
  value: unknown,
  min: number,
  max: number,
  label: string,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  )
    fail(`${label} must be an integer from ${min} to ${max}.`);
  return value;
}
function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") fail("expected true or false.");
  return value;
}
function choice<T extends string | number>(
  value: unknown,
  values: readonly T[],
  label: string,
): T {
  if (!values.includes(value as T)) fail(`unknown ${label}.`);
  return value as T;
}
function date(value: unknown): string {
  const result = text(value, "date");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(result) ||
    Temporal.PlainDate.from(result).toString() !== result
  )
    fail("dates must use YYYY-MM-DD.");
  return result;
}
function instant(value: unknown): string {
  return Temporal.Instant.from(text(value, "timestamp")).toString();
}
function timezone(value: unknown): string {
  const zone = text(value, "timezone");
  Temporal.Instant.fromEpochMilliseconds(0).toZonedDateTimeISO(zone);
  return zone;
}
function rows<T>(
  value: unknown,
  parse: (row: Record<string, unknown>) => T,
): T[] {
  if (!Array.isArray(value)) fail("expected a table array.");
  return value.map((row) => parse(record(row)));
}
function appearance(row: Record<string, unknown>) {
  return {
    title: text(row.title, "title"),
    color: choice(
      row.color,
      ["sage", "lavender", "peach", "blue", "rose"] as const,
      "color",
    ),
    icon: choice(
      row.icon,
      ["book", "briefcase", "coffee", "sparkles"] as const,
      "icon",
    ),
  };
}
function unique<T>(items: T[], key: (item: T) => string, label: string) {
  const map = new Map<string, T>();
  for (const item of items) {
    const id = key(item);
    if (map.has(id)) fail(`duplicate ${label}: ${id}.`);
    map.set(id, item);
  }
  return map;
}
/** Runtime validation builds fresh whitelisted objects; extra fields cannot import credentials or arbitrary stores. */
export function validateBackup(value: unknown): PlannerBackup {
  try {
    const root = record(value);
    if (root.format !== "timeblock" || root.version !== 1)
      fail(
        "unsupported format or version. Use a TimeBlock version 1 JSON backup.",
      );
    const data = record(root.data);
    const definitions = rows(data.definitions, (row): TimeBlockDefinition => {
      let recurrence: TimeBlockDefinition["recurrence"] = null;
      if (row.recurrence !== null) {
        const rule = record(row.recurrence);
        if (!Array.isArray(rule.weekdays)) fail("weekdays must be an array.");
        recurrence = {
          frequency: choice(rule.frequency, ["daily", "weekly"], "frequency"),
          weekdays: rule.weekdays.map((d) => integer(d, 1, 7, "weekday")),
          startsOn: date(rule.startsOn),
          ...(rule.endsOn === undefined ? {} : { endsOn: date(rule.endsOn) }),
        };
      }
      const definition = {
        id: text(row.id, "definition ID"),
        ...appearance(row),
        timezone: timezone(row.timezone),
        startTime: text(row.startTime, "start time"),
        endTime: text(row.endTime, "end time"),
        endDayOffset: choice(
          row.endDayOffset,
          [0, 1] as const,
          "end-day offset",
        ),
        recurrence,
      };
      // One-off definitions share the same wall-clock range invariants as routines.
      validateRoutine({
        ...definition,
        recurrence: recurrence ?? {
          frequency: "daily",
          weekdays: [],
          startsOn: "2000-01-01",
        },
      });
      return definition;
    });
    const occurrences = rows(data.occurrences, (row): TimeBlockOccurrence => {
      const block = {
        id: text(row.id, "occurrence ID"),
        definitionId: text(row.definitionId, "definition ID"),
        date: date(row.date),
        timezone: timezone(row.timezone),
        start: instant(row.start),
        end: instant(row.end),
        ...appearance(row),
        overridden: boolean(row.overridden),
      };
      validateRange(block.start, block.end, block.timezone);
      return block;
    });
    const exceptions = rows(data.exceptions, (row): RecurrenceException => ({
      id: text(row.id, "exception ID"),
      definitionId: text(row.definitionId, "definition ID"),
      date: date(row.date),
      kind: choice(row.kind, ["skip", "override"], "exception kind"),
      ...(row.occurrenceId === undefined
        ? {}
        : { occurrenceId: text(row.occurrenceId, "occurrence ID") }),
    }));
    const tasks = rows(data.tasks, (row): Task => ({
      id: text(row.id, "task ID"),
      occurrenceId:
        row.occurrenceId === null
          ? null
          : text(row.occurrenceId, "task destination"),
      title: text(row.title, "task title"),
      completed: boolean(row.completed),
      notes: text(row.notes, "notes", true),
      ...(row.estimatedMinutes === undefined
        ? {}
        : {
            estimatedMinutes: integer(
              row.estimatedMinutes,
              1,
              1440,
              "estimate",
            ),
          }),
      order: integer(row.order, 0, Number.MAX_SAFE_INTEGER, "task order"),
      createdAt: instant(row.createdAt),
    }));
    const preferences = rows(data.preferences, (row): UserPreferences => {
      if (row.id !== "user") fail("unknown preference ID.");
      const prefs = {
        id: "user" as const,
        timezone: timezone(row.timezone),
        visibleStart: integer(row.visibleStart, 0, 23, "first hour"),
        visibleEnd: integer(row.visibleEnd, 1, 24, "last hour"),
        increment: choice(row.increment, [15, 30] as const, "increment"),
        theme: choice(row.theme, ["light", "dark"] as const, "theme"),
      };
      if (prefs.visibleStart >= prefs.visibleEnd)
        fail("visible hours are reversed.");
      return prefs;
    });
    if (preferences.length !== 1)
      fail("exactly one preferences record is required.");
    const layouts = rows(data.layouts, (row): DailyLayout => {
      const layout = {
        date: date(row.date),
        ...(row.visibleStart === undefined
          ? {}
          : {
              visibleStart: integer(
                row.visibleStart,
                0,
                23,
                "layout first hour",
              ),
            }),
        ...(row.visibleEnd === undefined
          ? {}
          : { visibleEnd: integer(row.visibleEnd, 1, 24, "layout last hour") }),
      };
      if (
        (layout.visibleStart ?? preferences[0].visibleStart) >=
        (layout.visibleEnd ?? preferences[0].visibleEnd)
      )
        fail("layout hours are reversed.");
      return layout;
    });
    const definitionMap = unique(definitions, (d) => d.id, "definition ID");
    const occurrenceMap = unique(occurrences, (b) => b.id, "occurrence ID");
    unique(tasks, (t) => t.id, "task ID");
    unique(layouts, (l) => l.date, "layout date");
    unique(exceptions, (e) => e.id, "exception ID");
    const exceptionMap = unique(
      exceptions,
      (e) => JSON.stringify([e.definitionId, e.date]),
      "recurrence exception",
    );
    for (const block of occurrences) {
      const definition = definitionMap.get(block.definitionId);
      if (!definition)
        fail(`block ${block.id} references a missing definition.`);
      if (definition.recurrence) {
        if (block.id !== occurrenceId(definition.id, block.date))
          fail(
            "recurring occurrence identity does not match its original date.",
          );
        const exception = exceptionMap.get(
          JSON.stringify([definition.id, block.date]),
        );
        if (
          exception?.kind === "skip" ||
          (block.overridden && exception?.kind !== "override")
        )
          fail("recurring occurrence and exception disagree.");
      }
    }
    for (const task of tasks)
      if (task.occurrenceId !== null && !occurrenceMap.has(task.occurrenceId))
        fail(`task ${task.id} references a missing block.`);
    for (const exception of exceptions) {
      if (
        !definitionMap.get(exception.definitionId)?.recurrence ||
        exception.id !== exceptionId(exception.definitionId, exception.date)
      )
        fail("exception must reference a routine and its original date.");
      if (exception.kind === "skip") {
        if (exception.occurrenceId !== undefined)
          fail("a skipped day cannot reference an occurrence.");
      } else {
        const block = occurrenceMap.get(exception.occurrenceId ?? "");
        if (
          !block ||
          block.definitionId !== exception.definitionId ||
          block.date !== exception.date ||
          !block.overridden
        )
          fail("override must reference its edited occurrence.");
      }
    }
    return {
      format: "timeblock",
      version: 1,
      exportedAt: instant(root.exportedAt),
      data: {
        definitions,
        occurrences,
        exceptions,
        tasks,
        preferences,
        layouts,
      },
    };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Invalid backup:"))
      throw error;
    throw new Error(
      "Invalid backup: an invalid date, time, timezone, or block range was found.",
    );
  }
}
export function parseBackup(json: string) {
  if (new TextEncoder().encode(json).byteLength > MAX_BACKUP_BYTES)
    fail("files must be 20 MB or smaller.");
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    fail("the file is not valid JSON.");
  }
  return validateBackup(value);
}
export function backupCounts(backup: PlannerBackup) {
  return {
    blocks: backup.data.occurrences.length,
    routines: backup.data.definitions.filter((d) => d.recurrence).length,
    tasks: backup.data.tasks.length,
    exceptions: backup.data.exceptions.length,
  };
}
