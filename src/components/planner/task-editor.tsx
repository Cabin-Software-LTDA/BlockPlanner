"use client";
import dynamic from "next/dynamic";
import { Temporal } from "@js-temporal/polyfill";
import { taskRange, taskFits } from "@/domain/task-schedule";
import { useState } from "react";
import { useModalDialog } from "./editor-panel";
import { X } from "lucide-react";
import type { Task, TimeBlockOccurrence } from "@/domain/models";
import { saveTask } from "@/lib/db/repository";
import { dateOf } from "@/domain/interactions";
import { timeLabel } from "@/domain/time";
import type { RunAction } from "./planner-interactions";
const NotesEditor = dynamic(
  () => import("./notes-editor").then((m) => m.NotesEditor),
  { ssr: false, loading: () => <p>Loading notes editor…</p> },
);
export function TaskEditor({
  task,
  blocks,
  run,
  close,
}: {
  task: Task;
  blocks: TimeBlockOccurrence[];
  run: RunAction;
  close: () => void;
}) {
  const dialog = useModalDialog();
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes);
  const [estimate, setEstimate] = useState(
    task.estimatedMinutes?.toString() ?? "",
  );
  const [destination, setDestination] = useState(task.occurrenceId ?? "");
  const [checklist, setChecklist] = useState(task.checklist ?? []);
  const [notesFormat, setNotesFormat] = useState(task.notesFormat);
  const originalBlock = blocks.find((b) => b.id === task.occurrenceId);
  const originalRange = originalBlock ? taskRange(task, originalBlock) : null;
  const [scheduled, setScheduled] = useState(Boolean(task.schedule));
  const [startsAt, setStartsAt] = useState(
    originalRange && originalBlock
      ? Temporal.Instant.from(originalRange.start)
          .toZonedDateTimeISO(originalBlock.timezone)
          .toPlainDateTime()
          .toString({ smallestUnit: "minute" })
      : "",
  );
  const [duration, setDuration] = useState(
    String(task.schedule?.durationMinutes ?? task.estimatedMinutes ?? 30),
  );
  const destinationBlock = blocks.find((b) => b.id === destination);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <dialog
      ref={dialog}
      className="task-editor"
      aria-labelledby="task-editor-title"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <div className="section-heading">
        <h2 id="task-editor-title">Task details</h2>
        <button
          className="icon-button"
          aria-label="Close task details"
          onClick={close}
        >
          <X size={18} />
        </button>
      </div>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const submittedStart =
            new FormData(e.currentTarget).get("taskStart")?.toString() ??
            startsAt;
          setBusy(true);
          const ok = await run(async () => {
            try {
              let schedule: Task["schedule"];
              if (scheduled && destinationBlock) {
                // Preserve the exact instant for unchanged ambiguous wall times on DST folds.
                const originalLocal =
                  originalRange && originalBlock
                    ? Temporal.Instant.from(originalRange.start)
                        .toZonedDateTimeISO(originalBlock.timezone)
                        .toPlainDateTime()
                        .toString({ smallestUnit: "minute" })
                    : null;
                const start =
                  submittedStart === originalLocal &&
                  destination === task.occurrenceId
                    ? Temporal.Instant.from(originalRange!.start)
                    : Temporal.PlainDateTime.from(submittedStart)
                        .toZonedDateTime(destinationBlock.timezone, {
                          disambiguation: "reject",
                        })
                        .toInstant();
                schedule = {
                  offsetMinutes: Math.round(
                    (start.epochMilliseconds -
                      Date.parse(destinationBlock.start)) /
                      60000,
                  ),
                  durationMinutes: Number(duration),
                };
              }
              await saveTask(
                task.id,
                {
                  title,
                  notes,
                  notesFormat,
                  schedule,
                  checklist,
                  estimatedMinutes:
                    estimate === "" ? undefined : Number(estimate),
                },
                destination || null,
              );
            } catch (e) {
              setError(e instanceof Error ? e.message : "Could not save task.");
              throw e;
            }
          });
          setBusy(false);
          if (ok) close();
        }}
      >
        <label>
          Task name
          <input
            data-initial-focus
            required
            maxLength={300}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <NotesEditor
          initial={task.notes}
          markdown={task.notesFormat === "markdown"}
          onChange={(value) => {
            setNotes(value);
            setNotesFormat("markdown");
          }}
        />
        <fieldset className="checklist-editor">
          <legend>Checklist</legend>
          {checklist.map((item, index) => (
            <div className="checklist-edit-row" key={item.id}>
              <input
                aria-label={`Complete step ${index + 1}`}
                type="checkbox"
                checked={item.completed}
                onChange={(e) =>
                  setChecklist(
                    checklist.map((c) =>
                      c.id === item.id
                        ? { ...c, completed: e.target.checked }
                        : c,
                    ),
                  )
                }
              />
              <input
                aria-label={`Step ${index + 1}`}
                required
                maxLength={300}
                value={item.title}
                onChange={(e) =>
                  setChecklist(
                    checklist.map((c) =>
                      c.id === item.id ? { ...c, title: e.target.value } : c,
                    ),
                  )
                }
              />
              <button
                type="button"
                className="icon-button"
                aria-label={`Delete step ${index + 1}`}
                onClick={() =>
                  setChecklist(checklist.filter((c) => c.id !== item.id))
                }
              >
                <X size={14} />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="secondary"
            onClick={() =>
              setChecklist([
                ...checklist,
                { id: crypto.randomUUID(), title: "", completed: false },
              ])
            }
          >
            Add checklist item
          </button>
        </fieldset>
        <label>
          Estimated minutes{" "}
          <span className="muted">Optional · does not schedule the task</span>
          <input
            type="number"
            min={1}
            max={1440}
            step={1}
            value={estimate}
            onChange={(e) => setEstimate(e.target.value)}
            placeholder="e.g. 30"
          />
        </label>
        <label>
          Move to
          <select
            value={destination}
            onChange={(e) => {
              setDestination(e.target.value);
              setScheduled(false);
              setStartsAt("");
            }}
          >
            <option value="">Unscheduled</option>
            {[...blocks]
              .sort((a, b) => a.start.localeCompare(b.start))
              .map((b) => (
                <option key={b.id} value={b.id}>
                  {dateOf(b.start, b.timezone)} ·{" "}
                  {timeLabel(b.start, b.timezone)} · {b.title}
                </option>
              ))}
          </select>
        </label>
        {destinationBlock && (
          <fieldset className="task-timing">
            <legend>Time inside block</legend>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={scheduled}
                onChange={(e) => {
                  setScheduled(e.target.checked);
                  if (!startsAt)
                    setStartsAt(
                      Temporal.Instant.from(destinationBlock.start)
                        .toZonedDateTimeISO(destinationBlock.timezone)
                        .toPlainDateTime()
                        .toString({ smallestUnit: "minute" }),
                    );
                }}
              />
              Schedule this task
            </label>
            {scheduled && (
              <>
                <label>
                  Start · {destinationBlock.timezone}
                  <input
                    type="datetime-local"
                    name="taskStart"
                    required
                    value={startsAt}
                    onChange={(e) => setStartsAt(e.target.value)}
                  />
                </label>
                <label>
                  Duration in minutes
                  <input
                    type="number"
                    min={1}
                    max={1440}
                    required
                    step={1}
                    value={duration}
                    onChange={(e) => setDuration(e.target.value)}
                  />
                </label>
              </>
            )}
            {originalBlock && !taskFits(task, originalBlock) && (
              <p className="form-error">
                This task extends beyond its block. Adjust its timing or move it
                to another block.
              </p>
            )}
            <p className="muted">
              Drag the task on the timeline to place it. Meetings and other
              tasks are never moved automatically.
            </p>
          </fieldset>
        )}
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <button className="primary full" disabled={busy || !title.trim()}>
          {busy ? "Saving…" : "Save task"}
        </button>
      </form>
    </dialog>
  );
}
