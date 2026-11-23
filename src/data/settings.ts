import type { Db } from './db';
import type { SyncStatus } from '../types';

const INSTALLATION_ID = 'installationId';
const SYNC_STATUS = 'syncStatus';
const SHEET_URL = 'sheetUrl';

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

export async function getSheetUrl(db: Db): Promise<string | undefined> {
  const value = (await db.settings.get(SHEET_URL))?.value;
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export async function setSheetUrl(db: Db, url: string): Promise<void> {
  const trimmed = url.trim();
  if (!trimmed) {
    await db.settings.delete(SHEET_URL);
    return;
  }
  await db.settings.put({ key: SHEET_URL, value: trimmed });
}

export async function updateSyncStatus(db: Db, patch: SyncStatus): Promise<SyncStatus> {
  return db.transaction('rw', db.settings, async () => {
    const next = { ...(await getSyncStatus(db)), ...patch };
    await db.settings.put({ key: SYNC_STATUS, value: next });
    return next;
  });
}
