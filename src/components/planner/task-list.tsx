"use client";
import { useState } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import {
  ArrowDown,
  ArrowUp,
  GripVertical,
  Plus,
  Trash2,
  StickyNote,
} from "lucide-react";
import type { Task } from "@/domain/models";
import { db } from "@/lib/db/database";
import { addTask, orderedTasks, reorderTask } from "@/lib/db/repository";
import { usePlannerInteractions, type RunAction } from "./planner-interactions";
function TaskRow({
  task,
  first,
  last,
  run,
  draggable,
}: {
  task: Task;
  first: boolean;
  last: boolean;
  run: RunAction;
  draggable: boolean;
}) {
  const { editTask, busy } = usePlannerInteractions();
  const drag = useDraggable({
    id: `${draggable ? "task" : "editor-task"}:${task.id}`,
    data: { kind: "task", taskId: task.id },
    disabled: !draggable || busy,
  });
  const drop = useDroppable({
    id: `${draggable ? "target" : "editor-target"}:${task.id}`,
    data: {
      kind: "task-target",
      taskId: task.id,
      occurrenceId: task.occurrenceId,
    },
    disabled: !draggable || busy,
  });
  return (
    <div
      ref={drop.setNodeRef}
      className={`task-row ${drop.isOver ? "task-drop-before" : ""} ${drag.isDragging ? "dragging-task" : ""}`}
    >
      {draggable && (
        <button
          ref={drag.setNodeRef}
          {...drag.attributes}
          {...drag.listeners}
          className="icon-button drag-handle"
          aria-label={`Drag task ${task.title}`}
          title="Drag to reorder or move to another block"
        >
          <GripVertical size={13} />
        </button>
      )}
      <input
        type="checkbox"
        aria-label={`Complete ${task.title}`}
        checked={task.completed}
        onChange={() =>
          void run(() =>
            db.tasks.update(task.id, { completed: !task.completed }),
          )
        }
      />
      <button
        className={`task-title ${task.completed ? "completed" : ""}`}
        aria-label={`Edit task ${task.title}`}
        onClick={() => editTask(task.id)}
      >
        {task.title}
        {task.estimatedMinutes !== undefined && (
          <small>{task.estimatedMinutes}m</small>
        )}
        {task.notes && <StickyNote size={12} aria-label="Has notes" />}
      </button>
      <div className="task-actions">
        <button
          className="icon-button"
          disabled={first || busy}
          aria-label={`Move ${task.title} up`}
          onClick={() => void run(() => reorderTask(task.id, -1))}
        >
          <ArrowUp size={12} />
        </button>
        <button
          className="icon-button"
          disabled={last || busy}
          aria-label={`Move ${task.title} down`}
          onClick={() => void run(() => reorderTask(task.id, 1))}
        >
          <ArrowDown size={12} />
        </button>
        <button
          className="icon-button"
          aria-label={`Delete ${task.title}`}
          onClick={() => void run(() => db.tasks.delete(task.id))}
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}
export function TaskList({
  tasks,
  occurrenceId,
  run,
  dropZone = true,
  draggable = true,
}: {
  tasks: Task[];
  occurrenceId: string | null;
  run: RunAction;
  dropZone?: boolean;
  draggable?: boolean;
}) {
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const { busy } = usePlannerInteractions();
  const drop = useDroppable({
    id: `${draggable ? "list" : "editor-list"}:${occurrenceId ?? "inbox"}`,
    data: { kind: "task-list", occurrenceId },
    disabled: !dropZone || !draggable || busy,
  });
  const ordered = orderedTasks(tasks);
  return (
    <div
      ref={dropZone ? drop.setNodeRef : undefined}
      className={`task-list ${drop.isOver ? "task-list-over" : ""}`}
    >
      {ordered.map((task, index) => (
        <TaskRow
          key={task.id}
          task={task}
          first={index === 0}
          last={index === ordered.length - 1}
          run={run}
          draggable={draggable}
        />
      ))}
      <form
        className="task-add"
        onSubmit={async (e) => {
          e.preventDefault();
          if (saving || !title.trim()) return;
          setSaving(true);
          if (await run(() => addTask(title, occurrenceId))) setTitle("");
          setSaving(false);
        }}
      >
        <Plus size={15} />
        <input
          aria-label="New task"
          placeholder="Add a task…"
          value={title}
          maxLength={300}
          disabled={saving}
          onChange={(e) => setTitle(e.target.value)}
        />
        <button
          className="icon-button"
          aria-label="Add task"
          disabled={saving || !title.trim()}
        >
          <Plus size={14} />
        </button>
      </form>
    </div>
  );
}
