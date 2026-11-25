// Share links: a session stored in the club's Google Drive that anyone with the link can
// download into the app (see docs/google-drive-setup.md).
//
// In Drive, a shared session is a folder holding each clip as its own file plus a
// session.json (SharedManifest) listing the slides and their clips' Drive file ids. The link
// is the app's address with #/s/<session.json's file id>. Opening it needs no sign-in: the
// app downloads with an API key that only works from the app's own addresses.
import { readClipFormat, type ClipFormat } from './codec';
import * as db from './db';
import { sanitizeShapes } from './draw';
import { deleteVideo, getVideo, requestPersistence, storeVideoStream } from './files';
import { probeClip } from './media';
import { getSlides, listSessions } from './store';
import { GOOGLE_API_KEY } from './share-config';
import type { Session, SharedManifest, Slide, VideoRef } from './types';
import { uid } from './util';

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
  /** Bytes downloaded so far, across all clips. */
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
