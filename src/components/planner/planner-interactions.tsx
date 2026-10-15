"use client";
import { createContext, useContext, useState, type ReactNode } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragMoveEvent,
} from "@dnd-kit/core";
import type {
  ExternalCalendarEvent,
  MeetingPlacement,
  Task,
  TimeBlockOccurrence,
  UserPreferences,
} from "@/domain/models";
import {
  adjustBlock,
  PIXELS_PER_HOUR,
  type BlockAction,
} from "@/domain/interactions";
import { adjustBlockTime, moveTask, scheduleTask } from "@/lib/db/repository";
import { taskRange, scheduleAtMinute } from "@/domain/task-schedule";
import { meetingOwner, meetingLabel } from "@/domain/calendar";
import { assignMeeting } from "@/lib/db/calendar";
import { MeetingDialog } from "./meeting-card";
import { TaskEditor } from "./task-editor";
export type RunAction = (action: () => Promise<unknown>) => Promise<boolean>;
type DragData =
  | { kind: "meeting"; eventId: string }
  | { kind: "task"; taskId: string; scheduled?: boolean }
  | { kind: "block"; blockId: string; action: BlockAction };
type Preview = { id: string; start: string; end: string };
const InteractionContext = createContext<{
  openMeeting: (id: string) => void;
  ownerOf: (event: ExternalCalendarEvent) => string | null;
  editTask: (id: string) => void;
  preview: Preview | null;
  busy: boolean;
  draggingMeeting: boolean;
  taskTiming: (task: Task) => string;
}>({
  openMeeting: () => {},
  ownerOf: () => null,
  editTask: () => {},
  preview: null,
  busy: false,
  draggingMeeting: false,
  taskTiming: () => "",
});
export const usePlannerInteractions = () => useContext(InteractionContext);
const collisionDetection: CollisionDetection = (args) => {
  if (args.active.data.current?.kind === "meeting")
    return pointerWithin(args).filter((hit) => {
      const data = args.droppableContainers.find((c) => c.id === hit.id)?.data
        .current;
      return (
        data?.kind === "meeting-outside" ||
        data?.kind === "task-time" ||
        String(hit.id).startsWith("block-list:")
      );
    });
  if (args.active.data.current?.kind !== "task") return [];
  return pointerWithin(args)
    .filter((hit) => hit.id !== args.active.id)
    .sort((a, b) => {
      const kind = (id: typeof a.id) =>
        args.droppableContainers.find((c) => c.id === id)?.data.current?.kind;
      return (
        Number(kind(b.id) === "task-target") -
        Number(kind(a.id) === "task-target")
      );
    });
};
export function PlannerInteractions({
  children,
  events,
  placements,
  blocks,
  tasks,
  preferences,
  run,
}: {
  children: ReactNode;
  events: ExternalCalendarEvent[];
  placements: MeetingPlacement[];
  blocks: TimeBlockOccurrence[];
  tasks: Task[];
  preferences: UserPreferences;
  run: RunAction;
}) {
  const [meetingId, setMeetingId] = useState<string | null>(null);
  const [draggedMeeting, setDraggedMeeting] =
    useState<ExternalCalendarEvent | null>(null);
  const ownerOf = (event: ExternalCalendarEvent) =>
    meetingOwner(event, blocks, placements);
  const selectedMeeting = events.find((e) => e.id === meetingId);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [draggedTask, setDraggedTask] = useState<Task | null>(null);
  const [busy, setBusy] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );
  const editing = tasks.find((t) => t.id === editingId);
  function showPreview(event: DragMoveEvent) {
    const data = event.active.data.current as DragData | undefined;
    if (data?.kind !== "block") return;
    const block = blocks.find((b) => b.id === data.blockId);
    if (!block) return;
    try {
      setPreview({
        id: block.id,
        ...adjustBlock(
          block,
          data.action,
          (event.delta.y * 60) / PIXELS_PER_HOUR,
          preferences.increment,
        ),
      });
    } catch {
      setPreview(null);
    }
  }
  return (
    <InteractionContext.Provider
      value={{
        openMeeting: setMeetingId,
        ownerOf,
        editTask: setEditingId,
        preview,
        busy,
        draggingMeeting: draggedMeeting !== null,
        taskTiming: (task) => {
          const block = blocks.find((b) => b.id === task.occurrenceId);
          const range = block ? taskRange(task, block) : null;
          return range
            ? meetingLabel({ ...range, allDay: false }, preferences.timezone)
            : "";
        },
      }}
    >
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        accessibility={{
          announcements: {
            onDragStart: ({ active }) => {
              const data = active.data.current as DragData | undefined;
              if (data?.kind === "meeting")
                return "Assigning meeting. Its time will not change.";
              return data?.kind === "task"
                ? `Picked up ${tasks.find((t) => t.id === data.taskId)?.title ?? "task"}.`
                : `Adjusting ${blocks.find((b) => b.id === (data?.kind === "block" ? data.blockId : ""))?.title ?? "block"}.`;
            },
            onDragOver: ({ over }) => {
              const target = over?.data.current;
              if (target?.kind === "meeting-outside")
                return "Show meeting outside blocks at its original time.";
              if (!target) return "No task destination.";
              if (target.kind === "task-target")
                return `Insert before ${tasks.find((t) => t.id === target.taskId)?.title ?? "task"}.`;
              return target.occurrenceId === null
                ? "Move to Unscheduled."
                : `Move to ${blocks.find((b) => b.id === target.occurrenceId)?.title ?? "block"}.`;
            },
            onDragEnd: () => "Drag ended.",
            onDragCancel: () => "Drag cancelled. No changes saved.",
          },
          screenReaderInstructions: {
            draggable:
              "Pointer users can drag this handle. Keyboard users: use arrow keys on block handles to adjust time. Use task up and down buttons to reorder, or Edit task to move between blocks.",
          },
        }}
        onDragStart={(event) => {
          const data = event.active.data.current as DragData | undefined;
          setDraggedMeeting(
            data?.kind === "meeting"
              ? (events.find((e) => e.id === data.eventId) ?? null)
              : null,
          );
          setDraggedTask(
            data?.kind === "task"
              ? (tasks.find((t) => t.id === data.taskId) ?? null)
              : null,
          );
          setAnnouncement("");
        }}
        onDragMove={showPreview}
        onDragCancel={() => {
          setPreview(null);
          setDraggedMeeting(null);
          setDraggedTask(null);
          setAnnouncement("Drag cancelled.");
        }}
        onDragEnd={async (event) => {
          const data = event.active.data.current as DragData | undefined;
          setDraggedTask(null);
          setDraggedMeeting(null);
          setBusy(true);
          let ok = false;
          if (data?.kind === "meeting" && event.over) {
            const target = event.over.data.current;
            if (target?.kind === "meeting-outside" || target?.occurrenceId)
              ok = await run(() =>
                assignMeeting(
                  data.eventId,
                  target.kind === "meeting-outside"
                    ? null
                    : target.occurrenceId,
                ),
              );
          } else if (data?.kind === "block" && event.delta.y !== 0) {
            ok = await run(() =>
              adjustBlockTime(
                data.blockId,
                data.action,
                (event.delta.y * 60) / PIXELS_PER_HOUR,
                preferences.increment,
              ),
            );
          } else if (data?.kind === "task" && event.over) {
            const target = event.over.data.current;
            if (target?.kind === "task-time") {
              const block = blocks.find((b) => b.id === target.occurrenceId);
              const task = tasks.find((t) => t.id === data.taskId);
              if (block && task)
                ok = await run(async () => {
                  const pointer = event.activatorEvent as PointerEvent;
                  const y = data.scheduled
                    ? event.active.rect.current.translated?.top
                    : pointer.clientY + event.delta.y;
                  if (y === undefined || !Number.isFinite(y))
                    throw new Error(
                      "Could not determine task position. Use task details to set a time.",
                    );
                  const minute =
                    target.visibleStart +
                    ((y - event.over!.rect.top) * 60) / PIXELS_PER_HOUR;
                  const schedule = scheduleAtMinute(
                    block,
                    target.date,
                    target.timezone,
                    minute,
                    task.schedule?.durationMinutes ??
                      task.estimatedMinutes ??
                      30,
                    preferences.increment,
                  );
                  await scheduleTask(task.id, block.id, schedule);
                });
            } else if (
              target?.kind === "task-target" ||
              target?.kind === "task-list"
            ) {
              ok = await run(() =>
                moveTask(
                  data.taskId,
                  target.occurrenceId as string | null,
                  target.kind === "task-target"
                    ? (target.taskId as string)
                    : null,
                ),
              );
            }
          }
          setPreview(null);
          setBusy(false);
          setAnnouncement(ok ? "Saved." : "No changes saved.");
        }}
      >
        {children}
        <DragOverlay dropAnimation={null}>
          {draggedMeeting && (
            <div className="task-drag-preview">
              {draggedMeeting.title}
              <small>
                Time locked ·{" "}
                {meetingLabel(draggedMeeting, preferences.timezone)}
              </small>
            </div>
          )}
          {draggedTask && (
            <div className="task-drag-preview">{draggedTask.title}</div>
          )}
        </DragOverlay>
        <span className="sr-only" role="status">
          {announcement}
        </span>
        {selectedMeeting && (
          <MeetingDialog
            event={selectedMeeting}
            blocks={blocks}
            owner={ownerOf(selectedMeeting)}
            timezone={preferences.timezone}
            run={run}
            close={() => setMeetingId(null)}
          />
        )}
        {editing && (
          <TaskEditor
            key={editing.id}
            task={editing}
            blocks={blocks}
            run={run}
            close={() => setEditingId(null)}
          />
        )}
      </DndContext>
    </InteractionContext.Provider>
  );
}
