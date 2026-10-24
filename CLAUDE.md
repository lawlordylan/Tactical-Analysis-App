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
npm run dev        # http://localhost:5173, rebuilds on save (open on a phone via http://<lan-ip>:5173)
npm run build      # production build into dist/
npm run typecheck
npm test           # ZIP export-format round-trip tests
npm run test:e2e   # Playwright browser tests (first time: npx playwright install chromium)
```

## Stack and conventions

- Plain TypeScript + DOM, no UI framework. `h()` in `src/lib/dom.ts` builds elements; icons are inline SVG in the same file.
- Only runtime dependency: `@mediapipe/tasks-vision` (auto-ring), code-split and loaded on first use. Keep it that way: no new runtime deps without a good reason.
- esbuild via `scripts/build.mjs`, which also writes `index.html` and the service worker precache list (`src/sw.js` template).
- Each screen (`src/views/*.ts`) is a `render…(root, …)` function returning a cleanup function. Hash router in `src/main.ts`.
- Storage: metadata in IndexedDB (`src/lib/db.ts`), video bytes in the Origin Private File System with IndexedDB fallback (`src/lib/files.ts`).
- Drawings (`src/lib/draw.ts`) are stored in coordinates normalised to the video *picture* (not the element), so they line up on any screen. Circle `p` is `[cx, cy, rx, ry]`, plus a 5th value (beam height) for auto-ring floor rings; `g: true` marks auto-rings.
- Auto-ring (`src/lib/detect.ts`): EfficientDet-Lite0 int8 person detector on a zoomed crop around the tap; for players taller than a quarter of the frame, PoseLandmarker lite finds their feet. Both run on CPU (the int8 model doesn't work on MediaPipe's GPU delegate). Models live in `public/detector/`; the WebAssembly runtime is copied from `node_modules` at build time.
- Branding: club green `#016701` and white on a deep green-black base; colours are CSS variables at the top of `src/styles.css`. Crest images in `brand/` and `public/`.
- Target browsers: Chrome/Edge desktop and Chrome on Android. iPhone/iPad Safari is not supported yet (fullscreen video hides overlays there).

## Checking work

- Run `npm run typecheck`, `npm test` and `npm run test:e2e` before merging to `main`. The e2e suite (`tests/e2e/`, see README) covers every feature, layout at 12 screen sizes, touch reordering, offline use and auto-ring accuracy on hand-marked match photos. Add or update a spec when you add or change behaviour.
- If an auto-ring accuracy test fails after changing `src/lib/detect.ts`, treat it as a regression; only adjust thresholds in `tests/e2e/auto-ring.spec.ts` with a clear reason.
- Tests open the app at `/?nosw` to bypass the service worker; only `offline.spec.ts` runs with the service worker.
- Test UI changes in a real browser at phone sizes (portrait and landscape) as well as desktop; present mode has had overflow bugs on small landscape phones before.
- Present mode must never overlay the clip: title bar above, transport below, side panel beside (below on portrait phones).
- Commits end with the Co-Authored-By line for Claude.
