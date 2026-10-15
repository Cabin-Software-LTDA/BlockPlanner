import { taskFits, validateTaskSchedule } from "../../domain/task-schedule";
import { exceptionId } from "../../domain/recurrence";
import {
  adjustBlock,
  validateRange,
  type BlockAction,
} from "../../domain/interactions";
import type { Task } from "../../domain/models";
import type { BlockIcon, Color } from "../../domain/models";
import { interval } from "../../domain/time";
import { db, defaultPreferences, type TimeBlockDB } from "./database";
export async function initialize(database = db) {
  await database.transaction("rw", database.preferences, async () => {
    if (!(await database.preferences.get("user")))
      await database.preferences.add(defaultPreferences());
  });
}
export async function createBlock(
  input: {
    title: string;
    date: string;
    start: string;
    end: string;
    color: Color;
    icon: BlockIcon;
    timezone: string;
    fullDay?: boolean;
  },
  database = db,
) {
  const title = input.title.trim();
  if (!title) throw new Error("Give your block a name.");
  const times = interval(
    input.date,
    input.start,
    input.end,
    input.timezone,
    input.fullDay,
  );
  validateRange(times.start, times.end, input.timezone);
  const definitionId = crypto.randomUUID();
  const id = crypto.randomUUID();
  await database.transaction(
    "rw",
    database.definitions,
    database.occurrences,
    async () => {
      await database.definitions.add({
        id: definitionId,
        title,
        color: input.color,
        icon: input.icon,
        timezone: input.timezone,
        startTime: input.start,
        endTime: input.end,
        endDayOffset: times.endDayOffset,
        recurrence: null,
      });
      await database.occurrences.add({
        id,
        definitionId,
        date: input.date,
        timezone: input.timezone,
        title,
        color: input.color,
        icon: input.icon,
        start: times.start,
        end: times.end,
        overridden: false,
      });
    },
  );
  return id;
}
export async function addTask(
  title: string,
  occurrenceId: string | null,
  database = db,
) {
  if (!title.trim()) return;
  await database.transaction(
    "rw",
    database.tasks,
    database.occurrences,
    async () => {
      if (occurrenceId && !(await database.occurrences.get(occurrenceId)))
        throw new Error("This block no longer exists.");
      const tasks = await database.tasks.toArray();
      await database.tasks.add({
        id: crypto.randomUUID(),
        occurrenceId,
        title: title.trim(),
        completed: false,
        notes: "",
        order:
          Math.max(
            -1,
            ...tasks
              .filter((t) => t.occurrenceId === occurrenceId)
              .map((t) => t.order),
          ) + 1,
        createdAt: new Date().toISOString(),
      });
    },
  );
}
export async function removeBlock(id: string, database: TimeBlockDB = db) {
  await database.transaction(
    "rw",
    database.occurrences,
    database.definitions,
    database.exceptions,
    database.tasks,
    async () => {
      const occurrence = await database.occurrences.get(id);
      if (
        occurrence &&
        (await database.definitions.get(occurrence.definitionId))?.recurrence
      ) {
        await database.exceptions.put({
          id: exceptionId(occurrence.definitionId, occurrence.date),
          definitionId: occurrence.definitionId,
          date: occurrence.date,
          kind: "skip",
        });
      }
      const all = orderedTasks(await database.tasks.toArray());
      const inbox = all.filter((t) => t.occurrenceId === null);
      const rescued = all.filter((t) => t.occurrenceId === id);
      await database.tasks.bulkPut(
        [...inbox, ...rescued].map((task, order) => ({
          ...task,
          occurrenceId: null,
          schedule: undefined,
          order,
        })),
      );
      await database.occurrences.delete(id);
      if (
        occurrence &&
        (await database.definitions.get(occurrence.definitionId))
          ?.recurrence === null
      )
        await database.definitions.delete(occurrence.definitionId);
    },
  );
}

export async function updateBlock(
  id: string,
  changes: Pick<
    import("../../domain/models").TimeBlockOccurrence,
    "start" | "end" | "title" | "color" | "icon"
  >,
  database = db,
) {
  await database.transaction(
    "rw",
    database.occurrences,
    database.definitions,
    database.exceptions,
    async () => {
      const block = await database.occurrences.get(id);
      if (!block) throw new Error("This block no longer exists.");
      if (!changes.title.trim()) throw new Error("Give your block a name.");
      validateRange(changes.start, changes.end, block.timezone);
      await recordOverride(block, database);
      await database.occurrences.update(id, {
        ...changes,
        title: changes.title.trim(),
        overridden: true,
      });
    },
  );
}

export async function adjustBlockTime(
  id: string,
  action: BlockAction,
  minutes: number,
  increment: 15 | 30,
  database = db,
) {
  await database.transaction(
    "rw",
    database.occurrences,
    database.definitions,
    database.exceptions,
    async () => {
      const block = await database.occurrences.get(id);
      if (!block) throw new Error("This block no longer exists.");
      await recordOverride(block, database);
      await database.occurrences.update(id, {
        ...adjustBlock(block, action, minutes, increment),
        overridden: true,
      });
    },
  );
}

export type TaskChanges = Pick<
  Task,
  | "title"
  | "notes"
  | "estimatedMinutes"
  | "schedule"
  | "checklist"
  | "notesFormat"
