"use client";
import type {
  ExternalCalendarEvent,
  TimeBlockOccurrence,
  UserPreferences,
} from "@/domain/models";
import type { plannerView } from "@/domain/planner-view";
import { meetingLabel } from "@/domain/calendar";
import { TaskList } from "./task-list";
import { BlockMeetings } from "./calendar-meetings";
import type { RunAction } from "./planner-interactions";
export function DayList({
  view,
  meetings,
  preferences,
  open,
  run,
}: {
  view: ReturnType<typeof plannerView>;
  meetings: ExternalCalendarEvent[];
  preferences: UserPreferences;
  open: (block: TimeBlockOccurrence) => void;
  run: RunAction;
}) {
  return (
    <section className="day-list" aria-label="All blocks for this day">
      <p className="muted">
        All blocks intersecting this day, including those outside the visible
        timeline hours.
      </p>
      {!view.dayBlocks.length && (
        <p>No blocks planned. Create a block to make room for your day.</p>
      )}
      {view.dayBlocks.map((block) => (
        <article key={block.id} className={`day-list-block ${block.color}`}>
          <button className="day-list-heading" onClick={() => open(block)}>
            <strong>{block.title}</strong>
            <small>
              {meetingLabel(
                {
                  start: block.start,
                  end: block.end,
                  allDay: false,
                },
                preferences.timezone,
              )}
            </small>
            <span>
              Edit block
              {view.definitionsById.get(block.definitionId)?.recurrence
                ? " · Recurring"
                : ""}
            </span>
          </button>
          <BlockMeetings
            events={meetings}
            block={block}
            timezone={preferences.timezone}
          />
          <TaskList
            tasks={view.tasksByBlock.get(block.id) ?? []}
            occurrenceId={block.id}
            run={run}
            draggable={false}
          />
        </article>
      ))}
    </section>
  );
}
