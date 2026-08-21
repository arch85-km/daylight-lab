/* ==========================================================================
   Parametric room geometry.

   Everything is a solid with real thickness: walls, roof and floor are slabs,
   and every opening is cut through the slab with jamb / head / sill reveals.
   That matters physically, not just visually — the reveals and the skylight
   well are in the BVH, so changing wall thickness changes the numbers.

   Interior volume:  x in [-L/2, L/2], y in [0, H], z in [-W/2, W/2]
                     +Z = South, +X = East, Y up
   ========================================================================== */

/** Material slots. Ids above GLASS_BASE are per-aperture glazing. */
var MAT = {
  FLOOR: 0, WALL_IN: 1, CEIL: 2,
  WALL_OUT: 3, ROOF_OUT: 4, FLOOR_OUT: 5,
  REVEAL: 6, FRAME: 7, SHADE: 8, DOOR: 9, GROUND: 10, WORKPLANE: 11
};
var GLASS_BASE = 20;

/* --- triangle soup builder ---------------------------------------------- */
function MeshBuilder() {
  this.p = []; this.n = []; this.m = [];
  this.e = [];          // architectural line work: pairs of points
}
/** Record one drawn edge. */
MeshBuilder.prototype.edge = function (a, b) {
  this.e.push(a[0], a[1], a[2], b[0], b[1], b[2]);
};
/** Record the four edges of a rectangle on a face, at depth d. */
MeshBuilder.prototype.rect = function (F, u0, u1, v0, v1, d) {
  var c = [fpt(F, u0, v0, d), fpt(F, u1, v0, d), fpt(F, u1, v1, d), fpt(F, u0, v1, d)];
  for (var i = 0; i < 4; i++) this.edge(c[i], c[(i + 1) % 4]);
};
MeshBuilder.prototype.tri = function (a, b, c, mat) {
  var ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  var vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  var L = Math.hypot(nx, ny, nz);
  if (L < 1e-12) return;                                   // degenerate
  this.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  this.n.push(nx / L, ny / L, nz / L);
  this.m.push(mat);
};
/** Quad a-b-c-d, wound so its normal follows `want` (a 3-vector). */
MeshBuilder.prototype.quad = function (a, b, c, d, mat, want) {
  var ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  var vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
  var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  if (want && (nx * want[0] + ny * want[1] + nz * want[2]) < 0) {
    var t = b; b = d; d = t;
  }
  this.tri(a, b, c, mat);
  this.tri(a, c, d, mat);
};
/** Axis-oriented box from an origin and three edge vectors. */
MeshBuilder.prototype.box = function (o, U, V, W, mat, silent) {
  var P = function (i, j, k) {
    return [o[0] + U[0] * i + V[0] * j + W[0] * k,
            o[1] + U[1] * i + V[1] * j + W[1] * k,
            o[2] + U[2] * i + V[2] * j + W[2] * k];
  };
  var c000 = P(0, 0, 0), c100 = P(1, 0, 0), c110 = P(1, 1, 0), c010 = P(0, 1, 0);
  var c001 = P(0, 0, 1), c101 = P(1, 0, 1), c111 = P(1, 1, 1), c011 = P(0, 1, 1);
  var neg = function (v) { return [-v[0], -v[1], -v[2]]; };
  this.quad(c000, c100, c110, c010, mat, neg(W));
  this.quad(c001, c101, c111, c011, mat, W);
  this.quad(c000, c001, c011, c010, mat, neg(U));
  this.quad(c100, c101, c111, c110, mat, U);
  this.quad(c000, c100, c101, c001, mat, neg(V));
  this.quad(c010, c110, c111, c011, mat, V);
  if (silent) return;
  var E = [[c000, c100], [c100, c110], [c110, c010], [c010, c000],
           [c001, c101], [c101, c111], [c111, c011], [c011, c001],
           [c000, c001], [c100, c101], [c110, c111], [c010, c011]];
  for (var i = 0; i < E.length; i++) this.edge(E[i][0], E[i][1]);
};
MeshBuilder.prototype.finish = function () {
  return {
    pos: Float32Array.from(this.p),
    nrm: Float32Array.from(this.n),
    mat: Int32Array.from(this.m),
    edges: Float32Array.from(this.e),
    count: this.m.length
  };
};

