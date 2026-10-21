// Round-trip test for the ZIP writer/reader, including forced ZIP64 records.
// Run: npm test   (bundles with esbuild, runs in Node 20+)
import { crc32, readZip, zipStream } from '../src/lib/zip';
import { writeFileSync } from 'node:fs';

const rand = (n: number) => {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i += 65536) crypto.getRandomValues(b.subarray(i, Math.min(n, i + 65536)));
  return b;
};

async function roundTrip(forceZip64: boolean) {
  const files = { 'session.json': new TextEncoder().encode('{"hello":"wörld"}'), 'clips/001-a clip.mp4': rand(3_000_000), 'clips/002-b.mp4': rand(10) };
  const entries = Object.entries(files).map(([name, data]) => ({ name, data: new Blob([data]) }));
  const zipped = await new Response(zipStream(entries, undefined, { forceZip64 })).blob();
  const out = process.argv[2];
  if (out) writeFileSync(`${out}-${forceZip64 ? 'zip64' : 'plain'}.zip`, new Uint8Array(await zipped.arrayBuffer()));
  const read = await readZip(zipped);
  for (const [name, data] of Object.entries(files)) {
    const e = read.get(name);
    if (!e) throw new Error(`missing ${name}`);
    const got = new Uint8Array(await (await e.blob()).arrayBuffer());
    if (got.length !== data.length || crc32(got) !== crc32(data)) throw new Error(`content mismatch in ${name}`);
  }
  console.log(`ok ${forceZip64 ? 'zip64' : 'plain'} round trip (${zipped.size} bytes)`);
}

await roundTrip(false);
await roundTrip(true);
