/* ==========================================================================
   Viewport: renderer, camera control, model meshes and the analysis grid.

   The analysis mesh is deliberately UNLIT (MeshBasicMaterial + vertex
   colours). A false-colour field that is modulated by the scene lighting
   cannot be read against a legend, and reading it against the legend is the
   entire point.
   ========================================================================== */

/* --- camera control ------------------------------------------------------ */
function OrbitCtl(camera, dom, onChange) {
  this.cam = camera; this.dom = dom; this.onChange = onChange;
  // `claim` may consume a press before it becomes a camera gesture (used by
  // aperture dragging); `suspend` stops an in-flight gesture, for the touch
  // press-and-hold that promotes an orbit into a drag.
  this.claim = null; this.suspend = false;
  // In an orthographic view the camera direction is fixed by the view itself,
  // so gestures re-route: dragging pans and the wheel changes the extent.
  this.ortho = false; this.onOrtho = null;
  this.target = new THREE.Vector3(0, 1.2, 0);
  this.dist = 18; this.theta = -0.6; this.phi = 1.05;
  this.minPhi = 0.02; this.maxPhi = Math.PI - 0.02;
  this.minDist = 1.5; this.maxDist = 300;
  this.enabled = true;
  this._bind();
  this.apply();
}
OrbitCtl.prototype._bind = function () {
  var s = this, dom = this.dom, drag = null, touches = {}, lastPinch = 0, lastMid = null;

  var down = function (e) {
    if (!s.enabled) return;
    s.suspend = false;
    if (!Object.keys(touches).length && s.claim && s.claim(e)) return;
    dom.setPointerCapture && dom.setPointerCapture(e.pointerId);
    touches[e.pointerId] = { x: e.clientX, y: e.clientY };
    var n = Object.keys(touches).length;
    if (n === 1) {
      drag = { x: e.clientX, y: e.clientY, pan: e.button === 1 || e.button === 2 || e.shiftKey || e.ctrlKey };
    } else if (n === 2) {
      var k = Object.keys(touches);
      lastPinch = Math.hypot(touches[k[0]].x - touches[k[1]].x, touches[k[0]].y - touches[k[1]].y);
      lastMid = { x: (touches[k[0]].x + touches[k[1]].x) / 2, y: (touches[k[0]].y + touches[k[1]].y) / 2 };
      drag = null;
    }
    e.preventDefault();
  };
  var move = function (e) {
    if (!s.enabled || s.suspend || !(e.pointerId in touches)) return;
    touches[e.pointerId] = { x: e.clientX, y: e.clientY };
    var keys = Object.keys(touches);
    if (keys.length === 2) {
      var d = Math.hypot(touches[keys[0]].x - touches[keys[1]].x, touches[keys[0]].y - touches[keys[1]].y);
      var mid = { x: (touches[keys[0]].x + touches[keys[1]].x) / 2, y: (touches[keys[0]].y + touches[keys[1]].y) / 2 };
      if (lastPinch) s.zoom(Math.pow(0.995, d - lastPinch));
      if (lastMid) s.pan(mid.x - lastMid.x, mid.y - lastMid.y);
      lastPinch = d; lastMid = mid;
      s.apply(); e.preventDefault(); return;
    }
    if (!drag) return;
    var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY;
    if (drag.pan) s.pan(dx, dy); else s.orbit(dx, dy);
    s.apply(); e.preventDefault();
  };
  var up = function (e) {
    s.suspend = false;
    delete touches[e.pointerId];
    if (Object.keys(touches).length < 2) { lastPinch = 0; lastMid = null; }
    if (!Object.keys(touches).length) drag = null;
  };
  dom.addEventListener('pointerdown', down);
  dom.addEventListener('pointermove', move);
  dom.addEventListener('pointerup', up);
  dom.addEventListener('pointercancel', up);
  dom.addEventListener('pointerleave', up);
  dom.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  dom.addEventListener('wheel', function (e) {
    if (!s.enabled) return;
    s.zoom(Math.pow(1.0016, e.deltaY)); s.apply(); e.preventDefault();
  }, { passive: false });
};
OrbitCtl.prototype.orbit = function (dx, dy) {
  if (this.ortho) { this.pan(dx, dy); return; }   // a locked view pans instead
  this.theta -= dx * 0.007;
  this.phi = clamp(this.phi - dy * 0.007, this.minPhi, this.maxPhi);
};
OrbitCtl.prototype.zoom = function (f) {
  if (this.ortho) { if (this.onOrtho) this.onOrtho.zoom(f); return; }
  this.dist = clamp(this.dist * f, this.minDist, this.maxDist);
};
OrbitCtl.prototype.pan = function (dx, dy) {
  if (this.ortho) { if (this.onOrtho) this.onOrtho.pan(dx, dy); return; }
  var scale = this.dist * 0.0016;
  var right = new THREE.Vector3().setFromMatrixColumn(this.cam.matrix, 0);
  var up = new THREE.Vector3().setFromMatrixColumn(this.cam.matrix, 1);
  this.target.addScaledVector(right, -dx * scale).addScaledVector(up, dy * scale);
};
OrbitCtl.prototype.apply = function () {
  if (this.ortho) {
    if (this.onOrtho) this.onOrtho.apply();
    if (this.onChange) this.onChange();
    return;
  }
  var sp = Math.sin(this.phi), cp = Math.cos(this.phi);
  this.cam.position.set(
    this.target.x + this.dist * sp * Math.sin(this.theta),
    this.target.y + this.dist * cp,
    this.target.z + this.dist * sp * Math.cos(this.theta)
  );
  this.cam.lookAt(this.target);
  this.cam.updateMatrixWorld();
  if (this.onChange) this.onChange();
};

