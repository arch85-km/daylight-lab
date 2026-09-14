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
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

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
// the first-run tour puts a modal overlay over everything; dismiss it so the
// interaction tests below drive the real interface (it gets its own section)
await page.waitForFunction(() => window.Tour && Tour.active, null, { timeout: 10000 });
ok('the guided tour opens on launch', true);
await page.evaluate(() => Tour.end(false));
ok('app boots and produces a first result', true);
const rail = await page.evaluate(() => ({
  total: document.querySelectorAll('.panel').length,
  open: [...document.querySelectorAll('.panel')].filter((d) => d.open).map((d) => d.id)
}));
ok('the toolbar starts fully collapsed', rail.open.length === 0 && rail.total === 12,
  `${rail.total} panels, ${rail.open.length} open`);
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
const dropRt = 1 - engines.shadedRt / engines.plainRt;
const dropSf = 1 - engines.shadedSf / engines.plainSf;
ok('BOTH engines now see the overhang',
  dropRt > 0.08 && dropSf > 0.08,
  `raytraced ${engines.plainRt.toFixed(2)}→${engines.shadedRt.toFixed(2)}% (−${(dropRt * 100).toFixed(0)}%), ` +
  `split-flux ${engines.plainSf.toFixed(2)}→${engines.shadedSf.toFixed(2)}% (−${(dropSf * 100).toFixed(0)}%)`);
ok('their responses to shading are of the same order',
  dropSf > dropRt * 0.4 && dropSf < dropRt * 2.5,
  `ratio ${(dropSf / dropRt).toFixed(2)}`);

const sfGeom = await page.evaluate(() => {
  const grid = App.grid;
  const mean = (a) => { let s = 0; for (const v of a) s += v; return s / a.length; };
  const sf = (mutate) => {
    const m = defaultModel(); mutate(m);
    return mean(splitFluxGrid(m, grid.pts, grid.nrm, 6).df);
  };
  const south = (m) => makeAperture({ name: 'S', side: 'S', w: 5, h: 1.8, sill: 0.8 });
  return {
    depths: [0, 0.4, 0.8, 1.6].map((d) => sf((m) => {
      const w = south(m);
      if (d > 0) w.shading.h = { on: true, depth: d, thickness: 0.06, offset: 0.1, extend: 0.4, count: 1, tilt: 0 };
      m.apertures = [w];
    })),
    louvre: sf((m) => {
      const w = south(m);
      w.shading.h = { on: true, depth: 0.35, thickness: 0.04, offset: 0.1, extend: 0.2, count: 5, tilt: 15 };
      m.apertures = [w];
    }),
    fins: sf((m) => {
      const w = makeAperture({ name: 'E', side: 'E', w: 4, h: 1.8, sill: 0.8 });
      w.shading.v = { on: true, depth: 0.5, thickness: 0.05, offset: 0.05, extend: 0.1, count: 6, tilt: 25, side: 'both' };
      m.apertures = [w];
    }),
    finsBase: sf((m) => { m.apertures = [makeAperture({ name: 'E', side: 'E', w: 4, h: 1.8, sill: 0.8 })]; }),
    // With the glass at the INNER face, split-flux must be exactly insensitive
    // to wall thickness: it has no term for the reveal cutting off oblique sky,
    // and the glazing plane is no longer moving. That is the sharp boundary.
    thin: sf((m) => { m.room.tWall = 0.10; m.apertures = [makeAperture({ name: 'S', side: 'S', w: 5, h: 1.8, sill: 0.8, glassPos: 0 })]; }),
    thick: sf((m) => { m.room.tWall = 0.90; m.apertures = [makeAperture({ name: 'S', side: 'S', w: 5, h: 1.8, sill: 0.8, glassPos: 0 })]; }),
    unshadedFactor: (() => {
      const m = defaultModel();
      return splitFluxGrid(m, grid.pts, grid.nrm, 6).shadeFactor;
    })()
  };
});
ok('split-flux DF falls monotonically with overhang depth',
  sfGeom.depths.every((v, i) => i === 0 || v < sfGeom.depths[i - 1]),
  sfGeom.depths.map((v) => v.toFixed(2)).join(' → '));
ok('split-flux reads a louvre bank and a fin array, not just one overhang',
  sfGeom.louvre < sfGeom.depths[0] * 0.85 && sfGeom.fins < sfGeom.finsBase * 0.85,
  `louvres ${sfGeom.depths[0].toFixed(2)}→${sfGeom.louvre.toFixed(2)}%, fins ${sfGeom.finsBase.toFixed(2)}→${sfGeom.fins.toFixed(2)}%`);
