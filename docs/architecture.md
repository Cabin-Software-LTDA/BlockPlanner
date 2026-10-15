# Architecture and delivery record

## Scope and sequence

1. **Foundation — implemented:** app shell/design tokens, models, Dexie schema, repository, preferences, basic block/task entry and tests.
2. **Core planner — implemented:** dnd-kit drag/reposition/resize with keyboard equivalents, task edit/reorder/transfer, notes/estimates, dense-block details. The task editor uses native `<dialog>` for modal focus containment and Escape; no additional overlay dependency is needed.
3. **Routines — implemented:** daily/selected-weekday definitions, bounded deterministic materialization, exceptions, occurrence/series editing, block presets, skip/restore and reset. Task-template cloning remains deferred.
4. **Calendar — implemented, live OAuth verification pending:** Google Identity Services browser token flow, selected calendars, paginated event retrieval, local event cache, read-only meeting visualization and disconnect. Tokens exist only in memory.
5. **Polish — implemented milestone:** validated transactional JSON backup/recovery, modifier-key shortcuts, native modal focus management, mobile planning tools/day list, display timezone settings, indexed task lookups and additional integration tests. Offline shell caching, full assistive-technology/native touch validation and live Google consent verification remain outstanding.

Keep the app runnable at each step. No scheduling automation, analytics, accounts, or backend in the local MVP.

## Structure

- `src/app`: server entry point, metadata, global styles and design tokens.
- `src/components/planner`: interactive client shell, calendar, block editor, task list.
- `src/domain`: serializable models and pure time/intersection/layout logic.
- `src/lib/db`: Dexie schema and transactional repository operations.
- `src/lib/calendar`: Google Identity Services session and read-only REST adapter.
- `src/stores`: ephemeral selected-block UI state only.

Dexie is the durable source of truth; `useLiveQuery` updates the view after successful commits. No mirrored global data cache and no hydration race with localStorage. A single initialization transaction creates preferences only when missing. Storage failures are surfaced in an alert.

## Relationships

`TimeBlockDefinition` describes intent: title, color, icon, IANA timezone, local start/end clock times, end-day offset and optional recurrence rule. Weekdays use ISO 1=Monday through 7=Sunday. Rule boundaries are inclusive local dates.

`TimeBlockOccurrence` is a dated instance referencing a definition. It snapshots presentation fields, captures its own timezone, stores absolute start/end instants, and records whether it has been overridden. One-off blocks also have a definition. Single-occurrence edits update the snapshot and record an override. Whole-series edits update definitions and all regular materialized snapshots, including past dates, in a transaction. Explicit overrides and skips are preserved.

`Task.occurrenceId` references an individual occurrence or is null for unscheduled work. Completion belongs to that task alone. Recurring blocks must start with empty tasks unless a future explicit template is cloned with NEW task IDs and incomplete status. Never reuse yesterday's task entities. Old tasks persist on their original dates; deletion of a block moves all tasks to the inbox.

`RecurrenceException` uniquely identifies a definition/local date pair, either skipping the occurrence or linking an override. Materialization uses deterministic IDs derived from definition ID plus original local date, inside a transaction. Moving an occurrence does not change its original recurrence identity. Series changes must not delete tasks or regenerate overrides. Skipping removes the occurrence and rescues its tasks to Unscheduled. Restoring a skip creates an empty occurrence; resetting an override keeps its task IDs and completion.

`CalendarConnection` contains account/calendar metadata, selection revision and per-date/timezone freshness timestamps only. `ExternalCalendarEvent` has a stable JSON tuple identity of connection ID, calendar ID and Google expanded-instance event ID. It is never a task. Timed start/end values are canonical UTC instants; `allDay: true` uses ISO date strings with exclusive end dates. All-day events never acquire block associations.

`UserPreferences` stores timezone, visible hours, increment and theme. `DailyLayout` reserves per-date viewport overrides; the current UI uses global preferences.

## Time and visual geometry

Use Temporal for conversion from local wall-clock time to UTC instants and IANA zones; date-fns handles calendar-grid labels/arithmetic. An end time earlier than start means next day; equal times require explicit next-day confirmation for a 24-hour block. Nonexistent and ambiguous DST times throw rather than silently changing the user's choice.

The current timeline maps wall-clock minutes to pixels, clipping overnight segments to the visible date/window. Intersecting blocks are grouped and assigned columns. Half-open ranges `[start, end)` mean adjacent blocks do not overlap. dnd-kit gestures convert pixel deltas to configured increments, with explicit keyboard time controls. `domain/interactions.ts` owns snapping, minimum/maximum durations, and DST validation. Dedicated handles avoid task-input conflicts. Preview is ephemeral and commits on drop; cancellation never writes.

