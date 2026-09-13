/* ==========================================================================
   Triangle BVH.

   Written against plain typed arrays with no three.js dependency so the same
   code runs in the analysis Web Worker and on the main thread. Build is a
   binned surface-area-heuristic split; traversal is an iterative stack with
   Moller-Trumbore triangle intersection.
   ========================================================================== */

var BVH_LEAF_MAX = 4;
var BVH_BINS = 12;

/**
 * @param {Float32Array} pos  9 floats per triangle (v0,v1,v2)
 * @param {Int32Array}   mat  one material id per triangle
 */
function BVH(pos, mat) {
  this.pos = pos;
  this.mat = mat;
  this.triCount = (pos.length / 9) | 0;
  this.order = new Int32Array(this.triCount);

  var cx = new Float32Array(this.triCount);
  var cy = new Float32Array(this.triCount);
  var cz = new Float32Array(this.triCount);
  for (var i = 0; i < this.triCount; i++) {
    this.order[i] = i;
    var o = i * 9;
    cx[i] = (pos[o] + pos[o + 3] + pos[o + 6]) / 3;
    cy[i] = (pos[o + 1] + pos[o + 4] + pos[o + 7]) / 3;
    cz[i] = (pos[o + 2] + pos[o + 5] + pos[o + 8]) / 3;
  }
  this.cx = cx; this.cy = cy; this.cz = cz;

  var cap = Math.max(4, this.triCount * 2 + 4);
  this.bounds = new Float32Array(cap * 6);
  this.a = new Int32Array(cap);        // leaf: first tri  | node: left child
  this.b = new Int32Array(cap);        // leaf: tri count  | node: right child
  this.leaf = new Uint8Array(cap);
  this.nodeCount = 0;

  if (this.triCount) this.build(0, this.triCount);
  else { this.nodeCount = 1; this.leaf[0] = 1; this.a[0] = 0; this.b[0] = 0;
         for (var q = 0; q < 3; q++) { this.bounds[q] = 1e30; this.bounds[q + 3] = -1e30; } }
}

/** Bounds of order[start..end) written into node `n`. */
BVH.prototype.fitBounds = function (n, start, end) {
  var p = this.pos, o = this.order, B = this.bounds, k = n * 6;
  var x0 = 1e30, y0 = 1e30, z0 = 1e30, x1 = -1e30, y1 = -1e30, z1 = -1e30;
  for (var i = start; i < end; i++) {
    var t = o[i] * 9;
    for (var v = 0; v < 3; v++) {
      var x = p[t + v * 3], y = p[t + v * 3 + 1], z = p[t + v * 3 + 2];
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (z < z0) z0 = z; if (z > z1) z1 = z;
    }
  }
  B[k] = x0; B[k + 1] = y0; B[k + 2] = z0; B[k + 3] = x1; B[k + 4] = y1; B[k + 5] = z1;
};