ok('an unshaded model leaves split-flux untouched (shadeFactor exactly 1)',
  sfGeom.unshadedFactor === 1, 'shadeFactor = ' + sfGeom.unshadedFactor);
ok('split-flux cannot see the reveal cut off oblique sky (glass at inner face)',
  Math.abs(sfGeom.thick - sfGeom.thin) < 1e-6,
  `0.10 m ${sfGeom.thin.toFixed(3)}% vs 0.90 m ${sfGeom.thick.toFixed(3)}% — identical`);
ok('…while the raytracer drops sharply on the same change',
  mono.thickness[0] > mono.thickness[2] * 1.3,
  mono.thickness.map((v) => v.toFixed(2)).join(' → '));

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
console.log('\n-- split-flux direct sun --');

const bothEngines = async (metric) => {
  const out = {};
  for (const eng of ['raytrace', 'splitflux']) {
    await page.evaluate(async ([e, mk]) => {
      App.model.analysis.engine = e; App.markDirty('engine');
      App.setMetric(mk); App.dirty.annual = true; App.schedule(0);
      await App.whenIdle();
    }, [eng, metric]);
    out[eng] = await page.evaluate(() => ({
      mean: App.stats ? App.stats.mean : null,
      ase: App.compliance ? App.compliance.ase : null
    }));
  }
  return out;
};

const sunH = await bothEngines('sunhours');
ok('split-flux reports non-zero direct sun hours', sunH.splitflux.mean > 1,
  sunH.splitflux.mean.toFixed(1) + ' h');
ok('sun hours agree across engines (pure sun geometry)',
  Math.abs(sunH.raytrace.mean - sunH.splitflux.mean) < Math.max(1, sunH.raytrace.mean * 0.02),
  `raytraced ${sunH.raytrace.mean.toFixed(1)} h vs split-flux ${sunH.splitflux.mean.toFixed(1)} h`);

const aseM = await bothEngines('ase');
ok('split-flux reports non-zero ASE', aseM.splitflux.mean > 1, aseM.splitflux.mean.toFixed(1) + ' h');
ok('ASE agrees across engines', Math.abs(aseM.raytrace.ase - aseM.splitflux.ase) < 2,
  `raytraced ${aseM.raytrace.ase.toFixed(0)}% vs split-flux ${aseM.splitflux.ase.toFixed(0)}% of area`);

const sfBeam = await page.evaluate(async () => {
  App.model.analysis.engine = 'splitflux';
  App.model.analysis.skyModel = 'perez';
  App.setMetric('illuminance');
  App.model.apertures = [makeAperture({ name: 'S', side: 'S', w: 5, h: 1.8, sill: 0.8 })];
  App.setDate(6, 21); App.model.when.hour = 12; App.updateSun();
  App.markDirty('geometry'); await App.whenIdle();
  const noon = App.stats.mean;
  const beam = App.result.direct ? App.result.direct.reduce((a, c) => a + c, 0) : 0;
  const lit = App.result.direct ? App.result.direct.filter((v) => v > 1).length : 0;
  App.model.when.hour = 5; App.updateSun(); await App.whenIdle();
  const dawn = App.stats.mean;
  App.model.when.hour = 12; App.updateSun();
  App.model.apertures[0].shading.h =
    { on: true, depth: 1.2, thickness: 0.08, offset: 0.1, extend: 0.4, count: 1, tilt: 0 };
  App.markDirty('geometry'); await App.whenIdle();
  const shaded = App.stats.mean;
  App.resetModel(); App.model.analysis.engine = 'raytrace'; App.markDirty('geometry');
  await App.whenIdle();
  return { noon, dawn, shaded, beam, lit };
});
ok('split-flux illuminance carries a real direct beam',
  sfBeam.beam > 0 && sfBeam.lit > 0, `${sfBeam.lit} points sunlit at June noon`);
ok('split-flux illuminance falls when shading is added', sfBeam.shaded < sfBeam.noon * 0.8,
  `${sfBeam.noon.toFixed(0)} lx unshaded → ${sfBeam.shaded.toFixed(0)} lx with a 1.2 m overhang`);
ok('split-flux illuminance tracks the sun through the day', sfBeam.dawn < sfBeam.noon * 0.4,
  `05:00 ${sfBeam.dawn.toFixed(0)} lx vs 12:00 ${sfBeam.noon.toFixed(0)} lx`);

