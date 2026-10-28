// Video file storage. Prefers the Origin Private File System (fast, streams to
// disk, no size copy into the database). Falls back to IndexedDB blobs where
// OPFS writes aren't available (older browsers, plain-http LAN testing).
import * as db from './db';
import type { VideoRef } from './types';
import { fmtBytes } from './util';

let dirPromise: Promise<FileSystemDirectoryHandle | null> | null = null;

function videosDir(): Promise<FileSystemDirectoryHandle | null> {
  if (!dirPromise) {
    dirPromise = (async () => {
      try {
        if (!navigator.storage?.getDirectory) return null;
        if (typeof FileSystemFileHandle === 'undefined' || !('createWritable' in FileSystemFileHandle.prototype)) return null;
        const root = await navigator.storage.getDirectory();
        return await root.getDirectoryHandle('videos', { create: true });
      } catch {
        return null;
      }
    })();
  }
  return dirPromise;
}

export type Progress = (done: number, total: number) => void;

function counter(total: number, onProgress?: Progress) {
  let done = 0;
  let last = 0;
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, ctrl) {
      done += chunk.byteLength;
      const now = performance.now();
      if (onProgress && (now - last > 100 || done === total)) {
        last = now;
        onProgress(done, total);
      }
      ctrl.enqueue(chunk);
    },
  });
}

/**
 * Set to false when a file-system write didn't keep the clip's bytes even though
 * the browser reported success (seen in WebKit). Later clips then go to IndexedDB.
 */
let fileWritesWork = true;

/** Same size and the same bytes at both ends: catches empty, cut-short and unreadable copies. */
async function sameBytes(stored: Blob, original: Blob): Promise<boolean> {
  if (stored.size !== original.size) return false;
  const n = Math.min(64 * 1024, original.size);
  for (const [from, to] of [[0, n], [original.size - n, original.size]]) {
    const [a, b] = await Promise.all([stored.slice(from, to).arrayBuffer(), original.slice(from, to).arrayBuffer()]);
    const x = new Uint8Array(a), y = new Uint8Array(b);
    if (x.length !== y.length) return false;
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  }
  return true;
}

export async function storeVideo(id: string, blob: Blob, meta: { name: string; type: string }, onProgress?: Progress): Promise<VideoRef> {
  const ref: Omit<VideoRef, 'storage'> = { id, name: meta.name, type: meta.type || blob.type || 'video/mp4', size: blob.size };
  const dir = fileWritesWork ? await videosDir() : null;
  if (dir) {
    const fh = await dir.getFileHandle(id, { create: true });
    const w = await fh.createWritable();
    try {
      await blob.stream().pipeThrough(counter(blob.size, onProgress)).pipeTo(w);
    } catch (e) {
      await dir.removeEntry(id).catch(() => {});
      throw friendlyError(e);
    }
    if (await sameBytes(await fh.getFile(), blob).catch(() => false)) return { ...ref, storage: 'opfs' };
    console.warn('The file system did not keep the clip; using IndexedDB instead.');
    fileWritesWork = false;
    await dir.removeEntry(id).catch(() => {});
  }
  // IndexedDB: the clip is copied in pieces, each its own small in-memory Blob. Storing the
  // picked file (or a slice of an imported session file) directly lets WebKit keep a link to
  // that file instead of a copy, which it can later read back wrongly (seen: a clip imported
  // from a session file reading back as the whole session file).
  const chunks = Math.ceil(blob.size / CHUNK);
  try {
    for (let i = 0; i < chunks; i++) {
      const part = new Blob([await blob.slice(i * CHUNK, (i + 1) * CHUNK).arrayBuffer()]);
      await db.put('blobs', { id: chunkId(id, i), blob: part });
      onProgress?.(Math.min(blob.size, (i + 1) * CHUNK), blob.size);
    }
    await db.put('blobs', { id, chunks, size: blob.size });
  } catch (e) {
    await deleteChunks(id, chunks);
    throw friendlyError(e);
  }
  const back = await getVideo({ ...ref, storage: 'idb' }).catch(() => null);
  if (!back || !(await sameBytes(back, blob).catch(() => false))) {
    await deleteChunks(id, chunks);
    throw new Error(
      `This browser didn't save the clip correctly (kept ${back ? fmtBytes(back.size) : 'nothing'} of ${fmtBytes(blob.size)}). ` +
        'Try again, or add it in another browser.',
    );
  }
  onProgress?.(blob.size, blob.size);
  return { ...ref, storage: 'idb' };
}

