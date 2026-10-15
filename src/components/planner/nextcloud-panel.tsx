"use client";
import { useState } from "react";
import { CalendarDays, RefreshCw } from "lucide-react";
import type { useNextcloudCalendar } from "./use-nextcloud-calendar";
export function NextcloudPanel({
  calendar,
}: {
  calendar: ReturnType<typeof useNextcloudCalendar>;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  return (
    <section className="calendar-panel" aria-label="Nextcloud Calendar">
      <div className="section-heading">
        <h2>
          <CalendarDays size={15} /> Nextcloud Calendar
        </h2>
      </div>
      <p className="muted">
        Read-only calendars from your configured Nextcloud server.
      </p>
      {calendar.configured === false && (
        <p className="calendar-help">
          Nextcloud is not configured for this deployment. Set the server-only
          NEXTCLOUD_URL environment variable and redeploy.
        </p>
      )}
      {calendar.configured === null && !calendar.error && (
        <p className="muted" role="status">
          Checking Nextcloud setup…
        </p>
      )}
      {calendar.connection && (
        <>
          <p className="calendar-account">{calendar.connection.accountLabel}</p>
          <fieldset disabled={calendar.busy}>
            <legend className="sr-only">Nextcloud calendars to display</legend>
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
          {calendar.syncedAt && (
            <p className="muted">
              Refreshed {new Date(calendar.syncedAt).toLocaleString()}
            </p>
          )}
          {!calendar.connection.calendars?.length && (
            <p className="muted">
              No event calendars are available for this account.
            </p>
          )}
          <p className="muted">
            {calendar.authorized
              ? "Connected for this session"
              : "Cached meetings available. Reconnect to refresh."}
          </p>
        </>
      )}
      {calendar.configured && !calendar.authorized && (
        <form
          className="nextcloud-connect"
          onSubmit={(e) => {
            e.preventDefault();
            const auth = password;
            setPassword("");
            void calendar.connect(
              username || calendar.connection?.accountLabel || "",
              auth,
            );
          }}
        >
          <label>
            Nextcloud username
            <input
              required
              autoComplete="username"
              value={username || calendar.connection?.accountLabel || ""}
              onChange={(e) => setUsername(e.target.value)}
              disabled={calendar.busy}
            />
          </label>
          <label>
            App password
            <input
              type="password"
              required
              autoComplete="off"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={calendar.busy}
            />
          </label>
          <p className="muted">
            Generate an app password in Nextcloud → Settings → Security. Your
            credentials pass through this deployment to Nextcloud and stay in
            memory only; reconnect after reloading.
          </p>
          <button className="secondary" disabled={calendar.busy || !password}>
            {calendar.connection ? "Reconnect Nextcloud" : "Connect Nextcloud"}
          </button>
        </form>
      )}
      <div className="calendar-actions">
        {calendar.busy && (
          <button className="secondary" onClick={calendar.cancelUpdate}>
            Cancel Nextcloud update
          </button>
        )}
        {calendar.authorized && (
          <button
            className="secondary"
            disabled={calendar.busy}
            onClick={calendar.refresh}
          >
            <RefreshCw size={14} /> Refresh Nextcloud
          </button>
        )}
        {calendar.connection && (
          <button
            className="secondary"
            disabled={calendar.busy}
            onClick={() => void calendar.disconnect()}
          >
            Disconnect Nextcloud
          </button>
        )}
      </div>
      {calendar.busy && <p role="status">Reading Nextcloud calendars…</p>}
      {calendar.error && (
        <p className="error" role="alert">
          {calendar.error}
        </p>
      )}
      <small className="muted">
        Disconnect removes this device’s Nextcloud cache. Revoke the app
        password in Nextcloud Security to remove access completely.
      </small>
    </section>
  );
}
