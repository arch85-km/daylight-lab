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
import { createHash } from 'node:crypto';
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

/*
 * The licence notice, carried INSIDE the built file.
 *
 * The whole point of shipping one self-contained HTML file is that it travels
 * alone — emailed, uploaded, pasted into a page. MIT requires the copyright
 * notice AND the permission notice to accompany every copy, so a LICENSE file
 * sitting in a repository nobody receives does not discharge it. Kept as a
 * plain comment at the very top: unminified, ahead of everything, and
 * impossible to lose by copying the file.
 *
 * `--` cannot appear inside an HTML comment, so the three.js text is checked
 * rather than trusted; it has none today, and a future vendor bump that
 * introduced one would break the page silently.
 */
const threeLicense = read('vendor/three.LICENSE').trimEnd();

const noticeBody = `  Daylight Lab — a browser-based daylight simulation tool
  Copyright © Karam Al-Obaidi

  This file is the software, and it is licensed MIT. The project's
  documentation — the README, the method notes, the exercises — is
  licensed CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/).
  Both permit commercial use; both ask only for credit.

  Provided as-is, without warranty. Built to teach relationships and
  orders of magnitude, not for compliance work.

  MIT License

  Permission is hereby granted, free of charge, to any person obtaining a
  copy of this software and associated documentation files (the "Software"),
  to deal in the Software without restriction, including without limitation
  the rights to use, copy, modify, merge, publish, distribute, sublicense,
  and/or sell copies of the Software, and to permit persons to whom the
  Software is furnished to do so, subject to the following conditions:

  The above copyright notice and this permission notice shall be included in
  all copies or substantial portions of the Software.

  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
  FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
  AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
  LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
  FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
  DEALINGS IN THE SOFTWARE.

  ==================================================================
  THIRD-PARTY — bundled into this file, under its own licence:

  three.js r160 (https://threejs.org)

${threeLicense.split('\n').map((l) => (l ? '  ' + l : '')).join('\n')}
  ==================================================================

  Colour maps in the legend are sampled from viridis, inferno and
  cividis (CC0) and turbo (Anton Mikhailov, Google, Apache-2.0).`;

/*
 * `--` cannot appear inside an HTML comment. If it did, the notice would
 * terminate early and spill the rest of itself into the page as markup — so
 * the ASSEMBLED text is checked, not just the vendor file. A row of hyphens
 * used as a separator is exactly how this goes wrong, which is how it went
 * wrong the first time; test/validate.mjs asserts the same thing on the
 * built file.
 */
if (noticeBody.includes('--')) {
  throw new Error('the licence notice contains "--", which cannot go inside an HTML comment');
}
const notice = `<!--\n${noticeBody}\n-->`;

/*
 * Build stamp: the date a human reads, and a hash that separates two builds
 * made the same day - which happened repeatedly while the engines were being
 * fixed. Hashed over the assembled sources only, never the date, so rebuilding
 * without touching src/ gives the same hash and a real change always shows.
 * Generated rather than typed: a stamp you have to remember to update is a
 * stamp that will be wrong exactly when it matters.
 */
const buildHash = createHash('sha256').update(app).update(worker).update(style).digest('hex').slice(0, 6);
const buildStamp = `${new Date().toISOString().slice(0, 10)} \u00b7 ${buildHash}`;

const out = read('src/index.html')
  .replace('__NOTICE__', () => notice)
  .replace(/__BUILD__/g, () => buildStamp)
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
console.log('  build     ' + buildStamp);