/* --- rectangle-with-rectangular-holes partition -------------------------
   Exact for axis-aligned holes: sweep the unique u breakpoints, then split
   each strip vertically around the holes that span it. No CSG needed.      */
function partitionRect(u0, u1, v0, v1, holes) {
  var out = [];
  if (u1 - u0 < 1e-9 || v1 - v0 < 1e-9) return out;
  if (!holes || !holes.length) return [[u0, u1, v0, v1]];

  var cuts = [u0, u1];
  for (var i = 0; i < holes.length; i++) {
    var h = holes[i];
    if (h[0] > u0 + 1e-9 && h[0] < u1 - 1e-9) cuts.push(h[0]);
    if (h[1] > u0 + 1e-9 && h[1] < u1 - 1e-9) cuts.push(h[1]);
  }
  cuts.sort(function (a, b) { return a - b; });

  for (i = 0; i < cuts.length - 1; i++) {
    var ua = cuts[i], ub = cuts[i + 1];
    if (ub - ua < 1e-9) continue;
    var mid = (ua + ub) / 2;
    var spans = [];
    for (var j = 0; j < holes.length; j++) {
      var g = holes[j];
      if (mid > g[0] && mid < g[1]) spans.push([Math.max(g[2], v0), Math.min(g[3], v1)]);
    }
    spans.sort(function (a, b) { return a[0] - b[0]; });
    var v = v0;
    for (j = 0; j < spans.length; j++) {
      if (spans[j][0] > v + 1e-9) out.push([ua, ub, v, spans[j][0]]);
      v = Math.max(v, spans[j][1]);
    }
    if (v1 > v + 1e-9) out.push([ua, ub, v, v1]);
  }
  return out;
}

/* --- face frames --------------------------------------------------------
   A frame maps local (u, v) to 3D and carries the outward direction the
   slab is extruded along.                                                  */
function frameFor(side, R) {
  var L2 = R.L / 2, W2 = R.W / 2, tw = R.tWall;
  var Lo2 = L2 + tw, Wo2 = W2 + tw;
  switch (side) {
    case 'S': return { o: [0, 0, W2], U: [1, 0, 0], V: [0, 1, 0], N: [0, 0, 1],
                       t: tw, uMin: -Lo2, uMax: Lo2, vMin: 0, vMax: R.H,
                       inMin: -L2, inMax: L2, label: 'South' };
    case 'N': return { o: [0, 0, -W2], U: [1, 0, 0], V: [0, 1, 0], N: [0, 0, -1],
                       t: tw, uMin: -Lo2, uMax: Lo2, vMin: 0, vMax: R.H,
                       inMin: -L2, inMax: L2, label: 'North' };
    case 'E': return { o: [L2, 0, 0], U: [0, 0, 1], V: [0, 1, 0], N: [1, 0, 0],
                       t: tw, uMin: -W2, uMax: W2, vMin: 0, vMax: R.H,
                       inMin: -W2, inMax: W2, label: 'East' };
    case 'W': return { o: [-L2, 0, 0], U: [0, 0, 1], V: [0, 1, 0], N: [-1, 0, 0],
                       t: tw, uMin: -W2, uMax: W2, vMin: 0, vMax: R.H,
                       inMin: -W2, inMax: W2, label: 'West' };
    case 'roof': return { o: [0, R.H, 0], U: [1, 0, 0], V: [0, 0, 1], N: [0, 1, 0],
                       t: R.tRoof, uMin: -Lo2, uMax: Lo2, vMin: -Wo2, vMax: Wo2,
                       inMin: -L2, inMax: L2, vInMin: -W2, vInMax: W2, label: 'Roof' };
    default: return { o: [0, 0, 0], U: [1, 0, 0], V: [0, 0, 1], N: [0, -1, 0],
                       t: R.tFloor, uMin: -Lo2, uMax: Lo2, vMin: -Wo2, vMax: Wo2,
                       inMin: -L2, inMax: L2, label: 'Floor' };
  }
}
/** Local (u, v, depth-along-N) -> world point. */
function fpt(F, u, v, d) {
  return [F.o[0] + F.U[0] * u + F.V[0] * v + F.N[0] * d,
          F.o[1] + F.U[1] * u + F.V[1] * v + F.N[1] * d,
          F.o[2] + F.U[2] * u + F.V[2] * v + F.N[2] * d];
}
var negv = function (v) { return [-v[0], -v[1], -v[2]]; };

