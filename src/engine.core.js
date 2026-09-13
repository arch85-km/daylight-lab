/* ==========================================================================
   Daylight-coefficient engine core.

   Runs identically in the analysis Web Worker and, when a Worker cannot be
   created, on the main thread in time-sliced chunks. Nothing here touches
   the DOM or three.js.

   The bake casts cosine-weighted hemisphere rays from every workplane point
   and records where each ray finally escapes to sky. The result is a matrix

        DC[point][patch]     lux per (cd/m2) of that sky patch

   so any sky — CIE overcast for Daylight Factor, a Perez sky for one EPW
   hour, all 8760 of them for UDI — is then just a dot product. Glazing is
   traversed with its transmittance rather than blocking, and interreflection
   is a real Monte-Carlo bounce against each surface's reflectance, not the
   BRE average-IRC formula.
   ========================================================================== */

/** Branchless orthonormal basis around a unit normal (Duff et al. 2017). */
function onb(nx, ny, nz, out) {
  var s = nz >= 0 ? 1 : -1;
  var a = -1 / (s + nz), b = nx * ny * a;
  out[0] = 1 + s * nx * nx * a; out[1] = s * b; out[2] = -s * nx;
  out[3] = b; out[4] = s + ny * ny * a; out[5] = -ny;
}

/** Cosine-weighted direction about (nx,ny,nz); writes 3 floats into `d`. */
function cosineSample(nx, ny, nz, u1, u2, basis, d) {
  onb(nx, ny, nz, basis);
  var r = Math.sqrt(u1), phi = 2 * Math.PI * u2;
  var x = r * Math.cos(phi), y = r * Math.sin(phi), z = Math.sqrt(Math.max(0, 1 - u1));
  d[0] = x * basis[0] + y * basis[3] + z * nx;
  d[1] = x * basis[1] + y * basis[4] + z * ny;
  d[2] = x * basis[2] + y * basis[5] + z * nz;
  var L = Math.hypot(d[0], d[1], d[2]) || 1;
  d[0] /= L; d[1] /= L; d[2] /= L;
}

var EPS = 1e-4;

function DaylightCore() {
  this.bvh = null;
  this.mats = null;       // [{rho, tau}]
  this.patches = null;
  this.pts = null;        // Float32Array, 3 per point
  this.nrm = null;        // Float32Array, 3 per point (workplane normals)
  this.dc = null;         // Float32Array, nPts * (nPatch + 1); last col = ground
  this.nPts = 0;
  this.stride = 0;
  this.cfg = null;
}

/** Install geometry. `geom` = {pos, mat}; `mats` = [{rho, tau}]. */
DaylightCore.prototype.setGeometry = function (geom, mats) {
  this.bvh = new BVH(geom.pos, geom.mat);
  this.mats = mats;
  this.dc = null;
  return { tris: this.bvh.triCount, nodes: this.bvh.nodeCount };
};

/**
 * Install the sensor grid without allocating a daylight-coefficient matrix.
 *
 * directSun(), sunVisible() and transmittance() need only the points, their
 * normals and the BVH — not the DC matrix — so the split-flux engine can use
 * them for the direct beam, ASE and sun hours without ever baking.
 */
DaylightCore.prototype.setPoints = function (pts, nrm) {
  this.pts = pts; this.nrm = nrm;
  this.nPts = (pts.length / 3) | 0;
  return { nPts: this.nPts };
};

/** Prepare a bake. Points/normals are flat Float32Arrays. */
DaylightCore.prototype.beginBake = function (pts, nrm, cfg) {
  this.pts = pts; this.nrm = nrm; this.cfg = cfg;
  this.nPts = (pts.length / 3) | 0;
  this.patches = buildSkyPatches(cfg.mf || 1);
  this.stride = this.patches.n + 1;
  this.dc = new Float32Array(this.nPts * this.stride);
  this._scratch = {
    hit: {}, d: new Float64Array(3), basis: new Float64Array(6)
  };
  return { nPts: this.nPts, nPatch: this.patches.n, stride: this.stride };
};

/**
 * Bake points [from, to). Safe to call repeatedly to spread the work.
 * Returns the number of rays traced, for the timing readout.
 */
