// iPhone self-test: runs the app's own clip code (save, read back, play, export and
// import, reload) in whatever browser opens this page, and posts a report back to
// the test server. Built and served by tests/ios/run.mjs, which opens it in the
// iPhone Simulator's Safari (or Playwright WebKit/Chromium) — no taps needed.
import { describeFormat, readClipFormat } from '../../src/lib/codec';
import { getVideo, storageInfo } from '../../src/lib/files';
import { browserLabel } from '../../src/lib/media';
import { addClips, createSession, getSession, getSlides } from '../../src/lib/store';
import { exportSession, importSession } from '../../src/lib/transfer';

interface Clip {
  name: string;
  type: string;
  /** Must play for the test to pass (H.264 plays everywhere the app supports). */
  required: boolean;
}
const CLIPS: Clip[] = [
  { name: 'h264.mp4', type: 'video/mp4', required: true },
  { name: 'hevc.mov', type: 'video/quicktime', required: false },
  { name: 'hevc-hdr.mov', type: 'video/quicktime', required: false },
  { name: 'counter-press.webm', type: 'video/webm', required: false },
];

interface Check {
  name: string;
  ok: boolean;
  /** Informational checks are reported but don't fail the run. */
  info?: boolean;
  detail?: string;
}

const params = new URLSearchParams(location.search);
const phase = params.get('phase') === '2' ? 2 : 1;
const listEl = document.getElementById('log')!;
const statusEl = document.getElementById('status')!;
const stage = document.getElementById('stage')!;

function log(text: string, cls = '') {
  const li = document.createElement('li');
  li.textContent = text;
  if (cls) li.className = cls;
  listEl.append(li);
  li.scrollIntoView({ block: 'end' });
  fetch('/selftest/log', { method: 'POST', body: `[phase ${phase}] ${text}` }).catch(() => {});
}

const checks: Check[] = phase === 2 ? JSON.parse(sessionStorage.getItem('selftest-checks') || '[]') : [];
function check(name: string, ok: boolean, detail = '', info = false) {
  checks.push({ name, ok, detail, info });
  log(`${ok ? '✓' : info ? '–' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`, ok ? 'ok' : info ? 'info' : 'fail');
}

const withTimeout = <T>(p: Promise<T>, ms: number, what: string) =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`${what} timed out after ${ms / 1000} s`)), ms))]);

async function fixture(c: Clip): Promise<File> {
  const r = await fetch(`/selftest/fixtures/${c.name}`);
  if (!r.ok) throw new Error(`fixture ${c.name}: HTTP ${r.status}`);
  return new File([await r.blob()], c.name, { type: c.type });
}

async function sameBytes(a: Blob, b: Blob): Promise<boolean> {
  if (a.size !== b.size) return false;
  const [x, y] = await Promise.all([a.arrayBuffer(), b.arrayBuffer()]).then(([p, q]) => [new Uint8Array(p), new Uint8Array(q)]);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}

async function firstDifference(a: Blob, b: Blob): Promise<string> {
  const [x, y] = [new Uint8Array(await a.arrayBuffer()), new Uint8Array(await b.arrayBuffer())];
  let i = 0;
  while (i < x.length && i < y.length && x[i] === y[i]) i++;
  return `${x.length} vs ${y.length} bytes, first difference at byte ${i}`;
}

const once = (el: EventTarget, events: string[]) =>
  new Promise<string>((res) => {
    const fn = (e: Event) => {
      events.forEach((n) => el.removeEventListener(n, fn));
      res(e.type);
    };
    events.forEach((n) => el.addEventListener(n, fn));
  });

/** Loads a clip like the app does (object URL), plays a moment, seeks and checks a frame was drawn. */
async function playTest(blob: Blob, label: string): Promise<{ ok: boolean; detail: string }> {
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.preload = 'auto';
  v.title = label;
  stage.append(v);
  const url = URL.createObjectURL(blob);
  try {
    const loaded = once(v, ['loadeddata', 'error']);
    v.src = url;
    const ev = await withTimeout(loaded, 15_000, 'loading').catch((e) => (e as Error).message);
    if (ev !== 'loadeddata') {
      const err = v.error;
      return { ok: false, detail: err ? `error ${err.code}${err.message ? `: ${err.message}` : ''}` : String(ev) };
    }
    let played = 'played';
    try {
      await withTimeout(v.play(), 5_000, 'play()');
      await withTimeout(new Promise<void>((res) => { const t = () => v.currentTime > 0.2 && (v.removeEventListener('timeupdate', t), res()); v.addEventListener('timeupdate', t); }), 5_000, 'playback');
      v.pause();
    } catch (e) {
      played = `didn't play (${(e as Error).message})`;
    }
    const seeked = once(v, ['seeked']);
    v.currentTime = 1;
    await withTimeout(seeked, 5_000, 'seeking').catch(() => {});
    const c = document.createElement('canvas');
    c.width = 32;
    c.height = 18;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(v, 0, 0, c.width, c.height);
    const px = ctx.getImageData(0, 0, c.width, c.height).data;
    // The test pattern is colourful: a decoded frame has plenty of different values.
    const values = new Set<number>();
    for (let i = 0; i < px.length; i += 4) values.add((px[i] >> 4) * 256 + (px[i + 1] >> 4) * 16 + (px[i + 2] >> 4));
    const drew = values.size > 20;
    return {
      ok: drew,
      detail: `${v.videoWidth}×${v.videoHeight}, ${v.duration.toFixed(1)} s, ${played}, ${drew ? 'frame drawn' : `blank frame (${values.size} colours)`}`,
    };
  } finally {
    v.removeAttribute('src');
    v.load();
    v.remove();
    URL.revokeObjectURL(url);
  }
}

