/* ==========================================================================
   Split-flux (BRE) daylight factor.

        DF = SC + ERC + IRC

   The classic hand method: a sky component integrated over the aperture, an
   externally reflected component from the obstruction, and the BRE average
   internally reflected component. It runs in milliseconds and a student can
   check it with a calculator.

   External shading devices ARE accounted for: each sensor-to-glass direction is
   tested against a BVH holding only the overhangs, louvres and fins, and a
   blocked direction is credited to the externally reflected component off the
   device rather than to sky. A brise-soleil is an obstruction, and the method
   has always accounted for obstructions.

   Still NOT seen, deliberately: the reveals and the skylight well. Those are
   wall construction, which BRE handles through the net glazed area, and they
   remain the honest difference against the raytraced engine — change the wall
   thickness and one number moves while the other does not.
   ========================================================================== */

/**
 * Fraction of a shading device's diffuse reflection that heads back into the
 * room rather than out to the sky. Calibrated against the raytraced engine
 * across overhangs, louvre banks and fins — see docs/ENGINE-VALIDATION.md.
 */
var SHADE_ERC_SHARE = 0.5;

/**
 * Aperture subdivision. Shading devices put fine structure across the opening
 * — a five-blade louvre bank on a 1.6 m window has blades every 0.375 m — so
 * the integration is refined when any device is present. It costs nothing on
 * an unshaded model, which is the common case.
 */
var SF_SUB_PLAIN = 8, SF_SUB_SHADED = 16;

/** BRE coefficient C against obstruction angle, in 10-degree steps. */
var BRE_C = [39, 35, 31, 25, 20, 14, 10, 7, 5, 5, 5];
function breC(obstructionDeg) {
  var x = clamp(obstructionDeg, 0, 90) / 10;
  var i = Math.min(Math.floor(x), 9);
  return lerp(BRE_C[i], BRE_C[i + 1], x - i);
}

/**
 * A BVH holding nothing but the external shading devices.
 *
 * `buildShading()` already emits every overhang, louvre blade and fin as a
 * solid, so this is the same geometry the renderer and the raytracer use — no
 * second description of the devices to drift out of step. With no device
 * enabled the soup is empty and `BVH.occluded()` returns immediately on its
 * `triCount` guard, so an unshaded model costs nothing.
 */
function shadingBvh(model) {
  var mb = new MeshBuilder();
  buildShading(mb, model);
  var tri = mb.finish();
  return new BVH(tri.pos, tri.mat);
}

/**
 * CIE Standard General Sky type 1 relative luminance, normalised to the zenith.
 * The gradation is phi(Z) = 1 + a*exp(b/cos Z) with a = 4, b = -0.7, and
 * cos Z = sin(altitude). This is the same sky the raytraced engine uses, so the
 * two engines are compared under one definition; it replaces the Moon & Spencer
 * form (1 + 2 sin a)/3, which is up to 25% brighter near the horizon and a few
 * per cent darker high up, and which biased every side-lit case high and every
 * skylight case low. See docs/ENGINE-VALIDATION.md section 3.
 */
function overcastRel(altRad) {
  var cz = Math.max(Math.sin(Math.max(0, altRad)), 1e-9);
  return (1 + 4 * Math.exp(-0.7 / cz)) / (1 + 4 * Math.exp(-0.7));
}

/**
 * Sky + externally reflected components at one point, by numerical
 * integration over every aperture. Returns percentages of the unobstructed
 * horizontal illuminance.
 */
function skyComponents(model, px, py, pz, nx, ny, nz, sub, shadeBvh) {
  var R = model.room, aps = model.apertures || [];
  var obstruction = (model.site.obstructionAngle || 0) * DEG;
  var groundRefl = R.refl.ground == null ? 0.2 : R.refl.ground;
  var shadeRefl = R.refl.shade == null ? 0.35 : R.refl.shade;
  var hasShade = shadeBvh && shadeBvh.triCount > 0;
  var scOpen = 0;                     // sky component ignoring the devices,
                                      // kept so the IRC can be scaled by them
  var N = sub || 6;
  /*
   * Unobstructed horizontal illuminance under the same relative sky, with the
   * zenith luminance taken as 1:
   *   Eh = 2*pi * INT_0^{pi/2} L(a) sin a cos a da
   * For CIE type 1 that integral has no elementary closed form; evaluated
   * numerically it is 2.449541. The Moon & Spencer sky this replaced gave
   * exactly 7*pi/9 = 2.443461, so using that constant here while the
   * distribution above is CIE type 1 would scale every component 0.25% low.
   */
  var Eh = 2.449541;
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

      if (alt <= obstruction) {
        erc += contrib * groundRefl;         // obstruction seen instead of sky
        continue;
      }
      scOpen += contrib;
      // is one of the building's own shading devices in the way?
      if (hasShade && shadeBvh.occluded(px + dx * 1e-4, py + dy * 1e-4, pz + dz * 1e-4,
                                        dx, dy, dz, 1e5, -1)) {
        // Light bounced off the device. Only about half of what a blade
        // scatters heads inward — the rest goes back to the sky — so the
        // reflectance is halved. Crediting the full reflectance, as the
        // method does for a ground obstruction, put a louvre bank 83% above
        // the raytraced answer; halving it brings that to 19%. See
        // docs/ENGINE-VALIDATION.md §3.
        erc += contrib * shadeRefl * SHADE_ERC_SHARE;
      } else {
        sc += contrib;
      }
    }
  }
  return { sc: 100 * sc / Eh, erc: 100 * erc / Eh, scOpen: 100 * scOpen / Eh };
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
  var irc = (T * Wg / (Atot * (1 - rho))) * (C * rhoFw + 5 * rhoCw);
  return Math.max(0, irc);
}

/**
 * Split-flux daylight factor over a grid.
 * @returns {object} df (Float32Array, %), plus the three components
 */
function splitFluxGrid(model, pts, nrm, sub) {
  var n = (pts.length / 3) | 0;
  var df = new Float32Array(n), scA = new Float32Array(n), ercA = new Float32Array(n);
  var shade = shadingBvh(model);
  var irc = internallyReflected(model);
  sub = sub || (shade.triCount ? SF_SUB_SHADED : SF_SUB_PLAIN);

  // First pass: sky and externally reflected components at every point, and
  // the totals needed to work out how much flux the shading removes.
  var sumOpen = 0, sumShaded = 0;
  for (var p = 0; p < n; p++) {
    var c = skyComponents(model, pts[p * 3], pts[p * 3 + 1], pts[p * 3 + 2],
                          nrm[p * 3], nrm[p * 3 + 1], nrm[p * 3 + 2], sub, shade);
    scA[p] = c.sc; ercA[p] = c.erc;
    sumOpen += c.scOpen; sumShaded += c.sc;
  }

  /*
   * The BRE internally reflected component is built from T*W and has no
   * shading term, so on its own it would not respond to an overhang at all —
   * and in a deep room, where the IRC dominates the back half, the daylight
   * factor there would look completely unmoved. Scale it by the same fraction
   * of sky flux the devices remove.
   *
   * This is an extension of BS 8206-2, not part of it; the Engine information
   * panel says so.
   */
  var shadeFactor = sumOpen > 1e-9 ? clamp(sumShaded / sumOpen, 0, 1) : 1;
  irc *= shadeFactor;

  for (p = 0; p < n; p++) df[p] = scA[p] + ercA[p] + irc;
  return { df: df, sc: scA, erc: ercA, irc: irc, shadeFactor: shadeFactor };
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
