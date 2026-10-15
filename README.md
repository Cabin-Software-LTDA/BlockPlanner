# TimeBlock

A local-first daily planner. Phases 1–4: local planner, recurring routines, and optional read-only Google Calendar. Core planning needs no account or backend. No telemetry.

## Run

Use Node 24 LTS or newer (the test runner also supports Node 22.12+).

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:3000. Production: `npm run build && npm start`.

## Verify

```sh
npm run typecheck
npm test
npm run build
```

In the browser: create a block, add and complete a task, reload, and confirm both persist. Click the block heading to edit its name, times, color, or icon. Delete a block and verify its tasks appear in Unscheduled. Navigate dates to find earlier unfinished tasks. Settings controls visible hours and input increments. Test a 23:00–01:00 block with visible hours extended to midnight and then navigate to the next day with visible hours starting at 00:00.

## Implemented

- Next.js App Router, strict TypeScript, Tailwind, Lucide, Dexie, Zustand.
- Responsive shell, mini calendar, date navigation, light/dark mode, current-time indicator.
- Separate domain models, versioned IndexedDB schema (v2 preserves v1 data), transactional block creation.
- Block creation, date/time editing, deletion, overlap lanes, overnight clipping, and explicit 24-hour intervals.
- dnd-kit move and top/bottom resize handles, snapped previews, and arrow-key equivalents.
- Tasks: add, edit, complete, delete, notes, optional minute estimates, drag reordering, and moves between blocks/inbox.
- Keyboard reorder buttons and a native accessible task dialog with destination selection.
- Short blocks expose their tasks in the details panel; full task data persists after reload.
- Preferences: timezone captured on first use, visible hours, theme, 15/30 minute input step.
- Daily/selected-weekday routines, inclusive date bounds, reusable block presets, and stable dated occurrences.
- Single-occurrence overrides, whole-series edits, skip/restore, and reset-to-routine controls.
- Read-only Google Calendar, calendar selection, paginated recurring event expansion, manual refresh, offline event cache, and disconnect.
- Meeting entries within intersecting blocks, independent overlap lanes, all-day dates, and a full-time agenda.
- Domain, OAuth/API adapter, migration, and persistence tests.

## Not implemented yet

- Automatic task-template cloning and “this and following” series splitting.
- JSON export/import, global keyboard shortcuts, PWA/service worker offline launch.
- Timezone selection and repeated-hour DST timeline rendering.

Data stays in this browser profile and origin. Changing ports/hostnames produces a different storage origin. Browser storage can be cleared or evicted; backup UI is still pending. Local operations do not need a backend; fully offline page launch after stopping the Next server is not yet supported.

## Phase 3 routine checks

1. Choose **New routine** in the sidebar. Start from a block preset or set a name, daily/weekday schedule, first/optional last date, times, color, and icon.
2. Navigate to a matching day. Repeat badges identify generated occurrences. Add and complete a task, then navigate to the next day: its task list starts empty.
3. Drag/resize an occurrence or open it and select **Save this occurrence**. This records an override tied to its original date, even if moved to another date.
4. Choose **Edit entire series** in block details or select the routine in the sidebar. This updates all regular occurrences, including past dates. Existing overrides and skips stay unchanged. If changed weekdays/bounds remove a regular block, its tasks move to Unscheduled; the editor previews counts.
5. Choose **Skip this occurrence**, or use the routine editor’s exception-date field. The skip survives reload, and tasks move to Unscheduled. **Restore** recreates an empty block. **Reset** returns an edited occurrence to its current routine timing/appearance, keeping its attached tasks.
6. Reload and verify the routine, exceptions, and tasks. Series removal preserves every task in Unscheduled.

Routines keep their creation timezone. DST gaps/ambiguous times produce a dated warning instead of silent adjustment. New daily occurrences have no tasks; block presets never clone task entities or completion. A whole-series edit that cannot represent an existing DST date rolls back with an error; skip that date or choose valid times first.

## Phase 2 interaction checks

1. Drag a block's grip vertically. Start/end preview snaps to the 15/30-minute setting; release commits once. Escape cancels a drag. Drag the top/bottom line to resize. Tab to any handle and press Up/Down for the same increment, or Enter for details.
2. Click a task title to edit its name, notes, estimate, or destination. Escape closes the dialog. Estimate does not schedule a task.
3. Drag a task's grip onto another task to insert before it, or onto blank block/inbox space to append. The up/down buttons reorder without dragging. Use the dialog to move to dates outside the current view.
4. Resize a block below 45 minutes and open its heading to manage tasks in the details panel. Move a block's date in that panel; tasks stay attached.
5. Reload to verify timing, task order, notes, estimates, and completion. Delete a block to preserve its tasks at the end of Unscheduled.

