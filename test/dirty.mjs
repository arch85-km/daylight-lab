/**
 * Staleness regression: does a change to the model actually move the number?
 *
 * Both engines recompute only what the dirty flags ask for, so a control that
 * mutates state without raising the right flag leaves a stale result on screen
 * under a label that says otherwise. That is not a visible failure — the panel
 * redraws, the status reads ok, and only the number is wrong — so it needs a
 * test that compares the settled result against a forced full recalculation.
 *
 * Each case mirrors the setter body in src/ui.js. Add a case whenever a new
 * control is wired up.
 */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  (cond ? pass++ : fail++);
  console.log(`${cond ? '  PASS' : '  FAIL'}  ${name}${detail ? '  —  ' + detail : ''}`);
};

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell'
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('file://' + join(root, 'daylight-lab.html'));
await page.waitForFunction(() => window.App && App.field, null, { timeout: 90000 });
await page.evaluate(() => Tour.end(false));

/* Every case is [label, metric, sky, mutation]. The mutation is the body of the
   real control's onChange, copied from src/ui.js. */
const CASES = [
  // The site group: all of these land in App.onSiteChanged().
  ['City dropdown',      'illuminance', 'clear', `var s=App.model.site; s.city='Singapore'; s.lat=1.37; s.lon=103.98; s.tz=8; App.onSiteChanged();`],
  ['Latitude',           'illuminance', 'clear', `App.model.site.lat=1.37; App.model.site.city='Custom'; App.onSiteChanged();`],
  ['Longitude',          'illuminance', 'clear', `App.model.site.lon=103.98; App.model.site.city='Custom'; App.onSiteChanged();`],
  ['Time zone',          'illuminance', 'clear', `App.model.site.tz=8; App.onSiteChanged();`],
  ['Project north',      'illuminance', 'clear', `App.model.room.northAngle=90; App.onSiteChanged();`],
  // Date and time go through App.updateSun(), which marks 'sky' itself.
  ['Hour of day',        'illuminance', 'clear', `App.model.when.hour=15; App.updateSun();`],
  ['Month',              'illuminance', 'clear', `App.model.when.month=12; App.updateSun();`],
  // Sky, room, openings, shading, grid and engine.
  ['Sky model',          'illuminance', 'clear', `App.model.analysis.skyModel='intermediate'; App.markDirty('sky');`],
  ['Room length',        'illuminance', 'clear', `App.model.room.L=12; App.markDirty('geometry');`],
  ['Wall thickness',     'illuminance', 'clear', `App.model.room.tWall=0.9; App.markDirty('geometry');`],
  ['Wall reflectance',   'illuminance', 'clear', `App.model.room.refl.wall=0.85; App.model.room.refl.reveal=0.85; App.markDirty('materials');`],
  ['Ground reflectance', 'illuminance', 'clear', `App.model.room.refl.ground=0.8; App.markDirty('materials');`],
  ['Opening width',      'illuminance', 'clear', `App.model.apertures[0].w=1.0; App.markDirty('geometry');`],
  ['Opening wall side',  'illuminance', 'clear', `App.model.apertures[0].side='N'; App.markDirty('geometry');`],
  ['Glazing tau',        'illuminance', 'clear', `App.model.apertures[0].tau=0.2; App.markDirty('materials');`],
  ['Horizontal shade',   'illuminance', 'clear', `var s=App.model.apertures[0].shading; s.h.on=true; s.h.depth=1.5; App.markDirty('geometry');`],
  ['Grid spacing',       'illuminance', 'clear', `App.model.grid.spacing=0.25; App.markDirty('grid');`],
  ['Workplane height',   'illuminance', 'clear', `App.model.grid.height=2.5; App.markDirty('grid');`],
  ['Split-flux engine',  'illuminance', 'clear', `App.model.analysis.engine='splitflux'; App.markDirty('engine');`],
  // Annual metrics.
  ['Target lux (DA)',    'da',          'clear', `App.model.analysis.targetLux=100; App.markDirty('annual');`],
  ['Occupied hours (DA)','da',          'clear', `App.model.analysis.occStart=2; App.markDirty('annual');`],
  ['Latitude (sun h)',   'sunhours',    'clear', `App.model.site.lat=1.37; App.onSiteChanged();`]
];

for (const [label, metric, sky, code] of CASES) {
  await page.evaluate(([m, s]) => {
    App.model = defaultModel();
    App.model.analysis.skyModel = s;
    App.setMetric(m);
    App.markDirty('geometry');
  }, [metric, sky]);
  await page.evaluate(() => App.whenIdle());
  const before = await page.evaluate(() => App.stats.mean);

  await page.evaluate(new Function(code));
  await page.waitForTimeout(900);
  await page.evaluate(() => App.whenIdle());
  const settled = await page.evaluate(() => App.stats.mean);

  // Force everything, the way the Calculate button does.
  await page.evaluate(() => {
    App.dirty.bake = true; App.dirty.slice = true;
    App.dirty.annual = true; App.dirty.compliance = true;
    App.live = false; App.run();
  });
  await page.evaluate(() => App.whenIdle());
  const forced = await page.evaluate(() => App.stats.mean);

  // 2% absorbs Monte-Carlo noise between two bakes and still catches a result
  // that never moved at all, which is what a missing dirty flag looks like.
  const agrees = Math.abs(settled - forced) / Math.max(Math.abs(forced), 1) <= 0.02;
  const moved = Math.abs(before - forced) / Math.max(Math.abs(before), 1) > 0.005;
  ok(`${label} settles to the forced value`, agrees,
    `${before.toFixed(1)} -> ${settled.toFixed(1)} (forced ${forced.toFixed(1)})`);
  ok(`${label} changes the result at all`, moved,
    moved ? '' : 'the control moved nothing — check it reaches the engine');
}

/* Project north must reach the annual run, not only the live view. It is built
   inside the worker from sunPosition(), which knows nothing about the model. */
await page.evaluate(() => {
  App.model = defaultModel();
  App.model.analysis.aseLux = 1000; App.model.analysis.aseHours = 250;
  App.setMetric('ase'); App.markDirty('geometry');
});
await page.evaluate(() => App.whenIdle());
const aseAt = async (deg) => {
  await page.evaluate((d) => { App.model.room.northAngle = d; App.onSiteChanged(); }, deg);
  await page.evaluate(() => App.whenIdle());
  return page.evaluate(() => App.compliance.ase);
};
const a0 = await aseAt(0), a90 = await aseAt(90), aM90 = await aseAt(-90);
ok('project north changes annual ASE', Math.abs(a90 - a0) > 0.5 && Math.abs(aM90 - a0) > 0.5,
  `0° ${a0.toFixed(2)}%  90° ${a90.toFixed(2)}%  -90° ${aM90.toFixed(2)}%`);
ok('project north is not symmetric about 0', Math.abs(a90 - aM90) > 0.5,
  `90° ${a90.toFixed(2)}% vs -90° ${aM90.toFixed(2)}%`);

ok('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
