# Killeshin FC · Match Analysis

A lightweight app for preparing and presenting post-match analysis sessions, built for Killeshin F.C.

Each **session** is a set of **slides**, like a slide deck. Every slide is one video clip with a title, comments, and optional **shortcuts**: named moments in the clip you can jump to while presenting.

Everything is stored on the device. Nothing is uploaded anywhere. To move a session to another device, export it as a single `.analysis` file and import it there.

## Status: Phase 2 (drawing on video)

Working now:

- **How it works** tour: a short, skippable walk through preparing and presenting a session. Opens by itself on a first visit, and any time from the home page
- Create, rename and delete sessions
- Add clips (button or drag & drop), set title and comments, delete slides
- **Drag to reorder clips**: with a mouse, drag a clip anywhere; on touch, drag its handle or press and hold the clip. The list scrolls when you drag near its edge
- Add shortcuts at the current playhead, rename them, move them, delete them
- Present mode: the clip has its own uncovered area, with the title bar above it, playback controls below it, and shortcuts and comments in a side panel (below the clip on portrait phones). Previous/next clip (‹ › beside the title, or under the clip), a clip picker (click the title to see every clip with its thumbnail and jump to one; a bottom sheet on phones), 1× / 0.5× / 0.25× speed, frame-by-frame stepping, optional fullscreen. A drawing tool rail sits beside the clip (above it on portrait phones)
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
| Pick any clip | G or click the title, then ↑ ↓ and Enter, or type its number and Enter |
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
- **Auto-ring** (the first tool): tap a player and the app finds them and draws the ring for you: a ring at the feet for players in a wide shot, an oval around the whole player in a close-up. If nobody is found where you tapped, you get a normal ring there instead. Dragging with this tool still sizes a ring by hand. Its highlight is a ring painted on the pitch at the player's feet (bright at the front, fading at the back) with a soft beam of light rising through the player. It draws itself on: the ring sweeps round from the front, then the beam rises, both when it's placed and when you jump to the shortcut while presenting. Close-up players get the floor ring too: the app finds their feet with a pose model. Only when a player's feet are out of shot or hidden behind other players does it fall back to a crisp oval around them. The beam is drawn on its own layer, screen-blended over the video, so it brightens the player like real light. Otherwise they're ordinary rings: undo, colour, dashed and saving all work the same.
- Drawings are stored relative to the video picture, so they line up with the same players on any screen, in any orientation, and after export / import.

**Clip format:** H.264 MP4 plays everywhere. iPhone recordings (HEVC/.mov) may not play in Chrome on Windows; re-export them as H.264 MP4.

**Frame rate** is detected automatically the first time a clip plays (25 fps is assumed until then).

## Development

One runtime dependency (`@mediapipe/tasks-vision`, for auto-ring, loaded on first use). Dev tools: esbuild, TypeScript and Playwright.

```bash
npm install
npm run dev        # http://localhost:5173 with rebuild on save (built into dist-dev/)
npm run build      # production build into dist/
npm run preview    # production build served on http://localhost:4174
npm run typecheck
npm test           # export-format round-trip tests
npm run test:e2e   # browser tests (first time: npx playwright install chromium)
```

Work happens on the `develop` branch; `main` is what's live.

### In VS Code

