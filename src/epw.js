/* ==========================================================================
   EPW climate data.

   An EnergyPlus Weather file gives 8760 hourly rows. We only need four
   things from it: direct normal irradiance, diffuse horizontal irradiance,
   (optionally) the measured illuminances, and the header's location.

   When no file is loaded the app synthesises a climate from the clear-sky
   model with a deterministic cloud sequence, so every annual metric is
   available from the first second the page opens.
   ========================================================================== */

/** EPW column indices (0-based) for the fields we consume. */
var EPW_COL = {
  year: 0, month: 1, day: 2, hour: 3,
  dryBulb: 6, rh: 8,
  ghi: 13, dni: 14, dhi: 15,
  ghIll: 16, dnIll: 17, dhIll: 18, zenLum: 19,
  cloud: 22
};
var EPW_MISSING = 999999;

/**
 * Parse an .epw file.
 * @param {string} text
 * @returns {object} climate — see makeClimate() for the shape
 * @throws {Error} on a file that is not a recognisable EPW
 */
function parseEpw(text) {
  var lines = text.split(/\r?\n/);
  if (!lines.length || lines[0].slice(0, 8).toUpperCase() !== 'LOCATION') {
    throw new Error('Not an EPW file — the first line must start with LOCATION.');
  }
  var h = lines[0].split(',');
  var loc = {
    city: (h[1] || 'Unknown').trim(),
    region: (h[2] || '').trim(),
    country: (h[3] || '').trim(),
    lat: parseFloat(h[6]), lon: parseFloat(h[7]),
    tz: parseFloat(h[8]), elevation: parseFloat(h[9]) || 0
  };
  if (!isFinite(loc.lat) || !isFinite(loc.lon) || !isFinite(loc.tz)) {
    throw new Error('EPW header has no usable latitude / longitude / time zone.');
  }

  var dni = new Float32Array(8760), dhi = new Float32Array(8760);
  var ghi = new Float32Array(8760), temp = new Float32Array(8760);
  var dnIll = new Float32Array(8760), dhIll = new Float32Array(8760);
  var haveIll = true, rows = 0;

  for (var i = 8; i < lines.length && rows < 8760; i++) {
    var ln = lines[i];
    if (!ln || ln.length < 40) continue;
    var f = ln.split(',');
    if (f.length < 20) continue;

    var mo = +f[EPW_COL.month], da = +f[EPW_COL.day], hr = +f[EPW_COL.hour];
    if (!(mo >= 1 && mo <= 12 && da >= 1 && da <= 31 && hr >= 1 && hr <= 24)) continue;
    // Skip 29 Feb: the app runs a flat 365-day year.
    if (mo === 2 && da === 29) continue;

    var k = (doy(mo, da) - 1) * 24 + (hr - 1);
    if (k < 0 || k >= 8760) continue;

    var vDni = +f[EPW_COL.dni], vDhi = +f[EPW_COL.dhi], vGhi = +f[EPW_COL.ghi];
    dni[k] = (isFinite(vDni) && vDni < EPW_MISSING) ? Math.max(0, vDni) : 0;
    dhi[k] = (isFinite(vDhi) && vDhi < EPW_MISSING) ? Math.max(0, vDhi) : 0;
    ghi[k] = (isFinite(vGhi) && vGhi < EPW_MISSING) ? Math.max(0, vGhi) : 0;
    var t = +f[EPW_COL.dryBulb];
    temp[k] = (isFinite(t) && t > -90 && t < 90) ? t : 0;

    var a = +f[EPW_COL.dnIll], b = +f[EPW_COL.dhIll];
    if (isFinite(a) && a < EPW_MISSING && isFinite(b) && b < EPW_MISSING) {
      dnIll[k] = Math.max(0, a); dhIll[k] = Math.max(0, b);
    } else { haveIll = false; }
    rows++;
  }
  if (rows < 8000) throw new Error('EPW contains only ' + rows + ' usable hourly rows (expected 8760).');

  return makeClimate({
    name: loc.city + (loc.country ? ', ' + loc.country : ''),
    source: 'EPW', loc: loc,
    dni: dni, dhi: dhi, ghi: ghi, temp: temp,
    dnIll: haveIll ? dnIll : null, dhIll: haveIll ? dhIll : null
  });
}

