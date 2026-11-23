import type { SyncController } from './hooks';

export function SyncLine({ sync }: { sync: SyncController }) {
  const { status } = sync;
  return (
    <div className="muted" aria-live="polite">
      {sync.sample && (
        <p className="notice">
          Sample cards. These are practice corrections, not your Google Sheet.
        </p>
      )}
      {sync.syncing && <p>Syncing...</p>}
      {status.lastSuccessAt ? (
        <p>
          Last sync: {new Date(status.lastSuccessAt).toLocaleString()}
          {status.cardCount !== undefined && ` (${status.cardCount} cards)`}
        </p>
      ) : (
        !sync.syncing && <p>Not synced yet.</p>
      )}
      {status.lastError && (
        <p className="error" role="alert">
          Sync problem: {status.lastError} Saved cards are still available.
        </p>
      )}
    </div>
  );
}
