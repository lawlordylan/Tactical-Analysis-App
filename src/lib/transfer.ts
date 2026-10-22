// Export a session to a single .analysis file (a ZIP with session.json + clips)
// and import one back.
import * as db from './db';
import { sanitizeShapes } from './draw';
import { deleteVideo, getVideo, requestPersistence, storeVideo } from './files';
import { getSlides, listSessions } from './store';
import type { Session, SessionManifest, Slide, VideoRef } from './types';
import { slug, uid } from './util';
import { readZip, zipStream, type ZipInput } from './zip';

export const FILE_EXT = '.analysis';

export interface ExportResult {
  file?: File;
  /** True when the file was already written to disk via the save dialog. */
  saved: boolean;
}

declare global {
  interface Window {
    showSaveFilePicker?: (opts: {
      suggestedName?: string;
      types?: { description: string; accept: Record<string, string[]> }[];
    }) => Promise<FileSystemFileHandle>;
  }
}

function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(-120) || 'clip';
}

async function buildEntries(session: Session): Promise<ZipInput[]> {
  const slides = await getSlides(session);
  const manifest: SessionManifest = {
    format: 'tactical-analysis-session',
    version: 1,
    exportedAt: new Date().toISOString(),
    app: `tactical-analysis-app ${(window as unknown as { APP_VERSION?: string }).APP_VERSION ?? ''}`.trim(),
    session: { title: session.title, createdAt: session.createdAt, updatedAt: session.updatedAt },
    slides: [],
  };
  const clips: ZipInput[] = [];
  for (let i = 0; i < slides.length; i++) {
    const s = slides[i];
    let video: SessionManifest['slides'][number]['video'] = null;
    if (s.video) {
      const path = `clips/${String(i + 1).padStart(3, '0')}-${safeName(s.video.name)}`;
      clips.push({ name: path, data: await getVideo(s.video) });
      video = { path, name: s.video.name, type: s.video.type, size: s.video.size };
    }
    manifest.slides.push({
      title: s.title,
      notes: s.notes,
      shortcuts: s.shortcuts.map(({ title, time, drawing }) => ({ title, time, ...(drawing?.length ? { drawing } : {}) })),
      duration: s.duration,
      fps: s.fps,
      thumb: s.thumb,
      video,
    });
  }
  const json = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });
  return [{ name: 'session.json', data: json }, ...clips];
}

export async function exportSession(session: Session, onProgress?: (done: number, total: number) => void): Promise<ExportResult> {
  const name = slug(session.title) + FILE_EXT;

  // Desktop Chrome/Edge: stream straight to a file the user picks. Nothing is held in memory.
  // The picker is opened first, while the click's user activation is still fresh.
  if (window.showSaveFilePicker) {
    let handle: FileSystemFileHandle | null = null;
    try {
      handle = await window.showSaveFilePicker({
        suggestedName: name,
        types: [{ description: 'Analysis session', accept: { 'application/zip': [FILE_EXT] } }],
      });
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
    }
    if (handle) {
      const entries = await buildEntries(session);
      await zipStream(entries, onProgress).pipeTo(await handle.createWritable());
      return { saved: true };
    }
  }
  return exportAsFile(await buildEntries(session), name, onProgress);
}

async function exportAsFile(entries: ZipInput[], name: string, onProgress?: (d: number, t: number) => void): Promise<ExportResult> {
  // Elsewhere (e.g. Android): build the file as a Blob, which Chrome backs with disk for large sizes.
  const blob = await new Response(zipStream(entries, onProgress)).blob();
  return { file: new File([blob], name, { type: 'application/zip' }), saved: false };
}

export function downloadFile(file: File) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function canShareFile(file: File): boolean {
  try {
    return !!navigator.canShare?.({ files: [file] });
  } catch {
    return false;
  }
}

export async function importSession(file: Blob, onProgress?: (done: number, total: number) => void): Promise<Session> {
  const entries = await readZip(file);
  const metaEntry = entries.get('session.json');
  if (!metaEntry) throw new Error('This file is not a session file (session.json is missing).');
  let manifest: SessionManifest;
  try {
    manifest = JSON.parse(await metaEntry.text());
  } catch {
    throw new Error('The session file is damaged (session.json could not be read).');
  }
  if (manifest.format !== 'tactical-analysis-session') throw new Error('This file is not a Tactical Analysis session.');
  if (manifest.version > 1) throw new Error('This session was made with a newer version of the app. Update the app and try again.');

  await requestPersistence();
  const existing = new Set((await listSessions()).map((s) => s.title));
  let title = manifest.session.title || 'Imported session';
  if (existing.has(title)) {
    let n = 2;
    while (existing.has(`${title} (${n})`)) n++;
    title = `${title} (${n})`;
  }

  const now = Date.now();
  const session: Session = { id: uid(), title, slideIds: [], createdAt: manifest.session.createdAt ?? now, updatedAt: now };
  const slides: Slide[] = [];
  const stored: VideoRef[] = [];
  const total = manifest.slides.reduce((n, s) => n + (s.video?.size ?? 0), 0);
  let before = 0;

  try {
    for (const m of manifest.slides) {
      let video: VideoRef | null = null;
      if (m.video) {
        const entry = entries.get(m.video.path);
        if (!entry) throw new Error(`The session file is missing the clip "${m.video.name}".`);
        const base = before;
        video = await storeVideo(uid(), await entry.blob(), { name: m.video.name, type: m.video.type }, (d) => onProgress?.(base + d, total));
        stored.push(video);
        before += entry.size;
      }
      slides.push({
        id: uid(),
        sessionId: session.id,
        title: m.title ?? '',
        notes: m.notes ?? '',
        video,
        shortcuts: (m.shortcuts ?? []).map((s) => {
          const drawing = sanitizeShapes(s.drawing);
          return { id: uid(), title: s.title ?? '', time: Number(s.time) || 0, ...(drawing.length ? { drawing } : {}) };
        }),
        duration: m.duration,
        fps: m.fps,
        thumb: m.thumb,
        createdAt: now,
        updatedAt: now,
      });
    }
    session.slideIds = slides.map((s) => s.id);
    await db.write({ put: [['sessions', session], ...slides.map((s) => ['slides', s] as [db.StoreName, unknown])] });
  } catch (e) {
    // Don't leave orphaned video files behind from a half-finished import.
    for (const v of stored) await deleteVideo(v);
    throw e;
  }
  return session;
}
