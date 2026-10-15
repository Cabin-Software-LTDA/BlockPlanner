"use client";
import type { Task } from "@/domain/models";
import { checklistProgress } from "@/domain/task-schedule";
import { toggleChecklistItem } from "@/lib/db/repository";
import type { RunAction } from "./planner-interactions";
export function TaskProgress({
  task,
  run,
  compact = false,
}: {
  task: Task;
  run: RunAction;
  compact?: boolean;
}) {
  const { done, total } = checklistProgress(task);
  if (!total) return null;
  return (
    <div className="task-progress">
      <div className="progress-caption">
        <span>
          {done}/{total} steps
        </span>
        <progress
          aria-label={`${task.title} checklist progress`}
          value={done}
          max={total}
        />
      </div>
      {!compact && (
        <div className="task-checklist">
          {task.checklist?.map((item) => (
            <label key={item.id}>
              <input
                type="checkbox"
                checked={item.completed}
                onChange={() =>
                  void run(() => toggleChecklistItem(task.id, item.id))
                }
              />
              <span className={item.completed ? "completed" : ""}>
                {item.title}
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