/* --- viewport ------------------------------------------------------------ */
function View(canvas) {
  this.canvas = canvas;
  this.renderer = new THREE.WebGLRenderer({
    canvas: canvas, antialias: true, alpha: false,
    preserveDrawingBuffer: true, powerPreference: 'high-performance'
  });
  this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  this.renderer.shadowMap.enabled = true;
  this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  this.renderer.localClippingEnabled = true;

  this.scene = new THREE.Scene();
  this.camera = new THREE.PerspectiveCamera(42, 1, 0.05, 900);
  this.ortho = new THREE.OrthographicCamera(-10, 10, 10, -10, -200, 400);
  this.active = this.camera;
  this.mode = '3d';

  this.root = new THREE.Group(); this.scene.add(this.root);
  this.gModel = new THREE.Group(); this.root.add(this.gModel);
  this.gRoof = new THREE.Group(); this.root.add(this.gRoof);
  this.gGlass = new THREE.Group(); this.root.add(this.gGlass);
  this.gAnalysis = new THREE.Group(); this.root.add(this.gAnalysis);
  this.gSun = new THREE.Group(); this.root.add(this.gSun);
  this.gRays = new THREE.Group(); this.root.add(this.gRays);
  this.gDims = new THREE.Group(); this.root.add(this.gDims);
  this.gGround = new THREE.Group(); this.root.add(this.gGround);
  this.gPick = new THREE.Group(); this.root.add(this.gPick);

  this.sunLight = new THREE.DirectionalLight(0xffffff, 2.1);
  this.sunLight.castShadow = true;
  this.sunLight.shadow.mapSize.set(2048, 2048);
  this.sunLight.shadow.bias = -0.0008;
  this.sunLight.shadow.normalBias = 0.02;
  this.scene.add(this.sunLight);
  this.scene.add(this.sunLight.target);

  this.hemi = new THREE.HemisphereLight(0xdfe8f5, 0x9a8f80, 1.15);
  this.scene.add(this.hemi);
  this.fill = new THREE.DirectionalLight(0xffffff, 0.28);
  this.fill.position.set(-0.5, 0.8, -0.6);
  this.scene.add(this.fill);

  this.ctl = new OrbitCtl(this.camera, canvas, null);
  this.clip = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
  this.clipEnabled = false;
  this.theme = {};
  this.dirty = true;
}

View.prototype.resize = function () {
  var r = this.canvas.parentElement.getBoundingClientRect();
  var w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
  if (this.canvas.dataset.cw === String(w) && this.canvas.dataset.ch === String(h)) return;
  this.canvas.dataset.cw = w; this.canvas.dataset.ch = h;
  this.renderer.setSize(w, h, false);
  this.camera.aspect = w / h;
  this.camera.updateProjectionMatrix();
  this._orthoFrame(w / h);
  this.dirty = true;
};
View.prototype._orthoFrame = function (aspect) {
  var e = this.orthoExtent || 6;
  var px = this.orthoPan ? this.orthoPan.x : 0, py = this.orthoPan ? this.orthoPan.y : 0;
  this.ortho.left = -e * aspect + px; this.ortho.right = e * aspect + px;
  this.ortho.top = e + py; this.ortho.bottom = -e + py;
  this.ortho.updateProjectionMatrix();
};

/**
 * Zoom and pan handlers for the orthographic views. Zoom scales the visible
 * extent rather than moving the camera — an orthographic camera sees the same
 * thing wherever it sits along its axis — and is clamped either side of the
 * extent the view was fitted at.
 */