>;
export async function saveTask(
  id: string,
  changes: TaskChanges,
  destination: string | null,
  database = db,
) {
  if (!changes.title.trim()) throw new Error("Give your task a name.");
  if (
    changes.estimatedMinutes !== undefined &&
    (!Number.isInteger(changes.estimatedMinutes) ||
      changes.estimatedMinutes < 1 ||
      changes.estimatedMinutes > 1440)
  )
    throw new Error("Estimate must be a whole number from 1 to 1440 minutes.");
  await database.transaction(
    "rw",
    database.tasks,
    database.occurrences,
    async () => {
      const task = await database.tasks.get(id);
      if (!task) throw new Error("This task no longer exists.");
      if (changes.schedule) {
        validateTaskSchedule(changes.schedule);
        const block = destination
          ? await database.occurrences.get(destination)
          : null;
        if (!block) throw new Error("Choose a block before scheduling a task.");
        // Existing overflow remains editable after a block is shortened.
        const unchanged =
          destination === task.occurrenceId &&
          JSON.stringify(changes.schedule) === JSON.stringify(task.schedule);
        if (
          !unchanged &&
          !taskFits({ ...task, schedule: changes.schedule }, block)
        )
          throw new Error("The task must fit within its block.");
      }
      if (changes.checklist?.some((item) => !item.title.trim()))
        throw new Error("Checklist items need a name.");
      if (destination !== task.occurrenceId)
        await moveTask(id, destination, null, database);
      await database.tasks.update(id, {
        ...changes,
        title: changes.title.trim(),
      });
    },
  );
}

export function orderedTasks(tasks: Task[]) {
  return [...tasks].sort(
    (a, b) =>
      a.order - b.order ||
      a.createdAt.localeCompare(b.createdAt) ||
      a.id.localeCompare(b.id),
  );
}
/** Insert before another task, or append with null. Reindex both lists atomically. */
export async function moveTask(
  id: string,
  destination: string | null,
  beforeId: string | null,
  database = db,
) {
  await database.transaction(
    "rw",
    database.tasks,
    database.occurrences,
    async () => {
      const task = await database.tasks.get(id);
      if (!task) throw new Error("This task no longer exists.");
      if (destination && !(await database.occurrences.get(destination)))
        throw new Error("The destination block no longer exists.");
      if (beforeId === id && destination === task.occurrenceId) return;
      const all = orderedTasks(await database.tasks.toArray());
      const target = all.filter(
        (t) => t.occurrenceId === destination && t.id !== id,
      );
      const index =
        beforeId === null
          ? target.length
          : target.findIndex((t) => t.id === beforeId);
      if (index < 0)
        throw new Error("The destination task changed. Please try again.");
      target.splice(index, 0, {
        ...task,
        occurrenceId: destination,
        schedule: destination === task.occurrenceId ? task.schedule : undefined,
      });
      const source =
        task.occurrenceId === destination
          ? []
          : all.filter(
              (t) => t.occurrenceId === task.occurrenceId && t.id !== id,
            );
      await database.tasks.bulkPut([
        ...target.map((t, order) => ({ ...t, order })),
        ...source.map((t, order) => ({ ...t, order })),
      ]);
    },
  );
}

export async function reorderTask(
  id: string,
  direction: -1 | 1,
  database = db,
) {
  await database.transaction(
    "rw",
    database.tasks,
    database.occurrences,
    async () => {
      const task = await database.tasks.get(id);
      if (!task) throw new Error("This task no longer exists.");
      const list = orderedTasks(
        (await database.tasks.toArray()).filter(
          (t) => t.occurrenceId === task.occurrenceId,
        ),
      );
      const index = list.findIndex((t) => t.id === id);
      if (index + direction < 0 || index + direction >= list.length) return;
      await moveTask(
        id,
        task.occurrenceId,
        direction < 0 ? list[index - 1].id : (list[index + 2]?.id ?? null),
        database,
      );
    },
  );
}

async function recordOverride(
  block: import("../../domain/models").TimeBlockOccurrence,
  database: TimeBlockDB,
) {
  if ((await database.definitions.get(block.definitionId))?.recurrence) {
    await database.exceptions.put({
      id: exceptionId(block.definitionId, block.date),
      definitionId: block.definitionId,
      date: block.date,
      kind: "override",
      occurrenceId: block.id,
    });
  }
}

export async function scheduleTask(
  id: string,
  destination: string,
  schedule: NonNullable<Task["schedule"]>,
  database = db,
) {
  await database.transaction(
    "rw",
    database.tasks,
    database.occurrences,
    async () => {
      const task = await database.tasks.get(id);
      if (!task) throw new Error("This task no longer exists.");
      await saveTask(
        id,
        {
          title: task.title,
          notes: task.notes,
          estimatedMinutes: task.estimatedMinutes,
          schedule,
        },
        destination,
        database,
      );
    },
  );
}
export async function toggleChecklistItem(
  taskId: string,
  itemId: string,
  database = db,
) {
  await database.transaction("rw", database.tasks, async () => {
    const task = await database.tasks.get(taskId);
    if (!task) throw new Error("This task no longer exists.");
    await database.tasks.update(taskId, {
      checklist: task.checklist?.map((item) =>
        item.id === itemId ? { ...item, completed: !item.completed } : item,
      ),
    });
  });
}
