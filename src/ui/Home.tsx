import { useEffect, useState } from 'react';
import { db } from '../data/db';
import { getOrCreateSession, peekSession } from '../services/session';
import type { DailySession } from '../types';
import type { SyncController } from './hooks';
import { SessionClock } from './SessionClock';
import { SyncLine } from './SyncLine';

interface Props {
  sync: SyncController;
  online: boolean;
  onStart: () => void;
}

export function Home({ sync, onStart }: Props) {
  const [session, setSession] = useState<DailySession | undefined>();
  const [cardTotal, setCardTotal] = useState<number>(0);
  const [message, setMessage] = useState<string>();
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [s, rows] = await Promise.all([peekSession(db), db.corrections.toArray()]);
      const n = rows.filter((c) => !c.removedFromSource).length;
      if (!cancelled) {
        setSession(s);
        setCardTotal(n);
        setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sync.version]);

  const start = async () => {
    const s = await getOrCreateSession(db);
    if (!s) {
      setMessage('No cards yet. Sync once while online to download your corrections.');
      return;
    }
    setSession(s);
    onStart();
  };

  const total = session?.cardIds.length ?? 0;
  const done = session?.completedCardIds.length ?? 0;
  const finished = !!session && done >= total;

  return (
    <section className="stack">
      <div className="card">
        <h2>Today&apos;s review</h2>
        {!loaded ? (
          <p className="muted">Loading...</p>
        ) : session ? (
          <p className="big" aria-label={`${done} of ${total} completed`}>
            {done} / {total} <span className="muted">done - {total - done} remaining</span>
          </p>
        ) : (
          <p className="muted">
            {cardTotal > 0
              ? `${cardTotal} cards ready. Your session is built when you start.`
              : 'No cards downloaded yet.'}
          </p>
        )}
        {session && <progress value={done} max={total} aria-hidden="true" />}
        {session && <SessionClock session={session} />}
        <button className="primary" onClick={start} disabled={finished || !loaded}>
          {finished ? 'All done for today' : session && done > 0 ? "Continue today's review" : "Start today's review"}
        </button>
        {message && <p className="error" role="alert">{message}</p>}
      </div>
      <div className="card">
        <h2>Sync</h2>
        <SyncLine sync={sync} />
      </div>
    </section>
  );
}
