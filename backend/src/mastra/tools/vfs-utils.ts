import { and, eq } from 'drizzle-orm';

import { db } from '../../db/client';
import { files } from '../../db/schema';
import { getOwnedProject } from '../../authz/ownership';
import { getRuntimeIds } from './tool-utils';

const TEXT_TYPES = new Set(['txt', 'md', 'py', 'tex', 'csv', 'log'] as const);
export type TextFileType = (typeof TEXT_TYPES extends Set<infer T> ? T : never) & string;

export function normalizeVfsPath(raw: string): string {
  const p0 = String(raw ?? '').trim();
  if (!p0) throw new Error('path is required');

  // Normalize Windows separators and collapse multiple slashes
  let p = p0.replace(/\\/g, '/').replace(/\/+/g, '/');
  while (p.startsWith('/')) p = p.slice(1);

  // Very conservative: disallow traversal, drive letters, nulls, and colon.
  if (p.includes('\0')) throw new Error('Invalid path');
  if (p.includes('..')) throw new Error('Invalid path');
  if (/^[a-zA-Z]:/.test(p)) throw new Error('Invalid path');
  if (p.includes(':')) throw new Error('Invalid path');

  if (p.length > 500) throw new Error('Path too long');
  return p;
}

export function inferTextTypeFromPath(path: string): 'txt' | 'md' | 'py' | 'tex' | 'csv' | 'log' {
  const lower = path.toLowerCase();
  if (lower.endsWith('.md')) return 'md';
  if (lower.endsWith('.py')) return 'py';
  if (lower.endsWith('.tex')) return 'tex';
  if (lower.endsWith('.csv')) return 'csv';
  if (lower.endsWith('.log')) return 'log';
  // Treat .json as text in DB (matches your existing convention for Design/dataset.json)
  if (lower.endsWith('.json')) return 'txt';
  return 'txt';
}

export async function readTextFileByPath(opts: { path: string }, toolContext?: any) {
  const { userId, projectId } = getRuntimeIds(toolContext);
  const owned = await getOwnedProject(projectId, userId);
  if (!owned) throw new Error('Project not found');

  const rows = await db
    .select()
    .from(files)
    .where(and(eq(files.projectId, projectId), eq(files.path, opts.path)));

  const row = rows[0];
  if (!row) return { found: false as const };

  // Enforce text-only behavior
  if (!TEXT_TYPES.has(row.type as any)) {
    throw new Error(`File '${opts.path}' is not a supported text file`);
  }
  if (row.storageKey) {
    throw new Error(`File '${opts.path}' is stored in object storage and cannot be read as text`);
  }

  return {
    found: true as const,
    type: row.type as any,
    content: String(row.content ?? ''),
  };
}

export async function upsertTextFileByPath(
  opts: { path: string; type: 'txt' | 'md' | 'py' | 'tex' | 'csv' | 'log'; content: string },
  toolContext?: any,
) {
  const { userId, projectId } = getRuntimeIds(toolContext);
  const owned = await getOwnedProject(projectId, userId);
  if (!owned) throw new Error('Project not found');

  if (!TEXT_TYPES.has(opts.type as any)) throw new Error('Unsupported file type');

  const existing = await db
    .select()
    .from(files)
    .where(and(eq(files.projectId, projectId), eq(files.path, opts.path)));

  if (existing[0]) {
    await db.update(files).set({ content: opts.content, type: opts.type, origin: 'agent' }).where(eq(files.id, existing[0].id));
    return { created: false as const };
  }

  // Let DB/defaults generate the UUID
  await db.insert(files).values({
    projectId,
    path: opts.path,
    type: opts.type as any,
    content: opts.content,
    origin: 'agent',
  });
  return { created: true as const };
}


