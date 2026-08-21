/**
 * Headless validation for daylight-lab.html.
 *
 * Physics assertions run against the app's own modules inside the page, so
 * what is tested is exactly what ships. Interface assertions drive the real
 * UI and capture a screenshot of every theme, presentation style and metric.
 */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'test', 'out');
mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0;
const notes = [];
const ok = (name, cond, detail = '') => {
  (cond ? pass++ : fail++);
  const line = `${cond ? '  PASS' : '  FAIL'}  ${name}${detail ? '  —  ' + detail : ''}`;
  console.log(line);
  notes.push(line);
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });

const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));

console.log('\n=== Daylight Lab validation ===\n');
console.log('-- boot --');
await page.goto('file://' + join(root, 'daylight-lab.html'));
await page.waitForFunction(() => window.App && App.result && App.field, null, { timeout: 60000 });
/** Wait until nothing is scheduled, running or queued. */
const idle = () => page.evaluate(() => App.whenIdle());
await idle();
ok('app boots and produces a first result', true);
ok('engine mode', true, await page.evaluate(() => App.engine.mode));

/* ---------------- physics ---------------- */
console.log('\n-- physics --');

const t1 = await page.evaluate(async () => {
  const core = new DaylightCore();
  core.setGeometry({ pos: new Float32Array(0), mat: new Int32Array(0) }, []);
  core.beginBake(Float32Array.from([0, 0.75, 0]), Float32Array.from([0, 1, 0]), { rays: 8192, bounces: 3, mf: 1 });
  core.bakeChunk(0, 1);
  const P = buildSkyPatches(1);
  const sky = buildSkyVector(P, { model: 'overcast', designLux: 10000, groundRefl: 0.2 });
  return 100 * core.diffuse(sky.lum, sky.ground)[0] / sky.Ediff;
});
ok('unobstructed point under CIE overcast = 100% DF', near(t1, 100, 1), t1.toFixed(3) + '%');

const solar = await page.evaluate(() => {
  const cases = [
    ['London 21 Jun noon', { lat: 51.5074, lon: -0.1278, tz: 0 }, 2024, 6, 21, 12.0333, 61.94, 179.8],
    ['Baghdad 21 Jun noon', { lat: 33.3152, lon: 44.3661, tz: 3 }, 2024, 6, 21, 12.05, 80.12, 178.1],
    ['New York 21 Dec noon', { lat: 40.7128, lon: -74.006, tz: -5 }, 2024, 12, 21, 11.94, 25.88, 180.5],
    ['Sydney 21 Dec noon', { lat: -33.8688, lon: 151.2093, tz: 10 }, 2024, 12, 21, 11.9, 79.57, 359.1]
  ];
  return cases.map(([n, loc, y, m, d, h, ea, ez]) => {
    const s = sunPosition(loc, y, m, d, h);
    return { n, alt: s.altitude, azi: s.azimuth, ea, ez, rise: s.sunrise, set: s.sunset };
  });
});
for (const c of solar) {
  ok(`solar position ${c.n}`, near(c.alt, c.ea, 0.1) && near(((c.azi - c.ez + 540) % 360) - 180, 0, 0.5),
    `alt ${c.alt.toFixed(2)}° (exp ${c.ea}), azi ${c.azi.toFixed(2)}° (exp ${c.ez})`);
}

const skyInt = await page.evaluate(() => {
  const P = buildSkyPatches(2);
  let om = 0; for (let i = 0; i < P.n; i++) om += P.omega[i];
  const rel = cieRelative(P, 1, null);
  const uni = cieRelative(P, 5, null);
  return {
    n: P.n, omega: om,
    overcast: horizontalFromPatches(P, rel) / rel[P.n - 1],
    uniform: horizontalFromPatches(P, uni) / uni[0]
  };
});
ok('sky patch solid angles sum to 2π', near(skyInt.omega, 2 * Math.PI, 1e-4), skyInt.omega.toFixed(6));
ok('CIE overcast integral Eh/Lz = 7π/9', near(skyInt.overcast, 7 * Math.PI / 9, 0.02),
  skyInt.overcast.toFixed(4) + ' vs ' + (7 * Math.PI / 9).toFixed(4));