/** Local (u, v) rectangle of an aperture on its face. */
function apertureRect(ap, R) {
  if (ap.side === 'roof') {
    return [ap.offset - ap.w / 2, ap.offset + ap.w / 2,
            ap.offset2 - ap.h / 2, ap.offset2 + ap.h / 2];
  }
  return [ap.offset - ap.w / 2, ap.offset + ap.w / 2, ap.sill, ap.sill + ap.h];
}

/**
 * Build one slab (a wall, the roof or the floor) with its openings.
 * `mIn` / `mOut` are the interior- and exterior-facing material ids.
 */
function buildSlab(mb, F, apertures, R, mIn, mOut, includeGlass) {
  var holes = [], i;
  for (i = 0; i < apertures.length; i++) {
    var r = apertureRect(apertures[i], R);
    holes.push([r[0], r[1], r[2], r[3]]);
  }

  // interior face (at depth 0) and exterior face (at depth t)
  var panels = partitionRect(F.uMin, F.uMax, F.vMin, F.vMax, holes);
  var inward = negv(F.N);
  for (i = 0; i < panels.length; i++) {
    var q = panels[i];
    mb.quad(fpt(F, q[0], q[2], 0), fpt(F, q[1], q[2], 0), fpt(F, q[1], q[3], 0), fpt(F, q[0], q[3], 0), mIn, inward);
    mb.quad(fpt(F, q[0], q[2], F.t), fpt(F, q[1], q[2], F.t), fpt(F, q[1], q[3], F.t), fpt(F, q[0], q[3], F.t), mOut, F.N);
  }

  // line work: the slab outline and every opening, on both faces
  mb.rect(F, F.uMin, F.uMax, F.vMin, F.vMax, 0);
  mb.rect(F, F.uMin, F.uMax, F.vMin, F.vMax, F.t);
  for (i = 0; i < holes.length; i++) {
    mb.rect(F, holes[i][0], holes[i][1], holes[i][2], holes[i][3], 0);
    mb.rect(F, holes[i][0], holes[i][1], holes[i][2], holes[i][3], F.t);
  }

  // slab boundary faces (keeps the solid watertight)
  var edges = [
    [[F.uMin, F.vMin], [F.uMin, F.vMax]], [[F.uMax, F.vMin], [F.uMax, F.vMax]],
    [[F.uMin, F.vMin], [F.uMax, F.vMin]], [[F.uMin, F.vMax], [F.uMax, F.vMax]]
  ];
  for (i = 0; i < edges.length; i++) {
    var e = edges[i], a = e[0], b = e[1];
    mb.quad(fpt(F, a[0], a[1], 0), fpt(F, b[0], b[1], 0), fpt(F, b[0], b[1], F.t), fpt(F, a[0], a[1], F.t), mOut, null);
  }

  // reveals through the thickness, plus glazing / door leaves
  for (i = 0; i < apertures.length; i++) {
    var ap = apertures[i], rc = apertureRect(ap, R);
    var u0 = rc[0], u1 = rc[1], v0 = rc[2], v1 = rc[3];

    // four reveal faces, normals pointing into the opening
    mb.quad(fpt(F, u0, v0, 0), fpt(F, u0, v1, 0), fpt(F, u0, v1, F.t), fpt(F, u0, v0, F.t), MAT.REVEAL, F.U);
    mb.quad(fpt(F, u1, v0, 0), fpt(F, u1, v1, 0), fpt(F, u1, v1, F.t), fpt(F, u1, v0, F.t), MAT.REVEAL, negv(F.U));
    mb.quad(fpt(F, u0, v0, 0), fpt(F, u1, v0, 0), fpt(F, u1, v0, F.t), fpt(F, u0, v0, F.t), MAT.REVEAL, F.V);
    mb.quad(fpt(F, u0, v1, 0), fpt(F, u1, v1, 0), fpt(F, u1, v1, F.t), fpt(F, u0, v1, F.t), MAT.REVEAL, negv(F.V));

    if (ap.kind === 'door' && !ap.open) {
      var dd = clamp(ap.glassPos == null ? 0.5 : ap.glassPos, 0, 1) * Math.max(0, F.t - 0.05) + 0.02;
      mb.quad(fpt(F, u0, v0, dd), fpt(F, u1, v0, dd), fpt(F, u1, v1, dd), fpt(F, u0, v1, dd), MAT.DOOR, inward);
      mb.quad(fpt(F, u0, v0, dd + 0.04), fpt(F, u1, v0, dd + 0.04), fpt(F, u1, v1, dd + 0.04), fpt(F, u0, v1, dd + 0.04), MAT.DOOR, F.N);
    } else if (includeGlass && ap.kind !== 'door') {
      var gd = clamp(ap.glassPos == null ? 0.5 : ap.glassPos, 0, 1) * Math.max(0, F.t - 0.02) + 0.01;
      // frame border, then the pane inside it
      var fw = Math.min(ap.frameWidth == null ? 0.05 : ap.frameWidth, Math.min(u1 - u0, v1 - v0) / 2 - 0.02);
      if (fw > 0.005) {
        var fr = [[u0, u1, v0, v0 + fw], [u0, u1, v1 - fw, v1],
                  [u0, u0 + fw, v0 + fw, v1 - fw], [u1 - fw, u1, v0 + fw, v1 - fw]];
        for (var k = 0; k < fr.length; k++) {
          var f = fr[k];
          mb.quad(fpt(F, f[0], f[2], gd), fpt(F, f[1], f[2], gd), fpt(F, f[1], f[3], gd), fpt(F, f[0], f[3], gd), MAT.FRAME, inward);
        }
      } else { fw = 0; }
      mb.quad(fpt(F, u0 + fw, v0 + fw, gd), fpt(F, u1 - fw, v0 + fw, gd),
              fpt(F, u1 - fw, v1 - fw, gd), fpt(F, u0 + fw, v1 - fw, gd),
              GLASS_BASE + ap.matSlot, inward);
    }
  }
}

