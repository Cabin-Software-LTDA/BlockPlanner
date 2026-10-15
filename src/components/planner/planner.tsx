"use client";
import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { format, parseISO } from "date-fns";
import {
  Repeat2,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  Plus,
  Moon,
  Sun,
  SlidersHorizontal,
  Layers2,
  ShieldCheck,
} from "lucide-react";
import { BackupDialog } from "./backup-dialog";
import { KeyboardShortcuts, ShortcutHelp } from "./keyboard-shortcuts";
import { DayList } from "./day-list";
import { plannerView } from "@/domain/planner-view";
import { db } from "@/lib/db/database";
import { initialize } from "@/lib/db/repository";
import {
  layoutBlocks,
  minuteOnDay,
  shiftDate,
  timeLabel,
  today,
} from "@/domain/time";
import { usePlannerUI } from "@/stores/planner";
import { MiniCalendar } from "./mini-calendar";
import { BlockEditor } from "./block-editor";
import { TaskList } from "./task-list";
import { PlannerInteractions } from "./planner-interactions";
import { TimelineBlock } from "./timeline-block";
import { RoutineEditor } from "./routine-editor";
import { useRoutines } from "./use-routines";
import { useGoogleCalendar } from "./use-google-calendar";
import { useNextcloudCalendar } from "./use-nextcloud-calendar";
import { NextcloudPanel } from "./nextcloud-panel";
import { CalendarPanel } from "./calendar-panel";
import { CalendarAgenda, MeetingLane } from "./calendar-meetings";
import { routineSummary } from "@/domain/recurrence";
export default function Planner() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [date, setDate] = useState("");
  const [adding, setAdding] = useState(false);
  const [routineEditor, setRoutineEditor] = useState<string | null>(null);
  const [settings, setSettings] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"timeline" | "list">("timeline");
  const [now, setNow] = useState(new Date());
  const { selectedId, select } = usePlannerUI();
  useEffect(() => {
    initialize()
      .then(async () => {
        const p = await db.preferences.get("user");
        setDate(today(p?.timezone));
        setReady(true);
      })
      .catch(() =>
        setError(
          "Local storage could not be opened. Enable IndexedDB in your browser, then reload.",
        ),
      );
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);
  const data = useLiveQuery(
    () =>
      db.transaction(
        "r",
        [
          db.preferences,
          db.definitions,
          db.exceptions,
          db.occurrences,
          db.tasks,
          db.meetingPlacements,
        ],
        async () => ({
          preferences: await db.preferences.get("user"),
          definitions: await db.definitions.toArray(),
          exceptions: await db.exceptions.toArray(),
          blocks: await db.occurrences.toArray(),
          tasks: await db.tasks.toArray(),
          placements: await db.meetingPlacements.toArray(),
        }),
      ),
    [],
  );
  const view = useMemo(
    () =>
      data?.preferences && date
        ? plannerView(
            data.blocks,
            data.tasks,
            data.definitions,
            date,
            data.preferences,
          )
        : null,
    [data, date],
  );
  const calendar = useGoogleCalendar(date, data?.preferences?.timezone);
  const nextcloud = useNextcloudCalendar(date, data?.preferences?.timezone);
  const calendarEvents = useMemo(
    () => [...calendar.events, ...nextcloud.events],
    [calendar.events, nextcloud.events],
  );
  const routineRevision = JSON.stringify([
    data?.definitions.filter((d) => d.recurrence),
    data?.exceptions,
  ]);
  const generation = useRoutines(
    date,
    data?.preferences?.timezone,
    routineRevision,
  );
  async function run(action: () => Promise<unknown>) {
    try {
      await action();
      setError("");
      return true;
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not save your changes. Please try again.",
      );
      return false;
    }
  }
  if (!ready || !data?.preferences || !view)
    return (
      <main className="loading">
        <Layers2 size={34} />
        <h1>TimeBlock</h1>
        <p role={error ? "alert" : "status"}>
          {error || "Opening your space…"}
        </p>
      </main>
    );
  const { preferences, blocks, tasks, definitions, exceptions } = data;
  const routines = definitions.filter((d) => d.recurrence);
  const editingRoutine = routines.find((d) => d.id === routineEditor);
  const openRoutine = (id: string) => {
    setRoutineEditor(id);
    select(null);
    setAdding(false);
  };
  const timezone = preferences.timezone;
  const { visible, taskCount, completed: done } = view;
  const selected = blocks.find((b) => b.id === selectedId);
  const changeDate = (d: string) => {
    if (!d) return;
    setDate(d);
    setRoutineEditor(null);
    select(null);
    setAdding(false);
  };
  const openBlock = (id?: string) => {
    setRoutineEditor(null);
    select(id ?? null);
    setAdding(!id);
  };
  const nowMinute = minuteOnDay(now.toISOString(), date, timezone);
  return (
    <div className="app" data-theme={preferences.theme}>
      <a className="skip-link" href="#daily-planner">
        Skip to daily planner
      </a>
      <KeyboardShortcuts
        onAction={(action) => {
          if (action === "new-block") openBlock();
          else if (action === "new-routine") openRoutine("new");
          else if (action === "help") setHelpOpen(true);
          else
            changeDate(
              action === "today"
                ? today(timezone)
                : shiftDate(date, action === "previous" ? -1 : 1),
            );
        }}
      />

      <PlannerInteractions
        events={calendarEvents}
        placements={data.placements}
        blocks={blocks}
        tasks={tasks}
        preferences={preferences}
        run={run}
      >
        <aside className="sidebar">
          <a className="brand" href="/">
            <span className="brand-mark">
              <Layers2 size={23} />
            </span>
            TimeBlock<span className="brand-dot">.</span>
          </a>
          <button
            className="secondary mobile-tools-toggle"
            aria-controls="planning-tools"
            aria-expanded={toolsOpen}
            onClick={() => setToolsOpen(!toolsOpen)}
          >
            Planning tools
            {(view.tasksByBlock.get(null)?.length ?? 0) > 0
              ? ` · ${view.tasksByBlock.get(null)!.length} unscheduled`
              : ""}
          </button>
          <div
            id="planning-tools"
            className={`sidebar-content ${toolsOpen ? "tools-open" : ""}`}
          >
            <div className="workspace-label">YOUR PERSONAL SPACE</div>
            <div className="nav-active">
              <Layers2 size={17} />
              Daily planner<span>01</span>
            </div>
            <MiniCalendar date={date} onChange={changeDate} />
            <section className="routines-sidebar" aria-label="Routines">
              <div className="section-heading">
                <h2>
                  <Repeat2 size={15} /> Routines
                </h2>
                <button
                  className="icon-button"
                  aria-label="New routine"
                  onClick={() => openRoutine("new")}
                >
                  <Plus size={17} />
                </button>
              </div>
              {!routines.length && (
                <p className="muted">Give your week a little rhythm.</p>
              )}
              {routines.map((definition) => (
                <button
                  key={definition.id}
                  className="routine-nav"
                  onClick={() => openRoutine(definition.id)}
                >
                  <span className={`category-dot ${definition.color}`} />
                  <span>
                    <strong>{definition.title}</strong>
                    <small>
                      {routineSummary(definition)} · {definition.startTime}
                    </small>
                  </span>
                </button>
              ))}
              <button
                className="routine-add"
                onClick={() => openRoutine("new")}
              >
                + Create routine
              </button>
            </section>
            <CalendarPanel calendar={calendar} />
            <NextcloudPanel calendar={nextcloud} />
            <section className="inbox">
              <div className="section-heading">
                <h2>Unscheduled</h2>
                <span className="count">
                  {(view.tasksByBlock.get(null) ?? []).length}
                </span>
              </div>
              <p className="muted">A place for the things on your mind.</p>
              <TaskList
                tasks={view.tasksByBlock.get(null) ?? []}
                occurrenceId={null}
                run={run}
              />
            </section>
            <div className="workspace-actions">
              <button className="secondary" onClick={() => setBackupOpen(true)}>
                Backup and restore
              </button>
              <button
                className="secondary"
                aria-keyshortcuts="Alt+Shift+K"
                onClick={() => setHelpOpen(true)}
              >
                Keyboard shortcuts
              </button>
            </div>
            <div className="sidebar-bottom">
              <ShieldCheck size={15} />
              <span>
                Private by default
                <br />
                <small>Saved on this device</small>
              </span>
              <button
                className="icon-button"
                aria-label={`Use ${preferences.theme === "light" ? "dark" : "light"} mode`}
                onClick={() =>
                  void run(() =>
                    db.preferences.update("user", {
                      theme: preferences.theme === "light" ? "dark" : "light",
                    }),
                  )
                }
              >
                {preferences.theme === "light" ? (
                  <Moon size={17} />
                ) : (
                  <Sun size={17} />
                )}
              </button>
            </div>
          </div>
        </aside>
        <main className="main" id="daily-planner" tabIndex={-1}>
          <header className="topbar">
            <span>
              My workspace <span className="breadcrumb">/</span>{" "}
              <strong>Daily planner</strong>
            </span>
            <span className="local-status">
              <i /> Local workspace
            </span>
          </header>
          <div className="day-header">
            <div>
              <div className="eyebrow">
                A LITTLE STRUCTURE. MORE ROOM TO FOCUS.
              </div>
              <h1>
                {format(parseISO(date), "EEEE")}
                <span className="day-date">
                  {format(parseISO(date), "MMMM d")}
                </span>
              </h1>
              <p>Your day, thoughtfully arranged.</p>
            </div>
            <button
              className="primary"
              aria-keyshortcuts="Alt+Shift+N"
              onClick={() => openBlock()}
            >
              <Plus size={17} />
              New block
            </button>
          </div>
          <div className="toolbar">
            <div className="date-controls">
              <button
                className="secondary"
                onClick={() => changeDate(today(timezone))}
              >
                Today
              </button>
              <button
                className="icon-button"
                aria-label="Previous day"
                onClick={() => changeDate(shiftDate(date, -1))}
              >
                <ChevronLeft size={18} />
              </button>
              <button
                className="icon-button"
                aria-label="Next day"
                onClick={() => changeDate(shiftDate(date, 1))}
              >
                <ChevronRight size={18} />
              </button>
              <input
                aria-label="Selected day"
                type="date"
                value={date}
                onChange={(e) => changeDate(e.target.value)}
              />
            </div>
            <button
              className="secondary"
              aria-label="View settings"
              aria-expanded={settings}
              onClick={() => setSettings(!settings)}
            >
              <SlidersHorizontal size={15} />
              <span>View settings</span>
            </button>
          </div>
          <div className="view-switch" role="group" aria-label="Planner view">
            <button
              className="secondary"
              aria-pressed={viewMode === "timeline"}
              onClick={() => setViewMode("timeline")}
            >
              Timeline
            </button>
            <button
              className="secondary"
              aria-pressed={viewMode === "list"}
              onClick={() => setViewMode("list")}
            >
              Day list
            </button>
          </div>
          {settings && (
            <section className="settings" aria-label="View settings">
              <label>
                From
                <select
                  value={preferences.visibleStart}
                  onChange={(e) =>
                    void run(() =>
                      db.preferences.update("user", {
                        visibleStart: Number(e.target.value),
                      }),
                    )
                  }
                >
                  {Array.from({ length: preferences.visibleEnd }, (_, h) => (
                    <option key={h} value={h}>
                      {String(h).padStart(2, "0")}:00
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Until
                <select
                  value={preferences.visibleEnd}
                  onChange={(e) =>
                    void run(() =>
                      db.preferences.update("user", {
                        visibleEnd: Number(e.target.value),
                      }),
                    )
                  }
                >
                  {Array.from(
                    { length: 24 - preferences.visibleStart },
                    (_, i) => i + preferences.visibleStart + 1,
                  ).map((h) => (
                    <option key={h} value={h}>
                      {String(h).padStart(2, "0")}:00
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Time increment
                <select
                  value={preferences.increment}
                  onChange={(e) =>
                    void run(() =>
                      db.preferences.update("user", {
                        increment: Number(e.target.value) as 15 | 30,
                      }),
                    )
                  }
                >
                  <option value={15}>15 minutes</option>
                  <option value={30}>30 minutes</option>
                </select>
              </label>
              <label>
                Display timezone
                <select
                  value={timezone}
                  onChange={(event) =>
                    void run(() =>
                      db.preferences.update("user", {
                        timezone: event.target.value,
                      }),
                    )
                  }
                >
                  {[
                    ...new Set([
                      timezone,
                      "UTC",
                      ...Intl.supportedValuesOf("timeZone"),
                    ]),
                  ]
                    .sort()
                    .map((zone) => (
                      <option key={zone} value={zone}>
                        {zone}
                      </option>
                    ))}
                </select>
              </label>
              <p className="muted">
                Existing blocks and routines keep their original timezone. This
                changes the view and the default for new blocks.
              </p>
            </section>
          )}
          {error && (
            <div role="alert" className="error">
              {error}
              <button onClick={() => setError("")} aria-label="Dismiss error">
                ×
              </button>
            </div>
          )}
          {generation.pending && (
            <p className="routine-loading" role="status">
              Loading routines for this day…
            </p>
          )}
          {generation.error && (
            <div className="error" role="alert">
              {generation.error}
              <button onClick={generation.retry}>Retry</button>
            </div>
          )}
          {generation.issues.map((issue) => (
            <div
              className="routine-issue"
              role="alert"
              key={`${issue.definitionId}:${issue.date}`}
            >
              <span>
                <strong>
                  {issue.title} · {issue.date}
                </strong>
                <br />
                {issue.message}
              </span>
              <button
                className="secondary"
                onClick={() => openRoutine(issue.definitionId)}
              >
                Edit routine
              </button>
            </div>
          ))}
          <div className="day-summary">
            <span>
              <span className="small-dot" />
              {view.dayBlocks.length} blocks planned
            </span>
            <span>
              {done} / {taskCount} tasks complete
            </span>
            <div className="progress">
              <i
                style={{
                  width: `${taskCount ? (done / taskCount) * 100 : 0}%`,
                }}
              />
            </div>
          </div>
          <CalendarAgenda
            calendar={{
              connection: calendar.connection ?? nextcloud.connection,
              events: calendarEvents,
              syncedAt: undefined,
            }}
            listView={viewMode === "list"}
            date={date}
            preferences={preferences}
            blocks={blocks}
          />
          {viewMode === "list" ? (
            <DayList
              view={view}
              meetings={calendarEvents}
              preferences={preferences}
              open={(block) => openBlock(block.id)}
              run={run}
            />
          ) : (
            <div
              className="timeline-wrap"
              role="region"
              aria-label="Daily timeline"
              tabIndex={0}
            >
              <div
                className="timeline"
                style={{
                  height:
                    (preferences.visibleEnd - preferences.visibleStart) * 100,
                }}
              >
                <div className="timezone-label">
                  {
                    new Intl.DateTimeFormat("en", {
                      timeZone: timezone,
                      timeZoneName: "short",
                    })
                      .formatToParts(now)
                      .find((p) => p.type === "timeZoneName")?.value
                  }
                </div>
                {Array.from(
                  { length: preferences.visibleEnd - preferences.visibleStart },
                  (_, i) => (
                    <div className="hour-line" key={i} style={{ top: i * 100 }}>
                      <span>
                        {String(i + preferences.visibleStart).padStart(2, "0")}
                        :00
                      </span>
                    </div>
                  ),
                )}
                {layoutBlocks(visible).map(({ block, lane, lanes }) => (
                  <TimelineBlock
                    key={block.id}
                    block={block}
                    meetings={calendarEvents}
                    recurring={Boolean(
                      view.definitionsById.get(block.definitionId)?.recurrence,
                    )}
                    lane={lane}
                    lanes={lanes}
                    date={date}
                    preferences={preferences}
                    tasks={view.tasksByBlock.get(block.id) ?? []}
                    selected={selectedId === block.id}
                    run={run}
                    open={() => {
                      setRoutineEditor(null);
                      select(block.id);
                      setAdding(false);
                    }}
                  />
                ))}
                <MeetingLane
                  events={calendarEvents}
                  date={date}
                  preferences={preferences}
                  blocks={blocks}
                />
                {!visible.length &&
                  !calendarEvents.length &&
                  !generation.pending &&
                  !generation.error && (
                    <div className="empty-state">
                      <span className="empty-icon">
                        <Sparkles size={27} />
                      </span>
                      <h2>A fresh page for your day.</h2>
                      <p>
                        Make space for deep work, a slow lunch,
                        <br />
                        or whatever matters to you.
                      </p>
                      <button
                        className="secondary"
                        onClick={() => {
                          setAdding(true);
                          setRoutineEditor(null);
                        }}
                      >
                        <Plus size={16} />
                        Create your first block
                      </button>
                    </div>
                  )}
                {nowMinute >= preferences.visibleStart * 60 &&
                  nowMinute < preferences.visibleEnd * 60 && (
                    <div
                      className="now-line"
                      style={{
                        top:
                          ((nowMinute - preferences.visibleStart * 60) * 100) /
                          60,
                      }}
                    >
                      <span>{timeLabel(now.toISOString(), timezone)}</span>
                      <i />
                    </div>
                  )}
              </div>
            </div>
          )}
          <footer>
            Make a plan. Leave room for life.
            <span>TimeBlock · Your day, your pace</span>
          </footer>
        </main>
        {(adding || selected) && (
          <BlockEditor
            key={
              selected
                ? `${selected.id}:${selected.start}:${selected.end}`
                : `new-${date}`
            }
            block={selected}
            recurring={Boolean(
              definitions.find((d) => d.id === selected?.definitionId)
                ?.recurrence,
            )}
            editSeries={() => selected && openRoutine(selected.definitionId)}
            tasks={view.tasksByBlock.get(selected?.id ?? "") ?? []}
            date={date}
            preferences={preferences}
            close={() => {
              select(null);
              setAdding(false);
            }}
            run={run}
          />
        )}
        {(routineEditor === "new" || editingRoutine) && (
          <RoutineEditor
            key={routineEditor}
            definition={editingRoutine}
            date={date}
            preferences={preferences}
            blocks={blocks}
            tasks={tasks}
            exceptions={exceptions}
            run={run}
            close={() => setRoutineEditor(null)}
          />
        )}
        {backupOpen && (
          <BackupDialog
            close={() => setBackupOpen(false)}
            restored={() => {
              select(null);
              setAdding(false);
              setRoutineEditor(null);
              generation.retry();
            }}
          />
        )}
        {helpOpen && <ShortcutHelp close={() => setHelpOpen(false)} />}
      </PlannerInteractions>
    </div>
  );
}