const sealed = await page.evaluate(() => {
  // A room with no openings must read exactly zero. Anything else is a light
  // leak through the geometry or a ray-origin epsilon problem.
  const m = defaultModel();
  m.apertures = [];
  const b = buildModel(m, {});
  const core = new DaylightCore();
  core.setGeometry(b.tri, b.materials);
  core.beginBake(App.grid.pts, App.grid.nrm, { rays: 512, bounces: 4, mf: 1 });
  core.bakeChunk(0, App.grid.n);
  const P = buildSkyPatches(1);
  const sky = buildSkyVector(P, { model: 'overcast', designLux: 10000, groundRefl: 0.2 });
  const E = core.diffuse(sky.lum, sky.ground);
  let max = 0; for (let i = 0; i < E.length; i++) max = Math.max(max, E[i]);
  const sf = splitFluxGrid(m, App.grid.pts, App.grid.nrm, 6);
  let sfMax = 0; for (let i = 0; i < sf.df.length; i++) sfMax = Math.max(sfMax, sf.df[i]);
  return { rtMax: max, sfMax: sfMax };
});
ok('SEALED BOX: raytracer leaks no light into a room with no openings',
  sealed.rtMax === 0, 'max ' + sealed.rtMax.toExponential(2) + ' lx');
ok('SEALED BOX: split-flux likewise reads zero', sealed.sfMax === 0,
  'max ' + sealed.sfMax.toExponential(2) + '%');

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

/* ---------------- dragging an opening ---------------- */
console.log('\n-- drag to move --');

/** Screen position of an opening's centre, in page coordinates. */
const screenOf = (side) => page.evaluate((sd) => {
  const ap = App.model.apertures.find((a) => a.side === sd);
  if (!ap) return null;
  const F = frameFor(sd, App.model.room), r = apertureRect(ap, App.model.room);
  const c = fpt(F, (r[0] + r[1]) / 2, (r[2] + r[3]) / 2, F.t);
  const pr = App.view.project(c[0], c[1], c[2]);
  const cr = document.getElementById('view').getBoundingClientRect();
  return { sx: cr.left + pr.x, sy: cr.top + pr.y, visible: pr.visible };
}, side);

const aimAt = async (view) => {
  await page.evaluate((v) => {
    App.resetModel();
    App.setViewMode('3d');
    App.view.setStandardView(v);
    App.view.frame();
  }, view);
  await idle();
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
};
const dragBy = async (pt, dx, dy, steps = 10, mods = []) => {
  for (const m of mods) await page.keyboard.down(m);
  await page.mouse.move(pt.sx, pt.sy);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(pt.sx + dx * i / steps, pt.sy + dy * i / steps);
    await page.waitForTimeout(14);
  }
  await page.mouse.up();
  for (const m of mods) await page.keyboard.up(m);
  await idle();
};
const southAp = () => page.evaluate(() => {
  const a = App.model.apertures.find((x) => x.side === 'S');
  return { offset: +a.offset.toFixed(3), sill: +a.sill.toFixed(3), w: a.w, h: a.h };
});

const pick = await page.evaluate(() => {
  const ap = App.model.apertures.find((a) => a.side === 'S');
  const F = frameFor('S', App.model.room), r = apertureRect(ap, App.model.room);
  const on = (u, v, d) => { const p = fpt(F, u, v, d); return apertureAtPoint(App.model, p, 0.025); };
  const door = App.model.apertures.find((a) => a.kind === 'door');
  const FD = frameFor(door.side, App.model.room), rd = apertureRect(door, App.model.room);
  const dp = fpt(FD, (rd[0] + rd[1]) / 2, (rd[2] + rd[3]) / 2, FD.t / 2);
  return {
    glass: (on((r[0] + r[1]) / 2, (r[2] + r[3]) / 2, F.t / 2) || {}).id === ap.id,
    reveal: (on(r[0] + 0.001, (r[2] + r[3]) / 2, F.t / 2) || {}).id === ap.id,
    door: (apertureAtPoint(App.model, dp, 0.025) || {}).id === door.id,
    wall: apertureAtPoint(App.model, fpt(F, r[0] - 0.6, 0.3, F.t / 2), 0.025) === null
  };
});
ok('hit test finds the opening from glass, reveal and door leaf',
  pick.glass && pick.reveal && pick.door, JSON.stringify(pick));
ok('hit test returns nothing on blank wall', pick.wall);

await aimAt('south');
const s0 = await southAp();
const pS = await screenOf('S');
await dragBy(pS, 60, 0);
const s1 = await southAp();
ok('dragging an opening moves it along its wall', s1.offset > s0.offset + 0.2,
  `offset ${s0.offset} → ${s1.offset} m`);
ok('a move changes position only, never size', s1.w === s0.w && s1.h === s0.h);
ok('the move reaches the daylight engine', true,
  'mean DF now ' + (await page.evaluate(() => App.stats.mean.toFixed(2))) + '%');
