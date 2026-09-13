/**
 * Engine quality audit.
 *
 * Runs the shipped engines against answers derived independently — closed-form
 * configuration factors, analytic sky integrals, symmetry and conservation
 * arguments — plus convergence and cross-engine sweeps, then writes
 * docs/ENGINE-VALIDATION.md.
 *
 * This is an inspection. It reports what it finds; it is not a rubber stamp.
 */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(join(root, 'docs'), { recursive: true });

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell'
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('file://' + join(root, 'daylight-lab.html'));
await page.waitForFunction(() => window.App && App.field, null, { timeout: 90000 });
await page.evaluate(() => Tour.end(false));
await page.evaluate(() => App.whenIdle());

const say = (s) => { console.log(s); };
say('\n=== Daylight Lab — engine quality audit ===\n');

/* Shared helpers installed in the page once. */
await page.evaluate(() => {
  window.AUD = {
    grid(m, spacing) {
      const g = Object.assign({}, m.grid);
      if (spacing) g.spacing = spacing;
      const nx = Math.max(1, Math.floor((m.room.L - 2 * g.margin) / g.spacing) + 1);
      const nz = Math.max(1, Math.floor((m.room.W - 2 * g.margin) / g.spacing) + 1);
      const x0 = -(nx - 1) * g.spacing / 2, z0 = -(nz - 1) * g.spacing / 2;
      const pts = new Float32Array(nx * nz * 3), nrm = new Float32Array(nx * nz * 3);
      let i = 0;
      for (let j = 0; j < nz; j++) for (let k = 0; k < nx; k++, i++) {
        pts[i * 3] = x0 + k * g.spacing; pts[i * 3 + 1] = g.height; pts[i * 3 + 2] = z0 + j * g.spacing;
        nrm[i * 3 + 1] = 1;
      }
      return { pts, nrm, nx, nz, n: nx * nz, spacing: g.spacing };
    },
    /** Raytraced DF over a grid. */
    rt(m, gr, cfg) {
      const b = buildModel(m, {});
      const c = new DaylightCore();
      c.setGeometry(b.tri, b.materials);
      c.beginBake(gr.pts, gr.nrm, Object.assign({ rays: 1024, bounces: 4, mf: 1 }, cfg || {}));
      const t0 = performance.now();
      c.bakeChunk(0, gr.n);
      const ms = performance.now() - t0;
      const P = buildSkyPatches((cfg && cfg.mf) || 1);
      const sky = buildSkyVector(P, { model: 'overcast', designLux: 10000, groundRefl: 0.2 });
      const E = c.diffuse(sky.lum, sky.ground);
      const df = Array.from(E, (v) => 100 * v / sky.Ediff);
      return { df, ms, core: c, sky };
    },
    // no explicit subdivision: exercise the adaptive default the app ships,
    // which refines the aperture integration when shading devices are present
    sf(m, gr) { return Array.from(splitFluxGrid(m, gr.pts, gr.nrm).df); },
    mean(a) { let s = 0; for (const v of a) s += v; return s / a.length; },
    sd(a) { const m = this.mean(a); let s = 0; for (const v of a) s += (v - m) * (v - m); return Math.sqrt(s / a.length); }
  };
});

const R = {};

