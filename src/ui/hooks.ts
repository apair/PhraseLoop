import { useCallback, useEffect, useState } from 'react';
import { db } from '../data/db';
import { getSyncStatus } from '../data/settings';
import { syncCorrections, ConfigError, getFeedUrl, type SyncSummary } from '../services/sync';
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

export function configError(): string | undefined {
  try {
    getFeedUrl();
    return undefined;
  } catch (err) {
    return err instanceof ConfigError ? err.message : String(err);
  }
}

export interface SyncController {
  status: SyncStatus;
  syncing: boolean;
  lastSummary?: SyncSummary;
  /** Bumps after every successful sync so screens can reload. */
  version: number;
  syncNow: () => Promise<void>;
}

export function useSync(online: boolean): SyncController {
  const [status, setStatus] = useState<SyncStatus>({});
  const [syncing, setSyncing] = useState(false);
  const [lastSummary, setLastSummary] = useState<SyncSummary>();
  const [version, setVersion] = useState(0);

  const syncNow = useCallback(async () => {
    setSyncing(true);
    try {
      setLastSummary(await syncCorrections(db));
      setVersion((v) => v + 1);
    } catch {
      // The error is persisted in sync status and shown by the UI.
    } finally {
      setStatus(await getSyncStatus(db));
      setSyncing(false);
    }
  }, []);

  useEffect(() => {
    void getSyncStatus(db).then(setStatus);
  }, []);

  useEffect(() => {
    if (online && !configError()) void syncNow();
  }, [online, syncNow]);

  return { status, syncing, lastSummary, version, syncNow };
}