/** Recursive binned-SAH build over order[start..end). Returns node index. */
BVH.prototype.build = function (start, end) {
  var n = this.nodeCount++;
  this.fitBounds(n, start, end);
  var count = end - start;

  if (count <= BVH_LEAF_MAX) {
    this.leaf[n] = 1; this.a[n] = start; this.b[n] = count;
    return n;
  }

  // choose the axis with the widest centroid spread
  var o = this.order, C = [this.cx, this.cy, this.cz];
  var lo = [1e30, 1e30, 1e30], hi = [-1e30, -1e30, -1e30];
  for (var i = start; i < end; i++) for (var ax = 0; ax < 3; ax++) {
    var c = C[ax][o[i]];
    if (c < lo[ax]) lo[ax] = c;
    if (c > hi[ax]) hi[ax] = c;
  }
  var axis = 0, best = hi[0] - lo[0];
  if (hi[1] - lo[1] > best) { axis = 1; best = hi[1] - lo[1]; }
  if (hi[2] - lo[2] > best) { axis = 2; best = hi[2] - lo[2]; }

  var mid;
  if (best < 1e-7) {
    mid = (start + end) >> 1;                          // degenerate: split evenly
  } else {
    // bin centroids, pick the split with the lowest SAH cost
    var cc = C[axis], k1 = BVH_BINS / (best * 1.0001);
    var bc = new Int32Array(BVH_BINS);
    var bb = new Float32Array(BVH_BINS * 6);
    for (var q = 0; q < BVH_BINS; q++) {
      bb[q * 6] = bb[q * 6 + 1] = bb[q * 6 + 2] = 1e30;
      bb[q * 6 + 3] = bb[q * 6 + 4] = bb[q * 6 + 5] = -1e30;
    }
    var p = this.pos;
    for (i = start; i < end; i++) {
      var ti = o[i];
      var bi = Math.min(BVH_BINS - 1, (((cc[ti] - lo[axis]) * k1) | 0));
      bc[bi]++;
      var tp = ti * 9, kb = bi * 6;
      for (var v = 0; v < 3; v++) {
        var x = p[tp + v * 3], y = p[tp + v * 3 + 1], z = p[tp + v * 3 + 2];
        if (x < bb[kb]) bb[kb] = x; if (x > bb[kb + 3]) bb[kb + 3] = x;
        if (y < bb[kb + 1]) bb[kb + 1] = y; if (y > bb[kb + 4]) bb[kb + 4] = y;
        if (z < bb[kb + 2]) bb[kb + 2] = z; if (z > bb[kb + 5]) bb[kb + 5] = z;
      }
    }
    var area = function (bx0, by0, bz0, bx1, by1, bz1) {
      var dx = Math.max(0, bx1 - bx0), dy = Math.max(0, by1 - by0), dz = Math.max(0, bz1 - bz0);
      return dx * dy + dy * dz + dz * dx;
    };
    var lArea = new Float32Array(BVH_BINS), lCnt = new Int32Array(BVH_BINS);
    var rArea = new Float32Array(BVH_BINS), rCnt = new Int32Array(BVH_BINS);
    var ax0 = 1e30, ay0 = 1e30, az0 = 1e30, ax1 = -1e30, ay1 = -1e30, az1 = -1e30, run = 0;
    for (q = 0; q < BVH_BINS; q++) {
      run += bc[q];
      if (bc[q]) {
        if (bb[q * 6] < ax0) ax0 = bb[q * 6]; if (bb[q * 6 + 3] > ax1) ax1 = bb[q * 6 + 3];
        if (bb[q * 6 + 1] < ay0) ay0 = bb[q * 6 + 1]; if (bb[q * 6 + 4] > ay1) ay1 = bb[q * 6 + 4];
        if (bb[q * 6 + 2] < az0) az0 = bb[q * 6 + 2]; if (bb[q * 6 + 5] > az1) az1 = bb[q * 6 + 5];
      }
      lCnt[q] = run; lArea[q] = area(ax0, ay0, az0, ax1, ay1, az1);
    }
    ax0 = ay0 = az0 = 1e30; ax1 = ay1 = az1 = -1e30; run = 0;
    for (q = BVH_BINS - 1; q >= 0; q--) {
      run += bc[q];
      if (bc[q]) {
        if (bb[q * 6] < ax0) ax0 = bb[q * 6]; if (bb[q * 6 + 3] > ax1) ax1 = bb[q * 6 + 3];
        if (bb[q * 6 + 1] < ay0) ay0 = bb[q * 6 + 1]; if (bb[q * 6 + 4] > ay1) ay1 = bb[q * 6 + 4];
        if (bb[q * 6 + 2] < az0) az0 = bb[q * 6 + 2]; if (bb[q * 6 + 5] > az1) az1 = bb[q * 6 + 5];
      }
      rCnt[q] = run; rArea[q] = area(ax0, ay0, az0, ax1, ay1, az1);
    }
    var bestCost = Infinity, bestBin = -1;
    for (q = 0; q < BVH_BINS - 1; q++) {
      if (!lCnt[q] || !rCnt[q + 1]) continue;
      var cost = lArea[q] * lCnt[q] + rArea[q + 1] * rCnt[q + 1];
      if (cost < bestCost) { bestCost = cost; bestBin = q; }
    }
    if (bestBin < 0) {
      mid = (start + end) >> 1;
    } else {
      // in-place partition around the chosen bin
      var i2 = start, j = end - 1;
      while (i2 <= j) {
        var bIdx = Math.min(BVH_BINS - 1, (((cc[o[i2]] - lo[axis]) * k1) | 0));
        if (bIdx <= bestBin) i2++;
        else { var tmp = o[i2]; o[i2] = o[j]; o[j] = tmp; j--; }
      }
      mid = i2;
      if (mid === start || mid === end) mid = (start + end) >> 1;
    }
  }

  this.leaf[n] = 0;
  this.a[n] = this.build(start, mid);
  this.b[n] = this.build(mid, end);
  return n;
};

/**
 * Closest hit. Writes into `hit` and returns true when something was struck.
 * `hit` = {t, tri, u, v, nx, ny, nz, mat}
 */
