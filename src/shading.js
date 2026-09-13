/* ==========================================================================
   Shading devices.

   Overhangs, louvre blades and vertical fins are generated as real solids on
   the outside face of their aperture and go straight into the BVH, so they
   shade the raytraced result exactly as they shade the render. Nothing here
   is a multiplier or a correction factor.

   Every device is described in metres:
     depth      projection from the wall face
     thickness  slab thickness of the device itself
     offset     horizontal devices: height above the opening head
                vertical devices:   distance out from the jamb
     extend     how far the device runs past the opening
     count      1 = a single overhang / a fin at each jamb
                N = N louvre blades / N fins spread across the opening
     tilt       degrees; positive tips the blade down-and-out (horizontal)
                or rotates the fin towards the near jamb (vertical)
   ========================================================================== */

/** Default shading block for a new aperture. */
function defaultShading() {
  return {
    h: { on: false, depth: 0.60, thickness: 0.06, offset: 0.10, extend: 0.20, count: 1, tilt: 0 },
    v: { on: false, depth: 0.50, thickness: 0.06, offset: 0.05, extend: 0.10, count: 1, tilt: 0, side: 'both' }
  };
}

/** Local frame vector (u along wall, v up the wall, d outward) -> world. */
function lvec(F, u, v, d) {
  return [F.U[0] * u + F.V[0] * v + F.N[0] * d,
          F.U[1] * u + F.V[1] * v + F.N[1] * d,
          F.U[2] * u + F.V[2] * v + F.N[2] * d];
}

/** Emit every enabled shading device for every aperture. */
function buildShading(mb, model) {
  var aps = model.apertures || [];
  for (var i = 0; i < aps.length; i++) {
    var ap = aps[i];
    if (ap.enabled === false || !ap.shading) continue;
    var F = frameFor(ap.side, model.room);
    var r = apertureRect(ap, model.room);
    if (ap.shading.h && ap.shading.h.on) horizontalDevice(mb, F, r, ap.shading.h);
    if (ap.shading.v && ap.shading.v.on) verticalDevice(mb, F, r, ap.shading.v);
  }
}

/** Overhang or horizontal louvre bank. */
function horizontalDevice(mb, F, rect, s) {
  var u0 = rect[0] - Math.max(0, s.extend), u1 = rect[1] + Math.max(0, s.extend);
  var v0 = rect[2], v1 = rect[3];
  var depth = Math.max(0.01, s.depth), th = Math.max(0.005, s.thickness);
  var count = Math.max(1, Math.round(s.count || 1));
  var tilt = (s.tilt || 0) * DEG;
  var len = u1 - u0;
  if (len <= 0) return;

  // blade axes: depth tips down-and-out with positive tilt
  var dep = lvec(F, 0, -Math.sin(tilt) * depth, Math.cos(tilt) * depth);
  var thk = lvec(F, 0, Math.cos(tilt) * th, Math.sin(tilt) * th);
  var lenV = lvec(F, len, 0, 0);

  var top = v1 + Math.max(0, s.offset);
  if (count === 1) {
    mb.box(fpt(F, u0, top, F.t), lenV, thk, dep, MAT.SHADE);
    return;
  }
  // louvre bank: blades evenly spread from the head band down to the sill
  var span = top - v0;
  var step = span / (count - 1 || 1);
  for (var i = 0; i < count; i++) {
    var v = top - i * step;
    mb.box(fpt(F, u0, v, F.t), lenV, thk, dep, MAT.SHADE);
  }
}

/** Fins at the jambs, or a bank of vertical fins across the opening. */
function verticalDevice(mb, F, rect, s) {
  var u0 = rect[0], u1 = rect[1];
  var v0 = rect[2] - Math.max(0, s.extend), v1 = rect[3] + Math.max(0, s.extend);
  var depth = Math.max(0.01, s.depth), th = Math.max(0.005, s.thickness);
  var count = Math.max(1, Math.round(s.count || 1));
  var tilt = (s.tilt || 0) * DEG;
  var off = Math.max(0, s.offset || 0);
  var height = v1 - v0;
  if (height <= 0) return;

  var dep = lvec(F, Math.sin(tilt) * depth, 0, Math.cos(tilt) * depth);
  var thk = lvec(F, Math.cos(tilt) * th, 0, -Math.sin(tilt) * th);
  var hV = lvec(F, 0, height, 0);

  var us = [];
  if (count === 1) {
    if (s.side !== 'right') us.push(u0 - off - th);
    if (s.side !== 'left') us.push(u1 + off);
  } else {
    var span = (u1 + off) - (u0 - off - th);
    for (var i = 0; i < count; i++) us.push(u0 - off - th + span * i / (count - 1));
  }
  for (var k = 0; k < us.length; k++) mb.box(fpt(F, us[k], v0, F.t), thk, hV, dep, MAT.SHADE);
}

/**
 * Shading projection factors, reported in the UI so students can relate the
 * geometry to the rules of thumb they meet in textbooks.
 *   HSA — horizontal shadow angle produced by the fins
 *   VSA — vertical shadow angle produced by the overhang
 */
function shadingAngles(ap) {
  var out = { vsa: null, hsa: null, pfH: null, pfV: null };
  if (!ap.shading) return out;
  var h = ap.shading.h, v = ap.shading.v;
  if (h && h.on && h.depth > 0) {
    var drop = ap.h + Math.max(0, h.offset);
    out.vsa = Math.atan2(drop, h.depth) * RAD;
    out.pfH = h.depth / Math.max(drop, 1e-6);
  }
  if (v && v.on && v.depth > 0) {
    out.hsa = Math.atan2(ap.w / (v.count > 1 ? v.count : 1), v.depth) * RAD;
    out.pfV = v.depth / Math.max(ap.w, 1e-6);
  }
  return out;
}