async function phase1() {
  const info = await storageInfo();
  log(`Browser: ${browserLabel()}`);
  log(`User agent: ${navigator.userAgent}`);
  log(`Storage: ${info.backend === 'opfs' ? 'file system (OPFS)' : 'IndexedDB'}, persisted ${info.persisted}, quota ${Math.round(info.quota / 1e6)} MB`);
  const v = document.createElement('video');
  for (const t of ['video/mp4; codecs="avc1.640028"', 'video/mp4; codecs="hvc1.1.6.L93.B0"', 'video/mp4; codecs="hvc1.2.4.L93.B0"', 'video/quicktime', 'video/webm; codecs="vp9"']) {
    log(`canPlayType(${t}) = "${v.canPlayType(t)}"`);
  }

  const session = await createSession('iPhone self-test');
  sessionStorage.setItem('selftest-session', session.id);
  for (const c of CLIPS) {
    const file = await fixture(c);
    const t0 = performance.now();
    let slideOk = false;
    try {
      const { slides, unplayable } = await addClips(session, [file]);
      const s = slides[0];
      check(`add ${c.name}`, !!s?.video, `${Math.round(performance.now() - t0)} ms, stored in ${s?.video?.storage}, duration ${s?.duration ? `${s.duration.toFixed(1)} s` : 'unknown'}, thumbnail ${s?.thumb ? 'yes' : 'no'}${unplayable.length ? ', warned "won\'t play here"' : ''}`);
      const stored = await getVideo(s.video!);
      check(`saved copy of ${c.name} matches`, await sameBytes(stored, file), `${stored.size} of ${file.size} bytes`);
      check(`format of ${c.name}`, true, describeFormat(await readClipFormat(stored)), true);
      const p = await playTest(stored, c.name);
      check(`play ${c.name}`, p.ok, p.detail, !c.required);
      slideOk = true;
    } catch (e) {
      if (!slideOk) check(c.name, false, (e as Error).message);
    }
  }

  // Export (the no-save-dialog path every phone uses) and import back.
  try {
    (window as { showSaveFilePicker?: unknown }).showSaveFilePicker = undefined;
    const fresh = (await getSession(session.id))!;
    const res = await withTimeout(exportSession(fresh), 60_000, 'export');
    check('export session', !!res.file, `${res.file?.size} bytes`);
    const copy = await withTimeout(importSession(res.file!), 60_000, 'import');
    const [a, b] = [await getSlides(fresh), await getSlides(copy)];
    const problems: string[] = [];
    for (let i = 0; i < a.length; i++) {
      const [x, y] = [await getVideo(a[i].video!), b[i]?.video ? await getVideo(b[i].video!) : null];
      if (!y) problems.push(`${a[i].video?.name} missing`);
      else if (!(await sameBytes(x, y))) problems.push(`${a[i].video?.name}: ${await firstDifference(x, y)}`);
    }
    check('import the exported session', a.length === b.length && !problems.length, `${b.length} of ${a.length} clips${problems.length ? `; ${problems.join('; ')}` : ', bytes match'}`);
  } catch (e) {
    check('export and import', false, (e as Error).message);
  }

  sessionStorage.setItem('selftest-checks', JSON.stringify(checks));
  log('Reloading to check the clips are still there…');
  setTimeout(() => location.replace(`${location.pathname}?phase=2`), 300);
}

async function phase2() {
  const id = sessionStorage.getItem('selftest-session');
  const session = id ? await getSession(id) : undefined;
  check('session still there after reload', !!session);
  if (session) {
    for (const s of await getSlides(session)) {
      const c = CLIPS.find((x) => x.name === s.video?.name);
      if (!c || !s.video) continue;
      try {
        const stored = await getVideo(s.video);
        check(`after reload: ${c.name} matches`, await sameBytes(stored, await fixture(c)), `${stored.size} bytes`);
        const p = await playTest(stored, c.name);
        check(`after reload: play ${c.name}`, p.ok, p.detail, !c.required);
      } catch (e) {
        check(`after reload: ${c.name}`, false, (e as Error).message);
      }
    }
  }
  const failed = checks.filter((c) => !c.ok && !c.info);
  statusEl.textContent = failed.length ? `FAILED: ${failed.length} check${failed.length > 1 ? 's' : ''}` : 'PASSED';
  statusEl.className = failed.length ? 'fail' : 'ok';
  await fetch('/selftest/report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ browser: browserLabel(), userAgent: navigator.userAgent, sessionId: id, passed: !failed.length, checks }),
  });
  sessionStorage.removeItem('selftest-checks');
}

window.addEventListener('error', (e) => log(`Page error: ${e.message}`, 'fail'));
window.addEventListener('unhandledrejection', (e) => log(`Unhandled: ${(e.reason as Error)?.message ?? e.reason}`, 'fail'));
(phase === 1 ? phase1() : phase2()).catch(async (e) => {
  log(`Self-test crashed: ${(e as Error).message}`, 'fail');
  statusEl.textContent = 'CRASHED';
  statusEl.className = 'fail';
  await fetch('/selftest/report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ browser: browserLabel(), userAgent: navigator.userAgent, passed: false, crashed: String((e as Error)?.stack ?? e), checks }),
  }).catch(() => {});
});
