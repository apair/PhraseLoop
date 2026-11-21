import type { Db } from './db';
import type { SyncStatus } from '../types';

const INSTALLATION_ID = 'installationId';
const SYNC_STATUS = 'syncStatus';

export async function getInstallationId(db: Db): Promise<string> {
  return db.transaction('rw', db.settings, async () => {
    const existing = await db.settings.get(INSTALLATION_ID);
    if (typeof existing?.value === 'string') return existing.value;
    const id = crypto.randomUUID();
    await db.settings.put({ key: INSTALLATION_ID, value: id });
    return id;
  });
}

export async function getSyncStatus(db: Db): Promise<SyncStatus> {
  return ((await db.settings.get(SYNC_STATUS))?.value as SyncStatus | undefined) ?? {};
}

export async function updateSyncStatus(db: Db, patch: SyncStatus): Promise<SyncStatus> {
  return db.transaction('rw', db.settings, async () => {
    const next = { ...(await getSyncStatus(db)), ...patch };
    await db.settings.put({ key: SYNC_STATUS, value: next });
    return next;
  });
}
