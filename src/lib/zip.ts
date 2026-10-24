// Small streaming ZIP writer and random-access ZIP reader.
//
// Writer: entries are "stored" (no compression; video is already compressed),
// streamed one chunk at a time so multi-GB sessions never sit in memory.
// ZIP64 is used automatically for large files/offsets.
//
// Reader: uses Blob.slice() to read only the central directory, then hands
// back each entry as a lazy Blob slice, so importing streams straight from the
// picked file to storage.

const textEnc = new TextEncoder();
const textDec = new TextDecoder();

// ---------- CRC32 ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array, crc = 0): number {
  let c = ~crc >>> 0;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

// ---------- helpers ----------
const U32 = 0xffffffff;

class Buf {
  private view: DataView;
  readonly bytes: Uint8Array;
  private p = 0;
  constructor(size: number) {
    this.bytes = new Uint8Array(size);
    this.view = new DataView(this.bytes.buffer);
  }
  u16(v: number) {
    this.view.setUint16(this.p, v, true);
    this.p += 2;
    return this;
  }
  u32(v: number) {
    this.view.setUint32(this.p, v >>> 0, true);
    this.p += 4;
    return this;
  }
  u64(v: number) {
    this.view.setBigUint64(this.p, BigInt(v), true);
    this.p += 8;
    return this;
  }
  raw(b: Uint8Array) {
    this.bytes.set(b, this.p);
    this.p += b.length;
    return this;
  }
}

function dosDateTime(d: Date): [number, number] {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return [time, date];
}

// ---------- writer ----------
export interface ZipInput {
  name: string;
  data: Blob;
}

export function zipStream(
  entries: ZipInput[],
  onProgress?: (done: number, total: number) => void,
  /** Force ZIP64 records even for small files (used by tests). */
  opts: { forceZip64?: boolean } = {},
): ReadableStream<Uint8Array> {
  const force = !!opts.forceZip64;
  const total = entries.reduce((n, e) => n + e.data.size, 0);
  const [dosTime, dosDate] = dosDateTime(new Date());
  async function* generate(): AsyncGenerator<Uint8Array> {
    let offset = 0;
    let written = 0;
    const central: Uint8Array[] = [];

    for (const entry of entries) {
      const name = textEnc.encode(entry.name);
      const size = entry.data.size;
      const zip64 = force || size >= U32 || offset >= U32;
      const localOffset = offset;

      // Local file header. Sizes are known up front; CRC is in the data descriptor (flag bit 3).
      const lh = new Buf(30 + name.length + (zip64 ? 20 : 0));
      lh.u32(0x04034b50).u16(zip64 ? 45 : 20).u16(0x0808).u16(0).u16(dosTime).u16(dosDate);
      lh.u32(0).u32(zip64 ? U32 : size).u32(zip64 ? U32 : size).u16(name.length).u16(zip64 ? 20 : 0).raw(name);
      if (zip64) lh.u16(0x0001).u16(16).u64(size).u64(size);
      yield lh.bytes;
      offset += lh.bytes.length;

      let crc = 0;
      const reader = entry.data.stream().getReader();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        crc = crc32(value, crc);
        written += value.byteLength;
        onProgress?.(written, total);
        yield value;
      }
      offset += size;

      const dd = new Buf(zip64 ? 24 : 16);
      dd.u32(0x08074b50).u32(crc);
      if (zip64) dd.u64(size).u64(size);
      else dd.u32(size).u32(size);
      yield dd.bytes;
      offset += dd.bytes.length;

      const cz64 = zip64 || localOffset >= U32;
      const ch = new Buf(46 + name.length + (cz64 ? 28 : 0));
      ch.u32(0x02014b50).u16(45).u16(cz64 ? 45 : 20).u16(0x0808).u16(0).u16(dosTime).u16(dosDate).u32(crc);
      ch.u32(cz64 ? U32 : size).u32(cz64 ? U32 : size).u16(name.length).u16(cz64 ? 28 : 0).u16(0);
      ch.u16(0).u16(0).u32(0).u32(cz64 ? U32 : localOffset).raw(name);
      if (cz64) ch.u16(0x0001).u16(24).u64(size).u64(size).u64(localOffset);
      central.push(ch.bytes);
    }

    const cdOffset = offset;
    let cdSize = 0;
    for (const c of central) {
      yield c;
      cdSize += c.length;
    }
    offset += cdSize;

    const needs64 = force || cdOffset >= U32 || cdSize >= U32 || entries.length >= 0xffff;
    if (needs64) {
      const z = new Buf(56 + 20);
      z.u32(0x06064b50).u64(44).u16(45).u16(45).u32(0).u32(0);
      z.u64(entries.length).u64(entries.length).u64(cdSize).u64(cdOffset);
      z.u32(0x07064b50).u32(0).u64(offset).u32(1);
      yield z.bytes;
    }
    const e = new Buf(22);
    e.u32(0x06054b50).u16(0).u16(0);
    e.u16(needs64 ? 0xffff : entries.length).u16(needs64 ? 0xffff : entries.length);
    e.u32(needs64 ? U32 : cdSize).u32(needs64 ? U32 : cdOffset).u16(0);
    yield e.bytes;
  }

  const it = generate();
  return new ReadableStream<Uint8Array>({
    async pull(ctrl) {
      try {
        const { value, done } = await it.next();
        if (done) ctrl.close();
        else ctrl.enqueue(value);
      } catch (err) {
        ctrl.error(err);
      }
    },
    async cancel() {
      await it.return(undefined);
    },
  });
}

