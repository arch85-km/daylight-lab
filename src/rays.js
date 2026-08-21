/* ==========================================================================
   Solar ray access.

   Samples points across each glazed opening, checks whether the sun actually
   reaches that part of the glass (so overhangs, fins and reveals cut the
   bundle exactly as they should), then traces the beam into the room to where
   it lands.

   `sunSizeDeg` jitters each ray inside the sun's apparent disc — set it to
   the true 0.53 deg for a sharp shadow, or open it up to make the penumbra
   visible from the back of a lecture theatre.
   ========================================================================== */

/**
 * @param {THREE.Group} group   cleared and refilled
 * @param {View} view
 * @param {object} model
 * @param {BVH} bvh             main-thread BVH over the same geometry
 * @param {Array} materials
 * @param {object} sun
 * @param {object} o  {density, sunSizeDeg, length, opacity, showSpots, maxRays}
 */
function buildSunRays(group, view, model, bvh, materials, sun, o) {
  disposeGroup(group);
  o = o || {};
  if (!sun || sun.altitude <= 0 || !bvh) { view.dirty = true; return { count: 0, lit: 0 }; }

  var t = view.theme;
  var density = clamp(o.density == null ? 30 : o.density, 1, 400);   // rays per m2
  var maxRays = o.maxRays || 4000;
  var extLen = o.length == null ? 3.5 : o.length;
  var radius = sunAngularRadius(o.sunSizeDeg == null ? 0.53 : o.sunSizeDeg);

  var sd = sun.dir;
  var basis = new Float64Array(6);
  onb(sd.x, sd.y, sd.z, basis);
  var core = { bvh: bvh, mats: materials };
  var hit = {};

  var verts = [], cols = [], spots = [];
  var colIn = new THREE.Color(t.ray), colOut = new THREE.Color(t.sun);
  var aps = model.apertures || [], total = 0, lit = 0;
  var rng = new Rng(0xBEA401);

  // total glazed area decides how the ray budget is shared out
  var areas = [], areaSum = 0;
  for (var a = 0; a < aps.length; a++) {
    var ap = aps[a];
    var ok = ap.enabled !== false && (ap.kind !== 'door' || ap.open);
    var fw = ap.frameWidth == null ? 0.05 : ap.frameWidth;
    var ar = ok ? Math.max(0, ap.w - 2 * fw) * Math.max(0, ap.h - 2 * fw) : 0;
    areas.push(ar); areaSum += ar;
  }
  if (areaSum <= 0) { view.dirty = true; return { count: 0, lit: 0 }; }
  var budget = Math.min(maxRays, Math.ceil(density * areaSum));

  for (a = 0; a < aps.length; a++) {
    if (areas[a] <= 0) continue;
    var apr = aps[a];
    var F = frameFor(apr.side, model.room), rc = apertureRect(apr, model.room);
    var fw2 = apr.frameWidth == null ? 0.05 : apr.frameWidth;
    var u0 = rc[0] + fw2, u1 = rc[1] - fw2, v0 = rc[2] + fw2, v1 = rc[3] - fw2;
    if (u1 <= u0 || v1 <= v0) continue;

    // face the sun? a ray can only enter through a glazing facing it
    if (F.N[0] * sd.x + F.N[1] * sd.y + F.N[2] * sd.z <= 0.02) continue;

    var share = Math.max(4, Math.round(budget * areas[a] / areaSum));
    var nu = Math.max(2, Math.round(Math.sqrt(share * (u1 - u0) / (v1 - v0))));
    var nv = Math.max(2, Math.round(share / nu));
    var gd = clamp(apr.glassPos == null ? 0.5 : apr.glassPos, 0, 1) * Math.max(0, F.t - 0.02) + 0.01;

    for (var i = 0; i < nu; i++) for (var j = 0; j < nv; j++) {
      var uu = u0 + (i + 0.5) * (u1 - u0) / nu;
      var vv = v0 + (j + 0.5) * (v1 - v0) / nv;
      var p = fpt(F, uu, vv, gd);
      total++;

      // jitter inside the sun disc so a big sun gives a visibly soft bundle
      var dx = sd.x, dy = sd.y, dz = sd.z;
      if (radius > 1e-5) {
        var rr = radius * Math.sqrt(rng.next()), aa = 2 * Math.PI * rng.next();
        var ox = rr * Math.cos(aa), oy = rr * Math.sin(aa);
        dx += basis[0] * ox + basis[3] * oy;
        dy += basis[1] * ox + basis[4] * oy;
        dz += basis[2] * ox + basis[5] * oy;
        var L = Math.hypot(dx, dy, dz) || 1; dx /= L; dy /= L; dz /= L;
      }

      // is the sun actually reaching this part of the glass?
      var clear = traceOut(bvh, materials, p[0], p[1], p[2], dx, dy, dz, hit);
      if (!clear) continue;
      lit++;

      // and where does the beam land inside?
      var end;
      if (bvh.intersect(p[0] - dx * 1e-4, p[1] - dy * 1e-4, p[2] - dz * 1e-4, -dx, -dy, -dz, 60, hit, -1)) {
        end = [p[0] - dx * hit.t, p[1] - dy * hit.t, p[2] - dz * hit.t];
        if (o.showSpots !== false) spots.push(end[0], end[1], end[2]);
      } else {
        end = [p[0] - dx * 12, p[1] - dy * 12, p[2] - dz * 12];
      }

      // outside segment: fades IN towards the glass so it reads as arriving
      if (extLen > 0.01) {
        var start = [p[0] + dx * extLen, p[1] + dy * extLen, p[2] + dz * extLen];
        verts.push(start[0], start[1], start[2], p[0], p[1], p[2]);
        cols.push(colOut.r * 0.06, colOut.g * 0.06, colOut.b * 0.06, colOut.r, colOut.g, colOut.b);
      }
      // inside segment: brightest at the glass, fading towards where it lands
      verts.push(p[0], p[1], p[2], end[0], end[1], end[2]);
      cols.push(colIn.r, colIn.g, colIn.b, colIn.r * 0.3, colIn.g * 0.3, colIn.b * 0.3);
    }
  }

  if (verts.length) {
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(verts), 3));
    g.setAttribute('color', new THREE.BufferAttribute(Float32Array.from(cols), 3));
    var seg = new THREE.LineSegments(g, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true,
      opacity: o.opacity == null ? 0.6 : o.opacity,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false
    }));
    seg.renderOrder = 4;
    group.add(seg);
  }
  if (spots.length && o.showSpots !== false) {
    var sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(spots), 3));
    group.add(new THREE.Points(sg, new THREE.PointsMaterial({
      color: new THREE.Color(t.sun), size: 0.055, sizeAttenuation: true,
      transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false
    })));
  }
  view.dirty = true;
  return { count: total, lit: lit, drawn: verts.length / 6 };
}

/** True when nothing opaque stands between a point and the sun. */
function traceOut(bvh, mats, ox, oy, oz, dx, dy, dz, hit) {
  var x = ox + dx * 1e-3, y = oy + dy * 1e-3, z = oz + dz * 1e-3;
  for (var g = 0; g < 12; g++) {
    if (!bvh.intersect(x, y, z, dx, dy, dz, 1e5, hit, -1)) return true;
    var m = mats[hit.mat];
    if (!m || !(m.tau > 0)) return false;
    x += dx * (hit.t + 1e-3); y += dy * (hit.t + 1e-3); z += dz * (hit.t + 1e-3);
  }
  return false;
}
