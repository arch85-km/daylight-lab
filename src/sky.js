/* ==========================================================================
   Sky models.

   A sky is discretised into Tregenza/Reinhart patches. Every daylight
   calculation in the app reduces to a dot product between a per-point
   daylight-coefficient row and a patch-luminance vector, so swapping the sky
   (overcast -> clear -> a specific EPW hour) never re-runs the raytracer.

   Patch set  : Reinhart MF:1 = 145 patches, MF:2 = 577  (+1 ground slot)
   Luminance  : cd/m2
   ========================================================================== */

/** Reinhart row structure: [patches per row] per subdivision factor. */
var REINHART_ROWS = {
  1: [30, 30, 24, 24, 18, 12, 6],
  2: [60, 60, 60, 60, 48, 48, 48, 48, 36, 36, 24, 24, 12, 12]
};

/**
 * Build a patch set. Each patch carries its centre direction, altitude,
 * azimuth and solid angle. Index `n` (the last slot) is the ground.
 */
function buildSkyPatches(mf) {
  var rows = REINHART_ROWS[mf] || REINHART_ROWS[1];
  var bandDeg = 90 / (rows.length + 0.5);      // last half-band is the zenith cap
  var alt = [], azi = [], omega = [], pomega = [], dx = [], dy = [], dz = [], row = [];

  for (var r = 0; r < rows.length; r++) {
    var a1 = r * bandDeg, a2 = (r + 1) * bandDeg;
    var ac = (a1 + a2) / 2, n = rows[r];
    var om = (2 * Math.PI / n) * (Math.sin(a2 * DEG) - Math.sin(a1 * DEG));
    /*
     * Projected solid angle, integrated exactly rather than taken at the patch
     * centre:  ∫ sin a dω  over the band  =  (π/n)(sin²a2 − sin²a1).
     * Using ω·sin(a_centre) instead over-counts by 0.55% and put a systematic
     * −0.55% on every daylight factor. Caught by the audit's unobstructed
     * benchmark, which plateaued at 99.45% instead of converging on 100%.
     */
    var pom = (Math.PI / n) * (Math.pow(Math.sin(a2 * DEG), 2) - Math.pow(Math.sin(a1 * DEG), 2));
    for (var i = 0; i < n; i++) {
      var az = (i + 0.5) * 360 / n;
      var ca = Math.cos(ac * DEG), zr = az * DEG;
      alt.push(ac); azi.push(az); omega.push(om); pomega.push(pom); row.push(r);
      dx.push(ca * Math.sin(zr)); dy.push(Math.sin(ac * DEG)); dz.push(-ca * Math.cos(zr));
    }
  }
  // zenith cap
  var capAlt = rows.length * bandDeg;
  alt.push((capAlt + 90) / 2); azi.push(0); row.push(rows.length);
  omega.push(2 * Math.PI * (1 - Math.sin(capAlt * DEG)));
  pomega.push(Math.PI * (1 - Math.pow(Math.sin(capAlt * DEG), 2)));
  var mid = (capAlt + 90) / 2 * DEG;
  dx.push(0); dy.push(Math.sin(mid)); dz.push(0);
  // normalise the cap direction (it is straight up in practice)
  dy[dy.length - 1] = 1;

  return {
    mf: mf, n: alt.length,
    alt: Float64Array.from(alt), azi: Float64Array.from(azi),
    omega: Float64Array.from(omega), pomega: Float64Array.from(pomega),
    row: Int32Array.from(row),
    dx: Float64Array.from(dx), dy: Float64Array.from(dy), dz: Float64Array.from(dz),
    /** Index of the patch containing a direction (dy > 0), else -1 for ground. */
    lookup: function (x, y, z) {
      if (y <= 0) return -1;
      var a = Math.asin(clamp(y, -1, 1)) * RAD;
      var r = Math.min(Math.floor(a / bandDeg), rows.length);
      if (r >= rows.length) return this.n - 1;
      var az = Math.atan2(x, -z) * RAD; if (az < 0) az += 360;
      var k = Math.floor(az * rows[r] / 360) % rows[r];
      var base = 0; for (var q = 0; q < r; q++) base += rows[q];
      return base + k;
    }
  };
}