The `.vscode/` folder has everything wired up (needs [Node.js](https://nodejs.org) LTS):

- **First time:** *Terminal → Run Task… → First-time setup* (npm install + the test browser), and accept the suggested **Playwright Test** extension.
- **F5** starts the dev server and opens the app in Chrome attached to VS Code: breakpoints in `src/*.ts` work and console output goes to the Debug Console. Pick *App in Edge* or *Production build in Chrome* from the Run and Debug dropdown for the others. Press Ctrl+Shift+M in the browser's DevTools for phone sizes.
- **Ctrl+Shift+B** starts just the dev server; build errors show in the Problems panel. The terminal prints the address to open on a phone.
- **Terminal → Run Task…** has *Typecheck*, *Unit tests*, *Browser tests*, *Browser tests (interactive UI)* and *Check everything* (all three, before merging to `main`).
- The **Testing** sidebar (Playwright extension) runs or debugs a single browser test.

The dev server builds into `dist-dev/` and the tests into `dist/`, so both can run at once.

On Windows, tasks run in Command Prompt. If you type `npm` in a PowerShell terminal and get "npm.ps1 is not digitally signed", open a Command Prompt or Git Bash terminal instead (the **+** dropdown in the terminal panel), or type `npm.cmd`. After installing Node.js, quit VS Code completely and reopen it so it finds `npm`.

### Browser tests

`npm run test:e2e` builds the app, serves it on port 4173 and runs `tests/e2e/` in Chromium (about 2 minutes). `npm run test:e2e:ui` opens Playwright's interactive runner. Screenshots, traces and an HTML report land in `test-results/`.

| Spec | What it checks |
| --- | --- |
| `core` | Sessions, clips, titles, comments, shortcuts, frame stepping, saving across reload; present mode (shortcut keys, slow motion, side panel, next clip, nothing covering the clip); export to `.analysis` (every CRC verified) and import on a second "device", duplicate names, deleting removes stored clips |
| `layout` | Present mode at 12 screen sizes, phones to laptop, portrait and landscape: no control outside its bar, nothing off screen, nothing over the clip, clip picker fully on screen. Saves screenshots per size |
| `tour` | First-visit tour: opens on its own once, every step reachable (buttons, arrow keys, swipe), skip and Esc, reopens from the home page, doesn't interrupt people who already have sessions; every step fits phones in both orientations and tablets |
| `clip-picker` | Present mode clip picker: open from the title or G, pick by click, arrows, or clip number; ‹ › beside the title; Esc and clicking outside close it; bottom sheet on phones in both orientations |
| `drawing` | Drawing in the editor, saved per shortcut, shown on jump, frame step keeps it, play clears it, live drawing while presenting, drawings in exports |
| `reorder` | Drag to reorder with a mouse, and with real touch events on a phone (handle, swipe-scrolls, press-and-hold with auto-scroll) |
| `auto-ring` | Auto-ring behaviour, plus **accuracy on 38 hand-marked players** in five real match photos: the right player is ringed and floor rings land near the feet. Fails if detection tuning regresses |
| `offline` | With the service worker: the app and auto-ring (detector and pose model) keep working offline after first use |

Test clips are in `tests/e2e/fixtures/` (see its `CREDITS.md`). The same suite runs on GitHub for every push to `develop` and every pull request to `main` (`.github/workflows/tests.yml`).

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
tests/e2e/           browser tests (Playwright) and test clips
scripts/serve.mjs    static server for dist/ (used by the browser tests)
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
- **Finding the floor.** For distant players the detector's box ends at their feet, so the ring goes at its bottom edge (within 1–3% of the feet in testing). For closer players the box is often cut short at the knees or waist, so a pose model (MediaPipe **PoseLandmarker lite**, 5.8 MB, loaded the first time a close player is tapped) finds their heels and toes in a tall, narrow crop centred on them. On close-up and crowded test photos this put rings within about 4% of the feet; players whose feet are out of shot or hidden get an oval instead.
- **Runs on CPU** (WebAssembly). The int8 model is the smallest and fastest there; MediaPipe's GPU path doesn't run int8 models correctly.
- **Size and offline.** The models (`public/detector/efficientdet_lite0_int8.tflite`, 4.6 MB, and `pose_landmarker_lite.task`, 5.8 MB) are in the repo. The runtime (`@mediapipe/tasks-vision`, ~13 MB of WebAssembly) comes from npm and is copied to `dist/detector/wasm` at build time. Neither is downloaded until someone first picks the tool; the service worker then keeps them for offline use.
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
