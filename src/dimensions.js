/* ==========================================================================
   Professional dimensions.

   Every dimension is a real measured span with extension lines, a dimension
   line and architectural tick marks, labelled in metres. Clicking a label
   opens an inline field whose setter drives the parametric model, so the
   drawing is the interface: change 2.40 to 3.20 and the window resizes.
   ========================================================================== */

var DIM_GROUPS = ['room', 'thickness', 'aperture', 'shading'];

function dim(o) {
  return {
    id: o.id, group: o.group, label: o.label,
    a: o.a, b: o.b, dir: o.dir, off: o.off == null ? 0.55 : o.off,
    value: o.value, unit: o.unit || 'm', min: o.min == null ? 0.05 : o.min,
    max: o.max == null ? 60 : o.max, step: o.step == null ? 0.05 : o.step,
    editable: o.set != null, set: o.set, note: o.note
  };
}
var V = function (x, y, z) { return [x, y, z]; };

/**
 * Every dimension for the current model.
 * @param {object} model
 * @param {object} built  output of buildModel()
 * @param {object} sel    {apertureId} to dimension only the selected aperture
 */
function collectDimensions(model, built, sel) {
  var R = model.room, out = [];
  var L2 = R.L / 2, W2 = R.W / 2, H = R.H, tw = R.tWall;
  var oy = built.outer.y0, oz = built.outer.z1, ox = built.outer.x1;

  /* --- room ---------------------------------------------------------- */
  out.push(dim({
    id: 'room.L', group: 'room', label: 'Length',
    a: V(-L2, oy, oz), b: V(L2, oy, oz), dir: V(0, 0, 1), off: 1.1,
    value: R.L, min: 1, max: 60, set: function (v) { R.L = v; }
  }));
  out.push(dim({
    id: 'room.W', group: 'room', label: 'Width',
    a: V(ox, oy, -W2), b: V(ox, oy, W2), dir: V(1, 0, 0), off: 1.1,
    value: R.W, min: 1, max: 60, set: function (v) { R.W = v; }
  }));
  out.push(dim({
    id: 'room.H', group: 'room', label: 'Height',
    a: V(ox, 0, oz), b: V(ox, H, oz), dir: V(0.7, 0, 0.7), off: 0.75,
    value: R.H, min: 1.8, max: 15, set: function (v) { R.H = v; }
  }));

  /* --- element thicknesses ------------------------------------------- */
  out.push(dim({
    id: 'room.tWall', group: 'thickness', label: 'Wall',
    a: V(-L2 + 0.4, H * 0.62, W2), b: V(-L2 + 0.4, H * 0.62, W2 + tw),
    dir: V(0, 1, 0), off: 0.34, value: tw, min: 0.05, max: 1.5, step: 0.01,
    set: function (v) { R.tWall = v; }
  }));
  out.push(dim({
    id: 'room.tRoof', group: 'thickness', label: 'Roof',
    a: V(ox, H, -W2 + 0.5), b: V(ox, H + R.tRoof, -W2 + 0.5),
    dir: V(1, 0, 0), off: 0.34, value: R.tRoof, min: 0.05, max: 2, step: 0.01,
    set: function (v) { R.tRoof = v; }
  }));
  out.push(dim({
    id: 'room.tFloor', group: 'thickness', label: 'Floor',
    a: V(ox, -R.tFloor, W2 - 0.5), b: V(ox, 0, W2 - 0.5),
    dir: V(1, 0, 0), off: 0.34, value: R.tFloor, min: 0.05, max: 2, step: 0.01,
    set: function (v) { R.tFloor = v; }
  }));

  /* --- apertures ------------------------------------------------------ */
  var aps = model.apertures || [];
  for (var i = 0; i < aps.length; i++) {
    var ap = aps[i];
    if (ap.enabled === false) continue;
    if (sel && sel.apertureId && sel.apertureId !== ap.id) continue;
    var F = frameFor(ap.side, R), rc = apertureRect(ap, R);
    var d = F.t + 0.02;
    var kind = ap.kind === 'skylight' ? 'Skylight' : ap.kind === 'door' ? 'Door' : 'Window';

    (function (ap, F, rc, kind) {
      // width, along the face
      out.push(dim({
        id: ap.id + '.w', group: 'aperture', label: kind + ' W',
        a: fpt(F, rc[0], rc[2], d), b: fpt(F, rc[1], rc[2], d),
        dir: [-F.V[0], -F.V[1], -F.V[2]], off: 0.34,
        value: ap.w, min: 0.1, max: 30, set: function (v) { ap.w = v; }
      }));
      // height (roof apertures measure depth along Z instead)
      out.push(dim({
        id: ap.id + '.h', group: 'aperture',
        label: kind + (ap.side === 'roof' ? ' D' : ' H'),
        a: fpt(F, rc[1], rc[2], d), b: fpt(F, rc[1], rc[3], d),
        dir: F.U, off: 0.34,
        value: ap.h, min: 0.1, max: 30, set: function (v) { ap.h = v; }
      }));
      if (ap.side !== 'roof') {
        out.push(dim({
          id: ap.id + '.sill', group: 'aperture', label: 'Sill',
          a: fpt(F, rc[0], 0, d), b: fpt(F, rc[0], rc[2], d),
          dir: [-F.U[0], -F.U[1], -F.U[2]], off: 0.34,
          value: ap.sill, min: 0, max: 12, set: function (v) { ap.sill = v; }
        }));
      }

      /* --- shading devices ------------------------------------------- */
      var s = ap.shading;
      if (s && s.h && s.h.on) {
        var top = rc[3] + Math.max(0, s.h.offset);
        out.push(dim({
          id: ap.id + '.hd', group: 'shading', label: 'Overhang D',
          a: fpt(F, rc[1], top, F.t), b: fpt(F, rc[1], top, F.t + s.h.depth),
          dir: F.V, off: 0.26,
          value: s.h.depth, min: 0.02, max: 6, step: 0.01,
          set: function (v) { s.h.depth = v; }
        }));
        out.push(dim({
          id: ap.id + '.hh', group: 'shading', label: 'Above head',
          a: fpt(F, rc[0], rc[3], F.t), b: fpt(F, rc[0], top, F.t),
          dir: [-F.U[0], -F.U[1], -F.U[2]], off: 0.22,
          value: s.h.offset, min: 0, max: 4, step: 0.01,
          set: function (v) { s.h.offset = v; }
        }));
        out.push(dim({
          id: ap.id + '.ht', group: 'shading', label: 'Overhang t',
          a: fpt(F, rc[1], top, F.t + s.h.depth),
          b: fpt(F, rc[1], top + s.h.thickness, F.t + s.h.depth),
          dir: F.U, off: 0.2,
          value: s.h.thickness, min: 0.005, max: 0.8, step: 0.005,
          set: function (v) { s.h.thickness = v; }
        }));
      }
      if (s && s.v && s.v.on) {
        var fu = rc[1] + Math.max(0, s.v.offset);
        out.push(dim({
          id: ap.id + '.vd', group: 'shading', label: 'Fin D',
          a: fpt(F, fu, rc[3], F.t), b: fpt(F, fu, rc[3], F.t + s.v.depth),
          dir: F.V, off: 0.26,
          value: s.v.depth, min: 0.02, max: 6, step: 0.01,
          set: function (v) { s.v.depth = v; }
        }));
        out.push(dim({
          id: ap.id + '.vt', group: 'shading', label: 'Fin t',
          a: fpt(F, fu, rc[2], F.t + s.v.depth),
          b: fpt(F, fu + s.v.thickness, rc[2], F.t + s.v.depth),
          dir: [-F.V[0], -F.V[1], -F.V[2]], off: 0.2,
          value: s.v.thickness, min: 0.005, max: 0.8, step: 0.005,
          set: function (v) { s.v.thickness = v; }
        }));
      }
    })(ap, F, rc, kind);
  }
  return out;
}