/* --- CIE Standard General Sky (CIE S 011) -------------------------------
   15 standard types; a/b drive the zenith gradation, c/d/e the solar
   indicatrix. Type 1 is the Standard Overcast Sky used for Daylight Factor,
   type 12 the Standard Clear Sky.                                          */
var CIE_TYPES = [
  /*  1 */[4.0, -0.70, 0, -1.0, 0.00], /*  2 */[4.0, -0.70, 2, -1.5, 0.15],
  /*  3 */[1.1, -0.80, 0, -1.0, 0.00], /*  4 */[1.1, -0.80, 2, -1.5, 0.15],
  /*  5 */[0.0, -1.00, 0, -1.0, 0.00], /*  6 */[0.0, -1.00, 2, -1.5, 0.15],
  /*  7 */[0.0, -1.00, 5, -2.5, 0.30], /*  8 */[0.0, -1.00, 10, -3.0, 0.45],
  /*  9 */[-1.0, -0.55, 2, -1.5, 0.15], /* 10 */[-1.0, -0.55, 5, -2.5, 0.30],
  /* 11 */[-1.0, -0.55, 10, -3.0, 0.45], /* 12 */[-1.0, -0.32, 10, -3.0, 0.45],
  /* 13 */[-1.0, -0.32, 16, -3.0, 0.30], /* 14 */[-1.0, -0.15, 16, -3.0, 0.30],
  /* 15 */[-1.0, -0.15, 24, -2.8, 0.15]
];

var SKY_MODELS = {
  overcast:     { label: 'CIE Overcast',     cie: 1,  needsSun: false },
  intermediate: { label: 'CIE Intermediate', cie: 8,  needsSun: true },
  clear:        { label: 'CIE Clear',        cie: 12, needsSun: true },
  uniform:      { label: 'Uniform',          cie: 5,  needsSun: false },
  perez:        { label: 'Perez (climate)',  cie: 0,  needsSun: true }
};

/** Angle between a patch and the sun, both given as unit vectors. */
function angBetween(ax, ay, az, bx, by, bz) {
  return Math.acos(clamp(ax * bx + ay * by + az * bz, -1, 1));
}

/** Relative luminance of every patch under a CIE standard sky type. */
function cieRelative(patches, type, sun) {
  var p = CIE_TYPES[clamp(type, 1, 15) - 1];
  var a = p[0], b = p[1], c = p[2], d = p[3], e = p[4];
  var n = patches.n, out = new Float64Array(n);

  var sx = 0, sy = 1, sz = 0, Zs = 0;
  if (sun && sun.altitude > 0) {
    sx = sun.dir.x; sy = sun.dir.y; sz = sun.dir.z;
    Zs = (90 - sun.altitude) * DEG;
  }
  var grad = function (Z) {
    var cz = Math.cos(Math.min(Z, Math.PI / 2 - 1e-4));
    return 1 + a * Math.exp(b / Math.max(cz, 1e-4));
  };
  var indi = function (chi) {
    return 1 + c * (Math.exp(d * chi) - Math.exp(d * Math.PI / 2)) + e * Math.cos(chi) * Math.cos(chi);
  };
  var denom = indi(Zs) * grad(0);
  if (Math.abs(denom) < 1e-9) denom = 1;

  for (var i = 0; i < n; i++) {
    var Z = (90 - patches.alt[i]) * DEG;
    var chi = angBetween(patches.dx[i], patches.dy[i], patches.dz[i], sx, sy, sz);
    out[i] = Math.max(0, indi(chi) * grad(Z) / denom);
  }
  return out;
}

