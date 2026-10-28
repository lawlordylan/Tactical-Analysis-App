// Reads which video format a clip uses (container and codec) from its headers,
// without decoding it. Used to explain playback problems, e.g. iPhone HEVC clips
// on a browser that can't play HEVC.

export interface ClipFormat {
  container: 'mp4' | 'mov' | 'webm' | 'unknown';
  /** Codec code: avc1, hvc1, hev1, av01, vp09, VP8, VP9, AV1 ... */
  codec?: string;
  /** 10-bit or more (HEVC Main 10, the iPhone HDR default). */
  tenBit?: boolean;
  /** HDR transfer (HLG or PQ). */
  hdr?: boolean;
}

const MAX_MOOV = 32 * 1024 * 1024;

const latin1 = new TextDecoder('latin1');
const ascii = (b: Uint8Array, at: number, n = 4) => latin1.decode(b.subarray(at, at + n));

async function bytes(blob: Blob, from: number, to: number): Promise<Uint8Array> {
  return new Uint8Array(await blob.slice(from, to).arrayBuffer());
}

/** Child boxes of an MP4/QuickTime box body. */
function* boxes(b: Uint8Array, from: number, to: number): Generator<{ type: string; start: number; end: number }> {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let at = from;
  while (at + 8 <= to) {
    let size = dv.getUint32(at);
    const type = ascii(b, at + 4);
    let head = 8;
    if (size === 1 && at + 16 <= to) {
      size = Number(dv.getBigUint64(at + 8));
      head = 16;
    } else if (size === 0) size = to - at;
    if (size < head || at + size > to) return;
    yield { type, start: at + head, end: at + size };
    at += size;
  }
}

function find(b: Uint8Array, from: number, to: number, path: string[]): { start: number; end: number }[] {
  if (!path.length) return [{ start: from, end: to }];
  const out: { start: number; end: number }[] = [];
  for (const box of boxes(b, from, to)) if (box.type === path[0]) out.push(...find(b, box.start, box.end, path.slice(1)));
  return out;
}

async function readMp4(blob: Blob, brand: string): Promise<ClipFormat> {
  const fmt: ClipFormat = { container: brand === 'qt  ' ? 'mov' : 'mp4' };
  // Walk the top-level boxes by their headers to find the movie header box,
  // which can sit before or after the (large) media data.
  let at = 0;
  let moov: Uint8Array | null = null;
  for (let n = 0; n < 64 && at + 8 <= blob.size; n++) {
    const head = await bytes(blob, at, at + 16);
    const dv = new DataView(head.buffer);
    let size = dv.getUint32(0);
    if (size === 1) size = Number(dv.getBigUint64(8));
    else if (size === 0) size = blob.size - at;
    if (size < 8) break;
    if (ascii(head, 4) === 'moov') {
      if (size <= MAX_MOOV) moov = await bytes(blob, at, at + size);
      break;
    }
    at += size;
  }
  if (!moov) return fmt;
  for (const trak of find(moov, 8, moov.length, ['trak'])) {
    const hdlr = find(moov, trak.start, trak.end, ['mdia', 'hdlr'])[0];
    if (!hdlr || ascii(moov, hdlr.start + 8) !== 'vide') continue;
    const stsd = find(moov, trak.start, trak.end, ['mdia', 'minf', 'stbl', 'stsd'])[0];
    if (!stsd) continue;
    // stsd: version/flags (4) + entry count (4), then sample entries.
    const entry = boxes(moov, stsd.start + 8, stsd.end).next().value;
    if (!entry) continue;
    fmt.codec = entry.type;
    // Visual sample entry fields take 78 bytes; codec boxes (hvcC, colr ...) follow.
    for (const child of boxes(moov, entry.start + 78, entry.end)) {
      if (child.type === 'hvcC' && child.end - child.start > 2) {
        if ((moov[child.start + 1] & 0x1f) === 2) fmt.tenBit = true; // Main 10 profile
      } else if (child.type === 'avcC' && child.end - child.start > 2) {
        if ([110, 122, 244].includes(moov[child.start + 1])) fmt.tenBit = true;
      } else if (child.type === 'colr' && ['nclx', 'nclc'].includes(ascii(moov, child.start))) {
        // nclx (MP4) and nclc (QuickTime, iPhone): primaries, transfer, matrix as 16-bit codes.
        const transfer = (moov[child.start + 6] << 8) | moov[child.start + 7];
        if (transfer === 16 || transfer === 18) fmt.hdr = true; // PQ, HLG
      }
    }
    break;
  }
  return fmt;
}

async function readWebm(blob: Blob): Promise<ClipFormat> {
  const head = latin1.decode(await bytes(blob, 0, 64 * 1024));
  const codec = head.match(/V_(VP8|VP9|AV1|MPEG4\/ISO\/AVC|MPEGH\/ISO\/HEVC)/)?.[1];
  return { container: 'webm', codec: codec === 'MPEG4/ISO/AVC' ? 'avc1' : codec === 'MPEGH/ISO/HEVC' ? 'hvc1' : codec };
}

/** The clip's container and video codec, read from its headers. Never throws. */
export async function readClipFormat(blob: Blob): Promise<ClipFormat> {
  try {
    const head = await bytes(blob, 0, 12);
    if (head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return await readWebm(blob);
    if (head.length >= 12 && ['ftyp', 'moov', 'mdat', 'wide', 'free', 'skip'].includes(ascii(head, 4))) {
      return await readMp4(blob, ascii(head, 4) === 'ftyp' ? ascii(head, 8) : 'qt  ');
    }
  } catch {
    /* unreadable: report unknown */
  }
  return { container: 'unknown' };
}

export const isHevc = (f: ClipFormat) => f.codec === 'hvc1' || f.codec === 'hev1';

/** Plain-English name, e.g. "HEVC (H.265), 10-bit HDR, in a .mov file". */
export function describeFormat(f: ClipFormat): string {
  const names: Record<string, string> = { avc1: 'H.264', avc3: 'H.264', hvc1: 'HEVC (H.265)', hev1: 'HEVC (H.265)', av01: 'AV1', vp09: 'VP9', VP8: 'VP8', VP9: 'VP9', AV1: 'AV1' };
  const codec = f.codec ? (names[f.codec] ?? f.codec) : 'unknown codec';
  const extra = [f.tenBit && '10-bit', f.hdr && 'HDR'].filter(Boolean).join(' ');
  const box = f.container === 'unknown' ? '' : ` in a .${f.container} file`;
  return `${codec}${extra ? `, ${extra}` : ''}${box}`;
}
