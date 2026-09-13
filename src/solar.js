/* ==========================================================================
   Solar position — NOAA Solar Calculator algorithm (Meeus, low-precision).
   Accurate to well under 0.1 deg for the century around 2000, which is far
   finer than any daylighting question needs.

   Conventions used throughout Daylight Lab:
     * Y up, +X = East, +Z = South, -Z = North  (right handed)
     * Azimuth is measured CLOCKWISE FROM NORTH: 0 = N, 90 = E, 180 = S, 270 = W
     * `northAngle` rotates project north away from -Z, clockwise positive
   ========================================================================== */

/** Julian day for a Gregorian calendar date at 00:00 UT. */
function julianDay(y, m, d) {
  if (m <= 2) { y -= 1; m += 12; }
  var A = Math.floor(y / 100), B = 2 - A + Math.floor(A / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + B - 1524.5;
}

/**
 * Full solar geometry for one instant.
 * @param {object} loc  {lat, lon, tz}  degrees / hours east of Greenwich
 * @param {number} year
 * @param {number} month 1..12
 * @param {number} day   1..31
 * @param {number} hour  local CLOCK hour, decimal (DST already removed)
 * @returns {object} altitude, azimuth, declination, eqTime, hourAngle,
 *                   sunrise/solarNoon/sunset (decimal local hours), dayLength,
 *                   solarTime, and the unit vector `dir` pointing AT the sun.
 */
function sunPosition(loc, year, month, day, hour) {
  var jd = julianDay(year, month, day) + (hour - loc.tz) / 24;
  var T = (jd - 2451545) / 36525;

  var L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360;
  if (L0 < 0) L0 += 360;
  var M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  var e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);

  var Mr = M * DEG;
  var C = Math.sin(Mr) * (1.914602 - T * (0.004817 + 0.000014 * T)) +
          Math.sin(2 * Mr) * (0.019993 - 0.000101 * T) +
          Math.sin(3 * Mr) * 0.000289;

  var trueLong = L0 + C;
  var omega = 125.04 - 1934.136 * T;
  var appLong = trueLong - 0.00569 - 0.00478 * Math.sin(omega * DEG);

  var seconds = 21.448 - T * (46.815 + T * (0.00059 - T * 0.001813));
  var meanObliq = 23 + (26 + seconds / 60) / 60;
  var obliq = meanObliq + 0.00256 * Math.cos(omega * DEG);

  var decl = Math.asin(Math.sin(obliq * DEG) * Math.sin(appLong * DEG)) * RAD;

  var y = Math.tan(obliq * DEG / 2); y *= y;
  var eqTime = 4 * RAD * (
    y * Math.sin(2 * L0 * DEG) -
    2 * e * Math.sin(Mr) +
    4 * e * y * Math.sin(Mr) * Math.cos(2 * L0 * DEG) -
    0.5 * y * y * Math.sin(4 * L0 * DEG) -
    1.25 * e * e * Math.sin(2 * Mr)
  );

  // ---- hour angle & altitude ------------------------------------------
  var tst = (hour * 60 + eqTime + 4 * loc.lon - 60 * loc.tz) % 1440;
  if (tst < 0) tst += 1440;
  var ha = tst / 4 - 180;                       // degrees, 0 at solar noon
  if (ha < -180) ha += 360;

  var latR = loc.lat * DEG, declR = decl * DEG, haR = ha * DEG;
  var cosZ = clamp(Math.sin(latR) * Math.sin(declR) +
                   Math.cos(latR) * Math.cos(declR) * Math.cos(haR), -1, 1);
  var zenith = Math.acos(cosZ) * RAD;
  var alt0 = 90 - zenith;

  // atmospheric refraction (NOAA piecewise fit), only meaningful near horizon
  var refr = 0;
  if (alt0 <= 85) {
    var te = Math.tan(alt0 * DEG);
    if (alt0 > 5) refr = 58.1 / te - 0.07 / (te * te * te) + 0.000086 / Math.pow(te, 5);
    else if (alt0 > -0.575) refr = 1735 + alt0 * (-518.2 + alt0 * (103.4 + alt0 * (-12.79 + alt0 * 0.711)));
    else refr = -20.772 / te;
    refr /= 3600;
  }
  var altitude = alt0 + refr;

  // ---- azimuth ---------------------------------------------------------
  var azimuth;
  var denom = Math.cos(latR) * Math.sin(zenith * DEG);
  if (Math.abs(denom) > 1e-9) {
    var c = clamp((Math.sin(latR) * cosZ - Math.sin(declR)) / denom, -1, 1);
    azimuth = 180 - Math.acos(c) * RAD;
    if (ha > 0) azimuth = 360 - azimuth;
  } else {
    azimuth = loc.lat > 0 ? 180 : 0;           // sun at the zenith/pole
  }
  azimuth = (azimuth % 360 + 360) % 360;

  // ---- sunrise / noon / sunset (local clock hours) ---------------------
  var haSet = NaN, sunrise = NaN, sunset = NaN, dayLength = 0;
  var cosHa = Math.cos(90.833 * DEG) / (Math.cos(latR) * Math.cos(declR)) - Math.tan(latR) * Math.tan(declR);
  var noon = (720 - 4 * loc.lon - eqTime + 60 * loc.tz) / 60;
  if (cosHa >= -1 && cosHa <= 1) {
    haSet = Math.acos(cosHa) * RAD;
    sunrise = noon - haSet * 4 / 60;
    sunset = noon + haSet * 4 / 60;
    dayLength = haSet * 8 / 60;
  } else {
    dayLength = cosHa < -1 ? 24 : 0;           // polar day / polar night
    if (dayLength === 24) { sunrise = 0; sunset = 24; }
  }

  return {
    altitude: altitude, azimuth: azimuth, zenith: 90 - altitude,
    declination: decl, eqTime: eqTime, hourAngle: ha,
    solarTime: tst / 60, solarNoon: noon,
    sunrise: sunrise, sunset: sunset, dayLength: dayLength,
    up: altitude > 0,
    dir: sunVector(altitude, azimuth, 0)
  };
}

