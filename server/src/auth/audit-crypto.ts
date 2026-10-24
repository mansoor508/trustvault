import { createHash } from 'node:crypto';

export const GENESIS_HASH = '0'.repeat(64);

/**
 * Deterministic JSON stringifier that sorts keys recursively so that
 * equivalent metadata objects always yield identical byte sequences.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalJson).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const sortedKeys = Object.keys(obj).sort();
  const entries: string[] = [];
  for (const k of sortedKeys) {
    if (obj[k] !== undefined) {
      entries.push(`${JSON.stringify(k)}:${canonicalJson(obj[k])}`);
    }
  }
  return '{' + entries.join(',') + '}';
}

export interface HashableAuditEntry {
  prevHash: string | null;
  userId: string | null;
  targetUserId?: string | null;
  action: string;
  outcome: 'success' | 'failure' | 'denied';
  resourceType: string | null;
  resourceId: string | null;
  requestId: string | null;
  createdAt: string | Date;
  metadata: unknown;
}

/**
 * Computes a deterministic SHA-256 digest linking this entry to the prior hash.
 */
export function computeEntryHash(entry: HashableAuditEntry): string {
  const prev = entry.prevHash && entry.prevHash.length === 64 ? entry.prevHash : GENESIS_HASH;
  const createdAtIso =
    entry.createdAt instanceof Date
      ? entry.createdAt.toISOString()
      : new Date(entry.createdAt).toISOString();
  const metaStr = canonicalJson(entry.metadata);

  const payload = [
    prev,
    entry.userId ?? '',
    entry.targetUserId ?? '',
    entry.action,
    entry.outcome,
    entry.resourceType ?? '',
    entry.resourceId ?? '',
    entry.requestId ?? '',
    createdAtIso,
    metaStr,
  ].join('|');

  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

/**
 * Computes a SHA-256 digest over a checkpoint snapshot.
 */
export function computeCheckpointHash(params: {
  checkpointSeq: number;
  lastLogId: string | number;
  lastEntryHash: string;
  entryCount: number;
}): string {
  const payload = [
    params.checkpointSeq,
    params.lastLogId,
    params.lastEntryHash,
    params.entryCount,
  ].join('|');

  return createHash('sha256').update(payload, 'utf8').digest('hex');
}