View.prototype._orthoHandlers = function () {
  var self = this;
  return {
    zoom: function (f) {
      var base = self.orthoBase || self.orthoExtent || 6;
      self.orthoExtent = clamp((self.orthoExtent || base) * f, base * 0.15, base * 6);
      self._orthoFrame(self.camera.aspect || 1);
      self.dirty = true;
    },
    pan: function (dx, dy) {
      if (!self.orthoPan) self.orthoPan = new THREE.Vector2();
      // one pixel of drag moves one pixel of scene at the current extent
      var h = self.canvas.clientHeight || 1;
      var k = (self.orthoExtent || 6) * 2 / h;
      self.orthoPan.x -= dx * k;
      self.orthoPan.y += dy * k;
      self._orthoFrame(self.camera.aspect || 1);
      self.dirty = true;
    },
    apply: function () { self.dirty = true; }
  };
};

/** Reset an orthographic view to the extent and centring it was fitted at. */
View.prototype.orthoReset = function () {
  if (this.orthoBase) this.orthoExtent = this.orthoBase;
  if (this.orthoPan) this.orthoPan.set(0, 0);
  this._orthoFrame(this.camera.aspect || 1);
  this.dirty = true;
};

/** Theme colours come from the CSS custom properties so the two never drift. */
View.prototype.setTheme = function () {
  var t = {};
  ['vp-top', 'vp-bot', 'm-floor', 'm-wall', 'm-ceil', 'm-ext', 'm-frame', 'm-shade',
   'm-door', 'm-glass', 'm-ground', 'edge', 'grid-major', 'grid-minor', 'sun', 'ray',
   'sunpath', 'sunpath-hi', 'dim-line', 'hemi-ground', 'accent', 'ink']
    .forEach(function (k) { t[k] = cssVar('--' + k) || '#888'; });
  this.theme = t;
  this.scene.background = new THREE.Color(t['vp-bot']);
  this.hemi.color.set(t['vp-top']);
  this.hemi.groundColor.set(t['hemi-ground']);
  // a dark viewport swallows a matte model, so lift the ambient to compensate
  var dark = document.documentElement.getAttribute('data-theme') === 'dark';
  this.hemiBase = dark ? 1.9 : 1.15;
  this.hemi.intensity = this.hemiBase;
  this.fill.intensity = dark ? 0.55 : 0.28;
  this.dirty = true;
  return t;
};

/* --- model meshes -------------------------------------------------------- */
function matColor(theme, id) {
  if (id >= GLASS_BASE) return theme['m-glass'];
  switch (id) {
    case MAT.FLOOR: return theme['m-floor'];
    case MAT.WALL_IN: return theme['m-wall'];
    case MAT.CEIL: return theme['m-ceil'];
    case MAT.WALL_OUT: case MAT.ROOF_OUT: case MAT.FLOOR_OUT: return theme['m-ext'];
    case MAT.REVEAL: return theme['m-wall'];
    case MAT.FRAME: return theme['m-frame'];
    case MAT.SHADE: return theme['m-shade'];
    case MAT.DOOR: return theme['m-door'];
  }
  return '#888888';
}
function isRoofMat(id) { return id === MAT.CEIL || id === MAT.ROOF_OUT; }

function disposeGroup(g) {
  for (var i = g.children.length - 1; i >= 0; i--) {
    var c = g.children[i];
    if (c.geometry) c.geometry.dispose();
    if (c.material) {
      if (Array.isArray(c.material)) c.material.forEach(function (m) { m.dispose(); });
      else c.material.dispose();
    }
    g.remove(c);
  }
}

