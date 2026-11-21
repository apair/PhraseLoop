import { useCallback, useEffect, useState } from 'react';
import { db } from '../data/db';
import { getSyncStatus } from '../data/settings';
import { resolveActiveFeed, syncCorrections, type SyncSummary } from '../services/sync';
import type { SyncStatus } from '../types';

export function useOnline(): boolean {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

export interface SyncController {
  status: SyncStatus;
  syncing: boolean;
  /** True while the active feed is the bundled sample sheet. */
  sample: boolean;
  lastSummary?: SyncSummary;
  /** Bumps after every successful sync so screens can reload. */
  version: number;
  syncNow: () => Promise<void>;
}

export function useSync(online: boolean): SyncController {
  const [status, setStatus] = useState<SyncStatus>({});
  const [syncing, setSyncing] = useState(false);
  const [sample, setSample] = useState(true);
  const [lastSummary, setLastSummary] = useState<SyncSummary>();
  const [version, setVersion] = useState(0);

  const syncNow = useCallback(async () => {
    setSyncing(true);
    try {
      const feed = await resolveActiveFeed(db);
      setSample(feed.sample);
      setLastSummary(await syncCorrections(db, fetch, feed.url));
      setVersion((v) => v + 1);
    } catch {
      // The error is persisted in sync status and shown by the UI.
      setSample((await resolveActiveFeed(db)).sample);
    } finally {
      setStatus(await getSyncStatus(db));
      setSyncing(false);
    }
  }, []);

  useEffect(() => {
    void getSyncStatus(db).then(setStatus);
  }, []);

  useEffect(() => {
    if (online) void syncNow();
  }, [online, syncNow]);

  return { status, syncing, sample, lastSummary, version, syncNow };
}
