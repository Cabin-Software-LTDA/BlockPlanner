"use client";
import { useState, type CSSProperties } from "react";
import { useDraggable } from "@dnd-kit/core";
import { GripVertical, X } from "lucide-react";
import type {
  ExternalCalendarEvent,
  TimeBlockOccurrence,
} from "@/domain/models";
import {
  containsMeeting,
  meetingLabel,
  safeEventUrl,
  safeMeetingUrl,
} from "@/domain/calendar";
import { timeLabel } from "@/domain/time";
import { EditorPanel } from "./editor-panel";
import { usePlannerInteractions, type RunAction } from "./planner-interactions";
import { assignMeeting } from "@/lib/db/calendar";
export function MeetingCard({
  event,
  timezone,
  style,
  className = "",
}: {
  event: ExternalCalendarEvent;
  timezone: string;
  style: CSSProperties;
  className?: string;
}) {
  const { openMeeting, busy } = usePlannerInteractions();
  const drag = useDraggable({
    id: `meeting:${event.id}`,
    data: { kind: "meeting", eventId: event.id },
    disabled: busy,
  });
  return (
    <article
      ref={drag.setNodeRef}
      style={style}
      className={`meeting-card unified-meeting ${className} ${drag.isDragging ? "dragging-task" : ""}`}
      aria-label={`Meeting ${event.title}`}
      tabIndex={0}
      onKeyDown={(e) => {
        if (
          e.target === e.currentTarget &&
          (e.key === "Enter" || e.key === " ")
        ) {
          e.preventDefault();
          openMeeting(event.id);
        }
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) openMeeting(event.id);
      }}
    >
      <button
        ref={drag.setActivatorNodeRef}
        {...drag.attributes}
        {...drag.listeners}
        className="icon-button drag-handle"
        aria-label={`Assign meeting ${event.title}`}
        title="Drag to a containing block or Outside blocks. Time stays fixed. Use meeting details for keyboard assignment."
      >
        <GripVertical size={13} />
      </button>
      <button
        className="meeting-open"
        aria-label={`Open meeting ${event.title}`}
        title={`${event.title} · ${meetingLabel(event, timezone)}`}
        onClick={() => openMeeting(event.id)}
      >
        <strong>{event.title}</strong>
        <small>
          {timeLabel(event.start, timezone)}–{timeLabel(event.end, timezone)} ·
          Google Calendar
        </small>
      </button>
    </article>
  );
}
export function MeetingDialog({
  event,
  blocks,
  owner,
  timezone,
  run,
  close,
}: {
  event: ExternalCalendarEvent;
  blocks: TimeBlockOccurrence[];
  owner: string | null;
  timezone: string;
  run: RunAction;
  close: () => void;
}) {
  const { busy } = usePlannerInteractions();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const source = safeEventUrl(event.sourceUrl);
  const join = safeMeetingUrl(event.meetingUrl);
  return (
    <EditorPanel label="Meeting details" close={close}>
      <div className="section-heading">
        <h2>{event.title}</h2>
        <button
          className="icon-button"
          aria-label="Close meeting details"
          onClick={close}
        >
          <X size={18} />
        </button>
      </div>
      <p>{meetingLabel(event, timezone)}</p>
      <p className="muted">
        Google Calendar owns this meeting. Assigning it to a block changes only
        its position in TimeBlock; its start and end stay fixed.
      </p>
      <div className="meeting-links">
        {source && (
          <a
            className="secondary"
            href={source}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open in Google Calendar
          </a>
        )}
        {join && (
          <a
            className="primary"
            href={join}
            target="_blank"
            rel="noopener noreferrer"
          >
            Join meeting
          </a>
        )}
      </div>
      {!event.allDay && (
        <label>
          Show meeting in
          <select
            data-initial-focus
            value={owner ?? ""}
            disabled={busy || saving}
            onChange={async (e) => {
              const destination = e.target.value || null;
              setSaving(true);
              setError("");
              await run(async () => {
                try {
                  await assignMeeting(event.id, destination);
                } catch (error) {
                  setError(
                    error instanceof Error
                      ? error.message
                      : "Could not assign meeting.",
                  );
                  throw error;
                }
              });
              setSaving(false);
            }}
          >
            <option value="">Outside blocks</option>
            {blocks
              .filter((b) => containsMeeting(event, b))
              .map((b) => (
                <option key={b.id} value={b.id}>
                  {b.title} · {timeLabel(b.start, timezone)}–
                  {timeLabel(b.end, timezone)}
                </option>
              ))}
          </select>
        </label>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {!event.allDay && (
        <p className="muted">
          Only blocks containing the entire meeting are eligible. A meeting
          spanning several blocks stays outside as one card.
        </p>
      )}
    </EditorPanel>
  );
}