DaylightCore.prototype.bakeChunk = function (from, to) {
  var bvh = this.bvh, mats = this.mats, P = this.patches;
  var pts = this.pts, nrm = this.nrm, dc = this.dc, stride = this.stride;
  var N = this.cfg.rays, maxBounce = this.cfg.bounces;
  var s = this._scratch, hit = s.hit, d = s.d, basis = s.basis;
  var wgt = Math.PI / N;
  var groundCol = stride - 1;
  var rays = 0;

  to = Math.min(to, this.nPts);
  for (var p = from; p < to; p++) {
    var base = p * stride;
    // Cranley-Patterson rotation keeps each point's sample set decorrelated
    var rot1 = halton(p + 1, 5), rot2 = halton(p + 1, 7);
    var pnx = nrm[p * 3], pny = nrm[p * 3 + 1], pnz = nrm[p * 3 + 2];

    for (var i = 0; i < N; i++) {
      var u1 = fract(halton(i + 1, 2) + rot1);
      var u2 = fract(halton(i + 1, 3) + rot2);
      cosineSample(pnx, pny, pnz, u1, u2, basis, d);

      var ox = pts[p * 3] + pnx * EPS, oy = pts[p * 3 + 1] + pny * EPS, oz = pts[p * 3 + 2] + pnz * EPS;
      var dx = d[0], dy = d[1], dz = d[2];
      var w = wgt, bounce = 0, guard = 0;

      for (;;) {
        rays++;
        if (++guard > 64) break;
        if (!bvh.intersect(ox, oy, oz, dx, dy, dz, 1e6, hit, -1)) {
          // escaped: deposit into the sky patch it left through, or the ground
          if (dy > 0) {
            var pi = P.lookup(dx, dy, dz);
            if (pi >= 0) dc[base + pi] += w;
          } else {
            dc[base + groundCol] += w;
          }
          break;
        }
        var m = mats[hit.mat] || { rho: 0.5, tau: 0 };
        var hx = ox + dx * hit.t, hy = oy + dy * hit.t, hz = oz + dz * hit.t;

        if (m.tau > 0) {                      // glazing: carry on, attenuated
          w *= m.tau;
          if (w < wgt * 1e-4) break;
          ox = hx + dx * EPS; oy = hy + dy * EPS; oz = hz + dz * EPS;
          continue;                           // transmission is not a bounce
        }

        if (bounce >= maxBounce) break;
        bounce++;
        w *= m.rho;
        /*
         * Both cutoffs are RELATIVE to the starting weight. They used to be
         * absolute (1e-4), which meant that raising the ray count shrank
         * wgt = pi/N and truncated interreflection after fewer bounces — so a
         * higher quality setting returned a LOWER daylight factor. Caught by
         * the convergence sweep in test/audit.mjs.
         */
        if (w < wgt * 1e-3) break;
        // Russian roulette once the path is carrying little energy
        if (w < wgt * 0.02) {
          if (Math.random() > 0.5) break;
          w *= 2;
        }
        // reflect diffusely off the face the ray actually arrived at
        var nx = hit.nx, ny = hit.ny, nz = hit.nz;
        if (nx * dx + ny * dy + nz * dz > 0) { nx = -nx; ny = -ny; nz = -nz; }
        cosineSample(nx, ny, nz, Math.random(), Math.random(), basis, d);
        dx = d[0]; dy = d[1]; dz = d[2];
        ox = hx + nx * EPS; oy = hy + ny * EPS; oz = hz + nz * EPS;
      }
    }
  }
  return rays;
};

/**
 * Illuminance from a patch-luminance vector. Diffuse (sky + ground) only —
 * the direct beam is added by directSun().
 */
DaylightCore.prototype.diffuse = function (lum, groundLum, out) {
  var n = this.nPts, stride = this.stride, dc = this.dc, np = stride - 1;
  out = out || new Float32Array(n);
  for (var p = 0; p < n; p++) {
    var base = p * stride, s = 0;
    for (var i = 0; i < np; i++) s += dc[base + i] * lum[i];
    out[p] = s + dc[base + np] * groundLum;
  }
  return out;
};

/**
 * Direct beam contribution. `Enormal` is the beam illuminance on a plane
 * normal to the sun (lux). Samples the sun disc so a soft edge appears when
 * the apparent diameter is exaggerated for teaching.
 */