/* --- Perez all-weather sky (Perez et al. 1993) -------------------------- */
var PEREZ_EPS = [1.065, 1.23, 1.5, 1.95, 2.8, 4.5, 6.2, Infinity];
var PEREZ_C = [
  [1.3525, -0.2576, -0.2690, -1.4366, -0.7670, 0.0007, 1.2734, -0.1233, 2.8000, 0.6004, 1.2375, 1.0000, 1.8734, 0.6297, 0.9738, 0.2809, 0.0356, -0.1246, -0.5718, 0.9938],
  [-1.2219, -0.7730, 1.4148, 1.1016, -0.2054, 0.0367, -3.9128, 0.9156, 6.9750, 0.1774, 6.4477, -0.1239, -1.5798, -0.5081, -1.7812, 0.1080, 0.2624, 0.0672, -0.2190, -0.4285],
  [-1.1000, -0.2515, 0.8952, 0.0156, 0.2782, -0.1812, -4.5000, 1.1766, 24.7219, -13.0812, -37.7000, 34.8438, -5.0000, 1.5218, 3.9229, -2.6204, -0.0156, 0.1597, 0.4199, -0.5562],
  [-0.5484, -0.6654, -0.2672, 0.7117, 0.7234, -0.6219, -5.6812, 2.6297, 33.3389, -18.3000, -62.2500, 52.0781, -3.5000, 0.0016, 1.1477, 0.1062, 0.4659, -0.3296, -0.0876, -0.0329],
  [-0.6000, -0.3566, -2.5000, 2.3250, 0.2937, 0.0496, -5.6812, 1.8415, 21.0000, -4.7656, -21.5906, 7.2492, -3.5000, -0.1554, 1.4062, 0.3988, 0.0032, 0.0766, -0.0656, -0.1294],
  [-1.0156, -0.3670, 1.0078, 1.4051, 0.2875, -0.5328, -3.8500, 3.3750, 14.0000, -0.9999, -7.1406, 7.5469, -3.4000, -0.1078, -1.0750, 1.5702, -0.0672, 0.4016, 0.3017, -0.4844],
  [-1.0000, 0.0211, 0.5025, -0.5119, -0.3000, 0.1922, 0.7023, -1.6317, 19.0000, -5.0000, 1.2438, -1.9094, -4.0000, 0.0250, 0.3844, 0.2656, 1.0468, -0.3788, -2.4517, 1.4656],
  [-1.0500, 0.0289, 0.4260, 0.3590, -0.3250, 0.1156, 0.7781, 0.0025, 31.0625, -14.5000, -46.1148, 55.3750, -7.2312, 0.4050, 13.3500, 0.6234, 1.5000, -0.6426, 1.8564, 0.5636]
];

/** Sky clearness and brightness from irradiance, per Perez. */
function perezEpsDelta(altDeg, dni, dhi, dayOfYear) {
  var Z = (90 - clamp(altDeg, -90, 90)) * DEG;
  var d = Math.max(dhi, 1e-4);
  var eps = ((d + dni) / d + 1.041 * Z * Z * Z) / (1 + 1.041 * Z * Z * Z);
  var E0 = 1367 * (1 + 0.033 * Math.cos(2 * Math.PI * (dayOfYear || 100) / 365));
  var am = altDeg > 0
    ? 1 / (Math.sin(altDeg * DEG) + 0.50572 * Math.pow(altDeg + 6.07995, -1.6364))
    : 38;
  return { eps: eps, delta: clamp(dhi * am / E0, 0.01, 0.6), Z: Z };
}

/** Relative luminance of every patch under the Perez all-weather sky. */
function perezRelative(patches, sun, dni, dhi, dayOfYear) {
  var n = patches.n, out = new Float64Array(n);
  if (!sun || sun.altitude <= 0) {           // night, or sun below horizon
    for (var q = 0; q < n; q++) out[q] = 1;
    return out;
  }
  var ed = perezEpsDelta(sun.altitude, dni, dhi, dayOfYear);
  var cat = 0; while (cat < 7 && ed.eps > PEREZ_EPS[cat]) cat++;
  var k = PEREZ_C[cat], D = ed.delta, Z = ed.Z;

  var a = k[0] + k[1] * Z + D * (k[2] + k[3] * Z);
  var b = k[4] + k[5] * Z + D * (k[6] + k[7] * Z);
  var c, d;
  if (cat === 0) {
    // Perez's alternative expressions for c and d, which apply to the LOWEST
    // clearness bin (eps <= 1.065, i.e. overcast) rather than the clearest.
    // Radiance gendaylit branches on the same category. See Delaunay (1994).
    c = Math.exp(Math.pow(D * (k[8] + k[9] * Z), k[10])) - k[11];
    d = -Math.exp(D * (k[12] + k[13] * Z)) + k[14] + D * k[15];
  } else {
    c = k[8] + k[9] * Z + D * (k[10] + k[11] * Z);
    d = k[12] + k[13] * Z + D * (k[14] + k[15] * Z);
  }
  var e = k[16] + k[17] * Z + D * (k[18] + k[19] * Z);

  var sx = sun.dir.x, sy = sun.dir.y, sz = sun.dir.z;
  for (var i = 0; i < n; i++) {
    var cz = Math.max(Math.cos((90 - patches.alt[i]) * DEG), 0.01);
    var chi = angBetween(patches.dx[i], patches.dy[i], patches.dz[i], sx, sy, sz);
    var lv = (1 + a * Math.exp(b / cz)) * (1 + c * Math.exp(d * chi) + e * Math.cos(chi) * Math.cos(chi));
    out[i] = Math.max(0, lv);
  }
  return out;
}