ok('the dragged opening becomes the selected one',
  await page.evaluate(() => UI.selectedAperture === App.model.apertures.find((a) => a.side === 'S').id));

await page.keyboard.press('Control+z');
await idle();
ok('Ctrl+Z restores the position exactly', (await southAp()).offset === s0.offset,
  'back to ' + (await southAp()).offset + ' m');

await aimAt('south');
const pV = await screenOf('S');
await dragBy(pV, 0, -60, 8);
const sv = await southAp();
ok('dragging vertically changes the sill', sv.sill > s0.sill + 0.2 && sv.offset === s0.offset,
  `sill ${s0.sill} → ${sv.sill} m`);

await aimAt('south');
const pC = await screenOf('S');
await dragBy(pC, 700, 0, 20);
const sc = await southAp();
const limit = await page.evaluate(() => {
  const a = App.model.apertures.find((x) => x.side === 'S'), R = App.model.room;
  return +(R.L / 2 - 0.05 - a.w / 2).toFixed(3);
});
ok('a move is clamped inside the wall', Math.abs(sc.offset - limit) < 1e-6,
  `stopped at ${sc.offset} m, wall limit ${limit} m`);

await aimAt('top');
const pk = await screenOf('roof');
const rBefore = await page.evaluate(() => {
  const a = App.model.apertures.find((x) => x.side === 'roof');
  return { offset: a.offset, offset2: a.offset2, sill: a.sill };
});
await dragBy(pk, 70, 45, 10);
const rAfter = await page.evaluate(() => {
  const a = App.model.apertures.find((x) => x.side === 'roof');
  return { offset: +a.offset.toFixed(2), offset2: +a.offset2.toFixed(2), sill: a.sill };
});
ok('a skylight moves in both X and Z, not in sill',
  rAfter.offset !== rBefore.offset && rAfter.offset2 !== rBefore.offset2 && rAfter.sill === rBefore.sill,
  `X ${rAfter.offset} m, Z ${rAfter.offset2} m`);

await aimAt('south');
const camBefore = await page.evaluate(() => App.view.camera.position.toArray().map((v) => +v.toFixed(3)));
const pO = await screenOf('S');
await dragBy(pO, 70, 25, 8, ['Shift']);
const camAfter = await page.evaluate(() => App.view.camera.position.toArray().map((v) => +v.toFixed(3)));
ok('shift-drag still moves the camera, not the opening',
  (await southAp()).offset === s0.offset && JSON.stringify(camBefore) !== JSON.stringify(camAfter));

await page.evaluate(() => { App.resetModel(); App.setViewMode('plan'); });
await idle();
await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const pP = await screenOf('S');
if (pP) await dragBy(pP, 90, 0, 8);
ok('a wall opening cannot be dragged edge-on in plan view',
  (await southAp()).offset === s0.offset);
await page.evaluate(async () => { App.setViewMode('3d'); App.resetModel(); await App.whenIdle(); });
await idle();

/* ---------------- viewport navigation ---------------- */
console.log('\n-- navigation --');

// framing must describe the room, not whatever else happens to be in the scene
const framing = await page.evaluate(async () => {
  const d = () => { App.view.frame(); return +App.view.ctl.dist.toFixed(4); };
  App.display.showSunPath = true; App.markDirty('sunpath');
  await App.whenIdle();
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const withDome = d(), domeShown = App.view.gSun.children.length > 0;
  App.display.showSunPath = false; App.markDirty('sunpath');
  await App.whenIdle();
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const without = d();
  App.display.showSunPath = true; App.markDirty('sunpath');
  await App.whenIdle();
  return { withDome, without, domeShown };
});
await idle();
ok('the sun-path dome does not push the camera off the room',
  framing.domeShown && framing.withDome === framing.without,
  `dist ${framing.withDome} m with the dome, ${framing.without} m without`);

