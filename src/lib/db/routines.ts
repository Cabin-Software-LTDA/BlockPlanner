import type { TimeBlockOccurrence } from "../../domain/models";
import {
  buildOccurrence,
  datesForView,
  exceptionId,
  matchesDate,
  occurrenceId,
  validateRoutine,
  type RoutineInput,
} from "../../domain/recurrence";
import { db } from "./database";
import { orderedTasks } from "./repository";
export interface RoutineIssue {
  definitionId: string;
  title: string;
  date: string;
  message: string;
}
const timeIssue =
  "This local time is ambiguous or unavailable because of a timezone transition. Edit the routine or skip this date.";

export async function materializeDay(
  date: string,
  timezone: string,
  database = db,
): Promise<RoutineIssue[]> {
  return database.transaction(
    "rw",
    database.definitions,
    database.occurrences,
    database.exceptions,
    async () => {
      const issues: RoutineIssue[] = [];
      for (const definition of await database.definitions.toArray()) {
        if (!definition.recurrence) continue;
        for (const candidate of datesForView(
          date,
          timezone,
          definition.timezone,
          definition.endDayOffset === 1,
        )) {
          if (!matchesDate(definition, candidate)) continue;
          const exception = await database.exceptions.get(
            exceptionId(definition.id, candidate),
          );
          if (exception?.kind === "skip") continue;
          const existing = await database.occurrences.get(
            occurrenceId(definition.id, candidate),
          );
          if (existing) continue;
          if (exception?.kind === "override") {
            issues.push({
              definitionId: definition.id,
              title: definition.title,
              date: candidate,
              message:
                "The saved occurrence is missing. Reset this exception in the routine editor.",
            });
            continue;
          }
          try {
            await database.occurrences.add(
              buildOccurrence(definition, candidate),
            );
          } catch (error) {
            if (
              !(error instanceof RangeError) &&
              !(
                error instanceof Error &&
                error.message.startsWith("Blocks must")
              )
            )
              throw error;
            issues.push({
              definitionId: definition.id,
              title: definition.title,
              date: candidate,
              message: timeIssue,
            });
          }
        }
      }
      return issues;
    },
  );
}
export async function createRoutine(input: RoutineInput, database = db) {
  const definition = { ...validateRoutine(input), id: crypto.randomUUID() };
  await database.definitions.add(definition);
  return definition.id;
}
async function rescueTasks(ids: Set<string>, database: typeof db) {
  if (!ids.size) return;
  const all = orderedTasks(await database.tasks.toArray());
  const inbox = all.filter((t) => t.occurrenceId === null);
  const rescued = all.filter(
    (t) => t.occurrenceId !== null && ids.has(t.occurrenceId),
  );
  await database.tasks.bulkPut(
    [...inbox, ...rescued].map((task, order) => ({
      ...task,
      occurrenceId: null,
      order,
    })),
  );
}
/** Whole-series changes preserve explicit overrides/skips and all task entities. */
export async function updateRoutine(
  id: string,
  input: RoutineInput,
  database = db,
) {
  const changes = validateRoutine(input);
  await database.transaction(
    "rw",
    database.definitions,
    database.occurrences,
    database.exceptions,
    database.tasks,
    async () => {
      const original = await database.definitions.get(id);
      if (!original?.recurrence)
        throw new Error("This routine no longer exists.");
      if (changes.timezone !== original.timezone)
        throw new Error(
          "A routine’s timezone cannot be changed. Create a new routine instead.",
        );
      const definition = { ...changes, id };
      const removed = new Set<string>();
      const updated: TimeBlockOccurrence[] = [];
      for (const occurrence of await database.occurrences
        .where("definitionId")
        .equals(id)
        .toArray()) {
        const exception = await database.exceptions.get(
          exceptionId(id, occurrence.date),
        );
        if (occurrence.overridden || exception?.kind === "override") continue;
        if (
          exception?.kind === "skip" ||
          !matchesDate(definition, occurrence.date)
        ) {
          removed.add(occurrence.id);
          continue;
        }
        try {
          updated.push({
            ...buildOccurrence(definition, occurrence.date),
            id: occurrence.id,
          });
        } catch {
          throw new Error(
            `Cannot update ${occurrence.date}: ${timeIssue} Existing blocks and tasks have not changed.`,
          );
        }
      }
      await rescueTasks(removed, database);
      await database.occurrences.bulkDelete([...removed]);
      await database.occurrences.bulkPut(updated);
      await database.definitions.put(definition);
    },
  );
}
/** Works even for an occurrence that has never been materialized or has a DST error. */
export async function skipDate(
  definitionId: string,
  date: string,
  database = db,
) {
  await database.transaction(
    "rw",
    database.definitions,
    database.occurrences,
    database.exceptions,
    database.tasks,
    async () => {
      const definition = await database.definitions.get(definitionId);
      if (!definition?.recurrence)
        throw new Error("This routine no longer exists.");
      const occurrence = await database.occurrences.get(
        occurrenceId(definitionId, date),
      );
      if (!matchesDate(definition, date) && !occurrence)
        throw new Error("This routine is not scheduled on that date.");
      await rescueTasks(new Set(occurrence ? [occurrence.id] : []), database);
      if (occurrence) await database.occurrences.delete(occurrence.id);
      await database.exceptions.put({
        id: exceptionId(definitionId, date),
        definitionId,
        date,
        kind: "skip",
      });
    },
  );
}
/** Restore a skipped date or reset an override, keeping tasks attached to the stable ID. */
export async function resetDate(
  definitionId: string,
  date: string,
  database = db,
) {
  await database.transaction(
    "rw",
    database.definitions,
    database.occurrences,
    database.exceptions,
    async () => {
      const definition = await database.definitions.get(definitionId);
      if (!definition?.recurrence)
        throw new Error("This routine no longer exists.");
      if (!matchesDate(definition, date))
        throw new Error(
          "This date is no longer in the routine’s schedule. Edit the schedule before restoring it.",
        );
      let occurrence: TimeBlockOccurrence;
      try {
        occurrence = buildOccurrence(definition, date);
      } catch {
        throw new Error(timeIssue);
      }
      await database.occurrences.put(occurrence);
      await database.exceptions.delete(exceptionId(definitionId, date));
    },
  );
}
/** Remove the routine and its blocks, preserving every task in Unscheduled. */
export async function deleteRoutine(id: string, database = db) {
  await database.transaction(
    "rw",
    database.definitions,
    database.occurrences,
    database.exceptions,
    database.tasks,
    async () => {
      const definition = await database.definitions.get(id);
      if (!definition?.recurrence)
        throw new Error("This routine no longer exists.");
      const ids = new Set(
        (
          await database.occurrences.where("definitionId").equals(id).toArray()
        ).map((o) => o.id),
      );
      await rescueTasks(ids, database);
      await database.occurrences.bulkDelete([...ids]);
      await database.exceptions
        .where("[definitionId+date]")
        .between([id, ""], [id, "\uffff"])
        .delete();
      await database.definitions.delete(id);
    },
  );
}