/**
 * Build the whole model.
 * @param {object} model  {room, apertures, options}
 * @param {object} opts   {roofRemoved, wallsRemoved, includeShading, includeGlass}
 * @returns triangle soup + material table + a per-material group list
 */
function buildModel(model, opts) {
  opts = opts || {};
  var R = model.room, mb = new MeshBuilder();
  var aps = model.apertures || [];

  // stable per-aperture glass material slots
  for (var i = 0; i < aps.length; i++) aps[i].matSlot = i;

  var bySide = { N: [], S: [], E: [], W: [], roof: [] };
  for (i = 0; i < aps.length; i++) {
    if (aps[i].enabled === false) continue;
    if (bySide[aps[i].side]) bySide[aps[i].side].push(aps[i]);
  }

  if (!opts.wallsRemoved) {
    ['N', 'S', 'E', 'W'].forEach(function (s) {
      buildSlab(mb, frameFor(s, R), bySide[s], R, MAT.WALL_IN, MAT.WALL_OUT, opts.includeGlass !== false);
    });
  }
  if (!opts.roofRemoved) {
    buildSlab(mb, frameFor('roof', R), bySide.roof, R, MAT.CEIL, MAT.ROOF_OUT, opts.includeGlass !== false);
  }
  buildSlab(mb, frameFor('floor', R), [], R, MAT.FLOOR, MAT.FLOOR_OUT, false);

  if (opts.includeShading !== false) buildShading(mb, model);

  var tri = mb.finish();
  return {
    tri: tri,
    materials: buildMaterialTable(model),
    groups: groupByMaterial(tri),
    interior: { x0: -R.L / 2, x1: R.L / 2, y0: 0, y1: R.H, z0: -R.W / 2, z1: R.W / 2 },
    outer: {
      x0: -R.L / 2 - R.tWall, x1: R.L / 2 + R.tWall,
      y0: -R.tFloor, y1: R.H + R.tRoof,
      z0: -R.W / 2 - R.tWall, z1: R.W / 2 + R.tWall
    }
  };
}

