"use client";
import { CalendarDays, RefreshCw } from "lucide-react";
import type { CalendarState } from "./use-google-calendar";
export function CalendarPanel({ calendar }: { calendar: CalendarState }) {
  return (
    <section className="calendar-panel" aria-label="Google Calendar">
      <div className="section-heading">
        <h2>
          <CalendarDays size={15} /> Google Calendar
        </h2>
      </div>
      <p className="muted">Read-only meetings. Your blocks stay yours.</p>
      {!calendar.configured && (
        <p className="calendar-help">
          Calendar setup needed: add the public Google Web client ID to{" "}
          <code>.env.local</code>. See the README for setup.
        </p>
      )}
      {calendar.connection && (
        <>
          <p className="calendar-account">{calendar.connection.accountLabel}</p>
          <fieldset disabled={calendar.busy}>
            <legend className="sr-only">Calendars to display</legend>
            {calendar.connection.calendars?.map((c) => (
              <label className="calendar-choice" key={c.id}>
                <input
                  type="checkbox"
                  checked={calendar.connection!.calendarIds.includes(c.id)}
                  onChange={(e) =>
                    void calendar.selectCalendar(c.id, e.target.checked)
                  }
                />
                {c.title}
              </label>
            ))}
          </fieldset>
          {!calendar.connection.calendarIds.length && (
            <p className="muted">Select a calendar to show meetings.</p>
          )}
          <p className="muted">
            {calendar.authorized
              ? "Connected for this session"
              : "Reconnect to refresh cached meetings"}
          </p>
        </>
      )}
      <div className="calendar-actions">
        {calendar.busy && (
          <button className="secondary" onClick={calendar.cancelUpdate}>
            Cancel update
          </button>
        )}
        {calendar.configured && !calendar.authorized && (
          <button
            className="secondary"
            disabled={calendar.busy}
            onClick={() =>
              void (calendar.identityReady
                ? calendar.connect()
                : calendar.prepare())
            }
          >
            {calendar.identityReady
              ? calendar.connection
                ? "Reconnect Google"
                : "Connect Google"
              : "Load Google sign-in"}
          </button>
        )}
        {calendar.authorized && (
          <button
            className="secondary"
            disabled={calendar.busy}
            onClick={calendar.refresh}
          >
            <RefreshCw size={14} /> Refresh
          </button>
        )}
        {calendar.connection && (
          <button
            className="secondary"
            disabled={calendar.busy}
            onClick={() => void calendar.disconnect()}
          >
            Disconnect
          </button>
        )}
      </div>
      {calendar.busy && <p role="status">Updating calendar…</p>}
      {calendar.error && (
        <p className="error" role="alert">
          {calendar.error}
        </p>
      )}
      {calendar.notice && (
        <p role="status">
          {calendar.notice}{" "}
          <a
            href="https://myaccount.google.com/connections"
            target="_blank"
            rel="noreferrer"
          >
            Google connections
          </a>
        </p>
      )}
      <small className="muted">
        Meeting titles and times are cached on this device. Access tokens stay
        in memory.
      </small>
    </section>
  );
}
