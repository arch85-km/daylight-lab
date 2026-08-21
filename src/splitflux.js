/* ==========================================================================
   Split-flux (BRE) daylight factor.

        DF = SC + ERC + IRC

   The classic hand method: a sky component integrated over the aperture, an
   externally reflected component from the obstruction, and the BRE average
   internally reflected component. It runs in milliseconds and a student can
   check it with a calculator.

   It deliberately does NOT see the shading devices, the reveals or the
   skylight well — that limitation is the point of offering both engines.
   ========================================================================== */

/** BRE coefficient C against obstruction angle, in 10-degree steps. */
var BRE_C = [39, 35, 31, 25, 20, 14, 10, 7, 5, 5, 5];
function breC(obstructionDeg) {
  var x = clamp(obstructionDeg, 0, 90) / 10;
  var i = Math.min(Math.floor(x), 9);
  return lerp(BRE_C[i], BRE_C[i + 1], x - i);
}

/** CIE overcast relative luminance for a direction of altitude `altRad`. */
function overcastRel(altRad) { return (1 + 2 * Math.sin(Math.max(0, altRad))) / 3; }

/**
 * Sky + externally reflected components at one point, by numerical
 * integration over every aperture. Returns percentages of the unobstructed
 * horizontal illuminance.
 */
function skyComponents(model, px, py, pz, nx, ny, nz, sub) {
  var R = model.room, aps = model.apertures || [];
  var obstruction = (model.site.obstructionAngle || 0) * DEG;
  var groundRefl = R.refl.ground == null ? 0.2 : R.refl.ground;
  var N = sub || 6;
  // Unobstructed horizontal illuminance under the same relative sky:
  //   Eh = integral of L cos(theta) dw = (7*pi/9) * Lz, with Lz = 1
  var Eh = 7 * Math.PI / 9;
  var sc = 0, erc = 0;

  for (var a = 0; a < aps.length; a++) {
    var ap = aps[a];
    if (ap.enabled === false || ap.kind === 'door') continue;
    var tau = (ap.tau == null ? 0.78 : ap.tau) *
              (ap.maintenance == null ? 0.92 : ap.maintenance) *
              (ap.frameFactor == null ? 1 : ap.frameFactor);
    if (tau <= 0) continue;

    var F = frameFor(ap.side, R), rc = apertureRect(ap, R);
    var fw = ap.frameWidth == null ? 0.05 : ap.frameWidth;
    var u0 = rc[0] + fw, u1 = rc[1] - fw, v0 = rc[2] + fw, v1 = rc[3] - fw;
    if (u1 <= u0 || v1 <= v0) continue;

    // glazing plane sits at glassPos through the reveal
    var gd = clamp(ap.glassPos == null ? 0.5 : ap.glassPos, 0, 1) * Math.max(0, F.t - 0.02) + 0.01;
    var du = (u1 - u0) / N, dv = (v1 - v0) / N, cellA = du * dv;

    for (var i = 0; i < N; i++) for (var j = 0; j < N; j++) {
      var q = fpt(F, u0 + (i + 0.5) * du, v0 + (j + 0.5) * dv, gd);
      var rx = q[0] - px, ry = q[1] - py, rz = q[2] - pz;
      var r2 = rx * rx + ry * ry + rz * rz;
      if (r2 < 1e-9) continue;
      var r = Math.sqrt(r2);
      var dx = rx / r, dy = ry / r, dz = rz / r;

      var cosP = dx * nx + dy * ny + dz * nz;                 // at the sensor
      if (cosP <= 0) continue;
      var cosW = Math.abs(dx * F.N[0] + dy * F.N[1] + dz * F.N[2]);   // at the glass
      if (cosW <= 0) continue;

      var dOmega = cellA * cosW / r2;
      var alt = Math.asin(clamp(dy, -1, 1));
      var contrib = overcastRel(alt) * cosP * dOmega * tau;

      if (alt > obstruction) sc += contrib;
      else erc += contrib * groundRefl;      // obstruction seen instead of sky
    }
  }
  return { sc: 100 * sc / Eh, erc: 100 * erc / Eh };
}

