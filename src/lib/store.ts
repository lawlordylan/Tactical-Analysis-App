// Session and slide operations on top of IndexedDB + video storage.
import * as db from './db';
import { deleteVideo, requestPersistence, storeVideo, type Progress } from './files';
import { probeClip } from './media';
import type { Session, Slide } from './types';
import { stripExt, uid } from './util';

export async function listSessions(): Promise<Session[]> {
  const all = await db.getAll<Session>('sessions');
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export const getSession = (id: string) => db.get<Session>('sessions', id);
export const getSlide = (id: string) => db.get<Slide>('slides', id);

/** Slides of a session in presentation order. */
export async function getSlides(session: Session): Promise<Slide[]> {
  const all = await db.getAllByIndex<Slide>('slides', 'sessionId', session.id);
  const byId = new Map(all.map((s) => [s.id, s]));
  const ordered = session.slideIds.map((id) => byId.get(id)).filter((s): s is Slide => !!s);
  // Slides not in the order list (shouldn't happen) go at the end rather than vanishing.
  for (const s of all) if (!session.slideIds.includes(s.id)) ordered.push(s);
  return ordered;
}

export async function createSession(title: string): Promise<Session> {
  const now = Date.now();
  const s: Session = { id: uid(), title: title.trim() || 'Untitled session', slideIds: [], createdAt: now, updatedAt: now };
  await db.put('sessions', s);
  return s;
}

export async function saveSession(s: Session): Promise<void> {
  s.updatedAt = Date.now();
  await db.put('sessions', s);
}

export async function saveSlide(slide: Slide, session?: Session): Promise<void> {
  const now = Date.now();
  slide.updatedAt = now;
  const ops: [db.StoreName, unknown][] = [['slides', slide]];
  if (session) {
    session.updatedAt = now;
    ops.push(['sessions', session]);
  }
  await db.write({ put: ops });
}

export async function deleteSession(id: string): Promise<void> {
  const session = await getSession(id);
  if (!session) return;
  const slides = await db.getAllByIndex<Slide>('slides', 'sessionId', id);
  await db.write({ del: [['sessions', id], ...slides.map((s) => ['slides', s.id] as [db.StoreName, string])] });
  for (const s of slides) if (s.video) await deleteVideo(s.video);
}

export async function deleteSlide(session: Session, slideId: string): Promise<void> {
  const slide = await getSlide(slideId);
  session.slideIds = session.slideIds.filter((id) => id !== slideId);
  session.updatedAt = Date.now();
  await db.write({ put: [['sessions', session]], del: [['slides', slideId]] });
  if (slide?.video) await deleteVideo(slide.video);
}

export async function moveSlide(session: Session, slideId: string, delta: number): Promise<void> {
  const i = session.slideIds.indexOf(slideId);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= session.slideIds.length) return;
  const ids = [...session.slideIds];
  [ids[i], ids[j]] = [ids[j], ids[i]];
  session.slideIds = ids;
  await saveSession(session);
}

/** Store each file as a new slide at the end of the session. */
export async function addClips(
  session: Session,
  files: File[],
  onProgress?: (fileIndex: number, done: number, total: number) => void,
): Promise<Slide[]> {
  await requestPersistence();
  const created: Slide[] = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const id = uid();
    const progress: Progress = (d, t) => onProgress?.(i, d, t);
    const video = await storeVideo(id, file, { name: file.name, type: file.type }, progress);
    const info = await probeClip(file);
    const now = Date.now();
    const slide: Slide = {
      id: uid(),
      sessionId: session.id,
      title: stripExt(file.name),
      notes: '',
      video,
      shortcuts: [],
      duration: info.duration || undefined,
      thumb: info.thumb,
      createdAt: now,
      updatedAt: now,
    };
    session.slideIds = [...session.slideIds, slide.id];
    await saveSlide(slide, session);
    created.push(slide);
  }
  return created;
}
