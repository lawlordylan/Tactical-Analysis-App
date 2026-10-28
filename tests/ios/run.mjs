// Runs the iPhone self-test (tests/ios/selftest.ts) and collects its report and screenshots.
//
//   node tests/ios/run.mjs --driver simulator   iPhone Simulator's Safari (macOS with Xcode; used on GitHub)
//   node tests/ios/run.mjs --driver webkit      Playwright WebKit
//   node tests/ios/run.mjs --driver chrome      installed Google Chrome (plays H.264, unlike Playwright's Chromium)
//   node tests/ios/run.mjs --driver chromium    Playwright Chromium
//
// Default driver: simulator on a Mac, chrome elsewhere. npm run test:selftest builds first.
// Options: --device "iPhone 17" (simulator), --port 4180, --keep (leave the simulator running).
// Needs a production build in dist/ (npm run build). Output: test-results/ios/<driver>/
// (report.json, summary.md, screenshots, and a screen recording for the simulator).
// Exits non-zero if a required check fails.
import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, createReadStream, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import * as esbuild from 'esbuild';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const driver = arg('driver', process.platform === 'darwin' ? 'simulator' : 'chrome');
const port = Number(arg('port', 4180));
const deviceName = arg('device', '');
const keep = process.argv.includes('--keep');
const out = resolve('test-results/ios', driver);
const base = `http://localhost:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

if (!existsSync('dist/index.html')) {
  console.log('No build in dist/: building…');
  execFileSync(process.execPath, ['scripts/build.mjs'], { stdio: 'inherit' });
}

// ---- build the self-test page ----
const pageDir = resolve('dist-selftest');
mkdirSync(pageDir, { recursive: true });
await esbuild.build({ entryPoints: ['tests/ios/selftest.ts'], bundle: true, format: 'esm', target: 'safari15', outfile: join(pageDir, 'selftest.js'), logLevel: 'warning' });
writeFileSync(
  join(pageDir, 'index.html'),
  `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>iPhone self-test</title>
