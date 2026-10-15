"use client";
import { useState } from "react";
import { EditorPanel } from "./editor-panel";
import { Repeat2, X } from "lucide-react";
import type {
  Task,
  BlockIcon,
  Color,
  TimeBlockOccurrence,
  UserPreferences,
} from "@/domain/models";
import { interval, timeLabel } from "@/domain/time";
import { dateOf } from "@/domain/interactions";
import { TaskList } from "./task-list";
import { resetDate } from "@/lib/db/routines";
import { createBlock, removeBlock, updateBlock } from "@/lib/db/repository";
export const colors: Color[] = ["sage", "lavender", "peach", "blue", "rose"];
export function BlockEditor({
  block,
  recurring,
  editSeries,
  tasks,
  date,
  preferences,
  close,
  run: runAction,
}: {
  block?: TimeBlockOccurrence;
  recurring: boolean;
  editSeries: () => void;
  tasks: Task[];
  date: string;
  preferences: UserPreferences;
  close: () => void;
  run: (action: () => Promise<unknown>) => Promise<boolean>;
}) {
  const [startDate, setStartDate] = useState(
    block ? dateOf(block.start, block.timezone) : date,
  );
  const [title, setTitle] = useState(block?.title ?? "");
  const [start, setStart] = useState(
    block ? timeLabel(block.start, block.timezone) : "09:00",
  );
  const [end, setEnd] = useState(
    block ? timeLabel(block.end, block.timezone) : "10:00",
  );
  const [fullDay, setFullDay] = useState(
    Boolean(
      block &&
      timeLabel(block.start, block.timezone) ===
        timeLabel(block.end, block.timezone),
    ),
  );
  const [color, setColor] = useState<Color>(block?.color ?? "sage");
  const [icon, setIcon] = useState<BlockIcon>(block?.icon ?? "book");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run(action: () => Promise<unknown>) {
    setError("");
    return runAction(async () => {
      try {
        return await action();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not save block.");
        throw e;
      }
    });
  }
  return (
    <EditorPanel label="Block details" close={close}>
      <div className="section-heading">
        <h2>{block ? "Block details" : "Make room for focus"}</h2>
        <button
          className="icon-button"
          onClick={close}
          aria-label="Close block details"
        >
          <X size={18} />
        </button>
      </div>
      <p className="muted">
        {startDate} · {block?.timezone ?? preferences.timezone}
      </p>
      {block && recurring && (
        <section className="occurrence-context">
          <span>
            <Repeat2 size={14} />
            {block.overridden
              ? "Edited occurrence"
              : "Recurring occurrence"} · {block.date}
          </span>
          <p className="muted">
            Changes here affect only this occurrence. Its tasks stay attached.
          </p>
          <button className="secondary full" onClick={editSeries}>
            Edit entire series
          </button>
          {block.overridden && (
            <button
              className="secondary full"
              onClick={async () => {
                if (await run(() => resetDate(block.definitionId, block.date)))
                  close();
              }}
            >
              Reset to routine · keep tasks
            </button>
          )}
        </section>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          const submittedDate = String(form.get("date"));
          const submittedStart = String(form.get("start"));
          const submittedEnd = String(form.get("end"));
          setBusy(true);
          const ok = await run(async () => {
            if (block) {
              const times = interval(
                submittedDate,
                submittedStart,
                submittedEnd,
                block.timezone,
                fullDay,
              );
              await updateBlock(block.id, {
                title: title.trim(),
                start: times.start,
                end: times.end,
                color,
                icon,
              });
            } else
              await createBlock({
                title,
                date: submittedDate,
                fullDay,
                start: submittedStart,
                end: submittedEnd,
                color,
                icon,
                timezone: preferences.timezone,
              });
          });
          setBusy(false);
          if (ok) close();
        }}
      >
        <label>
          Block name
          <input
            data-initial-focus
            required
            maxLength={100}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What will you make time for?"
          />
        </label>
        <label>
          Date
          <input
            name="date"
            type="date"
            required
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </label>
        <div className="time-fields">
          <label>
            Start
            <input
              name="start"
              required
              type="time"
              step={preferences.increment * 60}
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </label>
          <label>
            End
            <input
              name="end"
              required
              type="time"
              step={preferences.increment * 60}
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </label>
        </div>
        {end === start && (
          <label className="full-day-option">
            <input
              type="checkbox"
              checked={fullDay}
              onChange={(e) => setFullDay(e.target.checked)}
            />
            End the following day (24 hours)
          </label>
        )}
        {end < start && <p className="muted">Ends the following day.</p>}
        <fieldset>
          <legend>Block color</legend>
          <div className="swatches">
            {colors.map((c) => (
              <button
                key={c}
                type="button"
                className={`swatch ${c} ${c === color ? "chosen" : ""}`}
                aria-label={c}
                aria-pressed={c === color}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
        </fieldset>
        <label>
          Icon
          <select
            value={icon}
            onChange={(e) => setIcon(e.target.value as BlockIcon)}
          >
            <option value="book">Book · Study</option>
            <option value="briefcase">Briefcase · Work</option>
            <option value="coffee">Coffee · Break</option>
            <option value="sparkles">Sparkles · Personal</option>
          </select>
        </label>
        <button className="primary full" disabled={busy || !title.trim()}>
          {busy
            ? "Saving…"
            : block
              ? recurring
                ? "Save this occurrence"
                : "Save changes"
              : "Create block"}
        </button>
      </form>
      {block && (
        <section className="block-detail-tasks">
          <h2>Tasks</h2>
          <p className="muted">
            Select a task to edit notes, estimate, or move it.
          </p>
          <TaskList
            tasks={tasks}
            occurrenceId={block.id}
            run={run}
            draggable={false}
          />
        </section>
      )}
      {block && (
        <button
          className="danger"
          onClick={async () => {
            if (await run(() => removeBlock(block.id))) close();
          }}
        >
          {recurring
            ? "Skip this occurrence · keep tasks"
            : "Delete block · keep tasks"}
        </button>
      )}
      <div className="editor-note">
        A little structure goes a long way.
        <br />
        Leave some space between the things that matter.
      </div>
    </EditorPanel>
  );
}