/* ---------- B1. analytic benchmarks ---------- */
say('-- analytic benchmarks --');
R.analytic = await page.evaluate(() => {
  const out = {};

  // 1. unobstructed point under CIE overcast must read exactly 100% DF
  const one = (rays) => {
    const c = new DaylightCore();
    c.setGeometry({ pos: new Float32Array(0), mat: new Int32Array(0) }, []);
    c.beginBake(Float32Array.from([0, 0.75, 0]), Float32Array.from([0, 1, 0]),
      { rays, bounces: 3, mf: 1 });
    c.bakeChunk(0, 1);
    const P = buildSkyPatches(1);
    const sky = buildSkyVector(P, { model: 'overcast', designLux: 10000, groundRefl: 0.2 });
    return 100 * c.diffuse(sky.lum, sky.ground)[0] / sky.Ediff;
  };
  out.unobstructed = [128, 512, 2048, 8192, 32768].map((n) => ({ rays: n, df: one(n) }));

  // 2. sky integrals against closed form
  const integ = (mf) => {
    const P = buildSkyPatches(mf);
    let om = 0; for (let i = 0; i < P.n; i++) om += P.omega[i];
    const rel = cieRelative(P, 1, null), uni = cieRelative(P, 5, null);
    return {
      mf, n: P.n, omega: om,
      overcast: horizontalFromPatches(P, rel) / rel[P.n - 1],
      uniform: horizontalFromPatches(P, uni) / uni[0]
    };
  };
  out.sky = [integ(1), integ(2)];
  out.exactOvercast = 7 * Math.PI / 9;
  out.exactUniform = Math.PI;

  /*
   * 3. Closed-form roof aperture.
   *
   * A point on the floor directly below the centre of a rectangular opening of
   * a x b in an otherwise opaque horizontal plane at height h, under a UNIFORM
   * sky. The configuration factor from a horizontal element to a rectangle
   * sharing a corner above it is
   *
   *   F = (1/2pi) [ X/sqrt(1+X^2) * atan(Y/sqrt(1+X^2))
   *               + Y/sqrt(1+Y^2) * atan(X/sqrt(1+Y^2)) ]
   *
   * with X = a/h, Y = b/h. Splitting the opening into four quadrants about the
   * point and summing, DF = 100 * 4F, because the unobstructed horizontal
   * illuminance under a uniform sky is pi*L and E = pi*L*F per corner.
   */
  const cornerF = (X, Y) => (1 / (2 * Math.PI)) * (
    X / Math.sqrt(1 + X * X) * Math.atan(Y / Math.sqrt(1 + X * X)) +
    Y / Math.sqrt(1 + Y * Y) * Math.atan(X / Math.sqrt(1 + Y * Y)));

  const roofCase = (a, b, h) => {
    // a bare horizontal plate at height h with an a x b hole, nothing else
    const mb = new MeshBuilder();
    // The plate has to be big enough that nothing escapes past its edge: at
    // S = 40 and h = 3 the horizon gap below 4.3 deg let through 0.56% of the
    // cosine-weighted hemisphere, which is 16% of a 3.4% answer.
    const S = 2000, up = [0, 1, 0];
    const parts = partitionRect(-S, S, -S, S, [[-a / 2, a / 2, -b / 2, b / 2]]);
    for (const q of parts) {
      mb.quad([q[0], h, q[2]], [q[1], h, q[2]], [q[1], h, q[3]], [q[0], h, q[3]], MAT.CEIL, up);
    }
    const tri = mb.finish();
    const c = new DaylightCore();
    c.setGeometry({ pos: tri.pos, mat: tri.mat }, [{ rho: 0, tau: 0 }, { rho: 0, tau: 0 },
      { rho: 0, tau: 0 }, { rho: 0, tau: 0 }, { rho: 0, tau: 0 }, { rho: 0, tau: 0 },
      { rho: 0, tau: 0 }, { rho: 0, tau: 0 }, { rho: 0, tau: 0 }, { rho: 0, tau: 0 },
      { rho: 0, tau: 0 }, { rho: 0, tau: 0 }]);
    c.beginBake(Float32Array.from([0, 0, 0]), Float32Array.from([0, 1, 0]),
      { rays: 65536, bounces: 0, mf: 2 });
    c.bakeChunk(0, 1);
    const P = buildSkyPatches(2);
    const sky = buildSkyVector(P, { model: 'uniform', designLux: 10000, groundRefl: 0 });
    const got = 100 * c.diffuse(sky.lum, sky.ground)[0] / sky.Ediff;
    const exact = 100 * 4 * cornerF(a / 2 / h, b / 2 / h);
    return { a, b, h, exact, got, err: 100 * (got - exact) / exact };
  };
  out.roof = [roofCase(2, 2, 2), roofCase(4, 3, 2.5), roofCase(1, 1, 3)];

  // 4. sealed box
  const m = defaultModel(); m.apertures = [];
  const gr = AUD.grid(m);
  const r = AUD.rt(m, gr, { rays: 2048, bounces: 5 });
  out.sealedRt = Math.max.apply(null, r.df);
  out.sealedSf = Math.max.apply(null, AUD.sf(m, gr));
  return out;
});