Meeting association is deterministic: every block with `meeting.start < block.end && block.start < meeting.end` intersects the meeting. Blocks show read-only entries for every intersecting meeting, retaining the original full range. The independent calendar lane clips timed meetings to the visible window and uses interval partitioning for overlaps. All-day meetings use a separate strip. A full-time details list exposes even short/overlapping events. None of these views creates tasks or writes external events.

DST limitation: the foundation rejects ambiguous inputs but does not yet render a duplicated fall-back hour or skipped spring-forward hour as an instant-aware axis. Phase 4 detects clock-change days and renders external meetings in an agenda with full dates and UTC offsets instead of putting arbitrary DST intervals on the wall-clock axis. The instant-based association rule remains valid.

## Persistence and migration safety

Version 1 stores definitions, occurrences, tasks, exceptions, connections, events, preferences and daily layouts. UUIDs are stable; datetimes serialize as ISO UTC strings. Transactions cover dependent writes and task preservation during deletion. React reads through live queries.

Never edit/remove an already released schema version. Add `version(n).stores(...).upgrade(...)` for future changes; transform records transactionally, test upgrades from old fixtures, and avoid destructive resets. Export/import will have its own format version, runtime validation, reference checks, preview and a transaction. Phase 5 adds a separately versioned backup format and a transactional restore/recovery workflow.

## Validation record

Phase 3 verification includes strict TypeScript, 48 Vitest tests against pure domain functions and fake IndexedDB, plus a production build. Tests cover snap increments, resize bounds, midnight moves, DST rejection, transactional transfers and rollback, task metadata, ordering, and stable occurrence/task relationships. Recurrence tests also cover inclusive bounds, weekdays, leap/year boundaries, concurrent materialization, stable override identities, independent completion, DST errors, skip/restore, series edits and rollback, task rescue, and compatibility with Phase 1/2 records. Browser smoke verification is recorded in the implementation handoff.

## Phase 2 implementation details

`PlannerInteractions` owns the single dnd-kit context, pointer collision detection, temporary time previews, and selected task dialog. It leaves durable state in Dexie. Task drop targets take priority over containing blocks so drops insert before tasks; blank container space appends. Drag overlays prevent clipping by scrolling task lists. Keyboard users use block-handle arrows, task up/down buttons, and the destination selector rather than spatial keyboard dragging.

Task move/save operations validate destination existence and rewrite both ordered lists within one transaction. Concurrent task completion is read before the move rather than copied from stale UI props. Deleting a block appends its tasks to the inbox and normalizes order. No database schema change was needed.

Occurrence `date` remains the original identity date for future recurrence. Render position, editing date, and daily task totals use actual intervals, including cross-midnight moves. Task association remains stable across all gestures. The original one-off definition stays a definition snapshot; recurrence processing will explicitly distinguish definitions from overrides in Phase 3.

Browser smoke checks cover pointer move/resize, inbox-to-block transfer, pointer and button reordering, task notes/estimates, and modal editing. Native touch hardware and full assistive-technology audits remain part of polish.

## Phase 3 recurrence implementation

`domain/recurrence.ts` validates rules and expands one date into a dated occurrence. It handles ISO weekdays (Monday=1), inclusive bounds, overnight/full-day durations, and local wall-clock conversion. It provides routine presets only; tasks are never cloned.

`lib/db/routines.ts` materializes dates under a single IndexedDB transaction. IDs use `routine:<definition-id>:<original-date>` and exceptions use a separate deterministic namespace. Existing occurrences and explicit skips are never overwritten by generation. Date navigation considers the routine timezone and preceding local date for overnight tails; it does not pre-expand an unbounded series. `useRoutines` runs this work at the date/definition/exception boundary, with loading, failure, and retry UI. Task changes alone do not rerun generation.

Series edits apply across all original dates except overrides/skips. Matching dated IDs and tasks survive timing/name/color changes. Removed regular dates rescue all tasks to Unscheduled before removing occurrences. Entire-series deletion also rescues tasks and removes only that definition’s exceptions. All compound operations are transactional. No schema upgrade or data reset was needed; version 1 already included recurrence and exception stores.

DST policy remains explicit rejection: valid routines continue loading while affected dates show warnings. Invalid DST dates can be skipped in the routine editor. A series edit that would invalidate an existing materialized date rolls back; the user can skip the date first. Routines retain their original timezone, and DST repeated-hour axis rendering remains deferred.

A moved occurrence retains its original date identity. It can coexist with a normal occurrence on its destination date; both have independent tasks. Reset returns it to the original date under the current routine rule. Overrides outside a subsequently narrowed series remain visible until manually skipped; resetting requires the original date to match the current rule again.

