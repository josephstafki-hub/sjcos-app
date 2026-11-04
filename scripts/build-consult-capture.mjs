/**
 * Builds the in-home consultation offline capture bundle and its precache manifest.
 *
 *   public/consult/assets/capture.js   the field app (components/consult/field) + React,
 *                                      one self-contained chunk, mounted by the data-free
 *                                      shell public/consult/offline.html on #consult-root
 *   public/consult/assets/capture.css  Tailwind for those components + design tokens +
 *                                      app/consult/consult.css (Sun mode etc.)
 *   public/consult/precache.json       scripts/consult-precache.mjs: sha256 of every
 *                                      asset + content-derived build id
 *
 * Why not the Next route chunks: public/sw.js (backend, tested) only admits
 * /consult/offline.html and /consult/assets/* into CacheStorage, and a disconnected
 * navigation is answered with offline.html — never an RSC/HTML page. So the offline
 * UI must be a static, data-free bundle under /consult/assets/.
 *
 * Runs automatically from next.config.ts during `next build` (PHASE_PRODUCTION_BUILD,
 * once per build). Manual:  node scripts/build-consult-capture.mjs
 * Skip (e.g. a build that must not touch public/):  SJC_SKIP_CONSULT_CAPTURE=1
 * Uses only what Next already ships: its compiled webpack + SWC, and the app's
 * PostCSS/Tailwind. Small graph; single process; no dev server.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'public/consult/assets');

async function bundleJs() {
  const { webpack } = require('next/dist/compiled/webpack/webpack.js');
  const compiler = webpack({
    mode: 'production', context: root, target: ['web', 'es2020'], devtool: false, cache: false,
    entry: path.join(root, 'components/consult/field/capture-entry.tsx'),
    output: { path: out, filename: 'capture.js', publicPath: '/consult/assets/', iife: true, clean: false },
    resolve: { extensions: ['.tsx', '.ts', '.mjs', '.js', '.json'], alias: { '@': root }, fallback: { crypto: false, fs: false, path: false } },
    module: { rules: [{ test: /\.(?:tsx?|mjs|jsx?)$/, exclude: /node_modules/, use: [{ loader: path.join(root, 'scripts/consult-capture-loader.cjs') }] }] },
    plugins: [
      new webpack.DefinePlugin({ 'process.env.NODE_ENV': JSON.stringify('production') }),
      new webpack.optimize.LimitChunkCountPlugin({ maxChunks: 1 }),
    ],
    optimization: { minimize: false, splitChunks: false, runtimeChunk: false, concatenateModules: true },
    performance: { hints: false },
    infrastructureLogging: { level: 'error' },
  });
  const stats = await new Promise((resolve, reject) => compiler.run((err, s) => { compiler.close(() => {}); if (err) reject(err); else resolve(s); }));
  if (stats.hasErrors()) throw new Error(`consult capture bundle failed:\n${stats.toString({ all: false, errors: true, errorDetails: true })}`);
  const file = path.join(out, 'capture.js');
  const swc = require('next/dist/build/swc');
  await swc.loadBindings();
  try {
    const min = await swc.minify(await readFile(file, 'utf8'), { compress: { passes: 1 }, mangle: true, module: false, format: { comments: false } });
    await writeFile(file, min.code);
  } catch (e) { console.warn('[consult-capture] minify skipped:', e instanceof Error ? e.message : e); }
}

async function bundleCss() {
  const postcss = require('postcss');
  const tailwind = require('@tailwindcss/postcss');
  let css = await readFile(path.join(root, 'app/globals.css'), 'utf8');
  css = css.replace('@import "tailwindcss";', [
    '@import "tailwindcss" source(none);',
    '@source "../components/consult/field";',
    '@source "../components/ui/CoverageMark.tsx";',
    '@source "../components/esign/SignaturePad.tsx";',
  ].join('\n'));
  // next/font injects these on the website; offline the stack falls back to system faces.
  css += '\n:root{--font-newsreader:Georgia;--font-mulish:system-ui;--font-jetbrains:ui-monospace}\n';
  css += await readFile(path.join(root, 'app/consult/consult.css'), 'utf8');
  const result = await postcss([tailwind({ base: root, optimize: { minify: true } })]).process(css, { from: path.join(root, 'app/globals.css') });
  await writeFile(path.join(out, 'capture.css'), result.css);
}

export async function buildConsultCapture() {
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  await bundleJs();
  await bundleCss();
  // Hashes every shell asset and writes the content-derived build id.
  await import(`${pathToFileURL(path.join(root, 'scripts/consult-precache.mjs')).href}?t=${Date.now()}`);
  const manifest = JSON.parse(await readFile(path.join(root, 'public/consult/precache.json'), 'utf8'));
  return manifest;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const m = await buildConsultCapture();
  console.log(`[consult-capture] build ${m.build.slice(0, 12)} · ${m.assets.length} assets`);
}
