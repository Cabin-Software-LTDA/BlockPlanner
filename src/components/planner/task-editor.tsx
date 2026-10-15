"use client";
import { useState } from "react";
import { useModalDialog } from "./editor-panel";
import { X } from "lucide-react";
import type { Task, TimeBlockOccurrence } from "@/domain/models";
import { saveTask } from "@/lib/db/repository";
import { dateOf } from "@/domain/interactions";
import { timeLabel } from "@/domain/time";
import type { RunAction } from "./planner-interactions";
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
          setBusy(true);
          const ok = await run(async () => {
            try {
              await saveTask(
                task.id,
                {
                  title,
                  notes,
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
        <label>
          Notes
          <textarea
            rows={5}
            maxLength={10000}
            placeholder="Details, links, or a helpful reminder…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
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
            onChange={(e) => setDestination(e.target.value)}
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