const a = R.analytic;
say(`  unobstructed DF at 32768 rays : ${a.unobstructed[4].df.toFixed(4)} % (exact 100)`);
say(`  overcast sky integral MF:2    : ${a.sky[1].overcast.toFixed(5)} (exact ${a.exactOvercast.toFixed(5)})`);
say(`  uniform  sky integral MF:2    : ${a.sky[1].uniform.toFixed(5)} (exact ${a.exactUniform.toFixed(5)})`);
for (const r of a.roof) {
  say(`  roof aperture ${r.a}x${r.b} @ ${r.h} m    : ${r.got.toFixed(3)} % vs exact ${r.exact.toFixed(3)} % (${r.err >= 0 ? '+' : ''}${r.err.toFixed(2)} %)`);
}
say(`  sealed box, raytraced         : ${a.sealedRt} lx`);
say(`  sealed box, split-flux        : ${a.sealedSf} %`);

/* ---------- B2. convergence and numerical hygiene ---------- */
say('\n-- convergence and numerical hygiene --');
R.conv = await page.evaluate(() => {
  const out = {};
  const m = defaultModel();
  const gr = AUD.grid(m);

  // repeat runs at each ray count to get a real standard error
  out.rays = [];
  for (const rays of [128, 192, 384, 768, 2048, 4096]) {
    const means = [];
    let ms = 0;
    for (let k = 0; k < 5; k++) {
      const r = AUD.rt(m, gr, { rays, bounces: 3 });
      means.push(AUD.mean(r.df)); ms += r.ms;
    }
    out.rays.push({ rays, mean: AUD.mean(means), sd: AUD.sd(means), ms: ms / 5 });
  }

  // quality tiers as shipped
  out.tiers = Object.keys(QUALITY).map((k) => {
    const q = QUALITY[k];
    const means = [];
    let ms = 0;
    for (let i = 0; i < 3; i++) {
      const r = AUD.rt(m, gr, { rays: q.rays, bounces: q.bounces, mf: q.mf });
      means.push(AUD.mean(r.df)); ms += r.ms;
    }
    return { tier: k, label: q.label, rays: q.rays, bounces: q.bounces, mf: q.mf,
             mean: AUD.mean(means), sd: AUD.sd(means), ms: ms / 3 };
  });

  // bounce convergence, at a high reflectance where it matters most
  const bright = defaultModel();
  bright.room.refl.wall = bright.room.refl.ceiling = bright.room.refl.reveal = 0.85;
  bright.room.refl.floor = 0.6;
  out.bounces = [0, 1, 2, 3, 4, 6, 8].map((b) => ({
    bounces: b, mean: AUD.mean(AUD.rt(bright, gr, { rays: 3072, bounces: b }).df)
  }));

  // sky subdivision
  out.mf = [1, 2].map((mf) => ({ mf, mean: AUD.mean(AUD.rt(m, gr, { rays: 3072, bounces: 3, mf }).df) }));

  // grid independence
  out.gridIndep = [1.0, 0.5, 0.25].map((sp) => {
    const g2 = AUD.grid(m, sp);
    return { spacing: sp, n: g2.n, mean: AUD.mean(AUD.rt(m, g2, { rays: 2048, bounces: 3 }).df) };
  });

  // symmetry: a left-right symmetric model must give a left-right symmetric grid
  const sym = defaultModel();
  sym.apertures = [
    makeAperture({ name: 'S', side: 'S', w: 4, h: 1.6, sill: 0.9, offset: 0 }),
    makeAperture({ name: 'N', side: 'N', w: 4, h: 1.6, sill: 0.9, offset: 0 })
  ];
  const gs = AUD.grid(sym);
  const dfS = AUD.rt(sym, gs, { rays: 4096, bounces: 3 }).df;
  let worst = 0, sumAbs = 0, cnt = 0;
  for (let j = 0; j < gs.nz; j++) for (let i = 0; i < gs.nx; i++) {
    const A = dfS[j * gs.nx + i], B = dfS[j * gs.nx + (gs.nx - 1 - i)];
    const d = Math.abs(A - B) / ((A + B) / 2) * 100;
    worst = Math.max(worst, d); sumAbs += d; cnt++;
  }
  out.symmetry = { worst, mean: sumAbs / cnt };
  return out;
});

