// Google Drive for the sharing side: signing in (Google Identity Services, loaded only when
// someone shares) and the signed-in Drive calls: folders, resumable uploads and deletes.
// Opening a link needs none of this (see share.ts).
import { DRIVE_SCOPE, GOOGLE_CLIENT_ID } from './share-config';

const GSI = 'https://accounts.google.com/gsi/client';
const FILES = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const FOLDER = 'application/vnd.google-apps.folder';
/** Upload piece size: a multiple of 256 KB, as Drive requires. */
const PIECE = 8 * 1024 * 1024;

export class DriveError extends Error {
  constructor(
    message: string,
    /** cancelled: the user closed sign-in; offline: couldn't reach Google; missing: the file or folder isn't there. */
    readonly kind: 'cancelled' | 'offline' | 'missing' | 'other' = 'other',
  ) {
    super(message);
  }
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number | string;
  error?: string;
  error_description?: string;
}

interface TokenClient {
  requestAccessToken(overrides?: { prompt?: string }): void;
}

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient(config: {
            client_id: string;
            scope: string;
            callback: (r: TokenResponse) => void;
            error_callback?: (e: { type: string }) => void;
          }): TokenClient;
        };
      };
    };
  }
}

const offline = () =>
  new DriveError(
    navigator.onLine === false ? "You're offline. Connect to the internet to share." : "Couldn't reach Google. Check your connection and try again.",
    'offline',
  );

let gsi: Promise<void> | null = null;

/** Loads Google's sign-in script. Start it before the Share click, so the click can open the pop-up straight away. */
export function loadSignIn(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  gsi ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = GSI;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      gsi = null;
      s.remove();
      reject(offline());
    };
    document.head.append(s);
  });
  return gsi;
}

let token: { value: string; expires: number } | null = null;

/**
 * An access token for the app's own Drive files. Call it straight from a click, before any
 * await: browsers only let a click open Google's sign-in pop-up. Reuses a token that's still valid.
 */
export function signIn(): Promise<string> {
  if (token && token.expires > Date.now() + 60_000) return Promise.resolve(token.value);
  const oauth2 = window.google?.accounts?.oauth2;
  if (!oauth2) return loadSignIn().then(() => Promise.reject(new DriveError("Google sign-in wasn't ready. Press the button again.")));
  return new Promise((resolve, reject) => {
    oauth2
      .initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: DRIVE_SCOPE,
        callback: (r) => {
          if (r.error || !r.access_token) {
            reject(
              new DriveError(
                r.error === 'access_denied'
                  ? "Google Drive access wasn't allowed, so the session can't be shared."
                  : `Google sign-in failed (${r.error_description || r.error || 'no token'}).`,
              ),
            );
            return;
          }
          token = { value: r.access_token, expires: Date.now() + (Number(r.expires_in) || 3600) * 1000 };
          resolve(r.access_token);
        },
        error_callback: (e) =>
          reject(
            e.type === 'popup_failed_to_open'
              ? new DriveError('The Google sign-in window was blocked. Allow pop-ups for this site, then try again.')
              : e.type === 'popup_closed'
                ? new DriveError('Google sign-in was closed before it finished.', 'cancelled')
                : new DriveError(`Google sign-in failed (${e.type}).`),
          ),
      })
      .requestAccessToken();
  });
}

/** Turns a failed Drive response into a message for the coach. */
function failure(status: number, body: string): DriveError {
  const reason = body.match(/"reason":\s*"([^"]+)"/)?.[1] ?? '';
  const message = body.match(/"message":\s*"([^"]+)"/)?.[1] ?? '';
  if (status === 401) {
    token = null;
    return new DriveError('Your Google sign-in has expired. Try again to sign in again.');
  }
  if (status === 404) return new DriveError('The shared copy is no longer in Google Drive.', 'missing');
  if (reason === 'storageQuotaExceeded') return new DriveError("The Google Drive is full. Stop sharing some old sessions or free up space in Drive, then try again.");
  return new DriveError(`Google Drive said no (error ${status}${message ? `: ${message}` : ''}). Try again later.`);
}

async function call(token: string, url: string, init: RequestInit = {}): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers as Record<string, string>) } });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw offline();
  }
  if (!res.ok) throw failure(res.status, await res.text().catch(() => ''));
  return res;
}

const json = { 'Content-Type': 'application/json; charset=UTF-8' };

/** The id of a folder the app made earlier with this name (under `parent`), or a new one. */
export async function folderNamed(token: string, name: string, parent?: string): Promise<string> {
  const q = [`name = '${name.replace(/['\\]/g, '\\$&')}'`, `mimeType = '${FOLDER}'`, 'trashed = false', parent ? `'${parent}' in parents` : null]
    .filter(Boolean)
    .join(' and ');
  const found = (await (await call(token, `${FILES}?q=${encodeURIComponent(q)}&fields=files(id)&spaces=drive`)).json()) as { files?: { id: string }[] };
  return found.files?.[0]?.id ?? createFolder(token, name, parent);
}