/**
 * BRE average internally reflected component (uniform over the room).
 *   IRC = (T*W / (A*(1-rho))) * (C*rho_fw + 5*(rho_cw - rho_fw))
 */
function internallyReflected(model) {
  var R = model.room, r = R.refl;
  var A = surfaceAreas(model);
  var aps = model.apertures || [];

  var Wg = 0, Ttot = 0;
  for (var i = 0; i < aps.length; i++) {
    var ap = aps[i];
    if (ap.enabled === false || ap.kind === 'door') continue;
    var fw = ap.frameWidth == null ? 0.05 : ap.frameWidth;
    var area = Math.max(0, ap.w - 2 * fw) * Math.max(0, ap.h - 2 * fw);
    var tau = (ap.tau == null ? 0.78 : ap.tau) *
              (ap.maintenance == null ? 0.92 : ap.maintenance) *
              (ap.frameFactor == null ? 1 : ap.frameFactor);
    Wg += area; Ttot += area * tau;
  }
  if (Wg <= 0) return 0;
  var T = Ttot / Wg;

  var Atot = A.floor + A.ceiling + A.wall + Wg;
  var wallHalf = A.wall / 2;
  // area-weighted mean reflectance of every interior surface
  var rho = (A.floor * r.floor + A.ceiling * r.ceiling + A.wall * r.wall + Wg * 0.1) / Atot;
  rho = clamp(rho, 0.02, 0.95);
  // lower half (floor + walls below mid-height) and upper half (ceiling + above)
  var rhoFw = (A.floor * r.floor + wallHalf * r.wall) / (A.floor + wallHalf);
  var rhoCw = (A.ceiling * r.ceiling + wallHalf * r.wall) / (A.ceiling + wallHalf);

  var C = breC(model.site.obstructionAngle || 0);
  var irc = (T * Wg / (Atot * (1 - rho))) * (C * rhoFw + 5 * (rhoCw - rhoFw));
  return Math.max(0, irc);
}

/**
 * Split-flux daylight factor over a grid.
 * @returns {object} df (Float32Array, %), plus the three components
 */
function splitFluxGrid(model, pts, nrm, sub) {
  var n = (pts.length / 3) | 0;
  var df = new Float32Array(n), scA = new Float32Array(n), ercA = new Float32Array(n);
  var irc = internallyReflected(model);
  for (var p = 0; p < n; p++) {
    var c = skyComponents(model, pts[p * 3], pts[p * 3 + 1], pts[p * 3 + 2],
                          nrm[p * 3], nrm[p * 3 + 1], nrm[p * 3 + 2], sub);
    scA[p] = c.sc; ercA[p] = c.erc;
    df[p] = c.sc + c.erc + irc;
  }
  return { df: df, sc: scA, erc: ercA, irc: irc };
}

/**
 * Average daylight factor, BS 8206-2 — the single number students are most
 * often asked for, and a useful cross-check on the grid mean.
 *   ADF = (T * W * theta) / (A * (1 - rho^2))
 * with theta the visible sky angle in degrees (90 with no obstruction).
 */
function averageDaylightFactor(model) {
  var A = surfaceAreas(model), r = model.room.refl;
  var aps = model.apertures || [], Wg = 0, Ttot = 0;
  for (var i = 0; i < aps.length; i++) {
    var ap = aps[i];
    if (ap.enabled === false || ap.kind === 'door') continue;
    var fw = ap.frameWidth == null ? 0.05 : ap.frameWidth;
    var area = Math.max(0, ap.w - 2 * fw) * Math.max(0, ap.h - 2 * fw);
    var tau = (ap.tau == null ? 0.78 : ap.tau) * (ap.maintenance == null ? 0.92 : ap.maintenance);
    Wg += area; Ttot += area * tau;
  }
  if (Wg <= 0) return 0;
  var T = Ttot / Wg;
  var Atot = A.floor + A.ceiling + A.wall + Wg;
  var rho = clamp((A.floor * r.floor + A.ceiling * r.ceiling + A.wall * r.wall + Wg * 0.1) / Atot, 0.02, 0.95);
  var theta = clamp(90 - (model.site.obstructionAngle || 0), 0, 90);
  return (T * Wg * theta) / (Atot * (1 - rho * rho));
}