/** Rebuild every mesh from a freshly built triangle soup. */
View.prototype.setModel = function (built, model) {
  disposeGroup(this.gModel); disposeGroup(this.gRoof); disposeGroup(this.gGlass);
  disposeGroup(this.gGround);
  this.built = built; this.model = model;
  var t = this.theme, self = this;

  built.groups.forEach(function (grp) {
    var tris = grp.tris, n = tris.length;
    var pos = new Float32Array(n * 9), nrm = new Float32Array(n * 9);
    for (var i = 0; i < n; i++) {
      var ti = tris[i];
      for (var k = 0; k < 9; k++) pos[i * 9 + k] = built.tri.pos[ti * 9 + k];
      for (var v = 0; v < 3; v++) {
        nrm[i * 9 + v * 3] = built.tri.nrm[ti * 3];
        nrm[i * 9 + v * 3 + 1] = built.tri.nrm[ti * 3 + 1];
        nrm[i * 9 + v * 3 + 2] = built.tri.nrm[ti * 3 + 2];
      }
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));

    var glass = grp.mat >= GLASS_BASE;
    var mesh;
    if (glass) {
      var tau = built.materials[grp.mat] ? built.materials[grp.mat].tau : 0.7;
      mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: new THREE.Color(t['m-glass']),
        transparent: true, opacity: clamp(0.10 + 0.22 * (1 - tau), 0.08, 0.42),
        side: THREE.DoubleSide, depthWrite: false
      }));
      mesh.renderOrder = 3;
      self.gGlass.add(mesh);
    } else {
      mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({
        color: new THREE.Color(matColor(t, grp.mat)),
        side: THREE.DoubleSide
      }));
      mesh.castShadow = true; mesh.receiveShadow = true;
      (isRoofMat(grp.mat) ? self.gRoof : self.gModel).add(mesh);
    }
    mesh.userData.mat = grp.mat;
  });

  // architectural line work over the solid — the edges that a drawing shows
  if (built.tri.edges && built.tri.edges.length) {
    var eg = new THREE.BufferGeometry();
    eg.setAttribute('position', new THREE.BufferAttribute(built.tri.edges.slice(), 3));
    var lines = new THREE.LineSegments(eg, new THREE.LineBasicMaterial({
      color: new THREE.Color(t['edge']), transparent: true, opacity: 0.55, depthWrite: false
    }));
    lines.renderOrder = 1;
    lines.name = 'edges';
    this.gModel.add(lines);
  }

  // ground plane, sized to the model so shadows always land somewhere
  var span = Math.max(built.outer.x1 - built.outer.x0, built.outer.z1 - built.outer.z0) * 6 + 20;
  var gp = new THREE.Mesh(
    new THREE.PlaneGeometry(span, span),
    new THREE.MeshLambertMaterial({ color: new THREE.Color(t['m-ground']) })
  );
  gp.rotation.x = -Math.PI / 2;
  gp.position.y = built.outer.y0 - 0.002;
  gp.receiveShadow = true;
  this.gGround.add(gp);

  var grid = new THREE.GridHelper(span * 0.55, Math.round(span * 0.55),
    new THREE.Color(t['grid-major']), new THREE.Color(t['grid-minor']));
  grid.position.y = built.outer.y0 + 0.001;
  grid.material.transparent = true; grid.material.opacity = 0.35;
  this.gGround.add(grid);

  this._applyClipping();
  this._fitShadow();
  this.dirty = true;
};

/** Re-apply theme colours to the existing meshes, without rebuilding them. */
View.prototype.recolor = function () {
  var t = this.theme;
  [this.gModel, this.gRoof].forEach(function (g) {
    g.traverse(function (o) {
      if (o.name === 'edges') { o.material.color.set(t['edge']); return; }
      if (o.material && o.userData.mat != null) o.material.color.set(matColor(t, o.userData.mat));
    });
  });
  this.gGlass.traverse(function (o) { if (o.material) o.material.color.set(t['m-glass']); });
  this.gGround.traverse(function (o) {
    if (o.material && o.material.color && !o.isGridHelper) o.material.color.set(t['m-ground']);
  });
  // GridHelper bakes its colours into a vertex attribute, so rebuild that one
  var o0 = this.built ? this.built.outer : { x0: -5, x1: 5, z0: -5, z1: 5, y0: 0 };
  var span = Math.max(o0.x1 - o0.x0, o0.z1 - o0.z0) * 6 + 20;
  for (var i = this.gGround.children.length - 1; i >= 0; i--) {
    var c = this.gGround.children[i];
    if (c.isGridHelper) { c.geometry.dispose(); c.material.dispose(); this.gGround.remove(c); }
  }
  var grid = new THREE.GridHelper(span * 0.55, Math.round(span * 0.55),
    new THREE.Color(t['grid-major']), new THREE.Color(t['grid-minor']));
  grid.position.y = o0.y0 + 0.001;
  grid.material.transparent = true; grid.material.opacity = 0.35;
  this.gGround.add(grid);
  this.scene.background = new THREE.Color(t['vp-bot']);
  this.dirty = true;
};

View.prototype._fitShadow = function () {
  if (!this.built) return;
  var o = this.built.outer;
  var r = Math.max(o.x1 - o.x0, o.z1 - o.z0, o.y1 - o.y0) * 1.1 + 2;
  var s = this.sunLight.shadow.camera;
  s.left = -r; s.right = r; s.top = r; s.bottom = -r;
  s.near = 0.1; s.far = r * 6 + 40;
  s.updateProjectionMatrix();
};

View.prototype._applyClipping = function () {
  var planes = this.clipEnabled ? [this.clip] : [];
  var self = this;
  [this.gModel, this.gRoof, this.gGlass, this.gAnalysis].forEach(function (g) {
    g.traverse(function (o) {
      if (o.material) {
        var ms = Array.isArray(o.material) ? o.material : [o.material];
        ms.forEach(function (m) { m.clippingPlanes = planes; m.needsUpdate = true; });
      }
    });
  });
  this.dirty = true;
};

