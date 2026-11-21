import { useRef, useState } from 'react';
import { db } from '../data/db';
import {
  buildExport,
  ImportValidationError,
  previewBackup,
  replaceAllData,
  validateBackup,
  type BackupFile,
  type ImportPreview,
} from '../services/backup';
import type { SyncController } from './hooks';
import { configError } from './hooks';
import { SyncLine } from './SyncLine';

interface Props {
  sync: SyncController;
  online: boolean;
  onBack: () => void;
}

export function Settings({ sync, online, onBack }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ file: BackupFile; preview: ImportPreview }>();
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string }>();

  const exportData = async () => {
    const data = await buildExport(db);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `phraseloop-backup-${data.exportedAt.slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setMessage({ kind: 'ok', text: `Exported ${data.corrections.length} cards and ${data.reviewEvents.length} reviews.` });
  };

  const chooseFile = async (file?: File) => {
    setMessage(undefined);
    setPending(undefined);
    if (!file) return;
    try {
      const parsed = await validateBackup(await file.text());
      setPending({ file: parsed, preview: previewBackup(parsed) });
    } catch (err) {
      setMessage({
        kind: 'error',
        text: err instanceof ImportValidationError ? `Import rejected. ${err.message}` : 'Could not read that file.',
      });
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const confirmImport = async () => {
    if (!pending) return;
    try {
      await replaceAllData(db, pending.file);
      setMessage({ kind: 'ok', text: 'Import complete. Local data was replaced.' });
    } catch (err) {
      setMessage({ kind: 'error', text: `Import failed; your existing data was kept. ${String(err)}` });
    }
    setPending(undefined);
  };

  return (
    <section className="stack">
      <div className="review-head">
        <button className="link" onClick={onBack}>Back</button>
        <h2>Settings</h2>
        <span />
      </div>

      <div className="card stack">
        <h3>Sync</h3>
        <SyncLine sync={sync} />
        {sync.lastSummary && (
          <p className="muted">
            Last result: {sync.lastSummary.added} new, {sync.lastSummary.removed} removed from sheet,{' '}
            {sync.lastSummary.duplicates} duplicates ignored.
          </p>
        )}
        <button disabled={!online || sync.syncing || !!configError()} onClick={() => void sync.syncNow()}>
          {sync.syncing ? 'Syncing...' : 'Sync now'}
        </button>
        {!online && <p className="muted">You are offline. Saved cards remain usable.</p>}
      </div>

      <div className="card stack">
        <h3>Backup</h3>
        <p className="muted">
          Review history is stored only on this device. Export it to move to another device.
        </p>
        <button onClick={() => void exportData()}>Export data (JSON)</button>
        <label className="file">
          <span>Import data (JSON)</span>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            onChange={(e) => void chooseFile(e.target.files?.[0])}
          />
        </label>
        {pending && (
          <div className="confirm" role="alertdialog" aria-labelledby="confirm-title">
            <h4 id="confirm-title">Replace all local data?</h4>
            <p>
              This backup (exported {new Date(pending.preview.exportedAt).toLocaleString()}) contains{' '}
              {pending.preview.corrections} cards, {pending.preview.reviewStates} review states,{' '}
              {pending.preview.reviewEvents} review events and {pending.preview.sessions} daily sessions.
              Everything currently on this device will be replaced.
            </p>
            <div className="row">
              <button className="danger" onClick={() => void confirmImport()}>Replace local data</button>
              <button onClick={() => setPending(undefined)}>Cancel</button>
            </div>
          </div>
        )}
        {message && (
          <p className={message.kind === 'error' ? 'error' : 'ok'} role={message.kind === 'error' ? 'alert' : 'status'}>
            {message.text}
          </p>
        )}
      </div>

      <div className="card stack">
        <h3>About the data source</h3>
        <p className="muted">
          Corrections are read from a public, read-only published Google Sheet feed. Anyone who has or
          discovers that URL can view the corrections; nobody can edit the sheet through this app. The
          feed URL is fixed at build time.
        </p>
      </div>
    </section>
  );
}