Browser verification for Phase 3 passed: preset creation, weekday generation, empty next-day tasks, occurrence override via a time handle, whole-series changes with override preservation, skip plus task rescue across reload, restore, reset, and weekend exclusion. Browser diagnostics reported no errors or warnings.

## Phase 4 integration and cache lifecycle

The GIS library loads only after an explicit user request. The public client ID is a build-time `NEXT_PUBLIC_GOOGLE_CLIENT_ID` variable. `auth.ts` holds short-lived credentials only in module memory; grants are checked for both read-only scopes. Popup failure, cancellation, expiry, partial consent and late callbacks have explicit handling. A future requirement for unattended synchronization would justify a server-side code exchange/token store; the current user-driven flow needs no server or client secret.

The REST adapter uses Authorization headers, omits cookies, uses `cache: no-store`, and retrieves every page before returning. It requests minimal event fields and expands recurring meetings with `singleEvents=true`, preserving Google's instance IDs. Requests cover the actual viewer day plus a two-day margin on each side so calendars with a different timezone still return relevant all-day dates; only events intersecting the requested day are stored. Event links are restricted to HTTPS Google Calendar/Google hosts.

`cacheDay` atomically replaces the selected calendars' entries intersecting the fetched day and records its refresh timestamp only after complete success. Missing events therefore disappear after cancellation/deletion/moving outside that day. Other days stay cached and can be stale until revisited/refreshed. Failed fetches never partially replace the cache. Date changes and selection changes abort in-flight requests; a session-operation check and persisted connection revision reject stale results at the transaction boundary. Deselecting a calendar removes its cached events and clears freshness metadata. A same-account reconnect preserves the cache; switching accounts removes the previous account's metadata/events. Disconnect clears only calendar stores. No OAuth tokens are persisted or included in logs.

Schema v2 replaces the old unique calendar/event index with a connection/calendar/event index without deleting records. Upgrade tests start with v1 data and confirm event/task preservation. Existing tables and version 1 declarations remain unchanged.

Validation: 66 tests, covering OAuth scope checks/expiry/cancellation/timeouts/revocation, paginated API access and failures, instance identities, all-day/overnight/DST behavior, multi-block associations, stale refresh rejection, cache persistence/replacement/account switching and v1 migration. Browser fixture checks verify overlap lanes, matching block entries, all-day display and short-event access. Real GIS script loading passed; live OAuth consent and fetching await external-browser verification (the embedded browser did not expose its popup). See README for Google Cloud configuration and manual checks.

## Phase 5 backup and interaction polish

`domain/backup.ts` validates an unknown JSON value into fresh, explicitly selected fields. The format is `{format: "timeblock", version: 1, exportedAt, data}`. Six planner tables are included; external meetings, connection identities, OAuth state and recovery snapshots are excluded from portable exports. Validation checks types/enums, temporal values, ranges, unique primary/compound keys, foreign keys and routine occurrence/exception identity. Unknown fields are discarded rather than copied into storage. File imports are bounded to 20 MB and unsupported versions fail explicitly.

`lib/db/backup.ts` reads all planner tables under one transaction for a consistent export. Restore revalidates at the write boundary, snapshots the current planner, then replaces the six tables and writes the single recovery slot in one transaction. Failures roll everything back. Recovery swaps current/saved snapshots rather than deleting intervening changes. The new `recovery` table is added in schema v3; v1/v2 definitions are untouched. Tests cover migrations and deliberately fail a write after table clearing to verify rollback. Recovery is not an independent backup: browser eviction removes it with other local data.

`BackupDialog` exposes export, local file parsing, a review of counts/date/timezone, explicit replacement acknowledgement, recovery download and recovery restore. File reads never upload to a server. The acknowledgement controls the browser workflow; repository operations are independently validated and transactional. No merge mode is offered because ID conflicts and series reconciliation need explicit product semantics.

`EditorPanel` and the task editor use a shared native-dialog focus lifecycle. Native modal behavior keeps background controls inert and supports nested task editing. Focus returns to the triggering control, with the main planner as fallback when that control no longer exists. Editor errors are visible inside the active modal. Modifier-key shortcuts pause while any dialog is open or the user is editing text. This avoids accidental scheduling during form entry.

`plannerView` derives definition/task indexes and day/viewport block sets in one linear pass, replacing repeated task × block scans in rendering. The existing source data remains in Dexie; the derived indexes are memoized, not a second durable store. Planner reads use a read transaction so a restore cannot briefly expose mismatched tables. Restoring explicitly retries recurrence materialization even when definitions are unchanged. No virtualization or worker was added without evidence of a need.