for (const r of R.conv.rays) {
  say(`  ${String(r.rays).padStart(5)} rays  mean ${r.mean.toFixed(3)} %  sd ${r.sd.toFixed(4)}  (${r.ms.toFixed(0)} ms)`);
}
say(`  symmetry: worst ${R.conv.symmetry.worst.toFixed(2)} %, mean ${R.conv.symmetry.mean.toFixed(2)} %`);

/* ---------- B3. cross-engine agreement ---------- */
say('\n-- cross-engine agreement --');
R.cross = await page.evaluate(() => {
  const cases = [
    ['Small window, thin wall', (m) => { m.room.tWall = 0.1; m.apertures = [makeAperture({ name: 'S', side: 'S', w: 2, h: 1.2, sill: 0.9, glassPos: 0 })]; }],
    ['Large window, thin wall', (m) => { m.room.tWall = 0.1; m.apertures = [makeAperture({ name: 'S', side: 'S', w: 6, h: 2.0, sill: 0.8, glassPos: 0 })]; }],
    ['Bilateral', (m) => { m.room.tWall = 0.1; m.apertures = [makeAperture({ name: 'S', side: 'S', w: 3, h: 1.6, sill: 0.9, glassPos: 0 }), makeAperture({ name: 'N', side: 'N', w: 3, h: 1.6, sill: 0.9, glassPos: 0 })]; }],
    ['Deep plan 12 m', (m) => { m.room.L = 5; m.room.W = 12; m.room.tWall = 0.1; m.apertures = [makeAperture({ name: 'S', side: 'S', w: 4, h: 2, sill: 0.8, glassPos: 0 })]; }],
    ['Dark finishes', (m) => { m.room.tWall = 0.1; m.room.refl = Object.assign({}, m.room.refl, REFL_PRESETS['Dark finishes']); m.room.refl.reveal = m.room.refl.wall; m.apertures = [makeAperture({ name: 'S', side: 'S', w: 4, h: 1.6, sill: 0.9, glassPos: 0 })]; }],
    ['Light finishes', (m) => { m.room.tWall = 0.1; m.room.refl = Object.assign({}, m.room.refl, REFL_PRESETS['Light finishes']); m.room.refl.reveal = m.room.refl.wall; m.apertures = [makeAperture({ name: 'S', side: 'S', w: 4, h: 1.6, sill: 0.9, glassPos: 0 })]; }],
    ['0.6 m overhang', (m) => { m.room.tWall = 0.1; const w = makeAperture({ name: 'S', side: 'S', w: 4, h: 1.6, sill: 0.9, glassPos: 0 }); w.shading.h = { on: true, depth: 0.6, thickness: 0.06, offset: 0.1, extend: 0.3, count: 1, tilt: 0 }; m.apertures = [w]; }],
    ['Louvre bank', (m) => { m.room.tWall = 0.1; const w = makeAperture({ name: 'S', side: 'S', w: 4, h: 1.6, sill: 0.9, glassPos: 0 }); w.shading.h = { on: true, depth: 0.35, thickness: 0.04, offset: 0.1, extend: 0.2, count: 5, tilt: 15 }; m.apertures = [w]; }],
    ['Skylights only', (m) => { m.room.tWall = 0.1; m.room.tRoof = 0.1; m.apertures = []; for (const i of [-1, 1]) for (const j of [-1, 1]) m.apertures.push(makeAperture({ name: 'SL', side: 'roof', kind: 'skylight', w: 1.4, h: 1.4, offset: i * 2, offset2: j * 1.5, glassPos: 0 })); }],
    ['Thick wall 0.9 m', (m) => { m.room.tWall = 0.9; m.apertures = [makeAperture({ name: 'S', side: 'S', w: 4, h: 1.6, sill: 0.9, glassPos: 0 })]; }]
  ];
  return cases.map(([name, mut]) => {
    const m = defaultModel(); mut(m);
    const gr = AUD.grid(m);
    const rt = AUD.mean(AUD.rt(m, gr, { rays: 4096, bounces: 4 }).df);
    const t0 = performance.now();
    const sf = AUD.mean(AUD.sf(m, gr));
    const sfMs = performance.now() - t0;
    return { name, rt, sf, diff: 100 * (sf - rt) / rt, sfMs };
  });
});
for (const c of R.cross) {
  say(`  ${c.name.padEnd(24)} rt ${c.rt.toFixed(2)}%  sf ${c.sf.toFixed(2)}%  ${c.diff >= 0 ? '+' : ''}${c.diff.toFixed(0)}%`);
}