/** Contiguous triangle ranges sharing a material, for renderer batching. */
function groupByMaterial(tri) {
  var byMat = {};
  for (var i = 0; i < tri.count; i++) {
    var m = tri.mat[i];
    (byMat[m] || (byMat[m] = [])).push(i);
  }
  var out = [];
  for (var k in byMat) out.push({ mat: +k, tris: byMat[k] });
  out.sort(function (a, b) { return a.mat - b.mat; });
  return out;
}

/** Reflectance / transmittance for every material id in the model. */
function buildMaterialTable(model) {
  var r = model.room.refl, t = [];
  t[MAT.FLOOR] = { rho: r.floor, tau: 0, name: 'Floor' };
  t[MAT.WALL_IN] = { rho: r.wall, tau: 0, name: 'Wall (inside)' };
  t[MAT.CEIL] = { rho: r.ceiling, tau: 0, name: 'Ceiling' };
  t[MAT.WALL_OUT] = { rho: r.ext, tau: 0, name: 'Wall (outside)' };
  t[MAT.ROOF_OUT] = { rho: r.ext, tau: 0, name: 'Roof (outside)' };
  t[MAT.FLOOR_OUT] = { rho: r.ground, tau: 0, name: 'Slab (outside)' };
  t[MAT.REVEAL] = { rho: r.reveal == null ? r.wall : r.reveal, tau: 0, name: 'Reveal' };
  t[MAT.FRAME] = { rho: r.frame == null ? 0.5 : r.frame, tau: 0, name: 'Frame' };
  t[MAT.SHADE] = { rho: r.shade == null ? 0.35 : r.shade, tau: 0, name: 'Shading device' };
  t[MAT.DOOR] = { rho: r.door == null ? 0.3 : r.door, tau: 0, name: 'Door' };
  t[MAT.GROUND] = { rho: r.ground, tau: 0, name: 'Ground' };
  t[MAT.WORKPLANE] = { rho: 0, tau: 1, name: 'Workplane' };

  var aps = model.apertures || [];
  for (var i = 0; i < aps.length; i++) {
    var a = aps[i];
    var tau = (a.tau == null ? 0.7 : a.tau) *
              (a.maintenance == null ? 0.92 : a.maintenance) *
              (a.frameFactor == null ? 1 : a.frameFactor);
    t[GLASS_BASE + i] = {
      rho: 0.08, tau: (a.kind === 'door' && !a.open) ? 0 : clamp(tau, 0, 1),
      name: (a.name || 'Glazing') + ' τe'
    };
  }
  for (i = 0; i < t.length; i++) if (!t[i]) t[i] = { rho: 0.5, tau: 0, name: '—' };
  return t;
}

/** Total glazed area (net of frames) by side — used by the split-flux engine. */
function glazedAreas(model) {
  var out = { N: 0, S: 0, E: 0, W: 0, roof: 0, total: 0 };
  var aps = model.apertures || [];
  for (var i = 0; i < aps.length; i++) {
    var a = aps[i];
    if (a.enabled === false || a.kind === 'door') continue;
    var fw = a.frameWidth == null ? 0.05 : a.frameWidth;
    var w = Math.max(0, a.w - 2 * fw), h = Math.max(0, a.h - 2 * fw);
    out[a.side] += w * h;
    out.total += w * h;
  }
  return out;
}

/** Interior surface areas, for the BRE internally-reflected component. */
function surfaceAreas(model) {
  var R = model.room;
  var floor = R.L * R.W, ceil = R.L * R.W;
  var wall = 2 * (R.L + R.W) * R.H;
  var g = glazedAreas(model);
  return {
    floor: floor, ceiling: ceil, wall: Math.max(0, wall - (g.N + g.S + g.E + g.W)),
    glazing: g.total, total: floor + ceil + wall, volume: floor * R.H
  };
}
