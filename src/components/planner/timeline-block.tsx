"use client";
import { useState } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import {
  BookOpen,
  BriefcaseBusiness,
  Coffee,
  Sparkles,
  GripVertical,
  Repeat2,
} from "lucide-react";
import type {
  ExternalCalendarEvent,
  Task,
  TimeBlockOccurrence,
  UserPreferences,
} from "@/domain/models";
import { minuteOnDay, timeLabel } from "@/domain/time";
import {
  dateOf,
  PIXELS_PER_HOUR,
  type BlockAction,
} from "@/domain/interactions";
import { adjustBlockTime } from "@/lib/db/repository";
import { usePlannerInteractions, type RunAction } from "./planner-interactions";
import { ScheduledTasks } from "./scheduled-tasks";
import { hasClockChange } from "@/domain/calendar";
import { taskFits } from "@/domain/task-schedule";
import { TaskList } from "./task-list";
const icons = {
  book: BookOpen,
  briefcase: BriefcaseBusiness,
  coffee: Coffee,
  sparkles: Sparkles,
};
function TimeHandle({
  block,
  action,
  increment,
  run,
  open,
}: {
  block: TimeBlockOccurrence;
  action: BlockAction;
  increment: 15 | 30;
  run: RunAction;
  open: () => void;
}) {
  const { busy } = usePlannerInteractions();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const drag = useDraggable({
    id: `${action}:${block.id}`,
    data: { kind: "block", blockId: block.id, action },
    disabled: busy || saving,
  });
  const label =
    action === "move"
      ? `Move ${block.title}`
      : `${action === "resize-start" ? "Resize start of" : "Resize end of"} ${block.title}`;
  return (
    <>
      <button
        ref={drag.setNodeRef}
        {...drag.attributes}
        {...drag.listeners}
        className={
          action === "move"
            ? "icon-button drag-handle block-move"
            : `resize-handle ${action}`
        }
        aria-label={label}
        title={`${label}. Drag or use Up/Down arrows (${increment} minutes). Enter opens details.`}
        onKeyDown={async (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            open();
            return;
          }
          if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
          e.preventDefault();
          e.stopPropagation();
          if (saving || busy || e.repeat) return;
          setSaving(true);
          const minutes = e.key === "ArrowUp" ? -increment : increment;
          const ok = await run(() =>
            adjustBlockTime(block.id, action, minutes, increment),
          );
          setSaving(false);
          setMessage(
            ok
              ? `${label}: adjusted by ${minutes} minutes.`
              : "Time unchanged.",
          );
        }}
      >
        {action === "move" ? <GripVertical size={15} /> : <span />}
      </button>
      <span role="status" className="sr-only">
        {message}
      </span>
    </>
  );
}
export function TimelineBlock({
  block,
  meetings,
  recurring,
  lane,
  lanes,
  date,
  preferences,
  tasks,
  selected,
  open,
  run,
}: {
  block: TimeBlockOccurrence;
  meetings: ExternalCalendarEvent[];
  recurring: boolean;
  lane: number;
  lanes: number;
  date: string;
  preferences: UserPreferences;
  tasks: Task[];
  selected: boolean;
  open: () => void;
  run: RunAction;
}) {
  const { ownerOf } = usePlannerInteractions();
  meetings = meetings.filter((event) => ownerOf(event) === block.id);
  const hasTimedItems =
    tasks.some((t) => t.schedule && taskFits(t, block)) ||
    meetings.some((m) => !m.allDay);
  const clockChange = hasClockChange(date, preferences.timezone);
  const { preview, busy } = usePlannerInteractions();
  const drop = useDroppable({
    id: `block-list:${block.id}`,
    data: {
      kind: clockChange ? "task-list" : "task-time",
      occurrenceId: block.id,
      date,
      timezone: preferences.timezone,
      visibleStart: Math.max(
        preferences.visibleStart * 60,
        minuteOnDay(block.start, date, preferences.timezone),
      ),
    },
    disabled: busy,
  });
  const range = preview?.id === block.id ? preview : block;
  const actualStart = minuteOnDay(range.start, date, preferences.timezone);
  const actualEnd = minuteOnDay(range.end, date, preferences.timezone);
  const start = Math.max(preferences.visibleStart * 60, actualStart);
  const end = Math.min(preferences.visibleEnd * 60, actualEnd);
  const height = Math.max(0, ((end - start) * PIXELS_PER_HOUR) / 60 - 4);
  const compact = height < 70;
  const Icon = icons[block.icon];
  return (
    <article
      ref={drop.setNodeRef}
      aria-label={`Block ${block.title}`}
      className={`time-block ${clockChange ? "" : `timed-block ${hasTimedItems ? "" : "empty-timed-block"}`} ${block.color} ${selected ? "selected" : ""} ${preview?.id === block.id ? "block-preview" : ""} ${drop.isOver ? "block-drop-over" : ""} ${compact ? "compact-block" : ""}`}
      style={{
        top: ((start - preferences.visibleStart * 60) * PIXELS_PER_HOUR) / 60,
        height,
        left: `calc(70px + (var(--block-area, 100%) - 86px) * ${lane / lanes})`,
        width: `calc((var(--block-area, 100%) - 86px) / ${lanes} - 8px)`,
        visibility: height <= 0 ? "hidden" : undefined,
      }}
    >
      {actualStart >= preferences.visibleStart * 60 && (
        <TimeHandle
          block={block}
          action="resize-start"
          increment={preferences.increment}
          run={run}
          open={open}
        />
      )}
      <div className="block-content">
        <div className="block-top">
          <TimeHandle
            block={block}
            action="move"
            increment={preferences.increment}
            run={run}
            open={open}
          />
          <button
            className="block-heading"
            onClick={open}
            title={`${block.title} · ${timeLabel(range.start, preferences.timezone)}–${timeLabel(range.end, preferences.timezone)} · ${tasks.length} tasks`}
          >
            <span className="block-icon">
              <Icon size={18} />
            </span>
            <span>
              <strong>
                {block.title}
                {recurring && (
                  <span
                    className="repeat-badge"
                    title={
                      block.overridden
                        ? "Edited occurrence"
                        : "Recurring occurrence"
                    }
                  >
                    <Repeat2 size={12} />
                    <span className="sr-only">
                      {block.overridden
                        ? " · Edited occurrence"
                        : " · Recurring"}
                    </span>
                    {block.overridden && <i />}
                  </span>
                )}
              </strong>
              <small>
                {timeLabel(range.start, preferences.timezone)} –{" "}
                {timeLabel(range.end, preferences.timezone)}
                {dateOf(range.start, preferences.timezone) < date
                  ? " · continued"
                  : dateOf(range.end, preferences.timezone) > date
                    ? " · next day"
                    : ""}
              </small>
            </span>
            {compact && (
              <span className="block-task-count">
                {tasks.filter((t) => t.completed).length}/{tasks.length}
              </span>
            )}
          </button>
        </div>
        {tasks.some((t) => !taskFits(t, block)) && (
          <p className="form-error">
            Some tasks no longer fit. Edit their timing below.
          </p>
        )}
        {clockChange && (
          <p className="muted">
            Clocks change today. Use task details for exact timing.
          </p>
        )}
        {!compact && (
          <TaskList
            tasks={tasks.filter(
              (t) => clockChange || !t.schedule || !taskFits(t, block),
            )}
            occurrenceId={block.id}
            run={run}
            dropZone={false}
          />
        )}
        {compact && height >= 60 && (
          <button className="compact-task-link" onClick={open}>
            {tasks.length
              ? `${tasks.length} tasks · view details`
              : "+ Add tasks"}
          </button>
        )}
      </div>
      {!clockChange && (
        <ScheduledTasks
          tasks={tasks}
          meetings={meetings}
          block={{ ...block, ...range }}
          date={date}
          preferences={preferences}
          start={start}
          end={end}
          run={run}
        />
      )}
      {actualEnd <= preferences.visibleEnd * 60 && (
        <TimeHandle
          block={block}
          action="resize-end"
          increment={preferences.increment}
          run={run}
          open={open}
        />
      )}
    </article>
  );
}