const CHUNK = 8 * 1024 * 1024;
const chunkId = (id: string, i: number) => `${id}/${i}`;

/** IndexedDB record: a clip in `chunks` pieces (current), or one `blob` (older versions). */
interface BlobRecord {
  id: string;
  blob?: Blob;
  chunks?: number;
  size?: number;
}

async function deleteChunks(id: string, chunks: number) {
  const del: [db.StoreName, string][] = [['blobs', id]];
  for (let i = 0; i < chunks; i++) del.push(['blobs', chunkId(id, i)]);
  await db.write({ del }).catch(() => {});
}

const incomplete = (kept: number, ref: VideoRef) =>
  new Error(`The saved copy of this clip is incomplete (${fmtBytes(kept)} of ${fmtBytes(ref.size)}). Delete this slide and add the clip again.`);

export async function getVideo(ref: VideoRef): Promise<Blob> {
  if (ref.storage === 'opfs') {
    const dir = await videosDir();
    if (!dir) throw new Error('Video storage is not available in this browser.');
    const file = await (await dir.getFileHandle(ref.id)).getFile();
    if (ref.size && file.size !== ref.size) throw incomplete(file.size, ref);
    return ref.type && file.type !== ref.type ? new Blob([file], { type: ref.type }) : file;
  }
  const rec = await db.get<BlobRecord>('blobs', ref.id);
  if (!rec) throw new Error('Video file is missing.');
  let blob: Blob;
  if (rec.chunks !== undefined) {
    const parts: Blob[] = [];
    for (let i = 0; i < rec.chunks; i++) {
      const part = await db.get<BlobRecord>('blobs', chunkId(ref.id, i));
      if (!part?.blob) throw incomplete(parts.reduce((n, p) => n + p.size, 0), ref);
      parts.push(part.blob);
    }
    blob = new Blob(parts, { type: ref.type });
  } else blob = rec.blob!;
  if (ref.size && blob.size !== ref.size) throw incomplete(blob.size, ref);
  return blob;
}

export async function deleteVideo(ref: VideoRef): Promise<void> {
  if (ref.storage === 'opfs') {
    const dir = await videosDir();
    await dir?.removeEntry(ref.id).catch(() => {});
  } else {
    const rec = await db.get<BlobRecord>('blobs', ref.id).catch(() => undefined);
    await deleteChunks(ref.id, rec?.chunks ?? 0);
  }
}

function friendlyError(e: unknown): Error {
  // WebKit rejects with a null error when storage is blocked (e.g. some private windows).
  if (e == null) return new Error("This browser wouldn't save the clip and gave no reason. If this is a private window, open the app in a normal one.");
  const err = e instanceof Error ? e : new Error(String(e));
  if (err.name === 'QuotaExceededError' || /quota/i.test(err.message)) {
    return new Error('Not enough storage space on this device for this clip. Free up space or delete an old session.');
  }
  return err;
}

export interface StorageInfo {
  usage: number;
  quota: number;
  persisted: boolean;
  backend: 'opfs' | 'idb';
}

export async function storageInfo(): Promise<StorageInfo> {
  const est = (await navigator.storage?.estimate?.().catch(() => undefined)) ?? {};
  const persisted = (await navigator.storage?.persisted?.().catch(() => false)) ?? false;
  return { usage: est.usage ?? NaN, quota: est.quota ?? NaN, persisted, backend: fileWritesWork && (await videosDir()) ? 'opfs' : 'idb' };
}

/** Ask the browser not to evict our data under storage pressure. */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (await navigator.storage?.persisted?.()) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