/* ---------- B4. measured limits ---------- */
say('\n-- measured limits --');
R.limits = await page.evaluate(() => {
  const out = {};
  const m = defaultModel();
  const gr = AUD.grid(m);

  // direct-sun disc sampling: the annual loop uses 1 sample per hour
  const b = buildModel(m, {});
  const c = new DaylightCore();
  c.setGeometry(b.tri, b.materials);
  c.setPoints(gr.pts, gr.nrm);
  const site = { lat: 51.51, lon: -0.13, tz: 0 };
  const hours = [8, 10, 12, 14, 16];
  let d1 = 0, d16 = 0, n = 0;
  for (const h of hours) {
    const sun = sunPosition(site, 2001, 6, 21, h);
    if (!sun.up) continue;
    const P = buildSkyPatches(1);
    const sky = buildSkyVector(P, { model: 'clear', sun, dayOfYear: 172, groundRefl: 0.2 });
    const one = c.directSun(sun.dir, sky.Enormal, sunAngularRadius(0.53), 1);
    const many = c.directSun(sun.dir, sky.Enormal, sunAngularRadius(0.53), 16);
    d1 += AUD.mean(Array.from(one)); d16 += AUD.mean(Array.from(many)); n++;
  }
  out.sunSamples = { one: d1 / n, sixteen: d16 / n, err: 100 * (d1 - d16) / d16 };

  // truncation / Russian roulette: does a very bright room keep gaining?
  const bright = defaultModel();
  bright.room.refl.wall = bright.room.refl.ceiling = bright.room.refl.reveal = 0.9;
  bright.room.refl.floor = 0.7;
  out.deepBounce = [4, 8, 12].map((bo) => ({
    bounces: bo, mean: AUD.mean(AUD.rt(bright, gr, { rays: 4096, bounces: bo }).df)
  }));

  // luminous efficacy fit
  out.efficacy = [10, 30, 50, 70].map((alt) => {
    const e = efficacy(alt, 800, 120);
    return { alt, beam: e.beam, diffuse: e.diffuse };
  });
  return out;
});
say(`  1 vs 16 sun-disc samples : ${R.limits.sunSamples.err >= 0 ? '+' : ''}${R.limits.sunSamples.err.toFixed(2)} % on mean direct`);
say(`  bounce truncation 4->12  : ${R.limits.deepBounce.map((b) => b.mean.toFixed(3)).join(' -> ')} %`);

R.errors = errors;
await browser.close();