// Fit must put the room inside the part of the canvas that no floating panel
// covers, centred there, at every window size — measured through the real
// projection, not estimated.
const fits = [];
for (const [w, h] of [[1901, 930], [1920, 1080], [1600, 900], [1440, 900],
  [1366, 768], [1024, 768], [915, 925], [768, 1024], [390, 844]]) {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(120);          // let the ResizeObserver settle first
  // fit and measure in one turn: a resize landing between the two would
  // change the projection under the measurement
  fits.push(await page.evaluate((size) => {
    App.view.resize(); App.fitView();
    const c = App.view.clearRect(), m = App.view._modelBounds(App.built.outer);
    return {
      size,
      inside: m.x0 >= c.x - 1 && m.x1 <= c.x + c.w + 1 &&
              m.y0 >= c.y - 1 && m.y1 <= c.y + c.h + 1,
      centred: Math.abs(m.cx - (c.x + c.w / 2)) <= 1 &&
               Math.abs(m.cy - (c.y + c.h / 2)) <= 1,
      fill: Math.max(m.w / c.w, m.h / c.h),
      off: [Math.round(m.cx - (c.x + c.w / 2)), Math.round(m.cy - (c.y + c.h / 2))],
      clear: [Math.round(c.x), Math.round(c.y), Math.round(c.w), Math.round(c.h)],
      canvas: [Math.round(c.cw), Math.round(c.ch)]
    };
  }, `${w}×${h}`));
}
await page.setViewportSize({ width: 1440, height: 900 });
await page.evaluate(() => { App.view.resize(); App.fitView(); });
const bad = fits.filter((f) => !f.inside || !f.centred);
ok('Fit centres the room in the clear part of the canvas at every size',
  bad.length === 0,
  bad.length ? bad.map((f) => `${f.size} off ${f.off} clear ${f.clear} canvas ${f.canvas}`).join(' | ')
             : fits.length + ' sizes, all centred');
ok('a fitted room fills the space it is given',
  fits.every((f) => f.fill > 0.7),
  'smallest fill ' + (100 * Math.min(...fits.map((f) => f.fill))).toFixed(0) + '%');

// The complaint that started this: Fit from a wrecked camera must recover.
const recovered = await page.evaluate(() => {
  App.view.ctl.dist = App.view.ctl.minDist;              // nose against a wall
  App.view.ctl.target.set(140, -60, 95);                 // aimed into the void
  App.view.ctl.theta = 2.9; App.view.ctl.phi = 0.05;
  App.view.ctl.apply();
  const lost = App.view._modelBounds(App.built.outer);
  App.fitView();
  const c = App.view.clearRect(), m = App.view._modelBounds(App.built.outer);
  return {
    wasOff: Math.abs(lost.cx - (c.x + c.w / 2)) > 400,
    inside: m.x0 >= c.x - 1 && m.x1 <= c.x + c.w + 1 &&
            m.y0 >= c.y - 1 && m.y1 <= c.y + c.h + 1
  };
});
ok('Fit recovers the model from any camera, however lost',
  recovered.wasOff && recovered.inside);

/** A patch of empty sky, clear of the model and of every floating panel. */
const emptyPoint = await page.evaluate(() => {
  const cr = document.getElementById('view').getBoundingClientRect();
  return { sx: cr.left + cr.width * 0.1, sy: cr.top + cr.height * 0.22 };
});
const camState = () => page.evaluate(() => ({
  theta: +App.view.ctl.theta.toFixed(5), phi: +App.view.ctl.phi.toFixed(5),
  target: App.view.ctl.target.toArray().map((v) => +v.toFixed(4))
}));

await aimAt('south');
const o0 = await camState();
await dragBy(emptyPoint, 90, 40, 8);
const o1 = await camState();
ok('a plain drag orbits the model',
  o1.theta !== o0.theta && o1.phi !== o0.phi &&
  JSON.stringify(o1.target) === JSON.stringify(o0.target),
  `theta ${o0.theta} → ${o1.theta}`);

// UI.build() clears UI.refreshers, so a toolbar built before it loses every
// on-state refresher and its toggles go dark. Catch that ordering directly.
const toggles = await page.evaluate(() => {
  const on = () => [...document.querySelectorAll('#viewtools .btn')]
    .filter((b) => b.classList.contains('on')).length;
  const before = on();
  App.setHandTool(true); const withHand = on();
  App.setHandTool(false);
  return { before, withHand };
});
ok('the viewport toolbar shows which tools are on',
  toggles.before > 0 && toggles.withHand === toggles.before + 1,
  `${toggles.before} lit at rest, ${toggles.withHand} with the hand tool on`);

await aimAt('south');
await page.evaluate(() => App.setHandTool(true));
const h0 = await camState();
await dragBy(emptyPoint, 90, 40, 8);
const h1 = await camState();
ok('with the hand tool on, a plain drag pans instead of orbiting',
  h1.theta === h0.theta && h1.phi === h0.phi &&
  JSON.stringify(h1.target) !== JSON.stringify(h0.target),
  `target ${h0.target} → ${h1.target}`);
ok('the hand tool shows a grab cursor',
  await page.evaluate(() => document.getElementById('view').classList.contains('hand')));

await aimAt('south');
await page.evaluate(() => App.setHandTool(true));
const g0 = await camState();
const gAp = await southAp();
await dragBy(await screenOf('S'), 80, 0, 8);
ok('the hand tool cannot nudge an opening',
  (await southAp()).offset === gAp.offset &&
  JSON.stringify((await camState()).target) !== JSON.stringify(g0.target),
  'window stayed at ' + gAp.offset + ' m');