DaylightCore.prototype.directSun = function (sunDir, Enormal, sunRadiusRad, samples, out) {
  var n = this.nPts, pts = this.pts, nrm = this.nrm, bvh = this.bvh, mats = this.mats;
  out = out || new Float32Array(n);
  if (!(Enormal > 0) || sunDir.y <= 0) { out.fill(0); return out; }

  var K = Math.max(1, samples | 0);
  var basis = new Float64Array(6);
  onb(sunDir.x, sunDir.y, sunDir.z, basis);
  var hit = {};

  for (var p = 0; p < n; p++) {
    var px = pts[p * 3], py = pts[p * 3 + 1], pz = pts[p * 3 + 2];
    var nx = nrm[p * 3], ny = nrm[p * 3 + 1], nz = nrm[p * 3 + 2];
    var acc = 0;
    for (var k = 0; k < K; k++) {
      var dx = sunDir.x, dy = sunDir.y, dz = sunDir.z;
      if (K > 1 && sunRadiusRad > 0) {
        // uniform disc offset within the sun's apparent radius
        var r = sunRadiusRad * Math.sqrt(halton(k + 1, 2));
        var a = 2 * Math.PI * halton(k + 1, 3);
        var ox2 = r * Math.cos(a), oy2 = r * Math.sin(a);
        dx += basis[0] * ox2 + basis[3] * oy2;
        dy += basis[1] * ox2 + basis[4] * oy2;
        dz += basis[2] * ox2 + basis[5] * oy2;
        var L = Math.hypot(dx, dy, dz) || 1; dx /= L; dy /= L; dz /= L;
      }
      var cosI = nx * dx + ny * dy + nz * dz;
      if (cosI <= 0) continue;
      acc += cosI * this.transmittance(px + nx * EPS, py + ny * EPS, pz + nz * EPS, dx, dy, dz, hit);
    }
    out[p] = Enormal * acc / K;
  }
  return out;
};

/** Product of glazing transmittances along a ray; 0 if anything opaque blocks. */
DaylightCore.prototype.transmittance = function (ox, oy, oz, dx, dy, dz, hit) {
  var bvh = this.bvh, mats = this.mats, t = 1;
  for (var guard = 0; guard < 24; guard++) {
    if (!bvh.intersect(ox, oy, oz, dx, dy, dz, 1e6, hit, -1)) return t;
    var m = mats[hit.mat] || { rho: 0.5, tau: 0 };
    if (!(m.tau > 0)) return 0;
    t *= m.tau;
    if (t < 1e-4) return 0;
    ox += dx * (hit.t + EPS); oy += dy * (hit.t + EPS); oz += dz * (hit.t + EPS);
  }
  return t;
};

/** Fraction of the sun disc visible at each point — used for sun-hour counts. */
DaylightCore.prototype.sunVisible = function (sunDir, samples, out) {
  var n = this.nPts, pts = this.pts, nrm = this.nrm;
  out = out || new Float32Array(n);
  if (sunDir.y <= 0) { out.fill(0); return out; }
  var hit = {};
  for (var p = 0; p < n; p++) {
    var nx = nrm[p * 3], ny = nrm[p * 3 + 1], nz = nrm[p * 3 + 2];
    if (nx * sunDir.x + ny * sunDir.y + nz * sunDir.z <= 0) { out[p] = 0; continue; }
    out[p] = this.transmittance(
      pts[p * 3] + nx * EPS, pts[p * 3 + 1] + ny * EPS, pts[p * 3 + 2] + nz * EPS,
      sunDir.x, sunDir.y, sunDir.z, hit) > 0 ? 1 : 0;
  }
  return out;
};

/**
 * Annual run over the occupied hours of a climate.
 * Split into begin/step so the same code can stream progress from the Worker
 * or be time-sliced on the main thread when no Worker is available.
 *
 * Accumulates everything the climate-based metrics need in one pass:
 *   udi[5]   hour counts per illuminance interval, per point
 *   daHours  hours at or above the target illuminance
 *   aseHours hours of direct sun above the ASE threshold
 *   sunHours hours with any direct beam reaching the point
 */