/** Diffuse horizontal illuminance produced by a patch-luminance vector. */
function horizontalFromPatches(patches, lum) {
  var s = 0;
  for (var i = 0; i < patches.n; i++) s += lum[i] * patches.pomega[i];
  return s;
}

/**
 * Build the absolute patch-luminance vector for a given sky.
 *
 * @param {object} patches
 * @param {object} o
 *   model         'overcast' | 'clear' | 'intermediate' | 'uniform' | 'perez'
 *   sun           result of sunPosition() (may be below horizon)
 *   dni, dhi      W/m2, only used by 'perez'
 *   designLux     target diffuse horizontal illuminance for the CIE skies
 *   groundRefl    0..1
 *   dayOfYear
 * @returns {object} lum (Float64Array, cd/m2, length patches.n),
 *                   ground (cd/m2), Ediff/Edir/Eglobal (lux)
 */
function buildSkyVector(patches, o) {
  var model = SKY_MODELS[o.model] ? o.model : 'overcast';
  var rel, Ediff, Edir = 0;

  if (model === 'perez') {
    rel = perezRelative(patches, o.sun, o.dni || 0, o.dhi || 0, o.dayOfYear);
    var eff = efficacy(o.sun ? o.sun.altitude : 0, o.dni || 0, o.dhi || 0);
    Ediff = (o.dhi || 0) * eff.diffuse;
    Edir = (o.sun && o.sun.altitude > 0)
      ? (o.dni || 0) * eff.beam * Math.sin(o.sun.altitude * DEG) : 0;
  } else {
    rel = cieRelative(patches, SKY_MODELS[model].cie, o.sun);
    Ediff = o.designLux || 10000;
    if (model === 'clear' || model === 'intermediate') {
      // CIE clear sky: pair the diffuse dome with a physically scaled beam
      var cs = clearSkyIrradiance(o.sun ? o.sun.altitude : 0, o.dayOfYear || 100,
        model === 'clear' ? 2.5 : 5.0);
      var ef = efficacy(o.sun ? o.sun.altitude : 0, cs.dni, cs.dhi);
      Ediff = cs.dhi * ef.diffuse;
      Edir = (o.sun && o.sun.altitude > 0) ? cs.dni * ef.beam * Math.sin(o.sun.altitude * DEG) : 0;
      if (Ediff < 1) Ediff = 1;
    }
  }

  var hRel = horizontalFromPatches(patches, rel);
  var scale = hRel > 1e-9 ? Ediff / hRel : 0;
  var lum = new Float64Array(patches.n);
  for (var i = 0; i < patches.n; i++) lum[i] = rel[i] * scale;

  var Eglobal = Ediff + Edir;
  return {
    model: model, lum: lum,
    ground: (o.groundRefl == null ? 0.2 : o.groundRefl) * Eglobal / Math.PI,
    Ediff: Ediff, Edir: Edir, Eglobal: Eglobal,
    // beam illuminance on a surface normal to the sun, for the direct term
    Enormal: (o.sun && o.sun.altitude > 0.5)
      ? Edir / Math.max(Math.sin(o.sun.altitude * DEG), 1e-3) : 0
  };
}

/** Sun angular radius in radians for a given apparent diameter in degrees. */
function sunAngularRadius(diameterDeg) { return (diameterDeg || 0.533) * DEG / 2; }
