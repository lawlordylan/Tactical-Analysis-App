// Share links: a session stored in the club's Google Drive that anyone with the link can
// download into the app (see docs/google-drive-setup.md).
//
// In Drive, a shared session is a folder holding each clip as its own file plus a
// session.json (SharedManifest) listing the slides and their clips' Drive file ids. The link
// is the app's address with #/s/<session.json's file id>. Opening it needs no sign-in: the
// app downloads with an API key that only works from the app's own addresses. Sharing signs in
// to Google (drive.ts); the app can only see and change the Drive files it made itself.
import { readClipFormat, type ClipFormat } from './codec';
import * as db from './db';
import { sanitizeShapes } from './draw';
import { createFolder, deleteFile, folderNamed, replaceFile, shareWithAnyone, uploadFile } from './drive';
import { deleteVideo, getVideo, requestPersistence, storeVideoStream } from './files';
import { probeClip } from './media';
import { getSlides, listSessions } from './store';
import { GOOGLE_API_KEY } from './share-config';
import { slideDetails } from './transfer';
import type { Session, SharedInfo, SharedManifest, Slide, VideoRef } from './types';
import { appVersion, uid } from './util';

const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files';

export class ShareError extends Error {
  constructor(
    message: string,
    /** gone: the link no longer works; offline: couldn't reach Drive; other: anything else. */
    readonly kind: 'gone' | 'offline' | 'other',
  ) {
    super(message);
  }
}

/** The app address that opens a shared session. */
export function shareLink(link: string): string {
  return `${location.origin}${location.pathname}#/s/${link}`;
}

/** Downloads a shared file's contents from Drive (no sign-in). */
async function driveFile(id: string, signal?: AbortSignal): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${DRIVE_FILES}/${encodeURIComponent(id)}?alt=media&key=${GOOGLE_API_KEY}`, { cache: 'no-store', signal });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ShareError(
      navigator.onLine === false
        ? "You're offline. Connect to the internet to download this session."
        : "Couldn't reach Google Drive. Check your connection and try again.",
      'offline',
    );
  }
  if (res.status === 404) throw new ShareError("This link doesn't work any more. The session may no longer be shared.", 'gone');
  if (!res.ok) {
    const why = await res.text().then((t) => t.match(/"message":\s*"([^"]+)"/)?.[1] ?? '').catch(() => '');
    throw new ShareError(`Google Drive couldn't send the file (error ${res.status}${why ? `: ${why}` : ''}). Try again later.`, 'other');
  }
  return res;
}

/** Reads the shared session's details (titles, clips, sizes) without downloading the clips. */
export async function fetchSharedManifest(link: string, signal?: AbortSignal): Promise<SharedManifest> {
  const res = await driveFile(link, signal);
  let m: SharedManifest;
  try {
    m = await res.json();
  } catch {
    throw new ShareError("This link doesn't point to a shared session.", 'gone');
  }
  if (m?.format !== 'tactical-analysis-share' || !Array.isArray(m.slides)) throw new ShareError("This link doesn't point to a shared session.", 'gone');
  if (m.version > 1) throw new ShareError('This session was shared from a newer version of the app. Update the app and try again.', 'other');
  return m;
}

export function sharedSize(m: SharedManifest): number {
  return m.slides.reduce((n, s) => n + (s.video?.size ?? 0), 0);
}

/** This device's downloaded copy of a shared session, if it has one. */
export async function findLocalCopy(link: string): Promise<Session | undefined> {
  return (await listSessions()).find((s) => s.shared?.role === 'in' && s.shared.link === link);
}

export interface DownloadProgress {
  /** Bytes downloaded (or uploaded) so far, across all clips. */
  done: number;
  total: number;
  /** 1-based clip number and clip count. */
  clip: number;
  clips: number;
}

/**
 * Downloads a shared session into this device, as a new session, or replacing `replace`
 * (an older downloaded copy, which keeps its place in the session list).
 * Returns the session and any clips this device can't play.
 */