/**
 * Deterministic synthetic climate so the app is never empty.
 * Clear-sky irradiance modulated by a seasonal cloud-cover sequence.
 */
function syntheticClimate(loc, cloudiness) {
  var dni = new Float32Array(8760), dhi = new Float32Array(8760);
  var ghi = new Float32Array(8760), temp = new Float32Array(8760);
  var rng = new Rng(0x5EED17);
  var base = cloudiness == null ? 0.42 : cloudiness;
  var state = base;

  for (var d = 0; d < 365; d++) {
    var md = fromDoy(d + 1);
    // seasonal cloud bias: cloudier in the hemisphere's winter
    var seasonal = Math.cos(2 * Math.PI * (d - (loc.lat >= 0 ? 172 : 355)) / 365);
    for (var h = 0; h < 24; h++) {
      var k = d * 24 + h;
      // slow random walk keeps consecutive hours correlated, like real weather
      state = clamp(state + (rng.next() - 0.5) * 0.22, 0, 1);
      var cloud = clamp(state * 0.72 + (base + 0.16 * seasonal) * 0.28, 0, 1);

      var s = sunPosition(loc, 2001, md.month, md.day, h + 0.5);
      if (s.altitude <= 0) { temp[k] = 10; continue; }
      var cs = clearSkyIrradiance(s.altitude, d + 1, 3.0 + 2 * cloud);

      // clouds kill the beam and lift the diffuse fraction
      var kb = Math.pow(1 - cloud, 2.6);
      dni[k] = cs.dni * kb;
      dhi[k] = cs.dhi * (1 + 2.1 * cloud * (1 - 0.35 * cloud));
      ghi[k] = dni[k] * Math.sin(s.altitude * DEG) + dhi[k];
      temp[k] = 14 + 10 * Math.sin(2 * Math.PI * (d - 100) / 365) * (loc.lat >= 0 ? 1 : -1)
              + 5 * Math.sin(2 * Math.PI * (h - 9) / 24);
    }
  }
  return makeClimate({
    name: 'Synthetic (' + Math.round(base * 100) + '% mean cloud)',
    source: 'built-in', loc: loc,
    dni: dni, dhi: dhi, ghi: ghi, temp: temp, dnIll: null, dhIll: null,
    synthetic: true
  });
}

/** Wrap raw hourly arrays with accessors and a monthly summary. */
function makeClimate(c) {
  c.monthly = [];
  for (var m = 0; m < 12; m++) {
    var s = (MCUM[m]) * 24, e = (MCUM[m + 1]) * 24, gs = 0, ds = 0, ts = 0, n = 0;
    for (var k = s; k < e; k++) { gs += c.ghi[k]; ds += c.dhi[k]; ts += c.temp[k]; n++; }
    c.monthly.push({
      month: m + 1,
      ghiMean: gs / n, dhiMean: ds / n, tempMean: ts / n,
      kwh: gs * 1 / 1000                        // kWh/m2 for the month
    });
  }
  c.peakGhi = 0;
  for (var i = 0; i < 8760; i++) if (c.ghi[i] > c.peakGhi) c.peakGhi = c.ghi[i];

  /** Hour index for (month, day, hour 0..23). */
  c.index = function (month, day, hour) {
    return clamp((doy(month, day) - 1) * 24 + Math.floor(hour), 0, 8759);
  };
  /** Linear interpolation between hourly rows, for a smooth time slider. */
  c.at = function (month, day, hour) {
    var f = (doy(month, day) - 1) * 24 + hour - 0.5;
    var i0 = clamp(Math.floor(f), 0, 8759), i1 = clamp(i0 + 1, 0, 8759);
    var t = clamp(f - i0, 0, 1);
    return {
      dni: lerp(c.dni[i0], c.dni[i1], t),
      dhi: lerp(c.dhi[i0], c.dhi[i1], t),
      ghi: lerp(c.ghi[i0], c.ghi[i1], t),
      temp: lerp(c.temp[i0], c.temp[i1], t)
    };
  };
  return c;
}
