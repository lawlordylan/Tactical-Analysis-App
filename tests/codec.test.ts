// Checks the clip format reader on the test clips (H.264, iPhone-style HEVC and HDR HEVC, WebM).
// Run: npm test
import { readFileSync } from 'node:fs';
import { describeFormat, readClipFormat } from '../src/lib/codec';

const cases: [string, string][] = [
  ['h264.mp4', 'H.264 in a .mp4 file'],
  ['hevc.mov', 'HEVC (H.265) in a .mov file'],
  ['hevc-hdr.mov', 'HEVC (H.265), 10-bit HDR in a .mov file'],
  ['counter-press.webm', 'VP9 in a .webm file'],
];

for (const [name, want] of cases) {
  const blob = new Blob([readFileSync(`tests/e2e/fixtures/${name}`)]);
  const got = describeFormat(await readClipFormat(blob));
  if (got !== want) throw new Error(`${name}: expected "${want}", got "${got}"`);
  console.log(`ok ${name}: ${got}`);
}

// (The .mov clips have their movie header after the media data, as camera recordings do;
// h264.mp4 has it first.)
const junk = describeFormat(await readClipFormat(new Blob([new Uint8Array(1000)])));
if (junk !== 'unknown codec') throw new Error(`junk file: got "${junk}"`);
console.log('ok unreadable file: unknown codec');