/** Where a dimension's line and label actually sit in world space. */
function dimGeometry(d) {
  var a = d.a, b = d.b, dir = d.dir, o = Math.max(1e-3, d.off);
  var n = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  var ux = dir[0] / n * o, uy = dir[1] / n * o, uz = dir[2] / n * o;
  var A = [a[0] + ux, a[1] + uy, a[2] + uz];
  var B = [b[0] + ux, b[1] + uy, b[2] + uz];
  // tick direction: bisector of the span and the offset
  var sx = B[0] - A[0], sy = B[1] - A[1], sz = B[2] - A[2];
  var sl = Math.hypot(sx, sy, sz) || 1;
  sx /= sl; sy /= sl; sz /= sl;
  var tk = 0.09;
  var tick = [(sx + ux / o) * tk, (sy + uy / o) * tk, (sz + uz / o) * tk];
  return { A: A, B: B, tick: tick, mid: [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2], length: sl };
}

/** Draw all visible dimension lines into `group`. */
function buildDimensionLines(group, view, dims, groupsOn) {
  disposeGroup(group);
  var verts = [];
  for (var i = 0; i < dims.length; i++) {
    var d = dims[i];
    if (groupsOn && !groupsOn[d.group]) continue;
    var g = dimGeometry(d);
    // extension lines, slightly past the dimension line
    var ex = 1.12;
    verts.push(d.a[0], d.a[1], d.a[2],
               d.a[0] + (g.A[0] - d.a[0]) * ex, d.a[1] + (g.A[1] - d.a[1]) * ex, d.a[2] + (g.A[2] - d.a[2]) * ex);
    verts.push(d.b[0], d.b[1], d.b[2],
               d.b[0] + (g.B[0] - d.b[0]) * ex, d.b[1] + (g.B[1] - d.b[1]) * ex, d.b[2] + (g.B[2] - d.b[2]) * ex);
    // dimension line
    verts.push(g.A[0], g.A[1], g.A[2], g.B[0], g.B[1], g.B[2]);
    // architectural ticks
    for (var k = 0; k < 2; k++) {
      var p = k ? g.B : g.A;
      verts.push(p[0] - g.tick[0], p[1] - g.tick[1], p[2] - g.tick[2],
                 p[0] + g.tick[0], p[1] + g.tick[1], p[2] + g.tick[2]);
    }
  }
  if (!verts.length) { view.dirty = true; return; }
  var geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(verts), 3));
  group.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
    color: new THREE.Color(cssVar('--dim-line')), transparent: true, opacity: 0.9, depthTest: true
  })));
  view.dirty = true;
}
