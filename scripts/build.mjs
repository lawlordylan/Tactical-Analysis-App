// Build script: bundles src/ with esbuild, writes index.html and a service
// worker whose precache list matches the hashed output files.
//   node scripts/build.mjs          -> production build into dist/
//   node scripts/build.mjs --serve  -> watch + local dev server
import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';

const serve = process.argv.includes('--serve');
const outdir = 'dist';
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });
cpSync('public', outdir, { recursive: true });

function listFiles(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? listFiles(p) : [p];
  });
}

const htmlAndSw = {
  name: 'html-and-sw',
  setup(build) {
    build.onEnd((result) => {
      if (result.errors.length || !result.metafile) return;
      const outputs = Object.keys(result.metafile.outputs).map((p) => relative(outdir, p));
      const js = outputs.find((p) => p.endsWith('.js') && !p.endsWith('.map'));
      const css = outputs.find((p) => p.endsWith('.css') && !p.endsWith('.map'));
      // Remove stale hashed bundles from previous watch rebuilds.
      for (const f of readdirSync(outdir)) {
        if (/^app-.*\.(js|css)(\.map)?$/.test(f) && !outputs.includes(f)) rmSync(join(outdir, f));
      }
      const html = readFileSync('src/index.html', 'utf8')
        .replace('%CSS%', `./${css}`)
        .replace('%JS%', `./${js}`)
        .replace(/%VERSION%/g, pkg.version);
      writeFileSync(join(outdir, 'index.html'), html);

      const files = listFiles(outdir)
        .map((p) => relative(outdir, p).split('\\').join('/'))
        .filter((p) => p !== 'sw.js' && !p.endsWith('.map'));
      const hash = createHash('sha256');
      for (const f of files.sort()) hash.update(f).update(readFileSync(join(outdir, f)));
      const version = hash.digest('hex').slice(0, 10);
      const sw = readFileSync('src/sw.js', 'utf8')
        .replace('__VERSION__', version)
        .replace('__PRECACHE__', JSON.stringify(['./', ...files.map((f) => './' + f)]));
      writeFileSync(join(outdir, 'sw.js'), sw);
      console.log(`[build] ${new Date().toLocaleTimeString()} ok (cache ${version})`);
    });
  },
};

const options = {
  entryPoints: { app: 'src/main.ts' },
  bundle: true,
  outdir,
  format: 'esm',
  target: ['chrome110', 'firefox115', 'safari16'],
  entryNames: '[name]-[hash]',
  minify: !serve,
  sourcemap: true,
  metafile: true,
  loader: { '.css': 'css' },
  // Fonts and images referenced from CSS are served as-is from public/.
  external: ['*.woff', '*.woff2', '*.png', '*.svg'],
  plugins: [htmlAndSw],
  logLevel: 'warning',
};

if (serve) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  const { port } = await ctx.serve({ servedir: outdir, port: 5173, host: '0.0.0.0' });
  console.log(`Dev server: http://localhost:${port}`);
} else {
  await esbuild.build(options);
}