ok('uniform sky integral Eh/L = π', near(skyInt.uniform, Math.PI, 0.01), skyInt.uniform.toFixed(4));

const mono = await page.evaluate(async () => {
  const grid = App.grid;
  const run = (mutate, rays = 512) => {
    const m = defaultModel(); mutate(m);
    const b = buildModel(m, {});
    const c = new DaylightCore(); c.setGeometry(b.tri, b.materials);
    c.beginBake(grid.pts, grid.nrm, { rays, bounces: 4, mf: 1 }); c.bakeChunk(0, grid.n);
    const P = buildSkyPatches(1);
    const sky = buildSkyVector(P, { model: 'overcast', designLux: 10000, groundRefl: 0.2 });
    const E = c.diffuse(sky.lum, sky.ground);
    let s = 0; for (let i = 0; i < E.length; i++) s += 100 * E[i] / sky.Ediff;
    return s / E.length;
  };
  const refl = [0, 0.3, 0.6, 0.85].map((r) => run((m) => {
    m.room.refl.wall = m.room.refl.ceiling = m.room.refl.floor = m.room.refl.reveal = r;
  }));
  const overhang = [0, 0.4, 0.8, 1.6].map((d) => run((m) => {
    m.apertures = [makeAperture({ name: 'S', side: 'S', w: 5, h: 1.8, sill: 0.8 })];
    if (d > 0) m.apertures[0].shading.h = { on: true, depth: d, thickness: 0.06, offset: 0.1, extend: 0.4, count: 1, tilt: 0 };
  }));
  const thickness = [0.1, 0.4, 0.9].map((t) => run((m) => {
    m.room.tWall = t;
    m.apertures = [makeAperture({ name: 'S', side: 'S', w: 4, h: 1.5, sill: 0.9, glassPos: 1 })];
  }));
  return { refl, overhang, thickness };
});
const isUp = (a) => a.every((v, i) => i === 0 || v > a[i - 1]);
const isDown = (a) => a.every((v, i) => i === 0 || v < a[i - 1]);
ok('DF rises monotonically with surface reflectance', isUp(mono.refl), mono.refl.map((v) => v.toFixed(2)).join(' → '));
ok('DF falls monotonically with overhang depth', isDown(mono.overhang), mono.overhang.map((v) => v.toFixed(2)).join(' → '));
ok('DF falls with wall thickness (reveal shading)', isDown(mono.thickness), mono.thickness.map((v) => v.toFixed(2)).join(' → '));

const engines = await page.evaluate(async () => {
  const grid = App.grid, P = buildSkyPatches(1);
  const sky = buildSkyVector(P, { model: 'overcast', designLux: 10000, groundRefl: 0.2 });
  const mean = (a) => { let s = 0; for (const v of a) s += v; return s / a.length; };
  const build = (mutate) => { const m = defaultModel(); mutate(m); return m; };
  const rt = (m) => {
    const b = buildModel(m, {});
    const c = new DaylightCore(); c.setGeometry(b.tri, b.materials);
    c.beginBake(grid.pts, grid.nrm, { rays: 1024, bounces: 4, mf: 1 }); c.bakeChunk(0, grid.n);
    const E = c.diffuse(sky.lum, sky.ground);
    return mean(Array.from(E, (v) => 100 * v / sky.Ediff));
  };
  const sf = (m) => mean(splitFluxGrid(m, grid.pts, grid.nrm, 8).df);

  const plain = build((m) => { m.apertures = [makeAperture({ name: 'S', side: 'S', w: 4, h: 1.6, sill: 0.9 })]; });
  const shaded = build((m) => {
    const w = makeAperture({ name: 'S', side: 'S', w: 4, h: 1.6, sill: 0.9 });
    w.shading.h = { on: true, depth: 1.0, thickness: 0.08, offset: 0.1, extend: 0.4, count: 1, tilt: 0 };
    m.apertures = [w];
  });
  return { plainRt: rt(plain), plainSf: sf(plain), shadedRt: rt(shaded), shadedSf: sf(shaded) };
});
const agree = Math.abs(engines.plainRt - engines.plainSf) / engines.plainRt;
ok('two engines agree on an unshaded window (within 30%)', agree < 0.30,
  `raytraced ${engines.plainRt.toFixed(2)}% vs split-flux ${engines.plainSf.toFixed(2)}% (${(agree * 100).toFixed(0)}% apart)`);