BVH.prototype.intersect = function (ox, oy, oz, dx, dy, dz, tMax, hit, skipTri) {
  var idx = 1 / (dx || 1e-12), idy = 1 / (dy || 1e-12), idz = 1 / (dz || 1e-12);
  var stack = this._stack || (this._stack = new Int32Array(64));
  var sp = 0; stack[sp++] = 0;
  var B = this.bounds, p = this.pos, o = this.order;
  var bestT = tMax, bestTri = -1, bu = 0, bv = 0;
  if (!this.triCount) return false;

  while (sp > 0) {
    var n = stack[--sp], k = n * 6;
    var t1 = (B[k] - ox) * idx, t2 = (B[k + 3] - ox) * idx;
    var tmin = Math.min(t1, t2), tmax = Math.max(t1, t2);
    t1 = (B[k + 1] - oy) * idy; t2 = (B[k + 4] - oy) * idy;
    tmin = Math.max(tmin, Math.min(t1, t2)); tmax = Math.min(tmax, Math.max(t1, t2));
    t1 = (B[k + 2] - oz) * idz; t2 = (B[k + 5] - oz) * idz;
    tmin = Math.max(tmin, Math.min(t1, t2)); tmax = Math.min(tmax, Math.max(t1, t2));
    if (tmax < Math.max(tmin, 0) || tmin > bestT) continue;

    if (this.leaf[n]) {
      var s = this.a[n], e = s + this.b[n];
      for (var i = s; i < e; i++) {
        var ti = o[i];
        if (ti === skipTri) continue;
        var q = ti * 9;
        var e1x = p[q + 3] - p[q], e1y = p[q + 4] - p[q + 1], e1z = p[q + 5] - p[q + 2];
        var e2x = p[q + 6] - p[q], e2y = p[q + 7] - p[q + 1], e2z = p[q + 8] - p[q + 2];
        var px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
        var det = e1x * px + e1y * py + e1z * pz;
        if (det > -1e-12 && det < 1e-12) continue;
        var inv = 1 / det;
        var tx = ox - p[q], ty = oy - p[q + 1], tz = oz - p[q + 2];
        var u = (tx * px + ty * py + tz * pz) * inv;
        if (u < -1e-7 || u > 1 + 1e-7) continue;
        var qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
        var v = (dx * qx + dy * qy + dz * qz) * inv;
        if (v < -1e-7 || u + v > 1 + 1e-7) continue;
        var t = (e2x * qx + e2y * qy + e2z * qz) * inv;
        if (t > 1e-6 && t < bestT) { bestT = t; bestTri = ti; bu = u; bv = v; }
      }
    } else {
      stack[sp++] = this.a[n];
      stack[sp++] = this.b[n];
    }
  }

  if (bestTri < 0) return false;
  var g = bestTri * 9;
  var ax = p[g + 3] - p[g], ay = p[g + 4] - p[g + 1], az = p[g + 5] - p[g + 2];
  var bx = p[g + 6] - p[g], by = p[g + 7] - p[g + 1], bz = p[g + 8] - p[g + 2];
  var nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
  var L = Math.hypot(nx, ny, nz) || 1;
  hit.t = bestT; hit.tri = bestTri; hit.u = bu; hit.v = bv;
  hit.nx = nx / L; hit.ny = ny / L; hit.nz = nz / L;
  hit.mat = this.mat[bestTri];
  return true;
};

/** Any-hit occlusion test — cheaper than intersect(), used for shadow rays. */
BVH.prototype.occluded = function (ox, oy, oz, dx, dy, dz, tMax, skipTri) {
  if (!this.triCount) return false;
  var idx = 1 / (dx || 1e-12), idy = 1 / (dy || 1e-12), idz = 1 / (dz || 1e-12);
  var stack = this._stack2 || (this._stack2 = new Int32Array(64));
  var sp = 0; stack[sp++] = 0;
  var B = this.bounds, p = this.pos, o = this.order;

  while (sp > 0) {
    var n = stack[--sp], k = n * 6;
    var t1 = (B[k] - ox) * idx, t2 = (B[k + 3] - ox) * idx;
    var tmin = Math.min(t1, t2), tmax = Math.max(t1, t2);
    t1 = (B[k + 1] - oy) * idy; t2 = (B[k + 4] - oy) * idy;
    tmin = Math.max(tmin, Math.min(t1, t2)); tmax = Math.min(tmax, Math.max(t1, t2));
    t1 = (B[k + 2] - oz) * idz; t2 = (B[k + 5] - oz) * idz;
    tmin = Math.max(tmin, Math.min(t1, t2)); tmax = Math.min(tmax, Math.max(t1, t2));
    if (tmax < Math.max(tmin, 0) || tmin > tMax) continue;

    if (this.leaf[n]) {
      var s = this.a[n], e = s + this.b[n];
      for (var i = s; i < e; i++) {
        var ti = o[i];
        if (ti === skipTri) continue;
        var q = ti * 9;
        var e1x = p[q + 3] - p[q], e1y = p[q + 4] - p[q + 1], e1z = p[q + 5] - p[q + 2];
        var e2x = p[q + 6] - p[q], e2y = p[q + 7] - p[q + 1], e2z = p[q + 8] - p[q + 2];
        var px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
        var det = e1x * px + e1y * py + e1z * pz;
        if (det > -1e-12 && det < 1e-12) continue;
        var inv = 1 / det;
        var tx = ox - p[q], ty = oy - p[q + 1], tz = oz - p[q + 2];
        var u = (tx * px + ty * py + tz * pz) * inv;
        if (u < -1e-7 || u > 1 + 1e-7) continue;
        var qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
        var v = (dx * qx + dy * qy + dz * qz) * inv;
        if (v < -1e-7 || u + v > 1 + 1e-7) continue;
        var t = (e2x * qx + e2y * qy + e2z * qz) * inv;
        if (t > 1e-6 && t < tMax) return true;
      }
    } else {
      stack[sp++] = this.a[n];
      stack[sp++] = this.b[n];
    }
  }
  return false;
};
