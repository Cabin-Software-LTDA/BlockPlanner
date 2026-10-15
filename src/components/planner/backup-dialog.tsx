"use client";
import { useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Download, X } from "lucide-react";
import { EditorPanel } from "./editor-panel";
import {
  backupCounts,
  MAX_BACKUP_BYTES,
  parseBackup,
  type PlannerBackup,
} from "@/domain/backup";
import { exportBackup, restoreBackup, undoRestore } from "@/lib/db/backup";
import { db } from "@/lib/db/database";
function download(backup: PlannerBackup) {
  const json = JSON.stringify(backup, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  if (blob.size > MAX_BACKUP_BYTES)
    throw new Error(
      "This workspace exceeds the 20 MB backup limit. No data was changed.",
    );
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `timeblock-${backup.exportedAt.replaceAll(":", "-")}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
export function BackupDialog({
  close,
  restored,
}: {
  close: () => void;
  restored: () => void;
}) {
  const [preview, setPreview] = useState<PlannerBackup | null>(null);
  const [filename, setFilename] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [undoAcknowledged, setUndoAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const request = useRef(0);
  const recovery = useLiveQuery(() => db.recovery.get("before-restore"), []);
  async function action(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not complete the backup operation.",
      );
    } finally {
      setBusy(false);
    }
  }
  const counts = preview && backupCounts(preview);
  return (
    <EditorPanel label="Backup and restore" close={busy ? () => {} : close}>
      <div className="section-heading">
        <h2>Backup and restore</h2>
        <button
          className="icon-button"
          aria-label="Close backup and restore"
          onClick={close}
          disabled={busy}
        >
          <X size={18} />
        </button>
      </div>
      <p className="muted">
        A portable copy of your planner. Files include task notes and routines.
        Keep them somewhere private.
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="backup-notice">
          {notice}
        </p>
      )}
      <section className="backup-section">
        <h3>Export your planner</h3>
        <p>
          Blocks, tasks, routines, exceptions, preferences and daily layouts.
          Google connections, tokens and cached meetings are excluded.
        </p>
        <button
          className="secondary"
          disabled={busy}
          onClick={() =>
            void action(async () => {
              download(await exportBackup());
              setNotice(
                "Backup download started. Check your browser downloads before relying on this file.",
              );
            })
          }
        >
          <Download size={16} /> Download JSON backup
        </button>
      </section>
      <section className="backup-section">
        <h3>Restore from a file</h3>
        <p>
          Restore replaces planner data on this device. A local recovery copy is
          saved automatically. Google Calendar data is left unchanged.
        </p>
        <label>
          Choose a TimeBlock JSON backup (up to 20 MB)
          <input
            type="file"
            accept=".json,application/json"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              const revision = ++request.current;
              setPreview(null);
              setAcknowledged(false);
              setError("");
              setNotice("");
              setFilename(file?.name ?? "");
              if (!file) return;
              if (file.size > MAX_BACKUP_BYTES) {
                setError("Choose a backup file no larger than 20 MB.");
                return;
              }
              setBusy(true);
              void file
                .text()
                .then((json) => {
                  if (request.current === revision)
                    setPreview(parseBackup(json));
                })
                .catch((e) => {
                  if (request.current === revision)
                    setError(
                      e instanceof Error
                        ? e.message
                        : "Could not read this file.",
                    );
                })
                .finally(() => {
                  if (request.current === revision) setBusy(false);
                });
            }}
          />
        </label>
        {preview && counts && (
          <div className="backup-preview">
            <h4>Review {filename}</h4>
            <p>Exported {new Date(preview.exportedAt).toLocaleString()}</p>
            <dl>
              <dt>Time blocks</dt>
              <dd>{counts.blocks}</dd>
              <dt>Routines</dt>
              <dd>{counts.routines}</dd>
              <dt>Tasks</dt>
              <dd>{counts.tasks}</dd>
              <dt>Exceptions</dt>
              <dd>{counts.exceptions}</dd>
            </dl>
            <p>
              Timezone: {preview.data.preferences[0].timezone}. Task completion
              and notes will be restored exactly.
            </p>
            <label className="check-label">
              <input
                type="checkbox"
                checked={acknowledged}
                disabled={busy}
                onChange={(e) => setAcknowledged(e.target.checked)}
              />{" "}
              Replace my current planner with this backup
            </label>
            <button
              className="primary full"
              disabled={busy || !acknowledged}
              onClick={() =>
                void action(async () => {
                  await restoreBackup(preview);
                  setPreview(null);
                  setAcknowledged(false);
                  setNotice(
                    "Planner restored. The previous workspace is available in the recovery copy below.",
                  );
                  restored();
                })
              }
            >
              Restore planner
            </button>
          </div>
        )}
      </section>
      {recovery && (
        <section className="backup-section">
          <h3>Recovery copy</h3>
          <p>
            Saved {new Date(recovery.savedAt).toLocaleString()}. Contains{" "}
            {recovery.backup.data.occurrences.length} blocks and{" "}
            {recovery.backup.data.tasks.length} tasks. Restoring it replaces the
            current planner and saves the current state as the next recovery
            copy.
          </p>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void action(async () => download(recovery.backup))}
          >
            Download recovery copy
          </button>
          <label className="check-label">
            <input
              type="checkbox"
              disabled={busy}
              checked={undoAcknowledged}
              onChange={(e) => setUndoAcknowledged(e.target.checked)}
            />{" "}
            Replace my planner with this recovery copy
          </label>
          <button
            className="secondary"
            disabled={busy || !undoAcknowledged}
            onClick={() =>
              void action(async () => {
                await undoRestore();
                setUndoAcknowledged(false);
                setPreview(null);
                setNotice(
                  "Recovery copy restored. Your previous state is now available as the recovery copy.",
                );
                restored();
              })
            }
          >
            Restore recovery copy
          </button>
        </section>
      )}
      {busy && <p role="status">Working with your local data…</p>}
    </EditorPanel>
  );
}
