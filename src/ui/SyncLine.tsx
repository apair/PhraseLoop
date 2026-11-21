import type { SyncController } from './hooks';
import { configError } from './hooks';

export function SyncLine({ sync }: { sync: SyncController }) {
  const cfg = configError();
  const { status } = sync;
  if (cfg) return <p className="error" role="alert">{cfg}</p>;
  return (
    <div className="muted" aria-live="polite">
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