ok('raytraced engine sees the overhang, split-flux does not',
  engines.shadedRt < engines.plainRt * 0.92 && Math.abs(engines.shadedSf - engines.plainSf) < 0.01,
  `raytraced ${engines.plainRt.toFixed(2)}→${engines.shadedRt.toFixed(2)}%, split-flux ${engines.plainSf.toFixed(2)}→${engines.shadedSf.toFixed(2)}%`);

/* ---------------- annual metrics ---------------- */
console.log('\n-- annual metrics --');
await page.evaluate(() => { App.setMetric('udi'); });
await idle();
await page.waitForFunction(() => App.result && App.result.annual && App.compliance, null, { timeout: 120000 });

const ann = await page.evaluate(() => {
  const r = App.result.annual, n = App.result.n;
  let binsOk = 0, minSum = Infinity, maxSum = -Infinity;
  for (let i = 0; i < n; i++) {
    let t = 0; for (let b = 0; b < 5; b++) t += r.udi[i * 5 + b];
    if (Math.abs(t - r.hours) < 0.5) binsOk++;
    minSum = Math.min(minSum, t); maxSum = Math.max(maxSum, t);
  }
  return {
    n, hours: r.hours, binsOk, minSum, maxSum,
    sda: App.compliance.sda, ase: App.compliance.ase,
    udiMean: App.compliance.udiMean,
    annualMs: App.annualMs, bakeMs: App.bakeMs
  };
});
ok('UDI intervals sum to the total occupied hours at every point', ann.binsOk === ann.n,
  `${ann.binsOk}/${ann.n} points, ${ann.hours} hours`);
ok('sDA and ASE lie in [0,100]', ann.sda >= 0 && ann.sda <= 100 && ann.ase >= 0 && ann.ase <= 100,
  `sDA ${ann.sda.toFixed(1)}%, ASE ${ann.ase.toFixed(1)}%`);
ok('UDI interval means sum to 100%', near(ann.udiMean.reduce((a, b) => a + b, 0), 100, 0.5),
  ann.udiMean.map((v) => v.toFixed(1)).join(' | '));
ok('bake within budget', ann.bakeMs < 12000, `bake ${ann.bakeMs} ms, annual ${ann.annualMs} ms, ${ann.n} points`);
notes.push(`  TIMING  bake ${ann.bakeMs} ms · annual ${ann.annualMs} ms · ${ann.n} grid points`);

/* ---------------- roof-closed reading ---------------- */
console.log('\n-- enclosed-room reading --');
const roof = await page.evaluate(async () => {
  App.setMetric('df');
  await App.whenIdle();
  const closedMean = App.stats.mean;
  App.setViewMode('plan');
  await App.whenIdle();
  const planMean = App.stats.mean;
  const planRoofFlag = document.getElementById('bb-roof').textContent;
  App.setViewMode('3d');
  App.display.roofRemoved = true; App.markDirty('geometry');
  await App.whenIdle();
  const openMean = App.stats.mean;
  App.display.roofRemoved = false; App.markDirty('geometry');
  await App.whenIdle();
  return { closedMean, planMean, openMean, planRoofFlag, restored: App.stats.mean };
});
ok('plan view does not change the result (roof stays in the calculation)',
  near(roof.planMean, roof.closedMean, Math.max(0.05, roof.closedMean * 0.02)),
  `3D ${roof.closedMean.toFixed(3)}% vs plan ${roof.planMean.toFixed(3)}%`);