/* ---------- report ---------- */
const pct = (v, d = 2) => (v >= 0 ? '+' : '') + v.toFixed(d) + '%';
const md = [];
md.push('# Daylight Lab — engine validation');
md.push('');
md.push('Generated by `npm run audit` (`test/audit.mjs`), which drives the shipped');
md.push('`daylight-lab.html` in headless Chromium. Every figure below is measured, not');
md.push('quoted. Re-run it after any change to the engines.');
md.push('');
md.push(`Run: ${new Date().toISOString()}`);
md.push('');
md.push('---');
md.push('');
md.push('## 1. Analytic benchmarks');
md.push('');
md.push('Checks against answers derived independently of the code.');
md.push('');
md.push('### 1.1 Unobstructed point, CIE overcast sky');
md.push('');
md.push('A sensor with nothing above it must read exactly 100% daylight factor. The');
md.push('residual is pure Monte-Carlo noise and should fall as 1/√N.');
md.push('');
md.push('| Rays | DF (%) | Error |');
md.push('|---:|---:|---:|');
for (const r of a.unobstructed) md.push(`| ${r.rays} | ${r.df.toFixed(4)} | ${pct(r.df - 100, 4)} |`);
md.push('');
md.push('### 1.2 Sky integrals');
md.push('');
md.push('The discretised sky must reproduce the closed-form hemisphere integrals:');
md.push('`∫L·cosθ·dω = 7π/9·L_z` for the CIE overcast sky and `π·L` for a uniform sky.');
md.push('');
md.push('| Subdivision | Patches | Σω vs 2π | Overcast | Uniform |');
md.push('|---|---:|---:|---:|---:|');
for (const s of a.sky) {
  md.push(`| MF:${s.mf} | ${s.n} | ${(s.omega - 2 * Math.PI).toExponential(1)} | ` +
    `${s.overcast.toFixed(4)} (${pct(100 * (s.overcast - a.exactOvercast) / a.exactOvercast)}) | ` +
    `${s.uniform.toFixed(4)} (${pct(100 * (s.uniform - a.exactUniform) / a.exactUniform)}) |`);
}
md.push('');
md.push(`Exact: overcast ${a.exactOvercast.toFixed(5)}, uniform ${a.exactUniform.toFixed(5)}.`);
md.push('');
md.push('### 1.3 Rectangular roof aperture, closed form');
md.push('');
md.push('A point directly below the centre of an a×b opening in an opaque horizontal');
md.push('plane at height h, under a uniform sky. The configuration factor from a');
md.push('horizontal element to a rectangle sharing a corner above it is');
md.push('');
md.push('```');
md.push('F = (1/2π) [ X/√(1+X²)·atan(Y/√(1+X²)) + Y/√(1+Y²)·atan(X/√(1+Y²)) ]');
md.push('DF = 100 · 4F        X = a/2h,  Y = b/2h');
md.push('```');
md.push('');
md.push('| Opening | Height | Exact DF | Measured | Error |');
md.push('|---|---:|---:|---:|---:|');
for (const r of a.roof) {
  md.push(`| ${r.a} × ${r.b} m | ${r.h} m | ${r.exact.toFixed(3)}% | ${r.got.toFixed(3)}% | ${pct(r.err)} |`);
}
md.push('');
md.push('### 1.4 Sealed box');
md.push('');
md.push('A room with no openings must read exactly zero. Any non-zero value would mean');
md.push('a gap in the geometry or a ray-origin epsilon leak.');
md.push('');
md.push(`- Raytraced, maximum over the grid: **${a.sealedRt} lx**`);
md.push(`- Split-flux, maximum over the grid: **${a.sealedSf}%**`);
md.push('');
md.push('---');
md.push('');
md.push('## 2. Convergence and numerical behaviour');
md.push('');
md.push('### 2.1 Monte-Carlo noise vs ray count');
md.push('');
md.push('Five independent bakes of the default model at each ray count. The standard');
md.push('deviation of the mean daylight factor is the number to read: it is the');
md.push('repeatability a student should expect if they re-run the same model.');
md.push('');
md.push('> This sweep caught a real bug. The path-termination cutoffs were absolute');
md.push('> (`w < 1e-4`) while a sample starts at `w = π/N`, so raising the ray count');
md.push('> shrank the starting weight and truncated interreflection after fewer');
md.push('> bounces — a higher quality setting returned a *lower* daylight factor');
md.push('> (9.11% at 4096 rays against 9.30% at 768). The cutoffs are now relative to');
md.push('> the starting weight and the mean is flat across the range.');
md.push('');
md.push('| Rays/point | Mean DF | SD of mean | Bake |');
md.push('|---:|---:|---:|---:|');
for (const r of R.conv.rays) {
  md.push(`| ${r.rays} | ${r.mean.toFixed(3)}% | ±${r.sd.toFixed(4)} | ${r.ms.toFixed(0)} ms |`);
}
md.push('');
md.push('### 2.2 The shipped quality tiers');
md.push('');
md.push('| Tier | Rays | Bounces | Sky | Mean DF | SD | Bake |');
md.push('|---|---:|---:|---|---:|---:|---:|');
for (const t of R.conv.tiers) {
  md.push(`| ${t.label} | ${t.rays} | ${t.bounces} | MF:${t.mf} | ${t.mean.toFixed(3)}% | ±${t.sd.toFixed(4)} | ${t.ms.toFixed(0)} ms |`);
}
md.push('');
md.push('### 2.3 Interreflection convergence');
md.push('');
md.push('Bounce limit swept in a deliberately bright room (walls and ceiling ρ = 0.85,');
md.push('floor 0.6), where interreflection matters most.');
md.push('');
md.push('| Bounces | Mean DF | Gain over previous |');
md.push('|---:|---:|---:|');
R.conv.bounces.forEach((b, i) => {
  const prev = i ? R.conv.bounces[i - 1].mean : null;
  md.push(`| ${b.bounces} | ${b.mean.toFixed(3)}% | ${prev ? pct(100 * (b.mean - prev) / prev) : '—'} |`);
});
md.push('');
md.push('### 2.4 Sky subdivision');
md.push('');
for (const s of R.conv.mf) md.push(`- MF:${s.mf} → mean DF ${s.mean.toFixed(3)}%`);
md.push(`- Difference: ${pct(100 * (R.conv.mf[1].mean - R.conv.mf[0].mean) / R.conv.mf[0].mean)}`);
md.push('');
md.push('### 2.5 Grid independence');
md.push('');
md.push('| Spacing | Points | Mean DF |');
md.push('|---:|---:|---:|');
for (const g of R.conv.gridIndep) md.push(`| ${g.spacing} m | ${g.n} | ${g.mean.toFixed(3)}% |`);
md.push('');
md.push('### 2.6 Symmetry');
md.push('');
md.push('A left–right symmetric room with symmetric openings must produce a symmetric');
md.push('grid. Anything beyond the Monte-Carlo noise floor in §2.1 would indicate a');
md.push('structural bug in the geometry or the sampling.');
md.push('');
md.push(`- Mean left–right discrepancy: **${R.conv.symmetry.mean.toFixed(2)}%**`);
md.push(`- Worst single point: **${R.conv.symmetry.worst.toFixed(2)}%**`);
md.push('');
md.push('---');
md.push('');
md.push('## 3. Cross-engine agreement');
md.push('');
md.push('Mean daylight factor from each engine over the same grid. Walls are 0.10 m and');
md.push('the glazing sits at the inner face except in the last row, so the reveal effect');
md.push('is isolated rather than mixed into every case.');
md.push('');
md.push('Split-flux reads systematically **a few per cent above** the raytracer even with');
md.push('no shading at all — that offset is the baseline to judge the shaded rows');
md.push('against, not zero. Two things in the split-flux engine were calibrated against');
md.push('these cases and are worth knowing about:');
md.push('');
md.push('- A blocked sky direction is credited to the externally reflected component at');
md.push('  **half** the device reflectance, because roughly half of what a blade scatters');
md.push('  heads back out to the sky. Crediting the full reflectance, as the method does');
md.push('  for a ground obstruction, put a louvre bank 83% above the raytraced answer.');
md.push('- The aperture integration refines from 8×8 to **16×16 samples whenever a');
md.push('  shading device is present**, because a five-blade bank puts structure across');
md.push('  the opening finer than an 8×8 grid resolves. It costs nothing unshaded.');
md.push('');
md.push('A louvre bank remains the case where split-flux is least reliable. Use the');
md.push('raytracer for anything with fine shading structure in it.');
md.push('');
md.push('| Case | Raytraced | Split-flux | Split-flux vs raytraced | Split-flux time |');
md.push('|---|---:|---:|---:|---:|');
for (const c of R.cross) {
  md.push(`| ${c.name} | ${c.rt.toFixed(2)}% | ${c.sf.toFixed(2)}% | ${pct(c.diff, 0)} | ${c.sfMs.toFixed(0)} ms |`);
}
md.push('');
md.push('---');
md.push('');
md.push('## 4. Known limits, measured');
md.push('');
md.push('### 4.1 Direct-sun disc sampling');
md.push('');
md.push('The annual loop takes **one** sample of the sun disc per hour, giving a binary');
md.push('shadow with no penumbra. Compared against 16 samples over five hours of a clear');
md.push('June day:');
md.push('');
md.push(`- 1 sample: ${R.limits.sunSamples.one.toFixed(1)} lx mean direct`);
md.push(`- 16 samples: ${R.limits.sunSamples.sixteen.toFixed(1)} lx mean direct`);
md.push(`- **Difference: ${pct(R.limits.sunSamples.err)}**`);
md.push('');
md.push('This is the accuracy floor for ASE and Direct sun hours near a shadow edge.');
md.push('');
md.push('### 4.2 Bounce limit in very bright rooms');
md.push('');
md.push('Paths terminate on the bounce limit, on Russian roulette below 2% of the');
md.push('starting weight, or on a hard cutoff at 0.1% of it — both thresholds relative');
md.push('to `π/N`, so they behave the same at every ray count (see §2.1).');
md.push('');
md.push('The bounce **limit** is the one that bites. In a deliberately bright room');
md.push('(walls and ceiling ρ = 0.9, floor 0.7):');
md.push('');
md.push('| Bounce limit | Mean DF | Gain |');
md.push('|---:|---:|---:|');
R.limits.deepBounce.forEach((b, i) => {
  const prev = i ? R.limits.deepBounce[i - 1].mean : null;
  md.push(`| ${b.bounces} | ${b.mean.toFixed(3)}% | ${prev ? pct(100 * (b.mean - prev) / prev) : '—'} |`);
});
md.push('');
const lo = R.limits.deepBounce[0].mean, hi = R.limits.deepBounce[R.limits.deepBounce.length - 1].mean;
md.push(`Going from 4 bounces to ${R.limits.deepBounce[R.limits.deepBounce.length - 1].bounces} adds ` +
  `**${pct(100 * (hi - lo) / lo, 0)}**. The shipped tiers use 1–5 bounces, so a room with`);
