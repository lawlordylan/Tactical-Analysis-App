# Tactical Analysis

A lightweight app for preparing and presenting post-match analysis sessions.

Each **session** is a set of **slides**, like a slide deck. Every slide is one video clip with a title, comments, and optional **shortcuts**: named moments in the clip you can jump to while presenting.

Everything is stored on the device. Nothing is uploaded anywhere. To move a session to another device, export it as a single `.analysis` file and import it there.

## Status: Phase 1 (proof of concept)

Working now:

- Create, rename and delete sessions
- Add clips (button or drag & drop), set title and comments, reorder and delete slides
- Add shortcuts at the current playhead, rename them, move them, delete them
- Present mode: full screen, previous/next clip, shortcut buttons, 1× / 0.5× / 0.25× speed, frame-by-frame stepping, comments panel, auto-hiding controls
- Export a session to one `.analysis` file, import it on another device
- Installable and works offline (PWA)

Target browsers for the POC: Chrome/Edge on desktop and Chrome on Android. iPhone/iPad (Safari) is not supported yet.

### Roadmap

- **Phase 2:** drawing on the video (arrows, circles, lines, freehand), saved per shortcut
- **Phase 3:** drag-to-reorder, casting (Chromecast / AirPlay), storage usage per session, polish

## Using it

| In present mode | Keys |
| --- | --- |
| Play / pause | Space or K |
| Step one frame | ← → |
| Jump 2 seconds | Shift + ← → |
| Previous / next clip | ↑ ↓ or PageUp / PageDown (presentation clickers work) |
| Jump to shortcut | 1 – 9 |
| Speed | S |
| Comments | N |
| Fullscreen | F |
| Exit | Esc |

In the editor: `,` and `.` step frames, `M` adds a shortcut at the current time.

On touch screens, tap the video to hide or show the controls.

**Clip format:** H.264 MP4 plays everywhere. iPhone recordings (HEVC/.mov) may not play in Chrome on Windows; re-export them as H.264 MP4.

**Frame rate** is detected automatically the first time a clip plays (25 fps is assumed until then).

## Development

No runtime dependencies. The only dev tools are esbuild and TypeScript.

```bash
npm install
npm run dev        # http://localhost:5173 with rebuild on save
npm run build      # production build into dist/
npm run typecheck
npm test           # export-format round-trip tests
```

To try it on a phone during development, open `http://<your-computer-ip>:5173` on the same Wi-Fi. Over plain http the browser blocks some storage APIs, so videos are stored in IndexedDB instead of the private file system. Everything still works; the deployed https version is the real thing.

## Deploying (GitHub Pages)

The workflow in `.github/workflows/deploy.yml` builds and publishes the app on every push to `main`.

One-time setup: in the GitHub repo go to **Settings → Pages** and set **Source** to **GitHub Actions**. The app will be at `https://<user>.github.io/Tactical-Analysis-App/`.

Open that link once on each device, then use the browser's **Install app** / **Add to Home screen** option. After that it works offline.

## How it's built

```
src/
  main.ts            hash router: #/  ·  #/session/:id  ·  #/present/:id/:index
  views/
    home.ts          sessions list
    editor.ts        slide list + slide editor
    present.ts       presentation player
    actions.ts       export / import / present flows shared by screens
  lib/
    types.ts         data model
    db.ts            IndexedDB wrapper (sessions, slides, fallback video blobs)
    files.ts         video storage: Origin Private File System, IndexedDB fallback
    store.ts         session and slide operations
    transfer.ts      .analysis export / import
    zip.ts           streaming ZIP writer + random-access reader (ZIP64-capable)
    media.ts         thumbnails, duration, frame-rate detection, frame stepping
    dom.ts, dialogs.ts, util.ts
  sw.js              service worker (offline cache), filled in at build time
scripts/build.mjs    esbuild bundle + index.html + service worker precache list
tests/zip.test.ts    ZIP round-trip tests
```

### Storage

- **Metadata** (sessions, slides, shortcuts, thumbnails) lives in IndexedDB.
- **Video files** live in the browser's Origin Private File System, written as a stream so large clips never load fully into memory. Where that isn't available the app falls back to IndexedDB.
- The app asks the browser to make storage **persistent** so it isn't cleared automatically when space runs low.

### The `.analysis` file

A standard ZIP (you can open it with any unzip tool):

```
session.json          title, slides, comments, shortcuts, thumbnails
clips/001-<name>.mp4
clips/002-<name>.mp4
...
```

Clips are stored uncompressed (video is already compressed), which keeps export and import fast. Export streams straight to disk on desktop Chrome/Edge; on Android it builds the file and offers **Download** (and **Share** where the browser allows that file type). Import reads clips directly out of the picked file without loading it into memory.