// ---------- reader ----------
export interface ZipEntry {
  name: string;
  size: number;
  /** CRC-32 recorded in the archive for this entry. */
  crc: number;
  /** Lazily reads the (decompressed) entry contents. */
  blob(): Promise<Blob>;
  text(): Promise<string>;
}

async function readBytes(file: Blob, start: number, end: number): Promise<DataView> {
  return new DataView(await file.slice(start, end).arrayBuffer());
}

function u64(v: DataView, p: number): number {
  return Number(v.getBigUint64(p, true));
}

export async function readZip(file: Blob): Promise<Map<string, ZipEntry>> {
  const bad = () => new Error('This file is not a valid session file.');
  const tailLen = Math.min(file.size, 22 + 0xffff);
  const tailStart = file.size - tailLen;
  const tail = await readBytes(file, tailStart, file.size);
  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw bad();

  let count = tail.getUint16(eocd + 10, true);
  let cdSize = tail.getUint32(eocd + 12, true);
  let cdOffset = tail.getUint32(eocd + 16, true);

  if (count === 0xffff || cdSize === U32 || cdOffset === U32) {
    const locAbs = tailStart + eocd - 20;
    if (locAbs < 0) throw bad();
    const loc = await readBytes(file, locAbs, locAbs + 20);
    if (loc.getUint32(0, true) !== 0x07064b50) throw bad();
    const z64Off = u64(loc, 8);
    const z = await readBytes(file, z64Off, z64Off + 56);
    if (z.getUint32(0, true) !== 0x06064b50) throw bad();
    count = u64(z, 32);
    cdSize = u64(z, 40);
    cdOffset = u64(z, 48);
  }

  const cd = await readBytes(file, cdOffset, cdOffset + cdSize);
  const out = new Map<string, ZipEntry>();
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (cd.getUint32(p, true) !== 0x02014b50) throw bad();
    const method = cd.getUint16(p + 10, true);
    const crc = cd.getUint32(p + 16, true);
    let compSize = cd.getUint32(p + 20, true);
    let size = cd.getUint32(p + 24, true);
    const nameLen = cd.getUint16(p + 28, true);
    const extraLen = cd.getUint16(p + 30, true);
    const commentLen = cd.getUint16(p + 32, true);
    let localOffset = cd.getUint32(p + 42, true);
    const name = textDec.decode(new Uint8Array(cd.buffer, p + 46, nameLen));

    // ZIP64 extra field: only the fields set to 0xFFFFFFFF are present, in this order.
    let e = p + 46 + nameLen;
    const eEnd = e + extraLen;
    while (e + 4 <= eEnd) {
      const id = cd.getUint16(e, true);
      const len = cd.getUint16(e + 2, true);
      if (id === 0x0001) {
        let q = e + 4;
        if (size === U32) (size = u64(cd, q)), (q += 8);
        if (compSize === U32) (compSize = u64(cd, q)), (q += 8);
        if (localOffset === U32) localOffset = u64(cd, q);
      }
      e += 4 + len;
    }
    p = eEnd + commentLen;

    if (name.endsWith('/')) continue;
    const dataStart = async () => {
      const lh = await readBytes(file, localOffset, localOffset + 30);
      if (lh.getUint32(0, true) !== 0x04034b50) throw bad();
      return localOffset + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
    };
    const blob = async (): Promise<Blob> => {
      const start = await dataStart();
      const raw = file.slice(start, start + compSize);
      if (method === 0) return raw;
      if (method === 8) return new Response(raw.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob();
      throw new Error(`Unsupported compression in "${name}".`);
    };
    out.set(name, { name, size, crc, blob, text: async () => (await blob()).text() });
  }
  return out;
}