/** Section cut along an axis at a world position. */
View.prototype.setSection = function (on, axis, pos, flip) {
  this.clipEnabled = !!on;
  var n = axis === 'x' ? new THREE.Vector3(1, 0, 0)
        : axis === 'y' ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
  if (flip) n.negate();
  this.clip.normal.copy(n);
  this.clip.constant = -n.dot(new THREE.Vector3(
    axis === 'x' ? pos : 0, axis === 'y' ? pos : 0, axis === 'z' ? pos : 0));
  this._applyClipping();
};

/* --- sun ----------------------------------------------------------------- */
/**
 * Position the sun light and set its penumbra from the apparent sun size.
 * The same `sunSizeDeg` drives the ray bundle spread and the sun sphere in
 * the sun-path dome, so the three always agree.
 */
View.prototype.setSun = function (sun, opts) {
  opts = opts || {};
  var b = this.built ? this.built.outer : { x0: -5, x1: 5, y0: 0, y1: 3, z0: -5, z1: 5 };
  var r = Math.max(b.x1 - b.x0, b.z1 - b.z0, b.y1 - b.y0) * 2.2 + 12;
  var d = sun && sun.altitude > 0 ? sun.dir : { x: 0, y: 1, z: 0 };
  this.sunLight.position.set(d.x * r, Math.max(d.y, 0.02) * r, d.z * r);
  this.sunLight.target.position.set(0, (b.y0 + b.y1) / 2, 0);
  this.sunLight.target.updateMatrixWorld();
  this.sunLight.intensity = sun && sun.altitude > 0
    ? clamp(0.5 + 2.0 * Math.sin(sun.altitude * DEG), 0, 2.4) : 0;
  this.sunLight.visible = !!(sun && sun.altitude > 0) && opts.shadows !== false;
  this.sunLight.castShadow = opts.shadows !== false;
  // apparent diameter -> penumbra width; 0.53 deg is the real sun
  this.sunLight.shadow.radius = clamp(1 + (opts.sunSizeDeg || 0.53) * 3.2, 1, 16);
  this.hemi.intensity = opts.hemi == null ? (this.hemiBase || 1.15) : opts.hemi;
  this._fitShadow();
  this.dirty = true;
};

/* --- analysis grid ------------------------------------------------------- */

/**
 * Build the workplane visualisation.
 * @param {object} grid  {nx, nz, x0, z0, spacing, y}
 * @param {Float32Array} field
 * @param {object} scale  from scaleFor()
 * @param {string} style  smooth | cells | contour | dots | numbers | relief
 */
