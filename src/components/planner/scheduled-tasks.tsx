"use client";
import { useDraggable } from "@dnd-kit/core";
import { GripVertical, StickyNote } from "lucide-react";
import type {
  ExternalCalendarEvent,
  Task,
  TimeBlockOccurrence,
  UserPreferences,
} from "@/domain/models";
import { taskFits, taskRange } from "@/domain/task-schedule";
import {
  intersects,
  layoutBlocks,
  minuteOnDay,
  timeLabel,
} from "@/domain/time";
import { PIXELS_PER_HOUR } from "@/domain/interactions";
import { db } from "@/lib/db/database";
import { scheduleTask } from "@/lib/db/repository";
import { MeetingCard } from "./meeting-card";
import { TaskProgress } from "./task-progress";
import { usePlannerInteractions, type RunAction } from "./planner-interactions";
function ScheduledTask({
  task,
  block,
  top,
  height,
  left,
  width,
  timezone,
  increment,
  conflict,
  run,
}: {
  task: Task;
  block: TimeBlockOccurrence;
  top: number;
  height: number;
  left: string;
  width: string;
  timezone: string;
  increment: 15 | 30;
  conflict: boolean;
  run: RunAction;
}) {
  const { editTask, busy } = usePlannerInteractions();
  const drag = useDraggable({
    id: `scheduled:${task.id}`,
    data: { kind: "task", taskId: task.id, scheduled: true },
    disabled: busy,
  });
  const range = taskRange(task, block)!;
  return (
    <div
      ref={drag.setNodeRef}
      className={`scheduled-task ${height < 65 ? "short-task" : ""} ${drag.isDragging ? "dragging-task" : ""} ${conflict ? "task-conflict" : ""}`}
      style={{ top, height, left, width }}
    >
      <div className="scheduled-task-heading">
        <button
          ref={drag.setActivatorNodeRef}
          {...drag.attributes}
          {...drag.listeners}
          className="icon-button drag-handle"
          aria-label={`Move scheduled task ${task.title}`}
          title="Drag, or use Up/Down to move and Shift+Up/Down to change duration"
          onKeyDown={(e) => {
            if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
            e.preventDefault();
            e.stopPropagation();
            if (busy || e.repeat) return;
            const delta = e.key === "ArrowUp" ? -increment : increment;
            const schedule = { ...task.schedule! };
            if (e.shiftKey) schedule.durationMinutes += delta;
            else schedule.offsetMinutes += delta;
            void run(() => scheduleTask(task.id, block.id, schedule));
          }}
        >
          <GripVertical size={12} />
        </button>
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
          onClick={() => editTask(task.id)}
          aria-label={`Edit task ${task.title}`}
        >
          {task.title}
          {task.notes && <StickyNote size={12} />}
        </button>
      </div>
      {height >= 45 && (
        <small>
          {timeLabel(range.start, timezone)}–{timeLabel(range.end, timezone)}
          {conflict ? " · overlap" : ""}
        </small>
      )}
      {height >= 24 && (
        <TaskProgress task={task} run={run} compact={height < 125} />
      )}
    </div>
  );
}
export function ScheduledTasks({
  tasks,
  meetings,
  block,
  date,
  preferences,
  start,
  end,
  run,
}: {
  tasks: Task[];
  meetings: ExternalCalendarEvent[];
  block: TimeBlockOccurrence;
  date: string;
  preferences: UserPreferences;
  start: number;
  end: number;
  run: RunAction;
}) {
  const items = [
    ...tasks
      .filter((t) => t.schedule && taskFits(t, block))
      .map((task) => ({
        id: `task:${task.id}`,
        ...taskRange(task, block)!,
        task,
        meeting: null,
      })),
    ...meetings
      .filter((m) => !m.allDay)
      .map((meeting) => ({
        id: `meeting:${meeting.id}`,
        start: new Date(
          Math.max(Date.parse(meeting.start), Date.parse(block.start)),
        ).toISOString(),
        end: new Date(
          Math.min(Date.parse(meeting.end), Date.parse(block.end)),
        ).toISOString(),
        task: null,
        meeting,
      })),
  ];
  return (
    <div className="scheduled-items">
      {layoutBlocks(items).map(({ block: item, lane, lanes }) => {
        const from = Math.max(
          start,
          minuteOnDay(item.start, date, preferences.timezone),
        );
        const to = Math.min(
          end,
          minuteOnDay(item.end, date, preferences.timezone),
        );
        if (to <= from) return null;
        const style = {
          top: ((from - start) * PIXELS_PER_HOUR) / 60,
          height: Math.max(1, ((to - from) * PIXELS_PER_HOUR) / 60 - 2),
          left: `${(lane * 100) / lanes}%`,
          width: `calc(${100 / lanes}% - 3px)`,
        };
        return item.task ? (
          <ScheduledTask
            key={item.id}
            task={item.task}
            block={block}
            {...style}
            timezone={preferences.timezone}
            increment={preferences.increment}
            conflict={items.some(
              (other) => other.id !== item.id && intersects(item, other),
            )}
            run={run}
          />
        ) : (
          <MeetingCard
            key={item.id}
            event={item.meeting!}
            timezone={preferences.timezone}
            style={style}
            className="scheduled-meeting"
          />
        );
      })}
    </div>
  );
}