await page.evaluate(() => App.setHandTool(false));
await aimAt('south');
const n0 = await southAp();
await dragBy(await screenOf('S'), 60, 0, 8);
ok('with the hand tool off, the same drag still moves the opening',
  (await southAp()).offset > n0.offset + 0.2,
  `offset ${n0.offset} → ${(await southAp()).offset} m`);

await aimAt('south');
const sp0 = await camState();
await page.keyboard.down('Space');
const spHeld = await page.evaluate(() => App.view.ctl.panning());
await dragBy(emptyPoint, 70, 30, 8);
const sp1 = await camState();
await page.keyboard.up('Space');
const spReleased = await page.evaluate(() => App.view.ctl.panning());
ok('holding Space pans, releasing it returns to orbit',
  spHeld && !spReleased && sp1.theta === sp0.theta &&
  JSON.stringify(sp1.target) !== JSON.stringify(sp0.target));

await page.evaluate(() => App.setHandTool(true));
await page.keyboard.press('Escape');
ok('Escape always returns the viewport to orbiting',
  !(await page.evaluate(() => App.view.ctl.panning())));

const hidden = (id) => page.evaluate(
  (i) => getComputedStyle(document.getElementById(i)).display === 'none', id);
await page.evaluate(() => App.setCleanView(true));
const cleanOn = [await hidden('legend'), await hidden('stats'), await hidden('timebar'),
  await hidden('viewtools')];
await page.evaluate(() => App.setCleanView(false));
const cleanOff = await hidden('legend');
ok('clean view hides the floating panels but keeps the toolbar',
  cleanOn[0] && cleanOn[1] && cleanOn[2] && !cleanOn[3] && !cleanOff);

const fold = await page.evaluate(() => {
  const lg = document.getElementById('legend');
  const before = lg.getBoundingClientRect().height;
  lg.querySelector('.hud-head').click();
  const after = lg.getBoundingClientRect().height;
  const headSeen = lg.querySelector('.hud-head').getBoundingClientRect().height > 8;
  lg.querySelector('.hud-head').click();
  return { before, after, headSeen, restored: lg.getBoundingClientRect().height };
});
ok('a floating panel folds to its title bar and back',
  fold.after < fold.before / 2 && fold.headSeen && fold.restored === fold.before,
  `${Math.round(fold.before)} → ${Math.round(fold.after)} → ${Math.round(fold.restored)} px`);

await page.evaluate(async () => { App.resetModel(); await App.whenIdle(); });
await idle();

/* ---------------- title typography ---------------- */
console.log('\n-- title --');
const title = await page.evaluate(() => {
  const t = document.querySelector('.brand-txt');
  const b = t.querySelector('b'), sp = t.querySelector('span');
  const cs = getComputedStyle(t);
  const rb = b.getBoundingClientRect(), rs = sp.getBoundingClientRect();
  const bar = document.getElementById('topbar').getBoundingClientRect();
  return {
    ratio: parseFloat(cs.lineHeight) / parseFloat(cs.fontSize),
    gap: +(rs.top - rb.bottom).toFixed(2),
    overlap: rs.top < rb.bottom,
    fits: t.getBoundingClientRect().top >= bar.top && t.getBoundingClientRect().bottom <= bar.bottom
  };
});
ok('title line-height is no longer compressed', title.ratio >= 1.25, 'ratio ' + title.ratio.toFixed(2));
ok('title and subtitle do not collide', !title.overlap && title.gap >= 1, title.gap + ' px apart');
ok('the title lockup fits inside the top bar', title.fits);

/* ---------------- guided tour ---------------- */
console.log('\n-- guided tour --');

const tour = await page.evaluate(async () => {
  Tour.end(false);
  Tour.start(true);
  const n = Tour.steps.length;
  const fits = [];
  for (let k = 0; k < n; k++) {
    Tour.i = k; Tour.render();
    const c = document.getElementById('tour-card').getBoundingClientRect();
    fits.push(c.left >= -1 && c.top >= -1 && c.right <= innerWidth + 1 && c.bottom <= innerHeight + 1);
  }
  // the toolbar step opens a panel to demonstrate, and must put it back
  const railStep = Tour.steps.findIndex((x) => x.target === '#rail');
  Tour.i = railStep; Tour.render();
  const openedDuring = document.getElementById('panel-room').open;
  Tour.go(1);
  const closedAfter = !document.getElementById('panel-room').open;
  Tour.i = Tour.steps.length - 1; Tour.render();
  Tour.go(1);                                     // finish
  let flag = null; try { flag = localStorage.getItem(TOUR_KEY); } catch (e) {}
  return {
    n, allFit: fits.every(Boolean), offscreen: fits.filter((f) => !f).length,
    openedDuring, closedAfter, active: Tour.active, flag,
    dim: getComputedStyle(document.getElementById('tour')).backgroundColor
  };
});
ok('the tour has a full set of steps', tour.n >= 8, tour.n + ' steps');
ok('every tour card stays on screen', tour.allFit, tour.offscreen + ' offscreen');
ok('a step that opens a panel puts it back', tour.openedDuring && tour.closedAfter);
ok('finishing closes the tour and records it', !tour.active && tour.flag === 'done', 'flag = ' + tour.flag);