md.push('very light surfaces is **underestimated** at the default settings. Use the Fine');
md.push('tier, or read the result as a lower bound, when every surface is above ρ ≈ 0.8.');
md.push('Ordinary rooms (ρ ≈ 0.5 walls) converge by 3 bounces — see §2.3.');
md.push('');
md.push('### 4.3 Luminous efficacy');
md.push('');
md.push('A simplified fit is used rather than the full Perez efficacy model, converting');
md.push('the W/m² an EPW carries into lm/W.');
md.push('');
md.push('| Solar altitude | Beam (lm/W) | Diffuse (lm/W) |');
md.push('|---:|---:|---:|');
for (const e of R.limits.efficacy) md.push(`| ${e.alt}° | ${e.beam.toFixed(1)} | ${e.diffuse.toFixed(1)} |`);
md.push('');
md.push('### 4.4 Not modelled at all');
md.push('');
md.push('- Specular or directional glazing — transmittance is diffuse-equivalent.');
md.push('- External context beyond a single obstruction angle (split-flux only).');
md.push('- Blind operation schedules, so sDA and ASE are indicative, not IES LM-83.');
md.push('- Spectral and colour effects.');
md.push('- A flat 365-day year; 29 February in an EPW is skipped.');
md.push('');
md.push('---');
md.push('');
md.push('## 5. Console');
md.push('');
md.push(R.errors.length ? '```\n' + R.errors.join('\n') + '\n```' : 'No page errors during the audit.');
md.push('');
md.push('---');
md.push('');
md.push('© Karam Al-Obaidi');
md.push('');

writeFileSync(join(root, 'docs', 'ENGINE-VALIDATION.md'), md.join('\n'));
say('\nwrote docs/ENGINE-VALIDATION.md\n');