DaylightCore.prototype.annualBegin = function (o) {
  var n = this.nPts;
  // the hourly Perez sky needs a patch set whether or not a bake happened
  if (!this.patches) this.patches = buildSkyPatches(1);
  return {
    o: o, day: 0, n: n,
    // `o.df` present => diffuse comes from a daylight factor rather than the
    // coefficient matrix, which is how the split-flux engine runs the year.
    // Everything downstream — direct sun, UDI, DA, ASE, sun hours — is shared.
    useDf: !!o.df,
    udi: new Float32Array(n * 5),
    daHours: new Float32Array(n), aseHours: new Float32Array(n),
    sunHours: new Float32Array(n),
    sumLux: new Float64Array(n), maxLux: new Float32Array(n),
    hours: 0,
    hStart: clamp(Math.floor(o.occStart), 0, 23),
    hEnd: clamp(Math.ceil(o.occEnd), clamp(Math.floor(o.occStart), 0, 23) + 1, 24),
    diff: new Float32Array(n), dir: new Float32Array(n), vis: new Float32Array(n)
  };
};

/** Advance the annual run by `nDays`. Returns progress 0..1 (1 = finished). */
DaylightCore.prototype.annualStep = function (st, nDays) {
  var o = st.o, clim = o.climate, site = o.site, P = this.patches;
  var n = st.n, bins = o.udi;
  var udi = st.udi, daH = st.daHours, aseH = st.aseHours, sunH = st.sunHours;
  var sumLux = st.sumLux, maxLux = st.maxLux;
  var diff = st.diff, dir = st.dir, vis = st.vis;
  var end = Math.min(365, st.day + nDays);

  for (; st.day < end; st.day++) {
    var md = fromDoy(st.day + 1);
    for (var h = st.hStart; h < st.hEnd; h++) {
      var sun = sunPosition(site, site.year || 2001, md.month, md.day, h + 0.5);
      st.hours++;
      if (!sun.up) {
        for (var q0 = 0; q0 < n; q0++) udi[q0 * 5] += 1;
        continue;
      }
      if (!st.useDf && !this.dc) continue;   // nothing baked; nothing to add
      var k = clim.index(md.month, md.day, h);
      var sky = buildSkyVector(P, {
        model: 'perez', sun: sun, dni: clim.dni[k], dhi: clim.dhi[k],
        groundRefl: o.groundRefl, dayOfYear: st.day + 1
      });

      if (st.useDf) {
        var df = o.df, Ed = sky.Ediff;
        for (var q1 = 0; q1 < n; q1++) diff[q1] = df[q1] / 100 * Ed;
      } else {
        this.diffuse(sky.lum, sky.ground, diff);
      }
      if (sky.Enormal > 1) {
        this.directSun(sun.dir, sky.Enormal, o.sunRadius || 0.00465, 1, dir);
        this.sunVisible(sun.dir, 1, vis);
      } else { dir.fill(0); vis.fill(0); }

      for (var q = 0; q < n; q++) {
        var E = diff[q] + dir[q];
        sumLux[q] += E;
        if (E > maxLux[q]) maxLux[q] = E;
        if (E >= o.targetLux) daH[q] += 1;
        var b = E < bins[0] ? 0 : E < bins[1] ? 1 : E < bins[2] ? 2 : E < bins[3] ? 3 : 4;
        udi[q * 5 + b] += 1;
        if (vis[q] > 0) {
          sunH[q] += 1;
          if (dir[q] >= o.aseLux) aseH[q] += 1;
        }
      }
    }
  }
  return st.day / 365;
};

/** Finalise an annual run into the result bundle the UI consumes. */
DaylightCore.prototype.annualEnd = function (st) {
  var meanLux = new Float32Array(st.n);
  for (var q = 0; q < st.n; q++) meanLux[q] = st.sumLux[q] / Math.max(1, st.hours);
  return {
    hours: st.hours, udi: st.udi, daHours: st.daHours, aseHours: st.aseHours,
    sunHours: st.sunHours, meanLux: meanLux, maxLux: st.maxLux
  };
};

/** Convenience: run the whole year in one go (used by the headless tests). */
DaylightCore.prototype.annual = function (o, onProgress) {
  var st = this.annualBegin(o);
  while (this.annualStep(st, 20) < 1) if (onProgress) onProgress(st.day / 365);
  return this.annualEnd(st);
};
