// Video file storage. Prefers the Origin Private File System (fast, streams to
// disk, no size copy into the database). Falls back to IndexedDB blobs where
// OPFS writes aren't available (older browsers, plain-http LAN testing).
import * as db from './db';
import type { VideoRef } from './types';

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

export async function storeVideo(id: string, blob: Blob, meta: { name: string; type: string }, onProgress?: Progress): Promise<VideoRef> {
  const ref: Omit<VideoRef, 'storage'> = { id, name: meta.name, type: meta.type || blob.type || 'video/mp4', size: blob.size };
  const dir = await videosDir();
  if (dir) {
    const fh = await dir.getFileHandle(id, { create: true });
    const w = await fh.createWritable();
    try {
      await blob.stream().pipeThrough(counter(blob.size, onProgress)).pipeTo(w);
    } catch (e) {
      await dir.removeEntry(id).catch(() => {});
      throw friendlyError(e);
    }
    return { ...ref, storage: 'opfs' };
  }
  try {
    await db.put('blobs', { id, blob });
  } catch (e) {
    throw friendlyError(e);
  }
  onProgress?.(blob.size, blob.size);
  return { ...ref, storage: 'idb' };
}

export async function getVideo(ref: VideoRef): Promise<Blob> {
  if (ref.storage === 'opfs') {
    const dir = await videosDir();
    if (!dir) throw new Error('Video storage is not available in this browser.');
    const file = await (await dir.getFileHandle(ref.id)).getFile();
    return ref.type && file.type !== ref.type ? new Blob([file], { type: ref.type }) : file;
  }
  const rec = await db.get<{ id: string; blob: Blob }>('blobs', ref.id);
  if (!rec) throw new Error('Video file is missing.');
  return rec.blob;
}

export async function deleteVideo(ref: VideoRef): Promise<void> {
  if (ref.storage === 'opfs') {
    const dir = await videosDir();
    await dir?.removeEntry(ref.id).catch(() => {});
  } else {
    await db.del('blobs', ref.id).catch(() => {});
  }
}

function friendlyError(e: unknown): Error {
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
  return { usage: est.usage ?? NaN, quota: est.quota ?? NaN, persisted, backend: (await videosDir()) ? 'opfs' : 'idb' };
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