On small screens, planning tools are collapsed by default and a day-list alternative provides full-width task/block controls. The timeline remains primary. The day list includes all blocks intersecting the selected date, while timeline visible hours still control spatial placement. Native dialogs fit the viewport, important icon controls have accessible names, muted text contrast is improved, and reduced-motion preferences remain respected. Display timezone changes affect rendering and defaults only, never existing routine/block instants.

Validation record: 78 passing tests plus strict TypeScript/production build. Browser checks include download + reselect, preview/acknowledgement, restore/recovery, note/completion preservation, modal focus/Escape, modified shortcuts and suppression, and 390px responsive layout. The Vercel fix is independently committed/pushed as `c17c379`; `vercel.json` selects the Next.js framework and `.next` output so an erroneous `public` dashboard override does not control the next build. Live Vercel deployment and Google consent remain user-environment checks.

## Timed task cards and structured notes

Tasks optionally carry `schedule: { offsetMinutes, durationMinutes }`, measured in elapsed minutes from their dated occurrence's start. These instants are derived, not duplicated, so moving an occurrence carries its tasks. A drop resolves the snapped wall-clock minute with Temporal's `reject` disambiguation. New placements must fit inside their block; overlaps are permitted and displayed in separate lanes alongside intersecting external meetings. No automatic splitting or rescheduling occurs. A block resize or routine edit may leave an existing task outside the block; it remains visible in the unslotted list with a warning until the user repairs it. DST clock-change dates use a task-list fallback with exact offset-labelled ranges.

A task's optional checklist has stable item IDs and independent completion flags. Progress counts completed items, without implicitly changing overall task completion. Checklist toggles use a read/write IndexedDB transaction. New recurrence occurrences still start without tasks. Rescue operations clear scheduling while retaining all checklist and note data.

The optional `notesFormat: "markdown"` distinguishes rich notes from existing literal plain text. Tiptap loads only when task details open, renders supported rich text, and serializes Markdown; raw HTML is not directly injected into React. Notes remain local to the task, not part of a Google event. Draft edits commit with Save task and are discarded when the dialog closes. No editor service or backend is involved.

Optional non-indexed task fields do not require a Dexie schema upgrade. Backup format v2 preserves these fields; v1 is accepted for legacy imports. Older clients reject v2, preventing silent field loss. Validation rejects invalid schedules, schedules without a parent block, and duplicate checklist identities before restore.


## Single-owner calendar presentation

`meetingOwner` resolves one visual owner independently of external event identity. Explicit `MeetingPlacement` choices take priority, including `null` for Outside blocks. Invalid explicit assignments fall back outside. Without a choice, select the shortest fully containing occurrence, then earliest start and stable ID. Partial intersections still describe overlap, but never create extra cards. Meetings spanning several blocks remain outside unless one occurrence contains their full range.

Dexie v4 adds `meetingPlacements` without altering existing tables. Assignment writes validate the cached event and destination occurrence in the same transaction; neither timestamps nor Google data is mutated. The table is separate from refreshable event cache and survives event refresh. Account switching/disconnection clears the appropriate assignments. Calendar metadata, including these assignments, remains outside planner backups. The details dialog and drag/drop use the same validation path; expired/missing event identities fail without changing assignment.


## Nextcloud connector

The read-only CalDAV adapter runs in a Next.js Node route at `/api/nextcloud`. The only target authority is server-only `NEXTCLOUD_URL`; browser input cannot select a host. Discovery follows DAV current-user-principal → calendar-home-set → VEVENT collections. Requests use Basic auth with a user-supplied app password. Passwords live only in a hook ref and individual requests; metadata and events remain local in Dexie. The endpoint retains no session and sends no credential cookies. Corporate deployment hostnames belong exclusively in ignored local env / deployment settings.

Calendar queries request expanded VEVENTs over the visible day's instant range with a date margin for all-day events. The server parses XML with DTD/entity declarations rejected and parses iCalendar via ical.js. Unexpanded RRULE/RDATE, missing event data, or unresolved floating timestamps cause an error and preserve the cache. Event identity uses principal/calendar/UID/RECURRENCE-ID. Selection is limited to 10 calendars; responses and execution time are bounded.

Connection replacement and disconnect are provider-scoped. One Google and one Nextcloud account may coexist; switching accounts within one provider removes only that provider's old cache and assignments. Existing Google rows need no migration. Hook request epochs plus repository revision checks prevent stale responses from repopulating disconnected/reselected calendars. The aggregate event collection feeds the existing assignment and timeline logic. A reconnect after reload is intentional; no app passwords are persisted.
