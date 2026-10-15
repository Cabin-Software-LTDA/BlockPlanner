"use client";
import { useState } from "react";
import { EditorPanel } from "./editor-panel";
import { Repeat2, X } from "lucide-react";
import type {
  BlockIcon,
  Color,
  RecurrenceException,
  Task,
  TimeBlockDefinition,
  TimeBlockOccurrence,
  UserPreferences,
} from "@/domain/models";
import {
  matchesDate,
  routinePresets,
  weekdays,
  type RoutineInput,
} from "@/domain/recurrence";
import {
  createRoutine,
  deleteRoutine,
  resetDate,
  skipDate,
  updateRoutine,
} from "@/lib/db/routines";
import type { RunAction } from "./planner-interactions";
const colors: Color[] = ["sage", "lavender", "peach", "blue", "rose"];
export function RoutineEditor({
  definition,
  date,
  preferences,
  blocks,
  tasks,
  exceptions,
  run,
  close,
}: {
  definition?: TimeBlockDefinition;
  date: string;
  preferences: UserPreferences;
  blocks: TimeBlockOccurrence[];
  tasks: Task[];
  exceptions: RecurrenceException[];
  run: RunAction;
  close: () => void;
}) {
  const [title, setTitle] = useState(definition?.title ?? "");
  const [start, setStart] = useState(definition?.startTime ?? "08:00");
  const [end, setEnd] = useState(definition?.endTime ?? "10:00");
  const [color, setColor] = useState<Color>(definition?.color ?? "sage");
  const [icon, setIcon] = useState<BlockIcon>(definition?.icon ?? "book");
  const [frequency, setFrequency] = useState<"daily" | "weekly">(
    definition?.recurrence?.frequency ?? "weekly",
  );
  const [days, setDays] = useState(
    definition?.recurrence?.weekdays ?? [1, 2, 3, 4, 5],
  );
  const [startsOn, setStartsOn] = useState(
    definition?.recurrence?.startsOn ?? date,
  );
  const [endsOn, setEndsOn] = useState(definition?.recurrence?.endsOn ?? "");
  const [exceptionDate, setExceptionDate] = useState(date);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const timezone = definition?.timezone ?? preferences.timezone;
  const related = blocks.filter((b) => b.definitionId === definition?.id);
  const relatedExceptions = exceptions
    .filter((e) => e.definitionId === definition?.id)
    .sort((a, b) => a.date.localeCompare(b.date));
  const skipped = relatedExceptions.some(
    (e) => e.date === exceptionDate && e.kind === "skip",
  );
  const tentative = {
    ...definition,
    recurrence: {
      frequency,
      weekdays: days,
      startsOn,
      endsOn: endsOn || undefined,
    },
  } as TimeBlockDefinition;
  let removed: TimeBlockOccurrence[] = [];
  try {
    removed = related.filter(
      (b) => !b.overridden && !matchesDate(tentative, b.date),
    );
  } catch {
    /* Show validation errors on submit. */
  }
  const rescued = tasks.filter((t) =>
    removed.some((b) => b.id === t.occurrenceId),
  ).length;
  async function action(work: () => Promise<unknown>, closeAfter = false) {
    setBusy(true);
    setError("");
    const ok = await run(async () => {
      try {
        return await work();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not save routine.");
        throw e;
      }
    });
    setBusy(false);
    if (ok && closeAfter) close();
  }
  return (
    <EditorPanel
      className="routine-editor"
      label="Routine details"
      close={close}
    >
      <div className="section-heading">
        <h2>
          <Repeat2 size={16} />{" "}
          {definition ? "Edit entire series" : "Create a routine"}
        </h2>
        <button
          className="icon-button"
          aria-label="Close routine details"
          onClick={close}
        >
          <X size={18} />
        </button>
      </div>
      <p className="muted">A repeatable time block · {timezone}</p>
      {!definition && (
        <label className="preset-picker">
          Start from a template
          <select
            defaultValue=""
            onChange={(e) => {
              const preset = routinePresets[Number(e.target.value)];
              if (e.target.value !== "" && preset) {
                setTitle(preset.values.title);
                setStart(preset.values.startTime);
                setEnd(preset.values.endTime);
                setColor(preset.values.color);
                setIcon(preset.values.icon);
                setFrequency("weekly");
                setDays([1, 2, 3, 4, 5]);
              }
            }}
          >
            <option value="">Custom routine</option>
            {routinePresets.map((p, i) => (
              <option key={p.label} value={i}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          const startTime = String(form.get("start"));
          const endTime = String(form.get("end"));
          const input: RoutineInput = {
            title,
            timezone,
            color,
            icon,
            startTime,
            endTime,
            endDayOffset: endTime <= startTime ? 1 : 0,
            recurrence: {
              frequency,
              weekdays: days,
              startsOn: String(form.get("startsOn")),
              endsOn: String(form.get("endsOn")) || undefined,
            },
          };
          await action(
            () =>
              definition
                ? updateRoutine(definition.id, input)
                : createRoutine(input),
            true,
          );
        }}
      >
        <label>
          Routine name
          <input
            data-initial-focus
            required
            maxLength={100}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Deep Study"
          />
        </label>
        <label>
          Repeat
          <select
            value={frequency}
            onChange={(e) => setFrequency(e.target.value as "daily" | "weekly")}
          >
            <option value="daily">Every day</option>
            <option value="weekly">Selected weekdays</option>
          </select>
        </label>
        {frequency === "weekly" && (
          <fieldset>
            <legend>Repeat on</legend>
            <div className="weekday-picker">
              {weekdays.map((day, index) => (
                <button
                  key={day}
                  type="button"
                  aria-label={day}
                  aria-pressed={days.includes(index + 1)}
                  onClick={() =>
                    setDays((current) =>
                      current.includes(index + 1)
                        ? current.filter((value) => value !== index + 1)
                        : [...current, index + 1].sort(),
                    )
                  }
                >
                  {day.slice(0, 2)}
                </button>
              ))}
            </div>
          </fieldset>
        )}
        <label>
          First day
          <input
            name="startsOn"
            required
            type="date"
            value={startsOn}
            onChange={(e) => setStartsOn(e.target.value)}
            onInput={(e) => setStartsOn(e.currentTarget.value)}
          />
        </label>
        <label>
          Last day{" "}
          <span className="muted">Optional · included in the schedule</span>
          <input
            name="endsOn"
            type="date"
            value={endsOn}
            onChange={(e) => setEndsOn(e.target.value)}
            onInput={(e) => setEndsOn(e.currentTarget.value)}
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
              onInput={(e) => setStart(e.currentTarget.value)}
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
              onInput={(e) => setEnd(e.currentTarget.value)}
            />
          </label>
        </div>
        {end <= start && (
          <p className="muted">
            Ends the following day{end === start ? " · 24 hours" : ""}.
          </p>
        )}
        <fieldset>
          <legend>Block color</legend>
          <div className="swatches">
            {colors.map((c) => (
              <button
                key={c}
                type="button"
                className={`swatch ${c} ${color === c ? "chosen" : ""}`}
                aria-label={c}
                aria-pressed={color === c}
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
        <p className="routine-policy">
          {definition ? (
            <>
              Applies across all dates, including past dates. Edited occurrences
              and skipped days stay unchanged.
              {removed.length > 0 && (
                <>
                  {" "}
                  {removed.length} regular blocks will be removed; {rescued}{" "}
                  tasks will move to Unscheduled.
                </>
              )}
            </>
          ) : (
            "Each day starts with an empty task list. Tasks and completion are never shared across days."
          )}
        </p>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <button
          className="primary full"
          disabled={
            busy || !title.trim() || (frequency === "weekly" && !days.length)
          }
        >
          {busy
            ? "Saving…"
            : definition
              ? "Save entire series"
              : "Create routine"}
        </button>
      </form>
      {definition && (
        <section className="routine-exceptions">
          <h2>Exceptions</h2>
          <p className="muted">
            Dates use {timezone}. Skipping moves that occurrence’s tasks to
            Unscheduled. Restoring a skip creates an empty block.
          </p>
          <label>
            Exception date
            <input
              type="date"
              value={exceptionDate}
              onChange={(e) => setExceptionDate(e.target.value)}
              onInput={(e) => setExceptionDate(e.currentTarget.value)}
            />
          </label>
          {!skipped &&
            exceptionDate &&
            (matchesDate(definition, exceptionDate) ||
              related.some((b) => b.date === exceptionDate)) && (
              <button
                className="secondary full"
                disabled={busy}
                onClick={() =>
                  void action(() => skipDate(definition.id, exceptionDate))
                }
              >
                Skip {exceptionDate}
              </button>
            )}
          {!relatedExceptions.length && (
            <p className="muted">No exceptions yet.</p>
          )}
          {relatedExceptions.map((exception) => (
            <div className="exception-row" key={exception.id}>
              <span>
                {exception.date}
                <small>
                  {exception.kind === "skip" ? "Skipped" : "Edited occurrence"}
                </small>
              </span>
              <button
                className="secondary"
                disabled={busy}
                aria-label={`${exception.kind === "skip" ? "Restore" : "Reset"} ${exception.date}`}
                onClick={() =>
                  void action(() => resetDate(definition.id, exception.date))
                }
              >
                {exception.kind === "skip" ? "Restore" : "Reset"}
              </button>
            </div>
          ))}
          <p className="muted">
            Reset uses the current routine’s timing and appearance; existing
            tasks stay attached.
          </p>
          <details className="remove-routine">
            <summary>Remove routine</summary>
            <p className="muted">
              Removes this series and all its dated blocks. Every task moves to
              Unscheduled.
            </p>
            <button
              className="danger"
              disabled={busy}
              onClick={() =>
                void action(() => deleteRoutine(definition.id), true)
              }
            >
              Remove entire series · keep tasks
            </button>
          </details>
        </section>
      )}
    </EditorPanel>
  );
}
