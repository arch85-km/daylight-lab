/**
 * Daylight Lab build
 * ------------------
 * Concatenates src/ into ONE self-contained daylight-lab.html.
 *
 *  - vendor/three.min.js is inlined as a classic script (UMD global `THREE`),
 *    so the result works from file://, inside a WordPress Custom HTML block,
 *    and inside an <iframe> with no import map, module loader or CDN.
 *  - src/engine.worker.js is inlined as <script type="text/plain"> and started
 *    from a Blob URL at runtime, with a main-thread fallback (see engine.js).
 *  - Everything else is wrapped in a single IIFE in dependency order.
 *
 * Placeholders in src/index.html:  __STYLE__ __WORKER__ __THREE__ __APP__
 */
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

/** App modules, in dependency order. */
const MODULES = [
  'src/util.js',
  'src/solar.js',
  'src/sky.js',
  'src/epw.js',
  'src/bvh.js',
  'src/geometry.js',
  'src/shading.js',
  'src/splitflux.js',
  'src/metrics.js',
  'src/engine.core.js',
  'src/engine.js',
  'src/legend.js',
  'src/dimensions.js',
  'src/view.js',
  'src/sunpath.js',
  'src/rays.js',
  'src/export.js',
  'src/presets.js',
  'src/ui.js',
  'src/tour.js',
  'src/main.js',
];

const banner = (name) =>
  `\n/* ${'='.repeat(74)}\n   ${name}\n   ${'='.repeat(74)} */\n`;

// three.min.js opens with a `console.warn('deprecated'),` comma-expression that
// the UMD factory call hangs off. Neutralise the warning but KEEP the comma —
// dropping it would leave a bare function expression in statement position.
// The vendor file itself stays pristine.
let three = read('vendor/three.min.js');
three = three.replace(/^console\.warn\((['"])(?:\\.|(?!\1)[^\\])*\1\),/, '0,');

const app = MODULES.map((m) => banner(m) + read(m)).join('\n');
// The worker is self-contained: it carries its own copy of the shared modules.
const WORKER_DEPS = ['src/util.js', 'src/solar.js', 'src/sky.js', 'src/epw.js',
                     'src/bvh.js', 'src/engine.core.js', 'src/engine.worker.js'];
const worker = WORKER_DEPS.map((m) => banner(m) + read(m)).join('\n');
const style = read('src/theme.css');

// Nothing in src/ may terminate the inline <script> blocks that carry it.
const guard = (s) => s.replace(/<\/(script)/gi, '<\\/$1');

const out = read('src/index.html')
  .replace('__STYLE__', () => style)
  .replace('__THREE__', () => guard(three))
  .replace('__WORKER__', () => guard(worker))
  .replace('__APP__', () => guard(app));

writeFileSync(join(root, 'daylight-lab.html'), out);

const kb = (n) => (n / 1024).toFixed(0).padStart(6) + ' KB';
console.log('built daylight-lab.html');
console.log('  three.js  ' + kb(three.length));
console.log('  app       ' + kb(app.length));
console.log('  worker    ' + kb(worker.length));
console.log('  css       ' + kb(style.length));
console.log('  total     ' + kb(statSync(join(root, 'daylight-lab.html')).size));
