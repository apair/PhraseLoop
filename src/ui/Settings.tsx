import { useEffect, useRef, useState } from 'react';
import { db } from '../data/db';
import { getSheetUrl, setSheetUrl } from '../data/settings';
import {
  buildExport,
  ImportValidationError,
  previewBackup,
  replaceAllData,
  validateBackup,
  type BackupFile,
  type ImportPreview,
} from '../services/backup';
import { SheetUrlError, validateSheetUrl } from '../services/sync';
import type { SyncController } from './hooks';
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
  const [sheetDraft, setSheetDraft] = useState('');
  const [sheetReady, setSheetReady] = useState(false);
  const [sheetError, setSheetError] = useState<string>();
  const [sheetNote, setSheetNote] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    void getSheetUrl(db).then((url) => {
      if (cancelled) return;
      setSheetDraft(url ?? '');
      setSheetReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const saveSheet = async (raw: string) => {
    setSheetError(undefined);
    setSheetNote(undefined);
    try {
      const next = validateSheetUrl(raw);
      await setSheetUrl(db, next);
      setSheetDraft(next);
      await sync.syncNow();
      setSheetNote(next ? 'Saved in this browser.' : 'Cleared. Sample cards are in use.');
    } catch (err) {
      setSheetError(err instanceof SheetUrlError ? err.message : 'Could not save that sheet URL.');
    }
  };

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
        <h3>Sheet</h3>
        <p className="muted">
          Paste a published CSV link, or the normal Google Sheets link. PhraseLoop saves it only in this
          browser and reads the sheet as CSV. Leave it blank to keep the sample cards.
        </p>
        <label className="field">
          Sheet URL
          <input
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder="https://docs.google.com/spreadsheets/d/…/edit"
            value={sheetDraft}
            onChange={(e) => setSheetDraft(e.target.value)}
          />
        </label>
        <div className="row">
          <button className="primary" disabled={!sheetReady || sync.syncing} onClick={() => void saveSheet(sheetDraft)}>
            Save sheet URL
          </button>
          <button disabled={!sheetReady || sync.syncing || !sheetDraft.trim()} onClick={() => void saveSheet('')}>
            Use sample cards
          </button>
        </div>
        {sheetError && <p className="error" role="alert">{sheetError}</p>}
        {sheetNote && <p className="ok" role="status">{sheetNote}</p>}
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
        <button disabled={!online || sync.syncing} onClick={() => void sync.syncNow()}>
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
          URL you save stays on this device and is not included in a backup export.
        </p>
      </div>
    </section>
  );
}