ok('plan view states the roof is still closed', /CLOSED \(in calculation\)/.test(roof.planRoofFlag), roof.planRoofFlag);
ok('removing the roof from the calculation raises DF sharply', roof.openMean > roof.closedMean * 2,
  `${roof.closedMean.toFixed(2)}% → ${roof.openMean.toFixed(2)}%`);

/* ---------------- data round trips ---------------- */
console.log('\n-- data --');
const data = await page.evaluate(() => {
  const csv = gridToCsv(App.result, App.metric, App.field, { test: '1' });
  const rows = csv.split('\n').filter((l) => l && !l.startsWith('#') && !l.startsWith('index'));
  const json = exportJson(App.model);
  const back = importJson(json);
  return {
    csvRows: rows.length, n: App.result.n,
    sameRoom: JSON.stringify(back.room) === JSON.stringify(App.model.room),
    sameApCount: back.apertures.length === App.model.apertures.length,
    hasCopyright: json.includes('Karam Al-Obaidi')
  };
});
ok('CSV row count equals the grid point count', data.csvRows === data.n, `${data.csvRows} rows / ${data.n} points`);
ok('model JSON round-trips', data.sameRoom && data.sameApCount);
ok('exported JSON carries the copyright', data.hasCopyright);

const epw = await page.evaluate(() => {
  // a minimal synthetic EPW, to prove the parser and its error path
  const head = ['LOCATION,Testville,XX,TST,SYN,000000,45.00,9.00,1.0,100',
    'DESIGN CONDITIONS,0', 'TYPICAL/EXTREME PERIODS,0', 'GROUND TEMPERATURES,0',
    'HOLIDAYS/DAYLIGHT SAVINGS,No,0,0,0', 'COMMENTS 1,synthetic', 'COMMENTS 2,-',
    'DATA PERIODS,1,1,Data,Sunday, 1/ 1,12/31'];
  const rows = [];
  const md = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  for (let m = 1; m <= 12; m++) for (let d = 1; d <= md[m - 1]; d++) for (let h = 1; h <= 24; h++) {
    const day = h > 6 && h < 19;
    rows.push(`2001,${m},${d},${h},60,?,15,8,70,101300,0,0,300,${day ? 400 : 0},${day ? 600 : 0},${day ? 120 : 0},999999,999999,999999,999999,180,3,5,5,20,7500,0,0,0,0,0,0,0,0,0,0`);
  }
  const text = head.concat(rows).join('\n');
  const c = parseEpw(text);
  let err = null;
  try { parseEpw('NOT AN EPW\n'); } catch (e) { err = e.message; }
  return { name: c.name, lat: c.loc.lat, tz: c.loc.tz, peak: c.peakGhi, rejects: !!err };
});
ok('EPW parses (header, 8760 rows, location applied)',
  epw.lat === 45 && epw.tz === 1 && epw.peak > 0, `${epw.name}, peak GHI ${epw.peak.toFixed(0)} W/m²`);
ok('a non-EPW file is rejected with a message', epw.rejects);

/* ---------------- interface ---------------- */
console.log('\n-- interface --');
await page.evaluate(async () => {
  App.setMetric('df');
  App.addAperture('window');
  App.addAperture('skylight');
  const ap = App.model.apertures[App.model.apertures.length - 1];
  App.model.apertures[0].shading.h = { on: true, depth: 0.6, thickness: 0.06, offset: 0.1, extend: 0.3, count: 3, tilt: 10 };
  App.model.apertures[0].shading.v = { on: true, depth: 0.4, thickness: 0.05, offset: 0.05, extend: 0.1, count: 4, tilt: 20, side: 'both' };
  App.markDirty('geometry');
  await App.whenIdle();
});
await idle();
ok('adding openings and shading recalculates', true,
  await page.evaluate(() => `${App.model.apertures.length} openings, mean DF ${App.stats.mean.toFixed(2)}%`));

