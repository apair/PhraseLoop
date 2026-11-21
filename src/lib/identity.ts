/** Unicode NFC, trimmed, collapsed whitespace, locale-independent lowercase. */
export function normalizeForId(text: string): string {
  return text.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Stable correction ID: SHA-256 hex of the normalized corrected sentence. */
export async function correctionId(corrected: string): Promise<string> {
  const data = new TextEncoder().encode(normalizeForId(corrected));
  return toHex(await crypto.subtle.digest('SHA-256', data));
}

export const ID_PATTERN = /^[0-9a-f]{64}$/;