<style>
  body { margin: 0; padding: 16px; font: 13px/1.4 -apple-system, system-ui, sans-serif; background: #08100a; color: #e9f0eb; }
  h1 { font-size: 18px; margin: 0 0 8px; } #status { font-weight: 700; font-size: 22px; margin: 8px 0; }
  .ok { color: #3ccf5e; } .fail { color: #ff6464; } .info { color: #8d9b93; }
  ol { padding-left: 18px; margin: 0; } li { margin: 2px 0; word-break: break-word; }
  #stage video { width: 160px; height: 90px; background: #000; margin: 4px 4px 0 0; }
</style>
<h1>iPhone self-test</h1><div id="status">Running…</div><div id="stage"></div><ol id="log"></ol>
<script type="module" src="selftest.js"></script></html>`,
);

// ---- server: the app from dist/, the self-test page, fixtures, and report endpoints ----
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.map': 'application/json', '.tflite': 'application/octet-stream',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
};
const FIXTURES = new Set(['h264.mp4', 'hevc.mov', 'hevc-hdr.mov', 'counter-press.webm']);
const progress = [];
let gotReport;
const report = new Promise((r) => (gotReport = r));

function sendFile(res, file) {
  try {
    if (statSync(file).isDirectory()) file = join(file, 'index.html');
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Content-Length': statSync(file).size, 'Cache-Control': 'no-store' });
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404).end('Not found');
  }
}

const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, base).pathname);
  if (req.method === 'POST') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      res.writeHead(204).end();
      if (path === '/selftest/log') {
        console.log(`  ${body}`);
        progress.push(body);
      }
      else if (path === '/selftest/report') gotReport(JSON.parse(body));
    });
    return;
  }
  if (path.startsWith('/selftest/fixtures/')) {
    const name = path.slice('/selftest/fixtures/'.length);
    return FIXTURES.has(name) ? sendFile(res, resolve('tests/e2e/fixtures', name)) : res.writeHead(404).end();
  }
  const [root, rel] = path.startsWith('/selftest/') || path === '/selftest' ? [pageDir, path.slice('/selftest'.length)] : [resolve('dist'), path];
  const file = normalize(join(root, rel));
  if (!file.startsWith(root)) return res.writeHead(403).end();
  sendFile(res, file);
});
await new Promise((r) => server.listen(port, r));
console.log(`Self-test server on ${base}`);

const waitForReport = (ms) =>
  Promise.race([report, sleep(ms).then(() => ({ passed: false, timedOut: true, checks: [], crashed: `no report within ${ms / 1000} s` }))]);

// ---- drivers ----
let result;
try {
  result = driver === 'simulator' ? await runSimulator() : await runPlaywright();
} catch (e) {
  // Report the runner's own failure the same way as a failed self-test, so it shows on GitHub.
  result = { passed: false, checks: [], crashed: `Runner failed: ${e?.stack ?? e}` };
}
if (!result.passed && progress.length) result.lastProgress = progress.slice(-20);
server.close();

// ---- summary ----
writeFileSync(join(out, 'report.json'), JSON.stringify(result, null, 2));
const icon = (c) => (c.ok ? '✅' : c.info ? 'ℹ️' : '❌');
const md = [
  `### iPhone self-test (${driver}): ${result.passed ? 'passed' : 'FAILED'}`,
  '',
  `**${result.browser ?? 'unknown browser'}**${result.device ? ` · ${result.device}` : ''}`,
  '',
  ...(result.crashed ? ['```', String(result.crashed), '```', ''] : []),
  ...(result.lastProgress && !result.checks?.length ? ['Last messages from the page:', '```', ...result.lastProgress, '```', ''] : []),
  '| | Check | Details |',
  '| --- | --- | --- |',
  ...(result.checks ?? []).map((c) => `| ${icon(c)} | ${c.name} | ${(c.detail ?? '').replace(/\|/g, '\\|')} |`),
  '',
  'ℹ️ = reported only (HEVC and WebM support varies by device); screenshots are in the test-results artifact.',
  '',
].join('\n');
writeFileSync(join(out, 'summary.md'), md);
console.log(`\n${md}`);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
if (process.env.GITHUB_ACTIONS) {
  // The whole table as a notice too: notices can be read without signing in, unlike the log.
  const enc = (s) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  console.log(`::notice title=iPhone self-test (${driver}) results::${enc(md)}`);
  for (const c of (result.checks ?? []).filter((c) => !c.ok && !c.info)) console.log(`::error title=iPhone self-test (${driver})::${c.name}: ${c.detail ?? ''}`);
  if (result.crashed) console.log(`::error title=iPhone self-test (${driver})::${String(result.crashed).split('\n')[0]}`);
}
process.exit(result.passed ? 0 : 1);

async function runPlaywright() {
  const pw = await import('@playwright/test');
  const browserType = driver === 'webkit' ? pw.webkit : pw.chromium;
  const opts = { viewport: { width: 430, height: 932 }, deviceScaleFactor: 2, ...(driver === 'chrome' ? { channel: 'chrome' } : {}) };
  // A normal (persistent) profile: Playwright's default contexts are like private windows,
  // where WebKit blocks storing clips.
  const profile = join(out, 'profile');
  const ctx = await browserType.launchPersistentContext(profile, opts);
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  page.on('pageerror', (e) => console.log('  page error:', e.message));
  try {
    await page.goto(`${base}/selftest/`);
    const r = await waitForReport(180_000);
    await page.screenshot({ path: join(out, '1-selftest.png'), fullPage: true });
    if (r.sessionId) {
      await page.addInitScript(() => localStorage.setItem('tourSeen', '1'));
      await page.goto(`${base}/?nosw#/session/${r.sessionId}`);
      await sleep(4000);
      await page.screenshot({ path: join(out, '2-editor.png') });
      await page.goto(`${base}/?nosw#/present/${r.sessionId}/1`);
      await sleep(4000);
      await page.screenshot({ path: join(out, '3-present-hevc.png') });
    }
    return r;
  } finally {
    await ctx.close();
  }
}

function simctl(...args) {
  return execFileSync('xcrun', ['simctl', ...args], { encoding: 'utf8' }).trim();
}

async function runSimulator() {
  // Newest iOS runtime, then the requested iPhone (or the first iPhone in it).
  const { devices } = JSON.parse(simctl('list', 'devices', 'available', '--json'));
  const runtimes = Object.keys(devices)
    .filter((k) => /iOS-\d/.test(k) && devices[k].some((d) => d.name.startsWith('iPhone')))
    .sort((a, b) => {
      const v = (k) => k.match(/iOS-([\d-]+)/)[1].split('-').map(Number);
      const [x, y] = [v(a), v(b)];
      return y[0] - x[0] || (y[1] ?? 0) - (x[1] ?? 0);
    });
  if (!runtimes.length) throw new Error('No iOS simulator runtime with an iPhone is installed.');
  const runtime = runtimes[0];
  const phones = devices[runtime].filter((d) => d.name.startsWith('iPhone'));
  const dev = phones.find((d) => d.name === deviceName) ?? phones.find((d) => /^iPhone \d+$/.test(d.name)) ?? phones[0];
  const device = `${dev.name}, ${runtime.replace(/.*SimRuntime\./, '').replace(/-/g, ' ').replace(/ (\d+) (\d+)/, ' $1.$2')}`;
  console.log(`Simulator: ${device} (${dev.udid})`);

  if (dev.state !== 'Booted') simctl('boot', dev.udid);
  simctl('bootstatus', dev.udid, '-b');
  const rec = spawn('xcrun', ['simctl', 'io', dev.udid, 'recordVideo', '--codec=h264', '--force', join(out, 'screen.mp4')], { stdio: 'ignore' });
  const shot = (name) => {
    try {
      simctl('io', dev.udid, 'screenshot', join(out, name));
    } catch (e) {
      console.log(`  screenshot ${name} failed: ${e.message}`);
    }
  };
  try {
    await sleep(2000);
    await openUrl(dev.udid, `${base}/selftest/`);
    const r = await waitForReport(300_000);
    shot('1-selftest.png');
    if (r.sessionId) {
      // The app itself: the editor, then present mode on the HEVC clip.
      await openUrl(dev.udid, `${base}/?nosw#/session/${r.sessionId}`);
      await sleep(8000);
      shot('2-editor.png');
      await openUrl(dev.udid, `${base}/?nosw#/present/${r.sessionId}/1`);
      await sleep(8000);
      shot('3-present-hevc.png');
    }
    return { ...r, device };
  } finally {
    if (rec.exitCode === null) {
      const exited = new Promise((res) => rec.once('exit', res));
      rec.kill('SIGINT');
      await Promise.race([exited, sleep(10_000)]);
    }
    if (!keep) {
      try {
        simctl('shutdown', dev.udid);
      } catch {
        /* already off */
      }
    }
  }
}

/** Opens a URL in the Simulator's Safari, retrying while Safari is still starting up. */
async function openUrl(udid, url) {
  for (let attempt = 1; ; attempt++) {
    try {
      simctl('openurl', udid, url);
      return;
    } catch (e) {
      if (attempt >= 5) throw e;
      console.log(`  openurl failed (attempt ${attempt}), retrying: ${String(e.message).split('\n')[0]}`);
      await sleep(5000);
    }
  }
}
