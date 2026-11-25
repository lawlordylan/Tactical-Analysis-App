// A stand-in for Google sign-in and Google Drive, so the sharing tests never touch the real
// Drive. One FakeDrive can serve several pages (the coach's and other devices'), like the real
// one. It does what the app relies on: folders, "anyone with the link" sharing (inherited by a
// folder's files), resumable uploads with Drive's 308 replies, media updates, deletes and
// downloads with an API key.
import type { Page, Route } from '@playwright/test';

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  data: Buffer;
  anyone: boolean;
}

interface Upload {
  meta: { name: string; parents: string[]; mimeType?: string };
  size: number;
  data: Buffer;
}

const FOLDER = 'application/vnd.google-apps.folder';

export class FakeDrive {
  files = new Map<string, DriveFile>();
  private uploads = new Map<string, Upload>();
  private next = 1;
  /** Requests the app made, as "METHOD path", for checking what it did. */
  log: string[] = [];
  /** Fail the next N upload pieces with a dropped connection. */
  dropPieces = 0;
  /** Fail the next N upload pieces with a 503. */
  failPieces = 0;
  /** Answer new uploads with "storage quota exceeded" while true. */
  full = false;
  /** Sign-ins so far. (A page sets window.__cancelSignIn to have its next one closed instead.) */
  signIns = 0;

  /** Files and folders named `name` (any kind). */
  named(name: string) {
    return [...this.files.values()].filter((f) => f.name === name);
  }

  children(folderId: string) {
    return [...this.files.values()].filter((f) => f.parents.includes(folderId));
  }

  private visible(f: DriveFile): boolean {
    return f.anyone || f.parents.some((p) => {
      const parent = this.files.get(p);
      return !!parent && this.visible(parent);
    });
  }

  /** Deletes a file, or a folder and everything in it (as if done in Drive itself). */
  delete(id: string) {
    for (const c of this.children(id)) this.delete(c.id);
    this.files.delete(id);
  }

  private add(meta: Upload['meta'], data: Buffer): DriveFile {
    const f: DriveFile = { id: `f${this.next++}`, name: meta.name, mimeType: meta.mimeType ?? 'application/octet-stream', parents: meta.parents ?? [], data, anyone: false };
    this.files.set(f.id, f);
    return f;
  }

  /** Points a page's Google sign-in and Drive requests at this fake. */
  async attach(page: Page) {
    await page.exposeFunction('__fakeSignIn', () => ++this.signIns);
    await page.route('https://accounts.google.com/gsi/client', (route) =>
      route.fulfill({
        contentType: 'text/javascript',
        body: `window.google = { accounts: { oauth2: { initTokenClient: (c) => ({ requestAccessToken: () => setTimeout(async () => {
          if (window.__cancelSignIn) { window.__cancelSignIn = false; return c.error_callback({ type: 'popup_closed' }); }
          await window.__fakeSignIn();
          c.callback({ access_token: 'test-token', expires_in: 3599 });
        }, 30) }) } } };`,
      }),
    );
    await page.route('https://www.googleapis.com/**', (route) => this.handle(route));
  }

  private async handle(route: Route) {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Expose-Headers': 'Location, Range',
    };
    if (method === 'OPTIONS') {
      return route.fulfill({
        status: 204,
        headers: {
          ...cors,
          'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE',
          'Access-Control-Allow-Headers': (await req.headerValue('access-control-request-headers')) ?? '*',
        },
      });
    }
    const reply = (status: number, body?: unknown, headers: Record<string, string> = {}) =>
      route.fulfill({ status, headers: { ...cors, ...headers }, contentType: 'application/json', body: body === undefined ? '' : JSON.stringify(body) });
    const notFound = () => reply(404, { error: { code: 404, message: 'File not found' } });
    const path = url.pathname;
    this.log.push(`${method} ${path}${url.searchParams.has('uploadType') ? `?uploadType=${url.searchParams.get('uploadType')}` : ''}`);

    // Signed-in calls must carry the token; downloads use the API key instead.
    const auth = await req.headerValue('authorization');
    const signedIn = auth === 'Bearer test-token';