const replay = await page.evaluate(async () => {
  const stillOpens = !tourHidden();     // seeing it must never suppress it
  document.getElementById('btn-help').click();
  await new Promise((r) => setTimeout(r, 60));
  const btn = document.getElementById('start-tour');
  const had = !!btn;
  if (btn) btn.click();
  await new Promise((r) => setTimeout(r, 60));
  const running = Tour.active;
  Tour.end(false);
  closeModal();
  return { stillOpens, had, running };
});
ok('having seen the tour does not stop it opening again', replay.stillOpens);

// "Don't show this on launch" is the only thing that suppresses it, and it
// must be reversible from the same tick box.
const optOut = await page.evaluate(async () => {
  Tour.start(true);
  await new Promise((r) => setTimeout(r, 40));
  const box = document.getElementById('tour-hide');
  const shown = !!box && box.offsetParent !== null;
  const startsUnticked = box && !box.checked;
  box.click();                                     // tick it
  const hidden = tourHidden();
  Tour.end(false);
  Tour.start(true);                                // Help must still work
  await new Promise((r) => setTimeout(r, 40));
  const replayable = Tour.active;
  const remembersTick = document.getElementById('tour-hide').checked;
  document.getElementById('tour-hide').click();    // untick
  const back = !tourHidden();
  Tour.end(false);
  return { shown, startsUnticked, hidden, replayable, remembersTick, back };
});
ok('the tour offers "Don\'t show this on launch"', optOut.shown && optOut.startsUnticked);
ok('ticking it suppresses the tour on launch', optOut.hidden);
ok('Help still replays it while suppressed, with the box ticked',
  optOut.replayable && optOut.remembersTick);
ok('unticking it brings the tour back on launch', optOut.back);
ok('Help offers a replay button that starts the tour', replay.had && replay.running);

const narrow = await page.evaluate(() => {
  // statistics is hidden on a phone, so its step must drop out of the sequence
  const all = TOUR_STEPS.length;
  const before = Tour._visible().length;
  return { all, before };
});
ok('steps are drawn from the full script', narrow.before === narrow.all,
  `${narrow.before} of ${narrow.all} visible at ${await page.evaluate(() => innerWidth)} px`);

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

await page.evaluate(() => { Tour.end(false); Tour.start(true); });
await page.waitForTimeout(320);
await page.screenshot({ path: join(OUT, 'tour-welcome.png') });
console.log('  shot  tour-welcome.png');
await page.evaluate(() => { Tour.i = Tour.steps.findIndex((x) => x.target === '#rail'); Tour.render(); });
await page.waitForTimeout(320);
await page.screenshot({ path: join(OUT, 'tour-toolbar.png') });
console.log('  shot  tour-toolbar.png');
await page.evaluate(() => Tour.end(false));

// hover highlight and a move in progress
await page.evaluate(async () => {
  App.resetModel(); App.setViewMode('3d');
  App.view.setStandardView('sw'); App.view.frame();
  await App.whenIdle();
});
await idle();
await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const pShot = await screenOf('S');
if (pShot && pShot.visible) {
  await page.mouse.move(pShot.sx, pShot.sy);
  await page.waitForTimeout(120);
  await shot('drag-hover');
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) { await page.mouse.move(pShot.sx + i * 8, pShot.sy); await page.waitForTimeout(14); }
  await page.screenshot({ path: join(OUT, 'drag-inprogress.png') });
  console.log('  shot  drag-inprogress.png');
  await page.mouse.up();
  await idle();
}
await page.evaluate(async () => { App.resetModel(); await App.whenIdle(); });

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
const mTour = await page.evaluate(() => ({ all: TOUR_STEPS.length, vis: Tour._visible().length }));
ok('tour steps with hidden targets drop out on a phone', mTour.vis < mTour.all && mTour.vis >= 7,
  `${mTour.vis} of ${mTour.all} steps`);
ok('no horizontal page scroll at 390 px', mobile.noHScroll, 'canvas ' + mobile.canvasW + ' px wide');

