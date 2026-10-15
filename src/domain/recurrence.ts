import { Temporal } from "@js-temporal/polyfill";
import type { TimeBlockDefinition, TimeBlockOccurrence } from "./models";
import { instantAt, shiftDate } from "./time";
import { dateOf, validateRange } from "./interactions";

export type Routine = TimeBlockDefinition & {
  recurrence: NonNullable<TimeBlockDefinition["recurrence"]>;
};
export type RoutineInput = Omit<Routine, "id">;
export const weekdays = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];
export function occurrenceId(definitionId: string, date: string) {
  return `routine:${definitionId}:${date}`;
}
export function exceptionId(definitionId: string, date: string) {
  return `exception:${definitionId}:${date}`;
}
export function validateRoutine(input: RoutineInput): RoutineInput {
  if (!input.title.trim()) throw new Error("Give your routine a name.");
  const rule = input.recurrence;
  if (!rule || !["daily", "weekly"].includes(rule.frequency))
    throw new Error("Choose a valid repeat schedule.");
  const startsOn = Temporal.PlainDate.from(rule.startsOn).toString();
  const endsOn = rule.endsOn
    ? Temporal.PlainDate.from(rule.endsOn).toString()
    : undefined;
  if (endsOn && endsOn < startsOn)
    throw new Error("The last day must be on or after the first day.");
  if (rule.weekdays.some((day) => !Number.isInteger(day) || day < 1 || day > 7))
    throw new Error("Weekdays must be Monday through Sunday.");
  const selected = [...new Set(rule.weekdays)].sort((a, b) => a - b);
  if (rule.frequency === "weekly" && !selected.length)
    throw new Error("Choose at least one weekday.");
  if (
    !/^\d{2}:\d{2}$/.test(input.startTime) ||
    !/^\d{2}:\d{2}$/.test(input.endTime)
  )
    throw new Error("Use hour and minute times.");
  const start = Temporal.PlainTime.from(input.startTime);
  const end = Temporal.PlainTime.from(input.endTime);
  if (input.endDayOffset !== 0 && input.endDayOffset !== 1)
    throw new Error("The routine must end the same day or the next day.");
  const duration =
    end.hour * 60 +
    end.minute +
    input.endDayOffset * 1440 -
    start.hour * 60 -
    start.minute;
  if (duration < 15 || duration > 1440)
    throw new Error("Routines must last between 15 minutes and 24 hours.");
  Temporal.Instant.fromEpochMilliseconds(0).toZonedDateTimeISO(input.timezone);
  return {
    ...input,
    title: input.title.trim(),
    recurrence: {
      ...rule,
      startsOn,
      endsOn,
      weekdays: rule.frequency === "daily" ? [] : selected,
    },
  };
}
export function matchesDate(
  definition: TimeBlockDefinition,
  date: string,
): boolean {
  date = Temporal.PlainDate.from(date).toString();
  const rule = definition.recurrence;
  if (!rule || date < rule.startsOn || (rule.endsOn && date > rule.endsOn))
    return false;
  return (
    rule.frequency === "daily" ||
    rule.weekdays.includes(Temporal.PlainDate.from(date).dayOfWeek)
  );
}
export function buildOccurrence(
  definition: TimeBlockDefinition,
  date: string,
): TimeBlockOccurrence {
  const start = instantAt(date, definition.startTime, definition.timezone);
  const end = instantAt(
    shiftDate(date, definition.endDayOffset),
    definition.endTime,
    definition.timezone,
  );
  validateRange(start, end, definition.timezone);
  return {
    id: occurrenceId(definition.id, date),
    definitionId: definition.id,
    date,
    timezone: definition.timezone,
    start,
    end,
    title: definition.title,
    color: definition.color,
    icon: definition.icon,
    overridden: false,
  };
}
/** Include preceding local dates for overnight tails and timezone offsets. No unbounded expansion. */
export function datesForView(
  date: string,
  viewerTimezone: string,
  routineTimezone: string,
  overnight = true,
) {
  const from = Temporal.PlainDate.from(date)
    .toZonedDateTime(viewerTimezone)
    .toInstant()
    .toString();
  const until = Temporal.PlainDate.from(shiftDate(date, 1))
    .toZonedDateTime(viewerTimezone)
    .toInstant()
    .subtract({ nanoseconds: 1 })
    .toString();
  const first = shiftDate(dateOf(from, routineTimezone), overnight ? -1 : 0);
  const last = dateOf(until, routineTimezone);
  const result: string[] = [];
  for (let current = first; current <= last; current = shiftDate(current, 1))
    result.push(current);
  return result;
}
export function routineSummary(definition: TimeBlockDefinition) {
  const rule = definition.recurrence;
  if (!rule) return "One-time block";
  return rule.frequency === "daily"
    ? "Every day"
    : rule.weekdays.map((day) => weekdays[day - 1].slice(0, 3)).join(", ");
}
export const routinePresets: Array<{
  label: string;
  values: Pick<
    RoutineInput,
    "title" | "startTime" | "endTime" | "color" | "icon"
  >;
}> = [
  {
    label: "Deep study · weekdays",
    values: {
      title: "Deep Study",
      startTime: "08:00",
      endTime: "10:00",
      color: "sage",
      icon: "book",
    },
  },
  {
    label: "Coursework · weekdays",
    values: {
      title: "Master’s Coursework",
      startTime: "10:00",
      endTime: "12:00",
      color: "blue",
      icon: "book",
    },
  },
  {
    label: "Work · weekdays",
    values: {
      title: "Work",
      startTime: "15:00",
      endTime: "19:00",
      color: "lavender",
      icon: "briefcase",
    },
  },
];