const dimEdit = await page.evaluate(async () => {
  const before = App.model.room.L;
  const d = App.dims.filter((x) => x.id === 'room.L')[0];
  d.set(11.5); App.markDirty('geometry');
  await App.whenIdle();
  return { before, after: App.model.room.L, gridN: App.gridInfo().n };
});
ok('editing a dimension drives the model', dimEdit.after === 11.5,
  `length ${dimEdit.before} → ${dimEdit.after} m, grid now ${dimEdit.gridN} points`);
await page.evaluate(async () => { App.resetModel(); await App.whenIdle(); });
await idle();

const rays = await page.evaluate(async () => {
  App.setDate(6, 21); App.model.when.hour = 14; App.updateSun();
  App.rays.enabled = true; App.rays.density = 40; App.markDirty('rays');
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const a = App.rayStats;
  App.rays.sunSizeDeg = 5; App.markDirty('sunsize');
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  return { count: a && a.count, lit: a && a.lit, shadowRadius: App.view.sunLight.shadow.radius };
});
ok('solar rays trace through the glazing', rays.count > 0 && rays.lit > 0, `${rays.lit} of ${rays.count} sample points in sun`);
ok('sun size drives the shadow penumbra', rays.shadowRadius > 8, 'shadow radius ' + rays.shadowRadius.toFixed(1));
await page.evaluate(() => { App.rays.sunSizeDeg = 0.53; App.markDirty('sunsize'); });

const chart = await page.evaluate(() => {
  const d = document.getElementById('panel-solar');
  d.open = true; d.dispatchEvent(new Event('toggle'));
  const svg = document.getElementById('spchart');
  const t0 = performance.now();
  renderSunChart(svg, App.model, App.sun);
  return { children: svg.childElementCount, ms: performance.now() - t0,
           today: svg.querySelectorAll('.sp-today').length,
           now: svg.querySelectorAll('.sp-now').length };
});
ok('2D sun-path chart draws', chart.children > 30 && chart.today > 0,
  `${chart.children} elements in ${chart.ms.toFixed(1)} ms`);
ok('chart marks the current sun position', chart.now === 1);

const extras = await page.evaluate(async () => {
  App.setMetric('df');
  await App.whenIdle();
  const adf = averageDaylightFactor(App.model);
  const statsTxt = document.getElementById('stats-body').textContent;
  App.setMetric('udi');
  await App.whenIdle();
  const before = App.stats.mean;
  App.udiView = 'excess'; App.markDirty('display');
  await App.whenIdle();
  const after = App.stats.mean;
  App.udiView = 'useful'; App.markDirty('display');
  await App.whenIdle();
  App.setMetric('df');
  await App.whenIdle();
  return { adf, hasAdf: /ADF/.test(statsTxt), before, after };
});
ok('ADF (BS 8206-2) computed and shown with DF', extras.hasAdf && extras.adf > 0 && extras.adf < 40,
  'ADF ' + extras.adf.toFixed(2) + '%');
ok('UDI interval selector changes the displayed field', Math.abs(extras.after - extras.before) > 1,
  `useful ${extras.before.toFixed(1)}% vs too-high ${extras.after.toFixed(1)}%`);

/* ---------------- screenshots ---------------- */
console.log('\n-- screenshots --');
const shot = async (name) => {
  await idle();
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.screenshot({ path: join(OUT, name + '.png') });
  console.log('  shot  ' + name + '.png');
};

for (const theme of ['light', 'dark', 'clay']) {
  await page.evaluate((t) => { App.setTheme(t); App.view.setStandardView('iso'); }, theme);
  await shot('theme-' + theme);
}
await page.evaluate(() => App.setTheme('light'));

for (const style of ['smooth', 'cells', 'contour', 'dots', 'numbers', 'relief']) {
  await page.evaluate((s) => {
    App.display.style = s;
    App.display.showValues = (s === 'numbers');
    App.markDirty('display'); App.refreshDisplay();
  }, style);
  await shot('style-' + style);
}
await page.evaluate(() => { App.display.style = 'smooth'; App.display.showValues = false; App.markDirty('display'); App.refreshDisplay(); });

for (const m of ['illuminance', 'df', 'udi', 'da', 'ase', 'sunhours']) {
  await page.evaluate((k) => App.setMetric(k), m);
  await idle();
  await shot('metric-' + m);
}
await page.evaluate(() => App.setMetric('df'));