// The floating panels are absolutely positioned against the stage, so a size
// the layout was never checked at silently buries one under another. Sweep the
// sizes a student actually uses and assert every pair is clear.
const overlaps = [];
for (const [w, h] of [[915, 925], [1024, 768], [1100, 900], [1180, 800],
  [1280, 800], [1366, 768], [1440, 900], [1536, 864], [1920, 1080]]) {
  await page.setViewportSize({ width: w, height: h });
  await page.evaluate(() => { App.view.resize(); App.view.frame(); });
  const bad = await page.evaluate(() => {
    const stage = document.getElementById('stage').getBoundingClientRect(), R = {};
    ['legend', 'stats', 'solarhud', 'timebar', 'viewtools'].forEach((i) => {
      const e = document.getElementById(i);
      if (e && getComputedStyle(e).display !== 'none') R[i] = e.getBoundingClientRect();
    });
    const out = [], k = Object.keys(R);
    for (let a = 0; a < k.length; a++) for (let c = a + 1; c < k.length; c++) {
      const A = R[k[a]], B = R[k[c]];
      if (Math.min(A.right, B.right) - Math.max(A.left, B.left) > 1 &&
          Math.min(A.bottom, B.bottom) - Math.max(A.top, B.top) > 1) out.push(k[a] + '/' + k[c]);
    }
    k.forEach((i) => {
      const A = R[i];
      if (A.left < stage.left - 1 || A.right > stage.right + 1 ||
          A.top < stage.top - 1 || A.bottom > stage.bottom + 1) out.push(i + ' off-stage');
    });
    return out;
  });
  if (bad.length) overlaps.push(`${w}×${h}: ${bad.join(', ')}`);
}
ok('the floating panels never overlap or leave the stage', overlaps.length === 0,
  overlaps.length ? overlaps.join(' | ') : '9 viewport sizes clear');

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

/* licence */
console.log('\n-- licence --');

// MIT requires the copyright notice AND the permission notice to accompany
// every copy. The single file IS the copy people receive, so the notice has to
// live inside it — a LICENSE file in a repository nobody clones does not
// discharge the condition.
const built = readFileSync(join(root, 'daylight-lab.html'), 'utf8');
const headEnd = built.indexOf('<style>');
const inHead = (needle) => {
  const i = built.indexOf(needle);
  return i >= 0 && i < headEnd;
};
ok('the three.js MIT permission notice ships inside the file',
  inHead('Permission is hereby granted') && inHead('three.js authors'),
  'both appear before the first <style>');
ok("the project's own terms ship inside the file",
  inHead('MIT License') && inHead('CC BY 4.0') && inHead('Karam Al-Obaidi'),
  'MIT for the app, CC BY 4.0 named for the documentation');
ok('the bundled colour maps are credited', inHead('Apache-2.0'));

/*
 * The build stamp must be substituted, not shipped as its own placeholder.
 * A build that silently failed to replace it would put the literal __BUILD__
 * in the status bar and into every exported image - reading as a bug to the
 * one person most likely to notice, and telling them nothing about which
 * build they have.
 */
{
  const m = built.match(/id="build"[^>]*>([^<]*)</);
  const stamp = m ? m[1].trim() : '';
  ok('the build stamp is substituted at build time',
    /^\d{4}-\d{2}-\d{2} \u00b7 [0-9a-f]{6}$/.test(stamp) && !built.includes("__BUILD__"),
    stamp || 'no stamp found');
}

// An HTML comment cannot contain "--". If one ever crept into the licence text
// the notice would terminate early and spill the rest into the page as markup.
const open = built.indexOf('<!--');
const inner = built.slice(open + 4, built.indexOf('-->', open));
ok('the notice comment cannot terminate early', !inner.includes('--'),
  inner.length + ' characters, no stray double hyphen');

const help = await page.evaluate(() => {
  document.getElementById('btn-help').click();
  const t = document.getElementById('modal-body').textContent;
  closeModal();
  return t;
});
ok('the help panel states the licence and credits three.js',
  /CC BY 4\.0/.test(help) && /three\.js/.test(help) && /MIT/.test(help));

/* console */
console.log('\n-- console --');
const real = consoleErrors.filter((e) => !/favicon|Download is not allowed|net::ERR_/i.test(e));
ok('no console errors through the whole session', real.length === 0, real.slice(0, 5).join(' | '));

await browser.close();

writeFileSync(join(OUT, 'report.txt'),
  `Daylight Lab validation\n${new Date().toISOString()}\n\n${notes.join('\n')}\n\n${pass} passed, ${fail} failed\n`);
console.log(`\n=== ${pass} passed, ${fail} failed ===\n`);
process.exit(fail ? 1 : 0);