export async function createFolder(token: string, name: string, parent?: string): Promise<string> {
  const res = await call(token, `${FILES}?fields=id`, {
    method: 'POST',
    headers: json,
    body: JSON.stringify({ name, mimeType: FOLDER, ...(parent ? { parents: [parent] } : {}) }),
  });
  return ((await res.json()) as { id: string }).id;
}

/** Anyone with the link can view the file or folder (and, for a folder, everything in it). */
export async function shareWithAnyone(token: string, id: string): Promise<void> {
  await call(token, `${FILES}/${encodeURIComponent(id)}/permissions?fields=id`, {
    method: 'POST',
    headers: json,
    body: JSON.stringify({ role: 'reader', type: 'anyone' }),
  });
}

/** Deletes a file, or a folder and everything in it. Already gone counts as done. */
export async function deleteFile(token: string, id: string): Promise<void> {
  try {
    await call(token, `${FILES}/${encodeURIComponent(id)}`, { method: 'DELETE' });
  } catch (e) {
    if (!(e instanceof DriveError && e.kind === 'missing')) throw e;
  }
}

/** Replaces a small file's contents (the shared session.json), keeping its id. */
export async function replaceFile(token: string, id: string, data: Blob): Promise<void> {
  await call(token, `${UPLOAD}/${encodeURIComponent(id)}?uploadType=media&fields=id`, {
    method: 'PATCH',
    headers: { 'Content-Type': data.type || 'application/octet-stream' },
    body: data,
  });
}

interface PieceResult {
  status: number;
  text: string;
  range: string | null;
}

/** One PUT to a resumable upload. XHR rather than fetch, for upload progress. */
function put(url: string, body: Blob | null, range: string, onSent?: (bytes: number) => void, signal?: AbortSignal): Promise<PieceResult> {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('PUT', url);
    x.setRequestHeader('Content-Range', range);
    if (onSent) x.upload.onprogress = (e) => onSent(e.loaded);
    x.onload = () => resolve({ status: x.status, text: x.responseText, range: x.getResponseHeader('Range') });
    x.onerror = x.ontimeout = () => reject(new Error('network'));
    x.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'));
    signal?.addEventListener('abort', () => x.abort(), { once: true });
    x.send(body);
  });
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => (clearTimeout(t), reject(new DOMException('Upload cancelled', 'AbortError'))), { once: true });
  });
}

/**
 * Uploads a file into a Drive folder in 8 MB pieces. A dropped connection or a Google hiccup
 * doesn't restart it: the upload asks Drive how much arrived and carries on from there.
 * Returns the new file's id.
 */
export async function uploadFile(
  token: string,
  blob: Blob,
  meta: { name: string; type: string; parent: string },
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<string> {
  const size = blob.size;
  const type = meta.type || blob.type || 'application/octet-stream';
  const start = await call(token, `${UPLOAD}?uploadType=resumable&fields=id`, {
    method: 'POST',
    headers: { ...json, 'X-Upload-Content-Type': type, 'X-Upload-Content-Length': String(size) },
    body: JSON.stringify({ name: meta.name, parents: [meta.parent], mimeType: type }),
    signal,
  });
  const url = start.headers.get('Location');
  if (!url) throw new DriveError("Google Drive didn't start the upload. Try again.");

  let offset = 0;
  let failures = 0;
  let askWhere = false; // after a failure: ask Drive how much it has before sending more
  for (;;) {
    if (signal?.aborted) throw new DOMException('Upload cancelled', 'AbortError');
    const end = Math.min(size, offset + PIECE);
    let res: PieceResult;
    try {
      res = askWhere
        ? await put(url, null, `bytes */${size}`, undefined, signal)
        : await put(url, blob.slice(offset, end), size ? `bytes ${offset}-${end - 1}/${size}` : 'bytes */0', (n) => onProgress?.(offset + n, size), signal);
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      res = { status: 0, text: '', range: null };
    }
    if (res.status === 200 || res.status === 201) {
      onProgress?.(size, size);
      return (JSON.parse(res.text) as { id: string }).id;
    }
    if (res.status === 308) {
      // Range is what Drive has ("bytes=0-1234"). Without it after a whole piece, the piece arrived.
      const next = res.range ? Number(res.range.split('-')[1]) + 1 : askWhere ? offset : end;
      if (next > offset) failures = 0;
      offset = next;
      askWhere = false;
      onProgress?.(offset, size);
      continue;
    }
    if (res.status === 0 || res.status === 429 || res.status >= 500) {
      if (++failures > 6) throw res.status ? failure(res.status, res.text) : offline();
      await wait(Math.min(30_000, 500 * 2 ** failures), signal);
      askWhere = true;
      continue;
    }
    if (res.status === 404 || res.status === 410) throw new DriveError('The upload was interrupted for too long. Try again.');
    throw failure(res.status, res.text);
  }
}
