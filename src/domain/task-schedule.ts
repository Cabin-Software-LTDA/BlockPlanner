import { Temporal } from "@js-temporal/polyfill";
import type { Task, TimeBlockOccurrence } from "./models";

/** Elapsed minutes from the occurrence start: moving a block carries its tasks. */
export function taskRange(task: Task, block: TimeBlockOccurrence) {
  if (!task.schedule) return null;
  const start = Temporal.Instant.from(block.start).add({
    minutes: task.schedule.offsetMinutes,
  });
  return {
    start: start.toString(),
    end: start.add({ minutes: task.schedule.durationMinutes }).toString(),
  };
}
export function validateTaskSchedule(schedule: NonNullable<Task["schedule"]>) {
  if (
    !Number.isInteger(schedule.offsetMinutes) ||
    schedule.offsetMinutes < 0 ||
    schedule.offsetMinutes > 1500 ||
    !Number.isInteger(schedule.durationMinutes) ||
    schedule.durationMinutes < 1 ||
    schedule.durationMinutes > 1440
  )
    throw new Error(
      "Task timing must use whole minutes and a duration of 1–1440 minutes.",
    );
}
export function taskFits(task: Task, block: TimeBlockOccurrence) {
  const range = taskRange(task, block);
  return !range || Date.parse(range.end) <= Date.parse(block.end);
}
export function checklistProgress(task: Task) {
  const items = task.checklist ?? [];
  return {
    done: items.filter((item) => item.completed).length,
    total: items.length,
  };
}
/** Resolve a wall-clock drop point without guessing across a DST gap or fold. */
export function scheduleAtMinute(
  block: TimeBlockOccurrence,
  date: string,
  timezone: string,
  minute: number,
  durationMinutes: number,
  increment: number,
) {
  const instant = Temporal.PlainDate.from(date)
    .toPlainDateTime()
    .add({ minutes: Math.round(minute / increment) * increment })
    .toZonedDateTime(timezone, { disambiguation: "reject" })
    .toInstant();
  const offsetMinutes = Math.round(
    (instant.epochMilliseconds - Date.parse(block.start)) / 60000,
  );
  const schedule = { offsetMinutes, durationMinutes };
  validateTaskSchedule(schedule);
  if (!taskFits({ schedule } as Task, block))
    throw new Error(
      "This task does not fit here. Choose a shorter duration or an earlier start.",
    );
  return schedule;
}