View.prototype.setAnalysis = function (grid, field, scale, style, opts) {
  disposeGroup(this.gAnalysis);
  this.grid = grid; this.field = field; this.scaleUsed = scale;
  if (!grid || !field || !field.length) { this.dirty = true; return; }
  opts = opts || {};

  var nx = grid.nx, nz = grid.nz, sp = grid.spacing;
  var y = grid.y + 0.004;
  var self = this;
  var at = function (i, j) { return field[clamp(j, 0, nz - 1) * nx + clamp(i, 0, nx - 1)]; };
  var px = function (i) { return grid.x0 + i * sp; };
  var pz = function (j) { return grid.z0 + j * sp; };

  if (style === 'numbers') {
    var pg = new THREE.Mesh(
      new THREE.PlaneGeometry((nx - 1) * sp + sp, (nz - 1) * sp + sp),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(cssVar('--panel')), transparent: true,
        opacity: 0.55, side: THREE.DoubleSide, depthWrite: false
      })
    );
    pg.rotation.x = -Math.PI / 2;
    pg.position.set(px(0) + (nx - 1) * sp / 2, y, pz(0) + (nz - 1) * sp / 2);
    pg.renderOrder = 2;
    this.gAnalysis.add(pg);
    this._applyClipping();
    this.dirty = true;
    return;
  }

  if (style === 'dots') {
    var geo = new THREE.CircleGeometry(1, 20);
    geo.rotateX(-Math.PI / 2);
    var inst = new THREE.InstancedMesh(geo,
      new THREE.MeshBasicMaterial({ vertexColors: false, side: THREE.DoubleSide, toneMapped: false }),
      nx * nz);
    inst.material.color.set(0xffffff);
    inst.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(nx * nz * 3), 3);
    var mtx = new THREE.Matrix4(), k = 0;
    for (var j = 0; j < nz; j++) for (var i = 0; i < nx; i++, k++) {
      var v = at(i, j), t = scaleT(scale, v);
      var rad = sp * (0.14 + 0.34 * (opts.dotUniform ? 1 : t));
      mtx.makeScale(rad, 1, rad);
      mtx.setPosition(px(i), y, pz(j));
      inst.setMatrixAt(k, mtx);
      var c = rampColor(scale.ramp, scale.reverse ? 1 - t : t);
      inst.instanceColor.setXYZ(k, c.r, c.g, c.b);
    }
    inst.instanceMatrix.needsUpdate = true;
    inst.renderOrder = 2;
    this.gAnalysis.add(inst);
    this._applyClipping();
    this.dirty = true;
    return;
  }

  if (style === 'cells') {
    var pos = new Float32Array(nx * nz * 18), col = new Float32Array(nx * nz * 18);
    var o = 0;
    for (j = 0; j < nz; j++) for (i = 0; i < nx; i++) {
      var x0 = px(i) - sp / 2, x1 = px(i) + sp / 2;
      var z0 = pz(j) - sp / 2, z1 = pz(j) + sp / 2;
      var cc = scaleColor(scale, at(i, j));
      var quad = [x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z0, x1, y, z1, x0, y, z1];
      for (var q = 0; q < 18; q++) pos[o + q] = quad[q];
      for (q = 0; q < 6; q++) { col[o + q * 3] = cc.r; col[o + q * 3 + 1] = cc.g; col[o + q * 3 + 2] = cc.b; }
      o += 18;
    }
    this.gAnalysis.add(this._colorMesh(pos, col));
    this._applyClipping();
    this.dirty = true;
    return;
  }

  // smooth / contour / relief share a subdivided vertex-coloured surface
  var sub = style === 'smooth' || style === 'relief' ? 3 : 1;
  var band = style === 'contour' ? (opts.bands || 8) : 0;
  var VX = (nx - 1) * sub + 1, VZ = (nz - 1) * sub + 1;
  var vpos = new Float32Array(VX * VZ * 3), vcol = new Float32Array(VX * VZ * 3);
  var relief = style === 'relief' ? (opts.reliefHeight || 1.2) : 0;

  var bilinear = function (fx, fz) {
    var i0 = clamp(Math.floor(fx), 0, nx - 1), j0 = clamp(Math.floor(fz), 0, nz - 1);
    var i1 = Math.min(i0 + 1, nx - 1), j1 = Math.min(j0 + 1, nz - 1);
    var tx = fx - i0, tz = fz - j0;
    return lerp(lerp(at(i0, j0), at(i1, j0), tx), lerp(at(i0, j1), at(i1, j1), tx), tz);
  };

  for (j = 0; j < VZ; j++) for (i = 0; i < VX; i++) {
    var fi = i / sub, fj = j / sub;
    var val = bilinear(fi, fj);
    var t2 = scaleT(scale, val);
    if (band) t2 = Math.min(0.999, Math.floor(t2 * band) / (band - 1));
    var c2 = rampColor(scale.ramp, scale.reverse ? 1 - t2 : t2);
    var idx = (j * VX + i) * 3;
    vpos[idx] = px(0) + fi * sp;
    vpos[idx + 1] = y + relief * scaleT(scale, val);
    vpos[idx + 2] = pz(0) + fj * sp;
    vcol[idx] = c2.r; vcol[idx + 1] = c2.g; vcol[idx + 2] = c2.b;
  }
  var idxArr = [];
  for (j = 0; j < VZ - 1; j++) for (i = 0; i < VX - 1; i++) {
    var a = j * VX + i, b = a + 1, c = a + VX, d = c + 1;
    idxArr.push(a, c, b, b, c, d);
  }
  var g2 = new THREE.BufferGeometry();
  g2.setAttribute('position', new THREE.BufferAttribute(vpos, 3));
  g2.setAttribute('color', new THREE.BufferAttribute(vcol, 3));
  g2.setIndex(idxArr);
  var mesh2 = new THREE.Mesh(g2, new THREE.MeshBasicMaterial({
    vertexColors: true, side: THREE.DoubleSide, toneMapped: false,
    transparent: opts.opacity != null && opts.opacity < 1,
    opacity: opts.opacity == null ? 1 : opts.opacity,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
  }));
  mesh2.renderOrder = 2;
  this.gAnalysis.add(mesh2);

  if (style === 'contour') {
    var lines = isolines(field, nx, nz, scale, opts.bands || 8, px, pz, y + 0.006);
    if (lines.length) {
      var lg = new THREE.BufferGeometry();
      lg.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(lines), 3));
      this.gAnalysis.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({
        color: new THREE.Color(cssVar('--ink')), transparent: true, opacity: 0.55
      })));
    }
  }
  this._applyClipping();
  this.dirty = true;
};

View.prototype._colorMesh = function (pos, col) {
  var g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  var m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
    vertexColors: true, side: THREE.DoubleSide, toneMapped: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
  }));
  m.renderOrder = 2;
  return m;
};

