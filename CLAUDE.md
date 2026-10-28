# Killeshin FC · Match Analysis — notes for Claude

Offline-first PWA for preparing and presenting post-match video analysis for Killeshin F.C.
Sessions → slides (one clip each) → shortcuts (named moments) → drawings on shortcuts.
All data stays on the device; sessions move between devices as a `.analysis` file (a ZIP).
See `README.md` for features, keyboard shortcuts and design notes.

## Branches and deploys

- `main` deploys to GitHub Pages on every push (`.github/workflows/deploy.yml`). Treat it as release.
- `develop` is for ongoing work. Merge to `main` when a change is tested and ready to go live.
- `dev-detector-assets` is a throwaway branch made by the "Fetch detector assets (dev)" workflow; nothing depends on it.

## Commands

```bash
npm install
npm run dev        # http://localhost:5173, rebuilds on save into dist-dev/ (prints the phone URL)
npm run build      # production build into dist/
npm run preview    # production build served on http://localhost:4174
npm run typecheck
npm test           # ZIP export-format round trip + clip-format reader tests
npm run test:e2e   # Playwright browser tests in Chromium (first time: npx playwright install chromium)
npm run test:e2e:webkit   # same suite in WebKit (meaningful on a Mac; see below)
npm run test:selftest     # clip save/playback self-test: Chrome locally, iPhone Simulator on a Mac
```

VS Code tasks and launch configs are in `.vscode/` (F5 = dev server + debug in Chrome; see README "In VS Code"). Keep them in step with the npm scripts.

## Stack and conventions

- Plain TypeScript + DOM, no UI framework. `h()` in `src/lib/dom.ts` builds elements; icons are inline SVG in the same file.
- Only runtime dependency: `@mediapipe/tasks-vision` (auto-ring), code-split and loaded on first use. Keep it that way: no new runtime deps without a good reason.
- `package-lock.json` is committed and CI installs with `npm ci`: commit lockfile changes along with any dependency change.
- esbuild via `scripts/build.mjs`, which also writes `index.html` and the service worker precache list (`src/sw.js` template).
- Each screen (`src/views/*.ts`) is a `render…(root, …)` function returning a cleanup function. Hash router in `src/main.ts`.
- Storage: metadata in IndexedDB (`src/lib/db.ts`), video bytes in the Origin Private File System with IndexedDB fallback (`src/lib/files.ts`).
- Drawings (`src/lib/draw.ts`) are stored in coordinates normalised to the video *picture* (not the element), so they line up on any screen. Circle `p` is `[cx, cy, rx, ry]`, plus a 5th value (beam height) for auto-ring floor rings; `g: true` marks auto-rings.
- Auto-ring (`src/lib/detect.ts`): EfficientDet-Lite0 int8 person detector on a zoomed crop around the tap; for players taller than a quarter of the frame, PoseLandmarker lite finds their feet. Both run on CPU (the int8 model doesn't work on MediaPipe's GPU delegate). Models live in `public/detector/`; the WebAssembly runtime is copied from `node_modules` at build time.
- Branding: club green `#016701` and white on a deep green-black base; colours are CSS variables at the top of `src/styles.css`. Crest images in `brand/` and `public/`.
- Target browsers: Chrome/Edge desktop and Chrome on Android. iPhone/iPad Safari is in progress (fullscreen video hides overlays there).
- iPhone/Safari testing without an iPhone: `.github/workflows/safari.yml` runs on `macos-26`: the self-test (`tests/ios/`) in the iPhone Simulator's Safari and in Playwright WebKit, then the e2e suite in WebKit. Read results from the run summary and the `safari-results` artifact. Playwright WebKit on Windows can't play video and its OPFS writes keep 0 bytes, so don't draw Safari conclusions from it.
- Clips: `src/lib/codec.ts` reads container and codec from headers (no decoding). Never trust a storage write: `storeVideo` reads back and compares; the IndexedDB path stores 8 MB in-memory chunks, not the File or slice itself (WebKit bug). A clip that loads with `videoWidth` 0 is "sound only" and counts as unplayable.

## Checking work

- Run `npm run typecheck`, `npm test` and `npm run test:e2e` before merging to `main`. The e2e suite (`tests/e2e/`, see README) covers every feature, layout at 12 screen sizes, touch reordering, offline use and auto-ring accuracy on hand-marked match photos. Add or update a spec when you add or change behaviour.
- If an auto-ring accuracy test fails after changing `src/lib/detect.ts`, treat it as a regression; only adjust thresholds in `tests/e2e/auto-ring.spec.ts` with a clear reason.
- Tests open the app at `/?nosw` to bypass the service worker; only `offline.spec.ts` runs with the service worker.
- `playwright.config.ts` marks the first-visit tour as seen (`localStorage.tourSeen`) so it doesn't cover the app in tests; `tour.spec.ts` clears it. Update the tour (`src/views/tour.ts`) when a main feature changes.
- Test UI changes in a real browser at phone sizes (portrait and landscape) as well as desktop; present mode has had overflow bugs on small landscape phones before.
- Present mode must never overlay the clip: title bar above, transport below, side panel beside (below on portrait phones).
- Commits end with the Co-Authored-By line for Claude.