/**
 * Unit vector pointing from the model towards the sun.
 * @param {number} altDeg
 * @param {number} aziDeg   clockwise from true north
 * @param {number} northAngle  project-north rotation, clockwise positive
 */
function sunVector(altDeg, aziDeg, northAngle) {
  var a = altDeg * DEG, z = (aziDeg - (northAngle || 0)) * DEG, ca = Math.cos(a);
  return { x: ca * Math.sin(z), y: Math.sin(a), z: -ca * Math.cos(z) };
}

/** Altitude/azimuth samples along one day's arc (for the sun-path dome). */
function dayArc(loc, year, month, day, stepMinutes) {
  var out = [], step = (stepMinutes || 10) / 60;
  for (var h = 0; h <= 24 + 1e-9; h += step) {
    var s = sunPosition(loc, year, month, day, Math.min(h, 23.9999));
    out.push({ h: h, alt: s.altitude, azi: s.azimuth });
  }
  return out;
}

/** Analemma: sun position at a fixed clock hour across the whole year. */
function analemma(loc, year, hour, stepDays) {
  var out = [], step = stepDays || 5;
  for (var n = 1; n <= 365; n += step) {
    var md = fromDoy(n);
    var s = sunPosition(loc, year, md.month, md.day, hour);
    out.push({ n: n, alt: s.altitude, azi: s.azimuth });
  }
  return out;
}

/**
 * ASHRAE-style clear-sky irradiance, used whenever no EPW is loaded so that
 * every metric still has something physically sensible to run against.
 * Returns W/m2: dni (direct normal), dhi (diffuse horizontal), ghi.
 */
function clearSkyIrradiance(altitudeDeg, dayOfYear, turbidity) {
  if (altitudeDeg <= 0) return { dni: 0, dhi: 0, ghi: 0 };
  var TL = turbidity == null ? 3.5 : turbidity;
  var alt = altitudeDeg * DEG;
  var sinA = Math.sin(alt);
  var E0 = 1367 * (1 + 0.033 * Math.cos(2 * Math.PI * dayOfYear / 365));

  // Kasten & Young relative air mass
  var am = 1 / (sinA + 0.50572 * Math.pow(altitudeDeg + 6.07995, -1.6364));
  var dni = E0 * Math.exp(-0.09 * am * (TL - 1)) * Math.exp(-0.0045 * am * TL);
  dni = Math.max(0, dni);

  // Diffuse rises as the sun drops and as turbidity climbs
  var dhi = Math.max(0, E0 * sinA * (0.0715 + 0.0193 * TL) * Math.pow(sinA, 0.28));
  return { dni: dni, dhi: dhi, ghi: dni * sinA + dhi };
}

/**
 * Luminous efficacy of beam and diffuse radiation (Perez et al. 1990,
 * simplified). Converts the W/m2 an EPW carries into the lm/W a lighting
 * calculation needs.
 */
function efficacy(altitudeDeg, dni, dhi) {
  var sinA = Math.max(0.01, Math.sin(Math.max(0, altitudeDeg) * DEG));
  // beam efficacy climbs with solar altitude (~40 lm/W low, ~105 lm/W high)
  var kb = 40 + 65 * Math.pow(sinA, 0.35);
  // diffuse efficacy is far more stable; clearer skies sit a little lower
  var clearness = dni > 0 ? clamp(dni / 900, 0, 1) : 0;
  var kd = 125 - 20 * clearness;
  return { beam: kb, diffuse: kd };
}