/** Marching-squares isolines at the band boundaries of the colour scale. */
function isolines(field, nx, nz, scale, bands, px, pz, y) {
  var out = [];
  var at = function (i, j) { return field[j * nx + i]; };
  for (var b = 1; b < bands; b++) {
    var level = lerp(scale.min, scale.max, b / bands);
    for (var j = 0; j < nz - 1; j++) for (var i = 0; i < nx - 1; i++) {
      var v = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)];
      var xs = [px(i), px(i + 1), px(i + 1), px(i)];
      var zs = [pz(j), pz(j), pz(j + 1), pz(j + 1)];
      var pts = [];
      for (var e = 0; e < 4; e++) {
        var a = e, c = (e + 1) % 4;
        if ((v[a] < level) !== (v[c] < level)) {
          var t = (level - v[a]) / ((v[c] - v[a]) || 1e-9);
          pts.push([lerp(xs[a], xs[c], t), y, lerp(zs[a], zs[c], t)]);
        }
      }
      for (var k = 0; k + 1 < pts.length; k += 2) {
        out.push(pts[k][0], pts[k][1], pts[k][2], pts[k + 1][0], pts[k + 1][1], pts[k + 1][2]);
      }
    }
  }
  return out;
}

/* --- view modes ---------------------------------------------------------- */

/**
 * '3d'   free orbit
 * 'plan' orthographic from directly above, looking at the workplane. The roof
 *        stays in the CALCULATION — only its meshes are hidden — so readings
 *        are those of the fully enclosed room.
 * 'elev' orthographic elevation
 */
View.prototype.setViewMode = function (mode, opts) {
  opts = opts || {};
  this.mode = mode;
  var b = this.built ? this.built.outer : { x0: -4, x1: 4, y0: 0, y1: 3, z0: -3, z1: 3 };
  var cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;

  if (mode === 'plan') {
    this.orthoExtent = Math.max(b.x1 - b.x0, b.z1 - b.z0) * 0.58;
    // sit just under the roof soffit and look straight down
    var eye = this.model ? this.model.room.H - 0.02 : b.y1 - 0.3;
    this.ortho.position.set(cx, eye + 40, cz);
    this.ortho.up.set(0, 0, -1);
    this.ortho.lookAt(cx, 0, cz);
    this.ortho.near = 40 - (eye - (this.grid ? this.grid.y : 0.75)) + 0.02;
    this.ortho.far = 400;
    this.active = this.ortho;
    this.ctl.enabled = true; this.ctl.ortho = true;
  } else if (mode === 'elev') {
    this.orthoExtent = Math.max(b.x1 - b.x0, b.y1 - b.y0) * 0.62;
    this.ortho.position.set(cx, (b.y0 + b.y1) / 2, cz + 80);
    this.ortho.up.set(0, 1, 0);
    this.ortho.lookAt(cx, (b.y0 + b.y1) / 2, cz);
    this.ortho.near = -200; this.ortho.far = 400;
    this.active = this.ortho;
    this.ctl.enabled = true; this.ctl.ortho = true;
  } else {
    this.active = this.camera;
    this.ctl.enabled = true; this.ctl.ortho = false;
  }
  if (this.ctl.ortho) {
    this.orthoBase = this.orthoExtent;      // the fitted extent, for clamping
    if (!this.orthoPan) this.orthoPan = new THREE.Vector2();
    this.orthoPan.set(0, 0);
    this.ctl.onOrtho = this._orthoHandlers();
  }
  this.resize();
  this._orthoFrame(this.camera.aspect || 1);
  this.ortho.updateProjectionMatrix();
  this.applyVisibility(opts);
  this.dirty = true;
};

/**
 * Roof / wall visibility. `roofRemoved` is the only one that changes physics
 * — everything else here is purely what the camera is allowed to see.
 */
View.prototype.applyVisibility = function (o) {
  o = o || {};
  var hideRoof = o.hideRoof || this.mode === 'plan';
  this.gRoof.visible = !hideRoof;
  this.gRoof.traverse(function (m) {
    if (m.material) {
      m.material.transparent = o.roofOpacity != null && o.roofOpacity < 1;
      m.material.opacity = o.roofOpacity == null ? 1 : o.roofOpacity;
      m.material.depthWrite = !(o.roofOpacity < 1);
    }
  });
  this.gGlass.visible = o.showGlass !== false;
  this.gGround.visible = o.showGround !== false && this.mode !== 'plan';
  this.gSun.visible = o.showSunPath !== false && this.mode === '3d';
  this.dirty = true;
};