await page.evaluate(() => { App.setViewMode('plan'); App.display.showValues = true; App.markDirty('labels'); });
await shot('view-plan-values');
await page.evaluate(() => { App.display.showValues = false; App.setViewMode('elev'); });
await shot('view-elevation');
await page.evaluate(() => {
  App.setViewMode('3d');
  App.rays.enabled = true; App.rays.density = 60; App.rays.sunSizeDeg = 1.2;
  App.setDate(12, 21); App.model.when.hour = 12; App.updateSun();
  DIM_GROUPS.forEach((g) => { App.display.dims[g] = g === 'room' || g === 'aperture'; });
  App.markDirty('dims'); App.markDirty('rays');
});
await shot('rays-and-dimensions');

await page.evaluate(() => {
  App.setTheme('dark'); App.setDate(6, 21); App.model.when.hour = 10; App.updateSun();
  App.rays.sunSizeDeg = 0.53; App.rays.density = 90;
  App.markDirty('rays');
});
await shot('dark-sunpath');
await page.evaluate(() => { App.setTheme('light'); App.rays.enabled = false; App.markDirty('rays'); });

await page.evaluate(() => { App.display.section = { on: true, axis: 'z', pos: 0, flip: false }; App.markDirty('section'); });
await shot('section-cut');
await page.evaluate(() => { App.display.section.on = false; App.markDirty('section'); });

await page.evaluate(() => App.openInfo('udi'));
await shot('info-udi');
await page.evaluate(() => closeModal());

/* mobile */
await page.setViewportSize({ width: 390, height: 844 });
await page.evaluate(() => { App.view.resize(); App.view.frame(); });
await shot('mobile-390');
const mobile = await page.evaluate(() => {
  const rail = document.getElementById('rail').getBoundingClientRect();
  const stage = document.getElementById('stage').getBoundingClientRect();
  return {
    railBelowStage: rail.top >= stage.top + stage.height - 2,
    noHScroll: document.documentElement.scrollWidth <= window.innerWidth + 1,
    canvasW: document.getElementById('view').clientWidth
  };
});
ok('mobile layout stacks the rail below the viewport', mobile.railBelowStage);
ok('no horizontal page scroll at 390 px', mobile.noHScroll, 'canvas ' + mobile.canvasW + ' px wide');
await page.setViewportSize({ width: 1440, height: 900 });

/* export */
console.log('\n-- export --');
const exp = await page.evaluate(async () => {
  const seen = [];
  const origCreate = document.createElement.bind(document);
  document.createElement = function (t) {
    const n = origCreate(t);
    if (t === 'a') { const c = n.click.bind(n); n.click = function () { seen.push(n.download); }; }
    return n;
  };
  App.exportOpts.showValues = true;
  App.exportImage();
  await new Promise((r) => setTimeout(r, 1200));
  App.exportCsv();
  App.exportModel();
  document.createElement = origCreate;
  return seen;
});
ok('export produces PNG, CSV and JSON downloads',
  exp.some((f) => /\.png$/.test(f)) && exp.some((f) => /\.csv$/.test(f)) && exp.some((f) => /\.json$/.test(f)),
  exp.join(', '));

const copyright = await page.evaluate(() => document.getElementById('copyright').textContent.trim());
ok('copyright shown bottom-left', copyright === '© Karam Al-Obaidi', copyright);

/* console */
console.log('\n-- console --');
const real = consoleErrors.filter((e) => !/favicon|Download is not allowed|net::ERR_/i.test(e));
ok('no console errors through the whole session', real.length === 0, real.slice(0, 5).join(' | '));

await browser.close();

writeFileSync(join(OUT, 'report.txt'),
  `Daylight Lab validation\n${new Date().toISOString()}\n\n${notes.join('\n')}\n\n${pass} passed, ${fail} failed\n`);
console.log(`\n=== ${pass} passed, ${fail} failed ===\n`);
process.exit(fail ? 1 : 0);
