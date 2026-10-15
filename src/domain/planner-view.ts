import type {
  Task,
  TimeBlockDefinition,
  TimeBlockOccurrence,
  UserPreferences,
} from "./models";
import { minuteOnDay } from "./time";
export function plannerView(
  blocks: TimeBlockOccurrence[],
  tasks: Task[],
  definitions: TimeBlockDefinition[],
  date: string,
  preferences: UserPreferences,
) {
  const definitionsById = new Map(definitions.map((d) => [d.id, d]));
  const tasksByBlock = new Map<string | null, Task[]>();
  for (const task of tasks) {
    const group = tasksByBlock.get(task.occurrenceId) ?? [];
    group.push(task);
    tasksByBlock.set(task.occurrenceId, group);
  }
  const dayBlocks: TimeBlockOccurrence[] = [];
  const visible: TimeBlockOccurrence[] = [];
  let taskCount = 0;
  let completed = 0;
  for (const block of blocks) {
    const start = minuteOnDay(block.start, date, preferences.timezone);
    const end = minuteOnDay(block.end, date, preferences.timezone);
    if (end > 0 && start < 1440) {
      dayBlocks.push(block);
      const group = tasksByBlock.get(block.id) ?? [];
      taskCount += group.length;
      completed += group.filter((t) => t.completed).length;
    }
    if (
      end > preferences.visibleStart * 60 &&
      start < preferences.visibleEnd * 60
    )
      visible.push(block);
  }
  dayBlocks.sort(
    (a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id),
  );
  return {
    definitionsById,
    tasksByBlock,
    dayBlocks,
    visible,
    taskCount,
    completed,
  };
}