/** Frame the model in the perspective camera. */
View.prototype.frame = function (margin) {
  var b = this.built ? this.built.outer : { x0: -4, x1: 4, y0: 0, y1: 3, z0: -3, z1: 3 };
  var r = Math.hypot(b.x1 - b.x0, b.y1 - b.y0, b.z1 - b.z0) / 2;
  this.ctl.target.set((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2 - 0.2, (b.z0 + b.z1) / 2);
  // pull back far enough to hold the sun-path dome when it is being shown
  var m = margin || (this.gSun.children.length ? 1.7 : 1.25);
  this.ctl.dist = r / Math.tan(this.camera.fov * DEG / 2) * m;
  this.ctl.apply();
  this.dirty = true;
};
View.prototype.setStandardView = function (name) {
  var a = { iso: [-0.6, 1.05], top: [0, 0.05], south: [0, Math.PI / 2 - 0.001],
            north: [Math.PI, Math.PI / 2 - 0.001], east: [Math.PI / 2, Math.PI / 2 - 0.001],
            west: [-Math.PI / 2, Math.PI / 2 - 0.001], sw: [-0.9, 1.15], se: [0.9, 1.15] }[name];
  if (!a) return;
  this.ctl.theta = a[0]; this.ctl.phi = clamp(a[1], this.ctl.minPhi, this.ctl.maxPhi);
  this.ctl.apply();
};

/** World point -> canvas pixel. Used for the value and dimension labels. */
View.prototype.project = function (x, y, z, out) {
  var v = this._pv || (this._pv = new THREE.Vector3());
  v.set(x, y, z).project(this.active);
  var w = this.canvas.clientWidth, h = this.canvas.clientHeight;
  out = out || {};
  out.x = (v.x * 0.5 + 0.5) * w;
  out.y = (-v.y * 0.5 + 0.5) * h;
  out.z = v.z;
  out.visible = v.z > -1 && v.z < 1 && out.x > -60 && out.y > -20 && out.x < w + 60 && out.y < h + 20;
  return out;
};

/* --- picking --------------------------------------------------------------
   Openings are picked by raycasting the SOLID geometry, then asking the model
   which opening (if any) owns the point that was struck. That way the glass,
   the frame, the reveal and a door leaf all select the same thing, and no
   material ids have to be duplicated per aperture.                          */

/** A raycaster set from the pointer through whichever camera is active. */
View.prototype.pointerRay = function (clientX, clientY) {
  var r = this.canvas.getBoundingClientRect();
  var nd = this._ndc || (this._ndc = new THREE.Vector2());
  nd.x = ((clientX - r.left) / r.width) * 2 - 1;
  nd.y = -((clientY - r.top) / r.height) * 2 + 1;
  var rc = this._rc || (this._rc = new THREE.Raycaster());
  rc.setFromCamera(nd, this.active);
  return rc;
};

/**
 * The opening under the pointer, with the ray that found it.
 * @returns {object|null} {aperture, point, ray, distance}
 */
View.prototype.pickAperture = function (model, clientX, clientY) {
  var rc = this.pointerRay(clientX, clientY);
  // solids and glazing only — never the analysis mesh, dimensions or sun path
  var hits = rc.intersectObjects([this.gModel, this.gRoof, this.gGlass], true);
  for (var i = 0; i < hits.length; i++) {
    var h = hits[i];
    if (h.object.type === 'LineSegments' || h.object.type === 'Line') continue;
    var p = [h.point.x, h.point.y, h.point.z];
    var ap = apertureAtPoint(model, p, 0.025);
    if (ap) return { aperture: ap, point: p, ray: rc, distance: h.distance };
    return null;                       // the nearest solid is plain wall
  }
  return null;
};

/** Outline an opening on both faces of its slab. Pass null to clear. */
View.prototype.highlightAperture = function (model, ap, active) {
  disposeGroup(this.gPick);
  if (!ap) { this.dirty = true; return; }
  var F = frameFor(ap.side, model.room), r = apertureRect(ap, model.room);
  var pts = [];
  [0, F.t].forEach(function (d) {
    var c = [fpt(F, r[0], r[2], d), fpt(F, r[1], r[2], d),
             fpt(F, r[1], r[3], d), fpt(F, r[0], r[3], d)];
    for (var i = 0; i < 4; i++) {
      var a = c[i], b = c[(i + 1) % 4];
      pts.push(a[0], a[1], a[2], b[0], b[1], b[2]);
    }
  });
  var g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(pts), 3));
  var line = new THREE.LineSegments(g, new THREE.LineBasicMaterial({
    color: new THREE.Color(cssVar('--accent')),
    transparent: true, opacity: active ? 1 : 0.75, depthTest: false
  }));
  line.renderOrder = 9;
  this.gPick.add(line);
  this.dirty = true;
};

View.prototype.render = function () {
  this.renderer.render(this.scene, this.active);
  this.dirty = false;
};