export async function downloadShared(
  link: string,
  manifest: SharedManifest,
  onProgress?: (p: DownloadProgress) => void,
  replace?: Session,
  signal?: AbortSignal,
): Promise<{ session: Session; unplayable: { name: string; format: ClipFormat }[] }> {
  await requestPersistence();
  const total = sharedSize(manifest);
  const clips = manifest.slides.filter((s) => s.video).length;
  const now = Date.now();
  const sessionId = replace?.id ?? uid();
  const slides: Slide[] = [];
  const stored: VideoRef[] = [];
  const unplayable: { name: string; format: ClipFormat }[] = [];
  let before = 0;
  let clip = 0;

  try {
    for (const m of manifest.slides) {
      let video: VideoRef | null = null;
      if (m.video) {
        const v = m.video;
        clip++;
        const base = before;
        video = await storeVideoStream(
          uid(),
          async () => {
            try {
              return (await driveFile(v.id, signal)).body!;
            } catch (e) {
              // The session's link works, so a missing clip is most likely mid-update.
              if (e instanceof ShareError && e.kind === 'gone') {
                throw new ShareError(`The clip “${v.name}” is missing from the shared session. It may be being updated: try again in a moment.`, 'other');
              }
              throw e;
            }
          },
          { name: v.name, type: v.type, size: v.size },
          (d) => onProgress?.({ done: base + d, total, clip, clips }),
        );
        stored.push(video);
        before += v.size;
        onProgress?.({ done: before, total, clip, clips });
        // Same check as adding a clip: say now if this device can't play it.
        const blob = await getVideo(video);
        if ((await probeClip(blob)).failed) unplayable.push({ name: v.name, format: await readClipFormat(blob) });
      }
      slides.push({
        id: uid(),
        sessionId,
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

    const session: Session = {
      id: sessionId,
      title: manifest.session.title || 'Shared session',
      slideIds: slides.map((s) => s.id),
      createdAt: replace?.createdAt ?? now,
      updatedAt: now,
      shared: { link, role: 'in', revision: manifest.revision, sharedAt: manifest.sharedAt },
    };
    const old = replace ? await getSlides(replace) : [];
    await db.write({
      put: [['sessions', session], ...slides.map((s) => ['slides', s] as [db.StoreName, unknown])],
      del: old.map((s) => ['slides', s.id] as [db.StoreName, string]),
    });
    // The old copy's clips go only once the new copy is safely saved.
    for (const s of old) if (s.video) await deleteVideo(s.video);
    return { session, unplayable };
  } catch (e) {
    // Don't leave half a session's clips behind.
    for (const v of stored) await deleteVideo(v);
    throw e;
  }
}

// ---- sharing (the coach's side) ----

/** Every shared session gets its own folder inside this one, in the Drive of whoever signs in. */
const SHARED_FOLDER = 'Killeshin Match Analysis – shared sessions';

/** This session's live share, if this device shares it. (A first share that didn't finish isn't live.) */
export function liveShare(session: Session): SharedInfo | undefined {
  const sh = session.shared;
  return sh?.role === 'out' && sh.revision > 0 && sh.link ? sh : undefined;
}

/** True when the session or any of its slides changed after it was last shared. */
export function changedSinceShared(session: Session, slides: Slide[]): boolean {
  const sh = liveShare(session);
  if (!sh) return false;
  const at = Date.parse(sh.sharedAt);
  return session.updatedAt > at || slides.some((s) => s.updatedAt > at);
}

/** Saves the session's share details without counting as an edit. */
const keep = (session: Session) => db.put('sessions', session);

/**
 * Shares a session, or updates its shared copy (same link, revision + 1). Uploads only clips
 * that aren't in Drive yet, then writes session.json, then removes clips the session no longer
 * has. An interrupted first share carries on in the same folder next time. `session` is
 * updated in place, so a screen holding it keeps the share details when it next saves.
 */
export async function publishSession(
  session: Session,
  token: string,
  onProgress?: (p: DownloadProgress) => void,
  signal?: AbortSignal,
): Promise<SharedInfo> {
  const slides = await getSlides(session);
  const prev = session.shared?.role === 'out' ? session.shared : undefined;
  const files: Record<string, string> = { ...(prev?.files ?? {}) };
  let folder = prev?.folder;
  if (!folder) {
    const parent = await folderNamed(token, SHARED_FOLDER);
    folder = await createFolder(token, `${session.title} · ${new Date().toISOString().slice(0, 10)}`, parent);
    await shareWithAnyone(token, folder);
    session.shared = { link: '', role: 'out', revision: 0, sharedAt: '', folder, files };
    await keep(session);
  }
  const out = session.shared!;

  const toSend = slides.filter((s) => s.video && !files[s.video.id]).map((s) => s.video!);
  const total = toSend.reduce((n, v) => n + v.size, 0);
  let before = 0;
  for (let i = 0; i < toSend.length; i++) {
    const v = toSend[i];
    const base = before;
    const report = (d: number) => onProgress?.({ done: base + d, total, clip: i + 1, clips: toSend.length });
    files[v.id] = await uploadFile(token, await getVideo(v), { name: v.name, type: v.type, parent: folder }, report, signal);
    before += v.size;
    out.files = { ...files };
    await keep(session);
  }

  const revision = (prev?.revision ?? 0) + 1;
  const manifest: SharedManifest = {
    format: 'tactical-analysis-share',
    version: 1,
    revision,
    sharedAt: new Date().toISOString(),
    app: `tactical-analysis-app ${appVersion()}`.trim(),
    session: { title: session.title, createdAt: session.createdAt, updatedAt: session.updatedAt },
    slides: slides.map((s) => ({
      ...slideDetails(s),
      video: s.video ? { id: files[s.video.id], name: s.video.name, type: s.video.type, size: s.video.size } : null,
    })),
  };
  const body = new Blob([JSON.stringify(manifest)], { type: 'application/json' });
  let link = out.link;
  if (link) await replaceFile(token, link, body);
  else link = await uploadFile(token, body, { name: 'session.json', type: 'application/json', parent: folder }, undefined, signal);

  // Clips taken out of the session: only now, so anyone mid-download of the old version can finish.
  const used = new Set(slides.map((s) => s.video?.id));
  for (const [videoId, fileId] of Object.entries(files)) {
    if (used.has(videoId)) continue;
    await deleteFile(token, fileId).catch(() => {});
    delete files[videoId];
  }

  session.shared = { link, role: 'out', revision, sharedAt: manifest.sharedAt, folder, files };
  await keep(session);
  return session.shared;
}

/** Deletes the shared copy from Drive, so the link stops working. Copies people downloaded stay. */
export async function stopSharing(session: Session, token: string): Promise<void> {
  const sh = session.shared;
  if (sh?.role !== 'out') return;
  if (sh.folder) await deleteFile(token, sh.folder);
  delete session.shared;
  await keep(session);
}

/** Forgets a share whose Drive folder has gone (deleted in Drive), so the next share starts afresh. */
export async function forgetShare(session: Session): Promise<void> {
  delete session.shared;
  await keep(session);
}
