# Killeshin FC · Match Analysis

A lightweight app for preparing and presenting post-match analysis sessions, built for Killeshin F.C.

Each **session** is a set of **slides**, like a slide deck. Every slide is one video clip with a title, comments, and optional **shortcuts**: named moments in the clip you can jump to while presenting.

Everything is stored on the device. Nothing is uploaded anywhere. To move a session to another device, export it as a single `.analysis` file and import it there.

## Status: Phase 2 (drawing on video)

Working now:

- Create, rename and delete sessions
- Add clips (button or drag & drop), set title and comments, reorder and delete slides
- Add shortcuts at the current playhead, rename them, move them, delete them
- Present mode: the clip has its own uncovered area, with the title bar above it, playback controls below it, and shortcuts and comments in a side panel (below the clip on portrait phones). Previous/next clip, 1× / 0.5× / 0.25× speed, frame-by-frame stepping, optional fullscreen. A drawing tool rail sits beside the clip (above it on portrait phones)
- Drawing on the video: arrows, lines, player rings and freehand, in five colours, solid or dashed (for runs), normal or thick. Undo and clear
- Export a session to one `.analysis` file, import it on another device
- Installable and works offline (PWA)

Target browsers for the POC: Chrome/Edge on desktop and Chrome on Android. iPhone/iPad (Safari) is not supported yet.

### Roadmap

- **Phase 2 (done):** drawing on the video, saved per shortcut
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
| Show / hide side panel | N |
| Fullscreen | F |
| Exit | Esc |

| Drawing tools: arrow, line, ring, freehand | A, L, C, P (press again to put the tool down) |
| Dashed / solid | D |
| Undo · clear drawing | Z (or Ctrl+Z) · X |

In the editor: `,` and `.` step frames, `M` adds a shortcut at the current time.

Click or tap the clip to play / pause. With a drawing tool selected, the clip is a canvas instead; drawing pauses it.

### Drawings

- **Prepare** them in the editor: tap the pen button on a shortcut. The clip holds on that frame and the drawing tools replace the playback row. Everything you draw saves to that shortcut. Tap **Done** (or Esc) when finished.
- **Present**: jumping to a shortcut (tap it or press its number) shows its drawing. Frame stepping keeps it on screen; playing or seeking away clears it, so the next freeze-frame starts clean.
- You can also draw live while presenting. Live drawings are not saved, so the prepared session stays as you made it.
- A tap with the ring tool drops a standard-size ring; drag to size it.
- Drawings are stored relative to the video picture, so they line up with the same players on any screen, in any orientation, and after export / import.

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
    drawbar.ts       drawing toolbar (present tool rail + editor draw mode)
  lib/
    types.ts         data model
    db.ts            IndexedDB wrapper (sessions, slides, fallback video blobs)
    files.ts         video storage: Origin Private File System, IndexedDB fallback
    store.ts         session and slide operations
    transfer.ts      .analysis export / import
    zip.ts           streaming ZIP writer + random-access reader (ZIP64-capable)
    media.ts         thumbnails, duration, frame-rate detection, frame stepping
    draw.ts          drawing layer: canvas over the video, shapes, undo
    dom.ts, dialogs.ts, util.ts
  sw.js              service worker (offline cache), filled in at build time
scripts/build.mjs    esbuild bundle + index.html + service worker precache list
tests/zip.test.ts    ZIP round-trip tests
```

### Branding

Club green `#016701` (taken from the crest) and white, on a deep green-black base.

- `brand/` holds the source crest images and the transparent cut-out.
- `public/brand-crest.png` is the crest used in the app; `public/brand-lines.png` is the white line-art watermark.
- `public/icons/` are the app icons (crest on a club-green tile).
- Type is Inter (bundled in `public/fonts/`, SIL Open Font License) so it looks the same on every device and works offline.

To change colours, edit the variables at the top of `src/styles.css`.

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
