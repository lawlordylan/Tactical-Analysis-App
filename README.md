# Killeshin FC · Match Analysis

A lightweight app for preparing and presenting post-match analysis sessions, built for Killeshin F.C.

Each **session** is a set of **slides**, like a slide deck. Every slide is one video clip with a title, comments, and optional **shortcuts**: named moments in the clip you can jump to while presenting.

Everything is stored on the device. Nothing is uploaded anywhere. To move a session to another device, export it as a single `.analysis` file and import it there.

## Status: Phase 2 (drawing on video)

Working now:

- Create, rename and delete sessions
- Add clips (button or drag & drop), set title and comments, delete slides
- **Drag to reorder clips**: with a mouse, drag a clip anywhere; on touch, drag its handle or press and hold the clip. The list scrolls when you drag near its edge
- Add shortcuts at the current playhead, rename them, move them, delete them
- Present mode: the clip has its own uncovered area, with the title bar above it, playback controls below it, and shortcuts and comments in a side panel (below the clip on portrait phones). Previous/next clip, 1× / 0.5× / 0.25× speed, frame-by-frame stepping, optional fullscreen. A drawing tool rail sits beside the clip (above it on portrait phones)
- **Auto-ring**: tap a player and a ring snaps to them (on-device player detection, works offline after first use)
- Drawing on the video: arrows, lines, player rings and freehand, in five colours, solid or dashed (for runs), normal or thick. Undo and clear
- Export a session to one `.analysis` file, import it on another device
- Installable and works offline (PWA)

Target browsers for the POC: Chrome/Edge on desktop and Chrome on Android. iPhone/iPad (Safari) is not supported yet.

### Roadmap

- **Phase 2 (done):** drawing on the video, saved per shortcut
- **Phase 3:** casting (Chromecast / AirPlay), storage usage per session, polish

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

| Auto-ring a player | R, then tap the player |
| Drawing tools: arrow, line, ring, freehand | A, L, C, P (press again to put the tool down) |
| Dashed / solid | D |
| Undo · clear drawing | Z (or Ctrl+Z) · X |

In the editor: `,` and `.` step frames, `M` adds a shortcut at the current time, `D` draws on the current frame.

Click or tap the clip to play / pause. With a drawing tool selected, the clip is a canvas instead; drawing pauses it.

### Drawings

- **Prepare** them in the editor: pause on a moment and tap **Draw on this frame** (or press D). That adds a shortcut there if there isn't one, and opens the drawing tools. Each shortcut also has a **Draw** button. The clip holds on that frame and the drawing tools replace the playback row. Everything you draw saves to that shortcut. Tap **Done** (or Esc) when finished.
- **Present**: jumping to a shortcut (tap it or press its number) shows its drawing. Frame stepping keeps it on screen; playing or seeking away clears it, so the next freeze-frame starts clean.
- You can also draw live while presenting. Live drawings are not saved, so the prepared session stays as you made it.
- A tap with the ring tool drops a standard-size ring; drag to size it.
- **Auto-ring** (the first tool): tap a player and the app finds them and draws the ring for you: a ring at the feet for players in a wide shot, an oval around the whole player in a close-up. If nobody is found where you tapped, you get a normal ring there instead. Dragging with this tool still sizes a ring by hand. Its rings get a soft glow in the ring's colour and pop in when they appear (and when you jump to the shortcut while presenting). Otherwise they're ordinary rings: undo, colour, dashed and saving all work the same.
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
    detect.ts        auto-ring: find the player under a tap
    sortable.ts      drag-to-reorder (pointer events: mouse, touch, pen)
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

### Auto-ring (player detection)

`src/lib/detect.ts`. A small person detector, Google MediaPipe's ObjectDetector with **EfficientDet-Lite0 (int8)**, runs on the device; no image ever leaves it.

- **Zoomed crop around the tap.** The detector works on a 320 × 320 picture, so in a wide shot distant players are too small to find. Because we know where the user tapped, we crop around the tap first, which makes them big enough. If the player found is cut off by the crop, it re-centres on them; if the box looks like only a pair of legs (a close-up player tapped at the feet), it checks one zoom level out.
- **Tested** on 38 hand-marked players in wide, medium, close-up and crowded match photos: taps on the chest found the right player 100% of the time, off-centre taps 95%, taps on the feet 87%. The crop approach beat detecting on the whole frame (79–87%) and the larger EfficientDet-Lite2 model, at about a third of the time.
- **Runs on CPU** (WebAssembly). The int8 model is the smallest and fastest there; MediaPipe's GPU path doesn't run int8 models correctly.
- **Size and offline.** The model (`public/detector/efficientdet_lite0_int8.tflite`, 4.6 MB) is in the repo. The runtime (`@mediapipe/tasks-vision`, ~13 MB of WebAssembly) comes from npm and is copied to `dist/detector/wasm` at build time. Neither is downloaded until someone first picks the tool; the service worker then keeps them for offline use.
- Licences: MediaPipe and the EfficientDet-Lite model are Apache 2.0.

`.github/workflows/fetch-detector-assets.yml` is a development helper for environments without internet access: run it from the Actions tab and it commits the runtime, models and some openly licensed test photos to a `dev-detector-assets` branch.

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