    // ---- uploads ----
    if (path.startsWith('/upload/drive/v3/files')) {
      if (!signedIn && !url.searchParams.has('upload_id')) return reply(401, { error: { code: 401, message: 'Login Required' } });
      const uploadId = url.searchParams.get('upload_id');
      if (method === 'POST' && url.searchParams.get('uploadType') === 'resumable') {
        if (this.full) return reply(403, { error: { code: 403, message: 'The user\'s Drive storage quota has been exceeded.', errors: [{ reason: 'storageQuotaExceeded' }] } });
        const meta = JSON.parse(req.postData() ?? '{}') as Upload['meta'];
        if (meta.parents?.some((p) => !this.files.has(p))) return notFound();
        const id = `u${this.next++}`;
        this.uploads.set(id, { meta, size: Number(await req.headerValue('x-upload-content-length')), data: Buffer.alloc(0) });
        return reply(200, undefined, { Location: `https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=${id}` });
      }
      if (method === 'PUT' && uploadId) {
        const up = this.uploads.get(uploadId);
        if (!up) return notFound();
        const range = (await req.headerValue('content-range')) ?? '';
        const status = () => (up.data.length ? { Range: `bytes=0-${up.data.length - 1}` } : ({} as Record<string, string>));
        if (!range.startsWith('bytes */')) {
          if (this.dropPieces > 0) {
            this.dropPieces--;
            return route.abort('failed');
          }
          if (this.failPieces > 0) {
            this.failPieces--;
            return reply(503, { error: { code: 503, message: 'Backend Error' } });
          }
          const [, from] = range.match(/bytes (\d+)-/) ?? [];
          if (Number(from) !== up.data.length) return reply(400, { error: { code: 400, message: `piece starts at ${from}, have ${up.data.length}` } });
          up.data = Buffer.concat([up.data, req.postDataBuffer() ?? Buffer.alloc(0)]);
        }
        if (up.data.length < up.size) return reply(308, undefined, status());
        this.uploads.delete(uploadId);
        const f = this.add(up.meta, up.data);
        return reply(200, { id: f.id });
      }
      const fileId = path.split('/')[5];
      if (method === 'PATCH' && fileId) {
        const f = this.files.get(fileId);
        if (!f) return notFound();
        f.data = req.postDataBuffer() ?? Buffer.alloc(0);
        return reply(200, { id: f.id });
      }
      return reply(400, { error: { code: 400, message: `unexpected ${method} ${path}` } });
    }

    // ---- metadata, permissions, deletes and downloads ----
    const [fileId, sub] = path.slice('/drive/v3/files'.length).split('/').filter(Boolean);
    if (method === 'GET' && fileId && url.searchParams.get('alt') === 'media') {
      const f = this.files.get(fileId);
      if (!f || !url.searchParams.get('key') || !this.visible(f)) return notFound();
      return route.fulfill({ status: 200, headers: cors, contentType: f.mimeType, body: f.data });
    }
    if (!signedIn) return reply(401, { error: { code: 401, message: 'Login Required' } });
    if (method === 'GET' && !fileId) {
      const q = url.searchParams.get('q') ?? '';
      const name = q.match(/name = '((?:[^'\\]|\\.)*)'/)?.[1]?.replace(/\\(.)/g, '$1');
      const parent = q.match(/'([^']+)' in parents/)?.[1];
      const found = [...this.files.values()].filter(
        (f) => (!name || f.name === name) && (!q.includes(FOLDER) || f.mimeType === FOLDER) && (!parent || f.parents.includes(parent)),
      );
      return reply(200, { files: found.map((f) => ({ id: f.id })) });
    }
    if (method === 'POST' && !fileId) {
      const meta = JSON.parse(req.postData() ?? '{}') as Upload['meta'];
      return reply(200, { id: this.add(meta, Buffer.alloc(0)).id });
    }
    if (method === 'POST' && fileId && sub === 'permissions') {
      const f = this.files.get(fileId);
      if (!f) return notFound();
      f.anyone = true;
      return reply(200, { id: 'anyoneWithLink' });
    }
    if (method === 'DELETE' && fileId) {
      if (!this.files.has(fileId)) return notFound();
      this.delete(fileId);
      return route.fulfill({ status: 204, headers: cors });
    }
    return reply(400, { error: { code: 400, message: `unexpected ${method} ${path}` } });
  }
}