Limits: blocks are 15 minutes to 24 wall-clock hours. Resize enforces at least the selected increment. Pointer movement operates on the visible timeline; use date/time fields for exact or offscreen placement. Mouse, touch, and pen handlers use dnd-kit's PointerSensor with dedicated `touch-action: none` handles; physical touch-device testing is still pending.

See [architecture](docs/architecture.md) for relationships, edge cases, and milestone sequence.

Browser smoke checks cover block/task workflows and recurring occurrence generation, per-day task isolation, overrides, whole-series edits, skip/restore persistence, reset-to-routine, and weekend exclusion. The current suite has 66 passing tests. Production builds use webpack because Turbopack's production CSS subprocess failed to bind a local port in this environment; development uses Turbopack successfully. Dependencies were checked against npm peer metadata and locked in `package-lock.json`. Framework setup follows the [Next.js installation guide](https://nextjs.org/docs/app/getting-started/installation); reactive database access follows [Dexie's React guide](https://dexie.org/docs/Tutorial/React).

## Phase 4 Google Calendar setup and verification

1. In the Google Cloud project for your **Web application** OAuth client, enable **Google Calendar API**. Configure Google Auth Platform branding/audience and add your Google account as a test user while the app is in testing.
2. Register the exact **Authorized JavaScript origin** `http://127.0.0.1:3000`. If using localhost, also register `http://localhost` and `http://localhost:3000`. Production requires your HTTPS origin. This popup token flow needs no redirect endpoint or client secret. See [Google's setup instructions](https://developers.google.com/identity/oauth2/web/guides/get-google-api-clientid) and [origin rules](https://developers.google.com/identity/protocols/oauth2/javascript-implicit-flow#origin-validation).
3. Copy `.env.example` to `.env.local` and set `NEXT_PUBLIC_GOOGLE_CLIENT_ID` to the public client ID, then restart Next.js. The supplied client ID has already been configured locally in this workspace; `.env.local` is ignored by Git. Never add a client secret.
4. Open the app in a normal external browser. Select **Load Google sign-in**, then **Connect Google** and complete Google's consent screen. The first button loads the third-party library only on request; the second opens the popup synchronously from a user gesture. Embedded browsers may not support the popup or Google authorization. Allow popups for this origin.
5. Grant `calendar.calendarlist.readonly` and `calendar.events.readonly`. Select calendars in the sidebar. Navigation refreshes the visible day while the session is authorized; **Refresh** fetches it again. No write scope, event creation, task conversion, or automatic schedule changes exist. [Google scope definitions](https://developers.google.com/workspace/calendar/api/auth).
6. Verify a meeting crossing two blocks appears in both, with its original full range. The calendar lane places it once at its actual time; overlapping meetings occupy separate columns. All-day events use date ranges with exclusive ends, displayed above the timeline. Meetings outside visible hours and all exact ranges remain accessible in **Meeting details**. Meetings shorter than 15 minutes render a proportional marker; use the details list for their content.
7. Reload: cached meetings remain, but a fresh session requires **Reconnect Google**. Tokens are kept only in memory and expire; there is no silent/background refresh token. After reconnecting, try changing a Google event outside TimeBlock and refreshing; deleted/moved events disappear from the refreshed day. A failed or partial fetch preserves the previous cache.
8. **Disconnect** deletes calendar metadata and cached events, preserving blocks/tasks. It attempts Google permission revocation when a valid access token is available. If revocation cannot be confirmed, the UI links to [Google Account connections](https://myaccount.google.com/connections) for manual removal.

Use the same hostname/port as your original planner to retain that origin's IndexedDB data. Common setup failures: missing authorized origin, Calendar API disabled, account not added as a test user, declined scopes, or blocked popup. Errors are shown without logging credentials. Before a public release, review [Google's OAuth production requirements](https://developers.google.com/identity/protocols/oauth2/policies), including app verification where required.

**Validation:** automated OAuth tests use a fake Google Identity Services adapter; API tests mock HTTP responses. Browser checks covered loading Google's real library and fixture-based meeting rendering. Live consent/event retrieval is not yet verified: the in-app browser did not expose the OAuth popup. The temporary synthetic preview was isolated from IndexedDB and removed after verification. Run the flow above in your normal browser to validate your Google Cloud configuration.

**Tradeoffs:** this uses Google's [browser token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model), avoiding a token backend. One Google account is connected at a time. Cached event titles/times/calendar identities are local plaintext IndexedDB data; disconnect clears them. Only visited days are cached; no background synchronization. On DST clock-change days, meetings use an offset-labelled agenda instead of the wall-clock lane. Full repeated-hour timeline support, backup/import, and accessibility/responsive polish remain Phase 5 work.
