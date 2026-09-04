/* ==========================================================================
   App — state, the recompute pipeline, and everything that wires the
   viewport, the toolbar and the engine together.
   ========================================================================== */

var App = {
  model: null,
  climate: null,
  sun: null,
  view: null,
  engine: null,
  bvh: null,
  built: null,
  grid: null,
  result: null,          // {n, pts, lux, df, annual}
  compliance: null,
  field: null,
  stats: null,
  scale: null,
  dims: [],
  metric: 'df',
  rayStats: null,
  scenarios: [],
  animating: null,

  display: {
    theme: 'light', style: 'smooth', ramp: null, reverseRamp: false,
    manualScale: false, scaleMin: 0, scaleMax: 10,
    showValues: false, decimals: null, labelEvery: 1,   // null = the metric's own
    dims: { room: true, thickness: false, aperture: false, shading: false },
    roofOpacity: 1, hideRoof: true, roofRemoved: false,
    showGlass: true, showGround: true, showSunPath: true, shadows: true,
    viewMode: '3d', handTool: false, cleanView: false,
    section: { on: false, axis: 'z', pos: 0, flip: false }
  },
  rays: { enabled: false, density: 22, sunSizeDeg: 0.53, length: 2.5, opacity: 0.6, showSpots: true },
  exportOpts: {
    scale: 2, showTitle: true, showLegend: true, showStats: true,
    showValues: false, showDimensions: true
  },

  dirty: {},
  busy: false,
  queued: false,

  drag: null,        // in-flight aperture move
  hover: null,       // aperture under the pointer
  undoStack: []
};

/* --- boot ---------------------------------------------------------------- */

App.init = function () {
  this.model = defaultModel();
  this.display.theme = 'light';
  document.documentElement.setAttribute('data-theme', 'light');

  this.view = new View($('#view'));
  this.view.setTheme();
  this.view.ctl.onChange = function () { App.dirty.labels = true; App.view.dirty = true; };

  this.engine = new Engine().start();
  this.useSyntheticClimate(true);
  this.updateSunObject();

  buildMetricTabs();
  buildViewTools();
  initHudFolds();
  UI.build($('#rail'));
  wireGlobalEvents();
  this.loadScenarios();

  this.rebuildGeometry();
  this.initApertureDrag();
  this.view.frame();
  this.view.setViewMode('3d', this.visibilityOpts());
  this.applySun();

  this.setStatus('Ready — ' + (this.engine.mode === 'worker' ? 'analysis worker active' : 'single-thread mode'), 'ok');
  UI.sync();
  this.run();
  startRenderLoop();

  // first visit in this browser: walk the student round the interface once
  initTour();
  if (!tourSeen()) setTimeout(function () { Tour.start(false); }, 900);
};

/* --- status, toasts, progress -------------------------------------------- */

App.setStatus = function (text, kind) {
  $('#bb-status').textContent = text;
  var d = $('#bb-dot');
  d.className = 'dot' + (kind ? ' ' + kind : '');
};
App.setProgress = function (v) {
  $('#progress i').style.width = (v == null ? 0 : clamp(v, 0, 1) * 100) + '%';
};
App.toast = function (msg, kind) {
  var t = el('div', { class: 'toast' + (kind ? ' ' + kind : ''), text: msg });
  $('#toast').appendChild(t);
  setTimeout(function () {
    t.style.transition = 'opacity .3s'; t.style.opacity = '0';
    setTimeout(function () { t.remove(); }, 320);
  }, kind === 'err' ? 5200 : 2600);
};
App.openInfo = function (key) {
  var i = INFO[key] || INFO.help;
  openModal(i.title, i.html);
};

/* --- solar --------------------------------------------------------------- */

App.clockHour = function () {
  // the solar routines want standard time; strip DST before calling them
  return this.model.when.hour - (this.model.site.dst ? 1 : 0);
};
App.updateSunObject = function () {
  var w = this.model.when;
  this.sun = sunPosition(this.model.site, w.year, w.month, w.day, this.clockHour());
  // rotate the sun into model space for everything geometric
  this.sun.dir = sunVector(this.sun.altitude, this.sun.azimuth, this.model.room.northAngle);
};
App.currentIrradiance = function () {
  var w = this.model.when, m = this.model;
  if (m.analysis.skyModel === 'perez' && this.climate) return this.climate.at(w.month, w.day, this.clockHour());
  var cs = clearSkyIrradiance(this.sun.altitude, doy(w.month, w.day),
    m.analysis.skyModel === 'clear' ? 2.5 : m.analysis.skyModel === 'intermediate' ? 5 : 3.5);
  if (m.analysis.skyModel === 'overcast' || m.analysis.skyModel === 'uniform') {
    return { dni: 0, dhi: cs.ghi * 0.85, ghi: cs.ghi * 0.85 };
  }
  return cs;
};
App.skyVector = function () {
  var m = this.model, w = m.when, irr = this.currentIrradiance();
  return buildSkyVector(this.patches, {
    model: m.analysis.skyModel, sun: this.sun,
    dni: irr.dni, dhi: irr.dhi,
    designLux: m.analysis.designLux, groundRefl: m.room.refl.ground,
    dayOfYear: doy(w.month, w.day)
  });
};
App.applySun = function () {
  this.view.setSun(this.sun, {
    shadows: this.display.shadows, sunSizeDeg: this.rays.sunSizeDeg
  });
  this.dirty.sunpath = true;
  this.dirty.rays = true;
  this.refreshTimebar();
  renderSolarHud($('#solar-body'));
  // the 2D chart is expensive to redraw, so only while its panel is open
  var sp = UI.panels.solar;
  if (sp && sp.el.open) renderSunChart($('#spchart'), this.model, this.sun);
};
App.updateSun = function () {
  this.updateSunObject();
  this.applySun();
  this.markDirty('sky');
  UI.sync();
};
App.onSiteChanged = function () {
  if (this.climate && this.climate.synthetic) this.useSyntheticClimate(true);
  this.updateSunObject();
  this.applySun();
  this.markDirty('annual');
  UI.sync();
};
App.setDate = function (month, day) {
  this.model.when.month = month; this.model.when.day = day;
  this.updateSun();
};
App.setUdi = function (t) {
  this.model.analysis.udi = t.slice();
  this.markDirty('annual');
  UI.sync();
};

/* --- climate ------------------------------------------------------------- */

App.useSyntheticClimate = function (quiet) {
  var s = this.model.site;
  this.climate = syntheticClimate({ lat: s.lat, lon: s.lon, tz: s.tz }, 0.45);
  if (!quiet) { this.toast('Using the built-in synthetic climate.'); this.markDirty('annual'); UI.sync(); }
};
App.loadEpwFile = function (file) {
  var self = this;
  this.setStatus('Reading ' + file.name + '…', 'busy');
  var fr = new FileReader();
  fr.onload = function () {
    try {
      var c = parseEpw(String(fr.result));
      self.climate = c;
      var s = self.model.site;
      s.lat = c.loc.lat; s.lon = c.loc.lon; s.tz = c.loc.tz; s.city = c.name;
      self.model.analysis.skyModel = 'perez';
      self.updateSunObject();
      self.applySun();
      self.toast('Loaded ' + c.name + ' — location applied.', 'ok');
      self.setStatus('EPW loaded', 'ok');
      self.markDirty('annual');
      UI.sync();
    } catch (e) {
      self.toast('Could not read that EPW: ' + e.message, 'err');
      self.setStatus('EPW failed', 'stale');
    }
  };
  fr.onerror = function () { self.toast('Could not read that file.', 'err'); };
  fr.readAsText(file);
};

/* --- geometry ------------------------------------------------------------ */

App.gridInfo = function () {
  var R = this.model.room, g = this.model.grid;
  var usableX = Math.max(g.spacing, R.L - 2 * g.margin);
  var usableZ = Math.max(g.spacing, R.W - 2 * g.margin);
  var nx = Math.max(1, Math.floor(usableX / g.spacing) + 1);
  var nz = Math.max(1, Math.floor(usableZ / g.spacing) + 1);
  // cap the point count so a careless 0.1 m spacing in a big room cannot hang
  var MAXP = 6000;
  while (nx * nz > MAXP) { nx = Math.max(2, nx - 1); nz = Math.max(2, nz - 1); }
  var x0 = -(nx - 1) * g.spacing / 2, z0 = -(nz - 1) * g.spacing / 2;
  return { nx: nx, nz: nz, n: nx * nz, x0: x0, z0: z0, spacing: g.spacing, y: g.height };
};

App.gridVersion = 0;
App.enginePointsVersion = -1;

App.buildGrid = function () {
  var gi = this.gridInfo();
  this.gridVersion++;
  var pts = new Float32Array(gi.n * 3), nrm = new Float32Array(gi.n * 3);
  var k = 0;
  for (var j = 0; j < gi.nz; j++) for (var i = 0; i < gi.nx; i++, k++) {
    pts[k * 3] = gi.x0 + i * gi.spacing;
    pts[k * 3 + 1] = gi.y;
    pts[k * 3 + 2] = gi.z0 + j * gi.spacing;
    nrm[k * 3 + 1] = 1;
  }
  gi.pts = pts; gi.nrm = nrm;
  this.grid = gi;
  return gi;
};

App.geomVersion = 0;
App.engineGeomVersion = -1;

App.rebuildGeometry = function () {
  var m = this.model;
  this.geomVersion++;
  this.built = buildModel(m, { roofRemoved: this.display.roofRemoved, includeGlass: true, includeShading: true });
  this.patches = buildSkyPatches(QUALITY[m.analysis.quality].mf);
  this.view.setModel(this.built, m);
  this.bvh = new BVH(this.built.tri.pos, this.built.tri.mat);
  this.materials = this.built.materials;
  this.buildGrid();
  this.dirty.dims = true;
  this.dirty.sunpath = true;
  this.dirty.rays = true;
  this.view.applyVisibility(this.visibilityOpts());
  this.applySection();
  $('#bb-model').textContent = m2(m.room.L) + ' × ' + m2(m.room.W) + ' × ' + m2(m.room.H) + ' m';
  $('#bb-grid').textContent = this.grid.nx + '×' + this.grid.nz + ' @ ' + m2(m.grid.spacing) + ' m';
};

App.visibilityOpts = function () {
  var d = this.display;
  return {
    hideRoof: d.hideRoof, roofOpacity: d.roofOpacity, showGlass: d.showGlass,
    showGround: d.showGround, showSunPath: d.showSunPath
  };
};
App.applySection = function () {
  var s = this.display.section;
  this.view.setSection(s.on, s.axis, s.pos, s.flip);
};

/* --- the recompute pipeline ---------------------------------------------- */

/**
 * Flag what changed. `live` marks a slider still being dragged, which drops
 * to preview quality and a short debounce so the viewport keeps up.
 */
App.markDirty = function (kind, live) {
  var d = this.dirty;
  switch (kind) {
    case 'geometry': d.geometry = d.bake = d.slice = d.annual = d.display = d.dims = d.rays = true; break;
    case 'materials': d.materials = d.bake = d.slice = d.annual = d.display = true; break;
    case 'grid': d.grid = d.bake = d.slice = d.annual = d.display = true; break;
    case 'bake': d.bake = d.slice = d.annual = d.display = true; break;
    case 'engine': d.slice = d.bake = d.display = true; break;
    case 'sky': d.slice = d.display = true; break;
    case 'annual': d.annual = d.display = d.compliance = true; break;
    case 'compliance': d.compliance = d.display = true; break;
    case 'splitflux': d.slice = d.display = true; break;
    case 'display': d.display = true; break;
    case 'labels': d.labels = true; break;
    case 'dims': d.dims = d.labels = true; break;
    case 'rays': d.rays = true; break;
    case 'sunsize': d.rays = true; this.applySun(); break;
    case 'sunpath': d.sunpath = true; break;
    case 'visibility': this.view.applyVisibility(this.visibilityOpts()); return;
    case 'section': this.applySection(); return;
  }
  this.live = !!live;
  this.schedule(live ? 90 : 220);
};

App._timer = 0;
App._pending = false;
App.schedule = function (ms) {
  clearTimeout(this._timer);
  this._pending = true;
  var self = this;
  this._timer = setTimeout(function () { self._pending = false; self.run(); }, ms);
};

/** Resolves once nothing is scheduled, running or queued. */
App.whenIdle = function () {
  var self = this;
  return new Promise(function (resolve) {
    (function poll() {
      if (!self.busy && !self.queued && !self._pending) resolve();
      else setTimeout(poll, 25);
    })();
  });
};

/** Run whatever is dirty, in dependency order. */
App.run = function () {
  if (this.busy) { this.queued = true; return; }
  var d = this.dirty, self = this;
  this.busy = true;
  this.queued = false;

  var chain = Promise.resolve();

  if (d.geometry || d.grid || d.materials) {
    chain = chain.then(function () {
      self.rebuildGeometry();
      d.geometry = d.grid = d.materials = false;
    });
  }
  // Push geometry whenever the engine's copy is older than the model's.
  chain = chain.then(function () {
    if (self.engineGeomVersion === self.geomVersion) return null;
    var v = self.geomVersion;
    return self.engine.setGeometry(self.built.tri, self.built.materials).then(function () {
      self.engineGeomVersion = v;
      d.bake = true;
    });
  });

  // The direct-sun routines need the sensor grid installed even when nothing
  // is baked, which is how split-flux gets its beam, ASE and sun hours.
  chain = chain.then(function () {
    if (self.enginePointsVersion === self.gridVersion) return null;
    var v = self.gridVersion;
    return self.engine.setPoints(self.grid.pts, self.grid.nrm).then(function () {
      self.enginePointsVersion = v;
    });
  });

  var engineMode = this.model.analysis.engine;

  // The bake decision must be taken AFTER the geometry push above, because
  // pushing geometry discards the engine's daylight-coefficient matrix.
  chain = chain.then(function () {
    if (engineMode !== 'raytrace' || !(d.bake || !self.result)) { d.bake = false; return null; }
    var q = QUALITY[self.live ? 'preview' : self.model.analysis.quality] || QUALITY.standard;
    self.setStatus('Tracing daylight coefficients…', 'busy');
    var t0 = performance.now();
    return self.engine.bake(self.grid.pts, self.grid.nrm,
      { rays: q.rays, bounces: q.bounces, mf: q.mf },
      function (p) { self.setProgress(p * 0.85); }
    ).then(function (info) {
      self.bakeInfo = info;
      self.bakeMs = Math.round(performance.now() - t0);
      d.bake = false; d.slice = true; d.annual = true;
      self.setProgress(0.85);
    });
  });

  chain = chain.then(function () { return self.computeInstant(); });

  if (METRICS[this.metric].annual) {
    chain = chain.then(function () { return self.computeAnnual(); });
  }

  chain.then(function () {
    self.refreshDisplay();
    self.setProgress(0);
    self.setStatus(self.statusLine(), 'ok');
    self.busy = false;
    UI.sync();
    if (self.queued) self.run();
  }).catch(function (err) {
    self.busy = false;
    self.setProgress(0);
    self.setStatus('Calculation failed', 'stale');
    self.toast('Calculation failed: ' + err.message, 'err');
    if (window.console) console.error(err);
  });
};

App.statusLine = function () {
  var parts = [];
  if (this.model.analysis.engine === 'raytrace' && this.bakeMs != null) {
    parts.push('Bake ' + this.bakeMs + ' ms');
  } else if (this.model.analysis.engine === 'splitflux') {
    parts.push('Split-flux');
  }
  if (this.annualMs != null && METRICS[this.metric].annual) parts.push('Annual ' + this.annualMs + ' ms');
  parts.push(this.grid.n + ' pts');
  return parts.join(' · ');
};

/** Point-in-time illuminance and the daylight factor. */
App.computeInstant = function () {
  var self = this, m = this.model, d = this.dirty;
  if (!d.slice && this.result) return Promise.resolve();

  var res = this.result && this.result.n === this.grid.n ? this.result
          : { n: this.grid.n, pts: this.grid.pts };
  res.n = this.grid.n; res.pts = this.grid.pts;

  if (m.analysis.engine === 'splitflux') {
    var sf = splitFluxGrid(m, this.grid.pts, this.grid.nrm);
    res.df = sf.df; res.sf = sf;
    var sky = this.skyVector();
    var diffuse = new Float32Array(res.n);
    for (var i = 0; i < res.n; i++) diffuse[i] = sf.df[i] / 100 * sky.Ediff;

    // The beam is pure sun geometry, so it is traced the same way for both
    // engines — only the diffuse component differs between them.
    var beam = (sky.Enormal > 1 && self.sun.dir.y > 0)
      ? self.engine.direct({
          sunDir: self.sun.dir, Enormal: sky.Enormal,
          radius: sunAngularRadius(self.rays.sunSizeDeg), samples: self.live ? 1 : 4
        })
      : Promise.resolve({ lux: new Float32Array(res.n) });

    return beam.then(function (b) {
      var out = new Float32Array(res.n);
      for (var k = 0; k < res.n; k++) out[k] = diffuse[k] + (b.lux[k] || 0);
      res.lux = out; res.diffuse = diffuse; res.direct = b.lux;
      res.sky = sky;
      self.result = res;
      d.slice = false;
    });
  }

  // raytraced: one dot product for the daylight factor, one for the instant
  var overcast = buildSkyVector(this.patches, {
    model: 'overcast', sun: this.sun, designLux: m.analysis.designLux,
    groundRefl: m.room.refl.ground, dayOfYear: doy(m.when.month, m.when.day)
  });
  var sky2 = this.skyVector();

  return this.engine.point({
    lum: overcast.lum, ground: overcast.ground, sunDir: { x: 0, y: -1, z: 0 }, Enormal: 0
  }).then(function (r) {
    var df = new Float32Array(res.n);
    for (var i = 0; i < res.n; i++) df[i] = 100 * r.lux[i] / overcast.Ediff;
    res.df = df;
    return self.engine.point({
      lum: sky2.lum, ground: sky2.ground,
      sunDir: self.sun.dir, Enormal: sky2.Enormal,
      radius: sunAngularRadius(self.rays.sunSizeDeg), samples: self.live ? 1 : 4
    });
  }).then(function (r2) {
    res.lux = r2.lux; res.direct = r2.direct; res.diffuse = r2.diffuse;
    res.sky = sky2;
    self.result = res;
    d.slice = false;
  });
};

/** Full-year run for UDI / DA / ASE / sun hours. */
App.computeAnnual = function () {
  var self = this, m = this.model, d = this.dirty;
  if (!d.annual && this.result && this.result.annual) { this.updateCompliance(); return Promise.resolve(); }
  this.setStatus('Running the year…', 'busy');
  var t0 = performance.now();
  return this.engine.annual({
    // split-flux supplies its daylight factor as the diffuse source; the beam,
    // UDI binning, DA, ASE and sun hours are the shared code path
    df: m.analysis.engine === 'splitflux' ? this.result.df : null,
    climate: this.climate,
    site: { lat: m.site.lat, lon: m.site.lon, tz: m.site.tz, year: 2001 },
    udi: m.analysis.udi, targetLux: m.analysis.targetLux,
    occStart: m.analysis.occStart, occEnd: m.analysis.occEnd,
    aseLux: m.analysis.aseLux, groundRefl: m.room.refl.ground,
    sunRadius: sunAngularRadius(this.rays.sunSizeDeg)
  }, function (p) { self.setProgress(0.85 + p * 0.15); }).then(function (r) {
    self.result.annual = r;
    self.annualMs = Math.round(performance.now() - t0);
    d.annual = false;
    self.updateCompliance();
  });
};

App.updateCompliance = function () {
  this.compliance = this.result && this.result.annual
    ? complianceSummary(this.result, this.model.analysis) : null;
  this.dirty.compliance = false;
};

/* --- display ------------------------------------------------------------- */

App.refreshDisplay = function () {
  var m = this.model, d = this.display;
  if (!this.result) return;

  this.field = metricField(this.metric, this.result, { udiView: this.udiView || 'useful' });
  if (!this.field) {
    this.view.setAnalysis(null);
    this.stats = null;
    renderStats($('#stats-body'), { metric: this.metric, stats: null, adf: null });
    return;
  }

  this.scale = scaleFor(this.metric, this.field, {
    manual: d.manualScale, min: d.scaleMin, max: d.scaleMax,
    ramp: d.ramp, reverse: d.reverseRamp
  });
  if (!d.manualScale) { d.scaleMin = this.scale.min; d.scaleMax = this.scale.max; }

  this.stats = metricStats(this.metric, this.field, {
    targetLux: m.analysis.targetLux, dfTarget: 2
  });

  this.view.setAnalysis(this.grid, this.field, this.scale, d.style, {
    bands: 8, reliefHeight: Math.min(1.5, m.room.H * 0.4), opacity: 1
  });

  renderLegend($('#legend-body'), {
    metric: this.metric, scale: this.scale, analysis: m.analysis,
    compliance: this.compliance, when: m.when, udiView: this.udiView || 'useful'
  });
  renderStats($('#stats-body'), {
    metric: this.metric, stats: this.stats,
    adf: this.metric === 'df' ? averageDaylightFactor(m) : null
  });

  // annual metrics always run the climate through Perez, whatever the
  // point-in-time sky selector says — name the sky that is actually in use
  var skyLabel = METRICS[this.metric].annual
    ? SKY_MODELS.perez.label + ' · ' + (this.climate ? this.climate.name : '—')
    : (SKY_MODELS[m.analysis.skyModel] || {}).label;
  $('#bb-engine').textContent = (m.analysis.engine === 'raytrace'
    ? 'Raytraced · ' + QUALITY[m.analysis.quality].label : 'Split-flux (BRE)') +
    ' · ' + skyLabel;
  $('#bb-roof').textContent = d.roofRemoved
    ? 'Roof: REMOVED from calculation'
    : (d.hideRoof || this.view.mode === 'plan')
      ? 'Roof: CLOSED (in calculation) — clipped for viewing'
      : 'Roof: closed';

  this.dirty.display = false;
  this.dirty.labels = true;
};

App.fitScale = function () {
  if (!this.field) return;
  var s = describe(this.field);
  this.display.manualScale = true;
  this.display.scaleMin = Math.floor(s.min);
  this.display.scaleMax = Math.ceil(s.max) || 1;
  this.markDirty('display');
  UI.sync();
};

App.setMetric = function (mk) {
  this.metric = mk;
  this.display.ramp = null;
  this.display.manualScale = false;
  $$('#metric-tabs button').forEach(function (b) {
    b.setAttribute('aria-selected', String(b.dataset.metric === mk));
  });
  $('#btn-run-label').textContent = METRICS[mk].annual ? 'Run year' : 'Calculate';
  if (METRICS[mk].annual && this.result && !this.result.annual) this.dirty.annual = true;
  this.markDirty('display');
  if (METRICS[mk].annual) this.schedule(0);
};

App.setTheme = function (name) {
  this.display.theme = name;
  document.documentElement.setAttribute('data-theme', name);
  this.view.setTheme();
  // colours only — recolouring in place avoids discarding the bake
  this.view.recolor();
  this.dirty.sunpath = true;
  this.dirty.rays = true;
  this.dirty.dims = true;
  this.markDirty('display');
  UI.sync();
};

/* --- apertures ----------------------------------------------------------- */

App.addAperture = function (kind) {
  var m = this.model;
  var ap;
  if (kind === 'skylight') {
    ap = makeAperture({ name: 'Skylight ' + (m.apertures.filter(function (a) { return a.kind === 'skylight'; }).length + 1),
      kind: 'skylight', side: 'roof', w: 1.2, h: 1.2, offset: 0, offset2: 0, tau: 0.7 });
  } else if (kind === 'door') {
    ap = makeAperture({ name: 'Door ' + (m.apertures.filter(function (a) { return a.kind === 'door'; }).length + 1),
      kind: 'door', side: 'N', w: 0.9, h: 2.1, sill: 0, offset: 0, tau: 0 });
  } else {
    // drop it on the wall with the fewest openings so it does not collide
    var counts = { N: 0, E: 0, S: 0, W: 0 };
    m.apertures.forEach(function (a) { if (counts[a.side] != null) counts[a.side]++; });
    var side = Object.keys(counts).sort(function (a, b) { return counts[a] - counts[b]; })[0];
    ap = makeAperture({ name: 'Window ' + (m.apertures.filter(function (a) { return a.kind === 'window'; }).length + 1),
      side: side, w: 1.5, h: 1.5, sill: 0.9, offset: 0 });
  }
  m.apertures.push(ap);
  UI.selectedAperture = ap.id;
  var ex = $('#panel-openings'); if (ex) ex.setAttribute('open', '');
  this.markDirty('geometry');
  UI.sync();
  this.toast('Added ' + ap.name + '.');
};

App.duplicateAperture = function (idx) {
  var a = this.model.apertures[idx];
  if (!a) return;
  var copy = makeAperture(JSON.parse(JSON.stringify(a)));
  copy.name = a.name + ' copy';
  copy.offset = a.offset + a.w + 0.3;
  this.model.apertures.splice(idx + 1, 0, copy);
  UI.selectedAperture = copy.id;
  this.markDirty('geometry');
  UI.sync();
};

App.deleteAperture = function (idx) {
  var a = this.model.apertures[idx];
  if (!a) return;
  this.model.apertures.splice(idx, 1);
  if (UI.selectedAperture === a.id) UI.selectedAperture = null;
  this.markDirty('geometry');
  UI.sync();
  this.toast('Deleted ' + a.name + '.');
};

App.applyShadingToAll = function (which) {
  var n = 0;
  this.model.apertures.forEach(function (a) {
    if (a.kind === 'door') return;
    if (!a.shading) a.shading = defaultShading();
    a.shading[which].on = true;
    n++;
  });
  this.markDirty('geometry');
  UI.sync();
  this.toast('Applied to ' + n + ' opening' + (n === 1 ? '' : 's') + '.');
};
App.clearAllShading = function () {
  this.model.apertures.forEach(function (a) {
    if (a.shading) { a.shading.h.on = false; a.shading.v.on = false; }
  });
  this.markDirty('geometry');
  UI.sync();
};

/* --- presets, scenarios, reset ------------------------------------------- */

App.resetModel = function () {
  this.model = defaultModel();
  UI.selectedAperture = null;
  this.display.roofRemoved = false;
  this.updateSunObject();
  this.markDirty('geometry');
  this.view.frame();
  this.applySun();
  UI.sync();
  this.toast('Reset to the default studio classroom.');
};

App.applyPreset = function (p) {
  var m = this.model;
  p.apply(m);
  m.name = p.title;
  UI.selectedAperture = m.apertures.length ? m.apertures[0].id : null;
  this.markDirty('geometry');
  this.view.frame();
  if (p.metric) this.setMetric(p.metric);
  UI.sync();
  this.toast(p.title + ' — ' + p.note);
};

App.scenarioKey = 'daylightlab.scenarios.v1';
App.loadScenarios = function () {
  try {
    var raw = localStorage.getItem(this.scenarioKey);
    this.scenarios = raw ? JSON.parse(raw) : [];
  } catch (e) { this.scenarios = []; }
};
App.persistScenarios = function () {
  try { localStorage.setItem(this.scenarioKey, JSON.stringify(this.scenarios)); }
  catch (e) { this.toast('Could not save — browser storage is unavailable here.', 'err'); }
};
App.saveScenario = function () {
  var name = prompt('Name for this scenario:', this.model.name || 'Scenario ' + (this.scenarios.length + 1));
  if (!name) return;
  var sc = {
    name: name,
    model: JSON.parse(exportJson(this.model)).model,
    metric: this.metric,
    summary: this.stats ? num(this.stats.mean, METRICS[this.metric].decimals) + ' ' + tickUnit(METRICS[this.metric]) : '',
    stats: this.stats, compliance: this.compliance,
    grid: { nx: this.grid.nx, nz: this.grid.nz, x0: this.grid.x0, z0: this.grid.z0, spacing: this.grid.spacing, y: this.grid.y },
    field: this.field ? Array.prototype.slice.call(this.field) : null,
    scaleMin: this.scale ? this.scale.min : 0, scaleMax: this.scale ? this.scale.max : 1,
    ramp: this.scale ? this.scale.ramp : 'viridis'
  };
  this.scenarios.push(sc);
  if (this.scenarios.length > 12) this.scenarios.shift();
  this.persistScenarios();
  UI.sync();
  this.toast('Saved “' + name + '”.', 'ok');
};
App.loadScenario = function (i) {
  var sc = this.scenarios[i];
  if (!sc) return;
  try {
    this.model = importJson(JSON.stringify({ model: sc.model }));
    UI.selectedAperture = null;
    this.updateSunObject();
    this.markDirty('geometry');
    this.applySun();
    if (sc.metric) this.setMetric(sc.metric);
    this.view.frame();
    UI.sync();
    this.toast('Loaded “' + sc.name + '”.');
  } catch (e) { this.toast('Could not load that scenario: ' + e.message, 'err'); }
};
App.deleteScenario = function (i) {
  this.scenarios.splice(i, 1);
  this.persistScenarios();
  UI.sync();
};

/** Side-by-side comparison of two saved scenarios. */
App.openCompare = function () {
  if (this.scenarios.length < 2) {
    this.toast('Save at least two scenarios first, then compare them.', 'err');
    return;
  }
  var opts = this.scenarios.map(function (s, i) { return '<option value="' + i + '">' + s.name + '</option>'; }).join('');
  openModal('Compare scenarios',
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
    '<div><select id="cmp-a" style="width:100%">' + opts + '</select><div id="cmp-a-body"></div></div>' +
    '<div><select id="cmp-b" style="width:100%">' + opts + '</select><div id="cmp-b-body"></div></div>' +
    '</div><div id="cmp-diff"></div>');
  $('#cmp-b').value = String(Math.min(1, this.scenarios.length - 1));
  var draw = function () { App.renderCompare(); };
  $('#cmp-a').addEventListener('change', draw);
  $('#cmp-b').addEventListener('change', draw);
  draw();
};

App.renderCompare = function () {
  var a = this.scenarios[+$('#cmp-a').value], b = this.scenarios[+$('#cmp-b').value];
  var self = this;
  [['a', a], ['b', b]].forEach(function (pair) {
    var host = $('#cmp-' + pair[0] + '-body'), sc = pair[1];
    host.innerHTML = '';
    if (!sc) return;
    var cv = el('canvas', { width: 260, height: 190, style: 'width:100%;height:auto;border:1px solid var(--line);border-radius:5px;margin-top:8px;display:block' });
    host.appendChild(cv);
    drawFieldMini(cv, sc);
    var M = METRICS[sc.metric] || METRICS.df;
    var t = el('table');
    var rows = [['Metric', M.label]];
    if (sc.stats) rows.push(
      ['Mean', num(sc.stats.mean, M.decimals) + ' ' + tickUnit(M)],
      ['Min', num(sc.stats.min, M.decimals)],
      ['Max', num(sc.stats.max, M.decimals)],
      ['Uniformity', sc.stats.uniformity.toFixed(2)]);
    if (sc.compliance) rows.push(
      ['sDA', sc.compliance.sda.toFixed(0) + '%'],
      ['ASE', sc.compliance.ase.toFixed(0) + '%']);
    rows.push(['Room', m2(sc.model.room.L) + ' × ' + m2(sc.model.room.W) + ' × ' + m2(sc.model.room.H) + ' m']);
    rows.push(['Openings', String(sc.model.apertures.filter(function (x) { return x.enabled !== false; }).length)]);
    t.innerHTML = rows.map(function (r) { return '<tr><td>' + r[0] + '</td><td class="n">' + r[1] + '</td></tr>'; }).join('');
    host.appendChild(t);
  });

  var diff = $('#cmp-diff');
  diff.innerHTML = '';
  if (a && b && a.stats && b.stats && a.metric === b.metric) {
    var M2 = METRICS[a.metric];
    var dm = b.stats.mean - a.stats.mean;
    var pct = a.stats.mean ? 100 * dm / a.stats.mean : 0;
    diff.innerHTML = '<h3>Difference (B − A)</h3><p>Mean ' + M2.label + ': <b>' +
      (dm >= 0 ? '+' : '') + num(dm, M2.decimals) + ' ' + tickUnit(M2) +
      '</b> (' + (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%). Uniformity ' +
      a.stats.uniformity.toFixed(2) + ' → <b>' + b.stats.uniformity.toFixed(2) + '</b>.</p>';
  } else if (a && b) {
    diff.innerHTML = '<p class="cite">The two scenarios were saved with different metrics, so only the models can be compared directly.</p>';
  }
};

/** Small top-down heatmap of a saved scenario's field. */
function drawFieldMini(canvas, sc) {
  var g = canvas.getContext('2d');
  g.fillStyle = cssVar('--panel-2') || '#eee';
  g.fillRect(0, 0, canvas.width, canvas.height);
  if (!sc.field || !sc.grid) return;
  var nx = sc.grid.nx, nz = sc.grid.nz;
  var pad = 8;
  var cw = (canvas.width - pad * 2) / nx, chh = (canvas.height - pad * 2) / nz;
  var s = Math.min(cw, chh);
  var ox = (canvas.width - s * nx) / 2, oy = (canvas.height - s * nz) / 2;
  var scale = { min: sc.scaleMin, max: sc.scaleMax, ramp: sc.ramp, reverse: false };
  for (var j = 0; j < nz; j++) for (var i = 0; i < nx; i++) {
    var c = scaleColor(scale, sc.field[j * nx + i]);
    g.fillStyle = rgb2hex(c.r, c.g, c.b);
    g.fillRect(ox + i * s, oy + j * s, Math.ceil(s), Math.ceil(s));
  }
  g.strokeStyle = cssVar('--line') || '#ccc';
  g.strokeRect(ox, oy, s * nx, s * nz);
}

/* --- export -------------------------------------------------------------- */

App.exportMeta = function () {
  var m = this.model, a = m.analysis;
  var out = [
    ['Location', m.site.city],
    ['Lat / Lon', m2(m.site.lat) + '° / ' + m2(m.site.lon) + '°'],
    ['Date / time', dateLabel(m.when.month, m.when.day) + '  ' + hhmm(m.when.hour)],
    ['Engine', a.engine === 'raytrace' ? 'Raytraced DC · ' + QUALITY[a.quality].label : 'Split-flux (BRE)'],
    ['Sky', (SKY_MODELS[a.skyModel] || {}).label],
    ['Climate', this.climate ? this.climate.name : '—'],
    ['Room', m2(m.room.L) + ' × ' + m2(m.room.W) + ' × ' + m2(m.room.H) + ' m'],
    ['Thickness', 'w ' + m2(m.room.tWall) + ' · r ' + m2(m.room.tRoof) + ' · f ' + m2(m.room.tFloor) + ' m'],
    ['Grid', this.grid.nx + ' × ' + this.grid.nz + ' @ ' + m2(m.grid.spacing) + ' m, h ' + m2(m.grid.height) + ' m'],
    ['Reflectance', 'f ' + m2(m.room.refl.floor) + ' · w ' + m2(m.room.refl.wall) + ' · c ' + m2(m.room.refl.ceiling)]
  ];
  if (METRICS[this.metric].annual) {
    out.push(['UDI bins', m.analysis.udi.join(' / ') + ' lx']);
    out.push(['Target', num(a.targetLux) + ' lx, ' + a.occStart + ':00–' + a.occEnd + ':00']);
  }
  return out;
};

App.exportImage = function () {
  if (!this.result) { this.toast('Calculate something first.', 'err'); return; }
  var name = exportImage(this.view, {
    metric: this.metric, scale: this.scale, stats: this.stats,
    analysis: this.model.analysis, compliance: this.compliance,
    when: this.model.when, model: this.model,
    udiView: this.udiView || 'useful',
    northAngle: this.model.room.northAngle,
    meta: this.exportMeta(),
    labels: this.exportOpts.showValues ? this.currentValueLabels() : null,
    dimLabels: this.exportOpts.showDimensions ? this.currentDimensionLabels() : null
  }, this.exportOpts);
  this.toast('Exported ' + name, 'ok');
};

App.exportCsv = function () {
  if (!this.field) { this.toast('Nothing to export yet.', 'err'); return; }
  var meta = {};
  this.exportMeta().forEach(function (r) { meta[r[0]] = r[1]; });
  meta['Copyright'] = COPYRIGHT;
  download('daylight-lab-' + this.metric + '.csv',
    gridToCsv(this.result, this.metric, this.field, meta), 'text/csv');
  this.toast('Grid exported as CSV.', 'ok');
};

App.exportModel = function () {
  download('daylight-lab-model.json', exportJson(this.model, {
    metric: this.metric, display: this.display, rays: this.rays
  }), 'application/json');
  this.toast('Model exported as JSON.', 'ok');
};

App.loadModelFile = function (file) {
  var self = this, fr = new FileReader();
  fr.onload = function () {
    try {
      self.model = importJson(String(fr.result));
      UI.selectedAperture = null;
      self.updateSunObject();
      self.markDirty('geometry');
      self.applySun();
      self.view.frame();
      UI.sync();
      self.toast('Model loaded.', 'ok');
    } catch (e) { self.toast('Could not load that model: ' + e.message, 'err'); }
  };
  fr.readAsText(file);
};

/* --- overlay labels ------------------------------------------------------ */

/** Workplane value labels, in canvas pixels — reused by the PNG export. */
/** Measure a string at the value-label font, for collision thinning. */
App._measure = function (text) {
  var c = this._measureCtx;
  if (!c) {
    c = this._measureCtx = document.createElement('canvas').getContext('2d');
    c.font = '600 9.5px ui-monospace, SFMono-Regular, monospace';
  }
  return c.measureText(text).width;
};

App.currentValueLabels = function () {
  if (!this.field || !this.grid) return [];
  var g = this.grid;
  // Decimals: fall back to what the metric itself calls for, so illuminance
  // reads 1,747 rather than 1,747.4 and the labels stay narrow.
  var dec = this.display.decimals == null
    ? (METRICS[this.metric] ? METRICS[this.metric].decimals : 1)
    : this.display.decimals;

  /*
   * Thin the labels until they stop colliding. A 16-column grid across a plan
   * view puts the points ~70 px apart, which four-digit lux values overrun —
   * so measure the widest label, compare it with the actual on-screen pitch,
   * and skip points until they fit.
   */
  var step = Math.max(1, this.display.labelEvery | 0);
  var a = {}, bx = {}, bz = {};
  this.view.project(g.x0, g.y, g.z0, a);
  this.view.project(g.x0 + g.spacing, g.y, g.z0, bx);
  this.view.project(g.x0, g.y, g.z0 + g.spacing, bz);
  var pitchX = Math.hypot(bx.x - a.x, bx.y - a.y);
  var pitchZ = Math.hypot(bz.x - a.x, bz.y - a.y);
  var st = describe(this.field);
  var wide = this._measure(num(st.max, dec)) + 7;
  if (pitchX > 0.5) step = Math.max(step, Math.ceil(wide / pitchX));
  var stepZ = pitchZ > 0.5 ? Math.max(1, Math.ceil(13 / pitchZ)) : 1;

  var out = [], p = {};
  var y = g.y + 0.02 + (this.display.style === 'relief' ? Math.min(1.5, this.model.room.H * 0.4) : 0);
  var budget = 900;
  for (var j = 0; j < g.nz; j += stepZ) {
    for (var i = 0; i < g.nx; i += step) {
      if (out.length >= budget) return out;
      var v = this.field[j * g.nx + i];
      var yy = this.display.style === 'relief'
        ? g.y + 0.02 + Math.min(1.5, this.model.room.H * 0.4) * scaleT(this.scale, v)
        : g.y + 0.02;
      this.view.project(g.x0 + i * g.spacing, yy, g.z0 + j * g.spacing, p);
      if (!p.visible) continue;
      out.push({ x: p.x, y: p.y, text: num(v, dec) });
    }
  }
  return out;
};

/** Dimension labels in canvas pixels, mirroring currentValueLabels(). */
/**
 * Dimension labels in canvas pixels, mirroring currentValueLabels().
 *
 * Openings close together project their labels on top of each other, so a
 * greedy pass drops any label whose box would overlap one already placed.
 */
App.currentDimensionLabels = function () {
  var out = [], p = {};
  for (var k = 0; k < this.dims.length; k++) {
    var d = this.dims[k];
    if (!this.display.dims[d.group]) continue;
    var gm = dimGeometry(d);
    this.view.project(gm.mid[0], gm.mid[1], gm.mid[2], p);
    if (!p.visible) continue;
    var text = m2(d.value) + (d.unit === 'm' ? '' : d.unit);
    var w = this._measure(text) + 12, h = 16;
    var clash = false;
    for (var q = 0; q < out.length; q++) {
      if (Math.abs(out[q].x - p.x) < (out[q].w + w) / 2 &&
          Math.abs(out[q].y - p.y) < h) { clash = true; break; }
    }
    if (clash) continue;
    out.push({ x: p.x, y: p.y, text: text, w: w, dim: d });
  }
  return out;
};

App.refreshLabels = function () {
  var host = $('#labels');
  var frag = document.createDocumentFragment();

  if (this.display.showValues && this.field) {
    var vl = this.currentValueLabels();
    for (var i = 0; i < vl.length; i++) {
      frag.appendChild(el('div', {
        style: 'left:' + vl[i].x.toFixed(1) + 'px;top:' + vl[i].y.toFixed(1) + 'px', text: vl[i].text
      }));
    }
  }

  var p = {};
  var dl = this.currentDimensionLabels();
  for (var k = 0; k < dl.length; k++) {
    (function (L) {
      var d = L.dim;
      var node = el('div', {
        class: 'dim',
        style: 'left:' + L.x.toFixed(1) + 'px;top:' + L.y.toFixed(1) + 'px',
        text: L.text,
        title: d.label + (d.editable ? ' — click to edit' : '')
      });
      if (d.editable) node.addEventListener('click', function (e) { e.stopPropagation(); App.openDimEdit(d, node); });
      frag.appendChild(node);
    })(dl[k]);
  }

  // sun-path compass letters
  if (this.display.showSunPath && this.view.mode === '3d' && this.view.gSun.userData.labels) {
    var labs = this.view.gSun.userData.labels;
    for (var q = 0; q < labs.length; q++) {
      this.view.project(labs[q].pos[0], labs[q].pos[1], labs[q].pos[2], p);
      if (!p.visible) continue;
      frag.appendChild(el('div', {
        class: 'tag', style: 'left:' + p.x.toFixed(1) + 'px;top:' + p.y.toFixed(1) + 'px', text: labs[q].text
      }));
    }
  }

  host.innerHTML = '';
  host.appendChild(frag);
  this.dirty.labels = false;
};

/* --- editing a dimension in the viewport --------------------------------- */

App.openDimEdit = function (d, node) {
  var box = $('#dimedit'), input = $('#dimedit-input');
  var r = node.getBoundingClientRect(), sr = $('#stage').getBoundingClientRect();
  box.classList.add('on');
  box.style.left = clamp(r.left - sr.left - 24, 6, sr.width - 190) + 'px';
  box.style.top = clamp(r.top - sr.top - 36, 6, sr.height - 44) + 'px';
  $('#dimedit-unit').textContent = d.unit;
  input.step = d.step; input.min = d.min; input.max = d.max;
  input.value = (+d.value).toFixed(d.step < 0.01 ? 3 : 2);
  input.focus(); input.select();
  App._editing = d;
};
App.commitDimEdit = function () {
  var d = App._editing;
  if (!d) return;
  var v = parseFloat($('#dimedit-input').value);
  App.closeDimEdit();
  if (!isFinite(v)) return;
  d.set(clamp(v, d.min, d.max));
  App.markDirty('geometry');
  UI.sync();
};
App.closeDimEdit = function () {
  $('#dimedit').classList.remove('on');
  App._editing = null;
};

/* --- viewport chrome ----------------------------------------------------- */

function buildMetricTabs() {
  var host = $('#metric-tabs');
  host.innerHTML = '';
  ['illuminance', 'df', 'udi', 'da', 'ase', 'sunhours'].forEach(function (k) {
    var b = el('button', {
      type: 'button', role: 'tab', text: METRICS[k].short,
      title: METRICS[k].label + (METRICS[k].annual ? ' — annual, takes a few seconds' : ''),
      'aria-selected': String(k === App.metric)
    });
    b.dataset.metric = k;
    b.addEventListener('click', function () { App.setMetric(k); });
    b.addEventListener('dblclick', function () { App.openInfo(METRICS[k].about); });
    host.appendChild(b);
  });
}

var ICONS = {
  cube: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.3 7 12 12 20.7 7"/><line x1="12" y1="22" x2="12" y2="12"/>',
  plan: '<rect x="3" y="3" width="18" height="18" rx="1.5"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="10" y1="10" x2="10" y2="21"/>',
  elev: '<path d="M3 21h18"/><path d="M5 21V9l7-5 7 5v12"/><rect x="9" y="12" width="6" height="5"/>',
  fit: '<polyline points="4 9 4 4 9 4"/><polyline points="20 9 20 4 15 4"/><polyline points="4 15 4 20 9 20"/><polyline points="20 15 20 20 15 20"/>',
  zoomIn: '<circle cx="11" cy="11" r="7"/><line x1="16.2" y1="16.2" x2="21" y2="21"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>',
  zoomOut: '<circle cx="11" cy="11" r="7"/><line x1="16.2" y1="16.2" x2="21" y2="21"/><line x1="8" y1="11" x2="14" y2="11"/>',
  roof: '<path d="M2 11 12 3l10 8"/><path d="M5 11v9h14v-9"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  ruler: '<rect x="2" y="8" width="20" height="8" rx="1.5"/><path d="M7 8v3M11 8v4M15 8v3M19 8v4"/>',
  values: '<path d="M4 7h16M4 12h16M4 17h10"/>',
  compass: '<circle cx="12" cy="12" r="9"/><polygon points="16 8 10.5 10.5 8 16 13.5 13.5"/>',
  hand: '<path d="M9 11V5.6a1.3 1.3 0 0 1 2.6 0V11"/><path d="M11.6 10.6V4.4a1.3 1.3 0 0 1 2.6 0v6.2"/><path d="M14.2 11V6.4a1.3 1.3 0 0 1 2.6 0V14"/><path d="M9 11V9.2a1.3 1.3 0 0 0-2.6 0v4.6c0 3.4 2.3 6.2 5.6 6.2h1c3 0 4.8-2.2 4.8-5.2"/>',
  clean: '<path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6z"/><circle cx="12" cy="12" r="2.6"/><line x1="3.5" y1="20.5" x2="20.5" y2="3.5"/>'
};
function vtBtn(icon, title, onClick, isOn) {
  var b = el('button', {
    class: 'btn icon', title: title, type: 'button',
    html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + ICONS[icon] + '</svg>'
  });
  b.addEventListener('click', onClick);
  if (isOn) reg(function () { b.classList.toggle('on', !!isOn()); });
  return b;
}

function buildViewTools() {
  var host = $('#viewtools');
  host.innerHTML = '';
  host.appendChild(vtBtn('cube', '3D view', function () { App.setViewMode('3d'); }, function () { return App.display.viewMode === '3d'; }));
  host.appendChild(vtBtn('plan', 'Plan view — looks down at the workplane with the roof still closed in the calculation',
    function () { App.setViewMode('plan'); }, function () { return App.display.viewMode === 'plan'; }));
  host.appendChild(vtBtn('elev', 'Elevation', function () { App.setViewMode('elev'); }, function () { return App.display.viewMode === 'elev'; }));
  host.appendChild(el('div', { class: 'vt-sep' }));
  host.appendChild(vtBtn('hand', 'Pan the model (H) — drag to slide it around the screen. Hold Space for the same thing without leaving the pointer.',
    function () { App.setHandTool(!App.display.handTool); },
    function () { return App.display.handTool; }));
  host.appendChild(vtBtn('zoomIn', 'Zoom in', function () { App.zoomBy(0.8); }));
  host.appendChild(vtBtn('zoomOut', 'Zoom out', function () { App.zoomBy(1.25); }));
  host.appendChild(vtBtn('fit', 'Fit the model in view', function () { App.fitView(); }));
  host.appendChild(vtBtn('compass', 'Cycle standard views', function () { App.cycleView(); }));
  host.appendChild(el('div', { class: 'vt-sep' }));
  host.appendChild(vtBtn('roof', 'Hide the roof (O) — view only, it stays in the calculation',
    function () { App.display.hideRoof = !App.display.hideRoof; App.markDirty('visibility'); App.refreshDisplay(); UI.sync(); },
    function () { return App.display.hideRoof; }));
  host.appendChild(vtBtn('sun', 'Solar rays',
    function () { App.rays.enabled = !App.rays.enabled; App.markDirty('rays'); UI.sync(); },
    function () { return App.rays.enabled; }));
  host.appendChild(vtBtn('ruler', 'Dimensions',
    function () {
      var any = DIM_GROUPS.some(function (g) { return App.display.dims[g]; });
      DIM_GROUPS.forEach(function (g) { App.display.dims[g] = !any; });
      App.markDirty('dims'); UI.sync();
    },
    function () { return DIM_GROUPS.some(function (g) { return App.display.dims[g]; }); }));
  host.appendChild(vtBtn('values', 'Show values on the workplane',
    function () { App.display.showValues = !App.display.showValues; App.markDirty('labels'); UI.sync(); },
    function () { return App.display.showValues; }));
  host.appendChild(el('div', { class: 'vt-sep' }));
  host.appendChild(vtBtn('clean', 'Clean view (C) — hide every floating panel and leave just the model',
    function () { App.setCleanView(!App.display.cleanView); },
    function () { return App.display.cleanView; }));
}

/**
 * A fold chevron on each floating panel's title bar. On a laptop the four
 * panels take a quarter of the viewport; folding one leaves its title bar so
 * it can be brought back without hunting for a menu.
 */
function initHudFolds() {
  ['legend', 'stats', 'solarhud'].forEach(function (id) {
    var hud = $('#' + id), head = hud && hud.querySelector('.hud-head');
    if (!head) return;
    var b = el('button', {
      class: 'hud-fold', type: 'button', title: 'Collapse', 'aria-label': 'Collapse panel',
      html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" ' +
        'stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>'
    });
    head.appendChild(b);
    head.addEventListener('click', function () {
      var off = hud.classList.toggle('collapsed');
      b.title = off ? 'Expand' : 'Collapse';
      App.dirty.labels = true;
    });
  });
}

/* --- viewport navigation -------------------------------------------------- */

/**
 * The hand tool. While it is on a plain left-drag pans, and aperture dragging
 * stands down so navigating cannot nudge a window by accident.
 */
App.setHandTool = function (on) {
  this.display.handTool = !!on;
  this.view.ctl.setHand(!!on);
  UI.sync();
};
/** Space held: pan for as long as it is down, without changing the toggle. */
App.setHandTemp = function (on) {
  if (this.view.ctl.handTemp === !!on) return;
  this.view.ctl.setHandTemp(!!on);
};

/** Clean view: every floating overlay out of the way but the toolbar. */
App.setCleanView = function (on) {
  this.display.cleanView = !!on;
  $('#stage').classList.toggle('clean', !!on);
  UI.sync();
  var self = this;
  setTimeout(function () { self.dirty.labels = true; }, 20);
};

/** Zoom step shared by the toolbar buttons and the keyboard. */
App.zoomBy = function (f) {
  this.view.ctl.zoom(f);
  this.view.ctl.apply();
  this.dirty.labels = true;
};

/** Fit: reframes the perspective camera, or resets an orthographic view. */
App.fitView = function () {
  if (this.view.ctl.ortho) this.view.orthoReset();
  else this.view.frame();
  this.dirty.labels = true;
};

App._viewCycle = 0;
App.cycleView = function () {
  var order = ['iso', 'south', 'west', 'north', 'east', 'top', 'sw'];
  this.view.setStandardView(order[this._viewCycle++ % order.length]);
  this.dirty.labels = true;
};
App.setViewMode = function (mode) {
  this.display.viewMode = mode;
  this.view.setViewMode(mode, this.visibilityOpts());
  this.dirty.labels = true;
  this.refreshDisplay();
  UI.sync();
};

/* --- time bar ------------------------------------------------------------ */

App.refreshTimebar = function () {
  var m = this.model, s = this.sun;
  $('#tb-date').textContent = dateLabel(m.when.month, m.when.day);
  $('#tb-time').textContent = hhmm(m.when.hour);
  $('#tb-sun').textContent = s.up
    ? 'alt ' + deg(s.altitude, 0) + ' · azi ' + deg(s.azimuth, 0)
    : 'sun below horizon';
  if (document.activeElement !== $('#tb-hour')) $('#tb-hour').value = Math.round(m.when.hour * 60);
  if (document.activeElement !== $('#tb-doy')) $('#tb-doy').value = doy(m.when.month, m.when.day);
  var rise = isFinite(s.sunrise) ? s.sunrise + (m.site.dst ? 1 : 0) : 0;
  var set = isFinite(s.sunset) ? s.sunset + (m.site.dst ? 1 : 0) : 24;
  var bar = $('#tb-daylight');
  bar.style.left = (clamp(rise, 0, 24) / 24 * 100).toFixed(2) + '%';
  bar.style.width = (clamp(set - rise, 0, 24) / 24 * 100).toFixed(2) + '%';
};

App.toggleAnimate = function (kind) {
  if (this.animating === kind) { this.animating = null; }
  else { this.animating = kind; }
  var day = $('#anim-day'), yr = $('#anim-year');
  if (day) day.textContent = this.animating === 'day' ? '■ Stop' : '▶ Animate day';
  if (yr) yr.textContent = this.animating === 'year' ? '■ Stop' : '▶ Animate year';
};
App.stepAnimation = function (dt) {
  if (!this.animating) return;
  var w = this.model.when;
  if (this.animating === 'day') {
    w.hour += dt * 2.2;
    if (w.hour >= 24) w.hour -= 24;
  } else {
    var n = doy(w.month, w.day) + dt * 24;
    if (n > 365) n -= 365;
    var md = fromDoy(n);
    w.month = md.month; w.day = md.day;
  }
  this.updateSunObject();
  this.applySun();
  this.dirty.slice = true;
  this.dirty.labels = true;
  if (!this.busy) this.schedule(0);
};

/* --- dragging an opening --------------------------------------------------
   Openings are draggable at any time, with no mode to turn on first. Three
   guards keep that from fighting the camera:
     * a modifier or a non-primary button always means orbit/pan, never move
     * a 4 px threshold, so a click that does not travel only selects
     * touch needs a ~300 ms press-and-hold, so a swipe still orbits
   Every move is undoable with Ctrl/Cmd+Z.                                   */

var DRAG_THRESHOLD = 4;        // px before a press becomes a move
var DRAG_SNAP = 0.05;          // m; hold Alt for free placement
var TOUCH_HOLD_MS = 300;

/** True when this press should be left to the camera controls. */
function pressIsCameraGesture(e) {
  return e.button !== 0 || e.shiftKey || e.ctrlKey || e.metaKey;
}

App.initApertureDrag = function () {
  var self = this, canvas = $('#view');

  // OrbitCtl asks first; returning true means we have taken the press
  this.view.ctl.claim = function (e) {
    // while the hand tool is navigating, nothing in the model is draggable
    if (self.view.ctl.panning()) return false;
    if (pressIsCameraGesture(e)) return false;
    var hit = self.view.pickAperture(self.model, e.clientX, e.clientY);
    if (!hit) return false;

    if (e.pointerType === 'touch') {
      // let the camera keep the gesture until the hold completes
      self._touchHold = {
        id: e.pointerId, x: e.clientX, y: e.clientY, hit: hit,
        timer: setTimeout(function () {
          self._touchHold = null;
          self.view.ctl.suspend = true;      // cancel the orbit in flight
          self.startDrag(hit, e.clientX, e.clientY, e.pointerId);
        }, TOUCH_HOLD_MS)
      };
      return false;
    }
    canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
    self.startDrag(hit, e.clientX, e.clientY, e.pointerId);
    e.preventDefault();
    return true;
  };

  canvas.addEventListener('pointermove', function (e) {
    if (self.drag) { self.moveDrag(e); return; }
    if (self._touchHold && e.pointerId === self._touchHold.id) {
      // a finger that travels is a swipe, not a hold
      if (Math.hypot(e.clientX - self._touchHold.x, e.clientY - self._touchHold.y) > 6) {
        clearTimeout(self._touchHold.timer);
        self._touchHold = null;
      }
      return;
    }
    if (e.buttons) return;                   // orbiting — do not re-pick
    self.updateHover(e.clientX, e.clientY);
  });

  ['pointerup', 'pointercancel'].forEach(function (t) {
    canvas.addEventListener(t, function (e) {
      if (self._touchHold) { clearTimeout(self._touchHold.timer); self._touchHold = null; }
      if (self.drag) self.endDrag(e);
    });
  });
  canvas.addEventListener('pointerleave', function () {
    if (!self.drag) self.updateHover(null, null);
  });
};

/** Highlight whatever opening the pointer is over. */
App.updateHover = function (x, y) {
  if (this.view.ctl.panning()) x = null;   // the hand tool owns the cursor
  var hit = x == null ? null : this.view.pickAperture(this.model, x, y);
  var ap = hit ? hit.aperture : null;
  if (ap === this.hover) return;
  this.hover = ap;
  this.view.highlightAperture(this.model, ap, false);
  $('#view').classList.toggle('over-aperture', !!ap);
};

/** The plane an opening slides in: its slab's mid-depth face plane. */
function aperturePlane(F) {
  var n = new THREE.Vector3(F.N[0], F.N[1], F.N[2]);
  var o = fpt(F, 0, 0, F.t / 2);
  return new THREE.Plane().setFromNormalAndCoplanarPoint(n, new THREE.Vector3(o[0], o[1], o[2]));
}
/** Where a ray meets that plane, in the face's own (u, v). Null if edge-on. */
function rayToFaceUV(ray, F, plane) {
  var d = ray.ray.direction;
  if (Math.abs(d.x * F.N[0] + d.y * F.N[1] + d.z * F.N[2]) < 0.15) return null;
  var hit = ray.ray.intersectPlane(plane, new THREE.Vector3());
  if (!hit) return null;
  var L = toLocal(F, [hit.x, hit.y, hit.z]);
  return { u: L.u, v: L.v };
}

App.startDrag = function (hit, x, y, pointerId) {
  var ap = hit.aperture, F = frameFor(ap.side, this.model.room);
  var plane = aperturePlane(F);
  var uv = rayToFaceUV(hit.ray, F, plane);
  if (!uv) {
    this.toast('That opening is edge-on to the camera — orbit round to move it.', 'err');
    return;
  }
  this.drag = {
    ap: ap, F: F, plane: plane, pointerId: pointerId,
    u0: uv.u, v0: uv.v, x0: x, y0: y, moved: false,
    offset0: ap.offset, sill0: ap.sill, offset20: ap.offset2
  };
  UI.selectedAperture = ap.id;
  this.hover = ap;
  this.view.highlightAperture(this.model, ap, true);
  $('#view').classList.add('dragging');
  UI.sync();
};

App.moveDrag = function (e) {
  var d = this.drag;
  if (!d || (d.pointerId != null && e.pointerId !== d.pointerId)) return;
  if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < DRAG_THRESHOLD) return;
  if (!d.moved) { d.moved = true; this.pushUndo(d.ap); }

  var uv = rayToFaceUV(this.view.pointerRay(e.clientX, e.clientY), d.F, d.plane);
  if (!uv) return;

  var snap = e.altKey ? 0 : DRAG_SNAP;
  var q = function (v) { return snap ? Math.round(v / snap) * snap : v; };
  var ap = d.ap, R = this.model.room;

  ap.offset = q(d.offset0 + (uv.u - d.u0));
  if (ap.side === 'roof') {
    ap.offset2 = q(d.offset20 + (uv.v - d.v0));
  } else {
    ap.sill = q(d.sill0 + (uv.v - d.v0));
    // a door wants to stay on the floor unless it is deliberately lifted
    if (ap.kind === 'door' && Math.abs(ap.sill) < 0.1) ap.sill = 0;
  }
  clampAperture(ap, R);

  // rebuild the meshes now so the opening tracks the pointer with no lag; the
  // analysis is debounced separately and drops to preview quality
  this.rebuildGeometry();
  this.view.highlightAperture(this.model, ap, true);
  this.showDragChip(e.clientX, e.clientY, ap);
  this.markDirty('bake', true);
};

App.endDrag = function (e) {
  var d = this.drag;
  if (!d) return;
  this.drag = null;
  $('#view').classList.remove('dragging');
  $('#dragchip').classList.remove('on');
  this.view.highlightAperture(this.model, this.hover, false);

  if (!d.moved) {                          // a click, not a drag: just select
    var ex = $('#panel-openings'); if (ex) ex.setAttribute('open', '');
    this.toast('Selected ' + d.ap.name + ' — drag it to move it.');
    this.markDirty('dims');
    UI.sync();
    return;
  }
  this.live = false;
  this.markDirty('geometry');
  UI.sync();
  this.toast('Moved ' + d.ap.name + ' — Ctrl+Z to undo.', 'ok');
};

App.showDragChip = function (x, y, ap) {
  var chip = $('#dragchip'), r = $('#stage').getBoundingClientRect();
  chip.classList.add('on');
  chip.style.left = (x - r.left) + 'px';
  chip.style.top = (y - r.top) + 'px';
  chip.innerHTML = ap.side === 'roof'
    ? '<i>X</i> <b>' + m2(ap.offset) + '</b> m &nbsp; <i>Z</i> <b>' + m2(ap.offset2) + '</b> m'
    : '<i>offset</i> <b>' + m2(ap.offset) + '</b> m &nbsp; <i>sill</i> <b>' + m2(ap.sill) + '</b> m';
};

/* --- undo for moves ------------------------------------------------------ */

App.pushUndo = function (ap) {
  this.undoStack.push({
    id: ap.id, name: ap.name,
    offset: ap.offset, sill: ap.sill, offset2: ap.offset2
  });
  if (this.undoStack.length > 20) this.undoStack.shift();
};

App.undoMove = function () {
  var u = this.undoStack.pop();
  if (!u) { this.toast('Nothing to undo.'); return; }
  var ap = null, aps = this.model.apertures;
  for (var i = 0; i < aps.length; i++) if (aps[i].id === u.id) ap = aps[i];
  if (!ap) { this.toast('That opening no longer exists.', 'err'); return; }
  ap.offset = u.offset; ap.sill = u.sill; ap.offset2 = u.offset2;
  this.markDirty('geometry');
  UI.sync();
  this.toast('Undid the move of ' + u.name + '.');
};

/* --- global wiring ------------------------------------------------------- */

function wireGlobalEvents() {
  $('#btn-run').addEventListener('click', function () {
    App.dirty.bake = true; App.dirty.slice = true;
    if (METRICS[App.metric].annual) App.dirty.annual = true;
    App.live = false;
    App.run();
  });
  $('#btn-export').addEventListener('click', function () {
    var p = $('#panel-export'); if (p) { p.setAttribute('open', ''); p.scrollIntoView({ block: 'nearest' }); }
    App.exportImage();
  });
  $('#btn-help').addEventListener('click', function () { App.openInfo('help'); });
  $('#modal-close').addEventListener('click', closeModal);
  $('#modal-body').addEventListener('click', function (e) {
    if (e.target && e.target.id === 'start-tour') { closeModal(); Tour.start(true); }
  });
  $('#modal-bg').addEventListener('click', function (e) { if (e.target === $('#modal-bg')) closeModal(); });

  $('#rail-toggle').addEventListener('click', function () {
    $('#app').classList.toggle('rail-collapsed');
    setTimeout(function () { App.view.resize(); App.dirty.labels = true; }, 20);
  });

  $('#tb-hour').addEventListener('input', function () {
    App.model.when.hour = +this.value / 60;
    App.updateSunObject(); App.applySun();
    App.dirty.slice = true; App.dirty.labels = true;
    App.live = true; App.schedule(90);
  });
  $('#tb-hour').addEventListener('change', function () { App.live = false; App.schedule(0); UI.sync(); });
  $('#tb-doy').addEventListener('input', function () {
    var md = fromDoy(+this.value);
    App.model.when.month = md.month; App.model.when.day = md.day;
    App.updateSunObject(); App.applySun();
    App.dirty.slice = true; App.dirty.labels = true;
    App.live = true; App.schedule(90);
  });
  $('#tb-doy').addEventListener('change', function () { App.live = false; App.schedule(0); UI.sync(); });

  $('#dimedit-ok').addEventListener('click', App.commitDimEdit);
  $('#dimedit-input').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') App.commitDimEdit();
    if (e.key === 'Escape') App.closeDimEdit();
  });
  $('#view').addEventListener('pointerdown', function () { App.closeDimEdit(); });

  $('#file-epw').addEventListener('change', function () {
    if (this.files && this.files[0]) App.loadEpwFile(this.files[0]);
    this.value = '';
  });
  $('#file-json').addEventListener('change', function () {
    if (this.files && this.files[0]) App.loadModelFile(this.files[0]);
    this.value = '';
  });

  // dropping an EPW or a model anywhere on the page loads it
  document.addEventListener('dragover', function (e) { e.preventDefault(); });
  document.addEventListener('drop', function (e) {
    e.preventDefault();
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f) return;
    if (/\.epw$/i.test(f.name)) App.loadEpwFile(f);
    else if (/\.json$/i.test(f.name)) App.loadModelFile(f);
  });

  // Hold Space to pan — the convention from every drawing application. It is
  // handled apart from the shortcut table because it needs the key release,
  // and because Space would otherwise scroll or re-fire a focused button.
  document.addEventListener('keydown', function (e) {
    if (e.key !== ' ' && e.code !== 'Space') return;
    if (/^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(e.target.tagName)) return;
    e.preventDefault();
    App.setHandTemp(true);
  });
  var releaseSpace = function (e) {
    if (e && e.type === 'keyup' && e.key !== ' ' && e.code !== 'Space') return;
    App.setHandTemp(false);
  };
  document.addEventListener('keyup', releaseSpace);
  window.addEventListener('blur', releaseSpace);

  document.addEventListener('keydown', function (e) {
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    var k = e.key.toLowerCase();
    if (k === 'z' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); App.undoMove(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (k === 'escape') { if (Tour.active) Tour.end(false); closeModal(); App.closeDimEdit(); }
    else if (Tour.active && (k === 'arrowright' || k === 'enter')) { e.preventDefault(); Tour.go(1); }
    else if (Tour.active && k === 'arrowleft') { e.preventDefault(); Tour.go(-1); }
    else if (k === 'f') App.fitView();
    else if (k === '+' || k === '=') App.zoomBy(0.8);
    else if (k === '-' || k === '_') App.zoomBy(1.25);
    else if (k === 'p') App.setViewMode(App.display.viewMode === 'plan' ? '3d' : 'plan');
    else if (k === 'r') { App.rays.enabled = !App.rays.enabled; App.markDirty('rays'); UI.sync(); }
    else if (k === 'd') {
      var any = DIM_GROUPS.some(function (g) { return App.display.dims[g]; });
      DIM_GROUPS.forEach(function (g) { App.display.dims[g] = !any; });
      App.markDirty('dims'); UI.sync();
    }
    else if (k === 'v') { App.display.showValues = !App.display.showValues; App.markDirty('labels'); UI.sync(); }
    else if (k === 'o') { App.display.hideRoof = !App.display.hideRoof; App.markDirty('visibility'); App.refreshDisplay(); UI.sync(); }
    else if (k === 'h') App.setHandTool(!App.display.handTool);
    else if (k === 'c') App.setCleanView(!App.display.cleanView);
    else if (k === '?') App.openInfo('help');
    else if (k >= '1' && k <= '6') App.setMetric(['illuminance', 'df', 'udi', 'da', 'ase', 'sunhours'][+k - 1]);
  });

  var ro = new ResizeObserver(function () { App.view.resize(); App.dirty.labels = true; });
  ro.observe($('#stage'));
  window.addEventListener('resize', function () { App.view.resize(); App.dirty.labels = true; });
}

/* --- render loop --------------------------------------------------------- */

function startRenderLoop() {
  var last = performance.now();
  (function frame(now) {
    var dt = Math.min(0.06, (now - last) / 1000);
    last = now;

    if (App.animating) App.stepAnimation(dt);

    if (App.dirty.sunpath) {
      if (App.display.showSunPath) {
        buildSunPath(App.view.gSun, App.view, App.model, App.sun, { sunSizeDeg: App.rays.sunSizeDeg });
      } else {
        disposeGroup(App.view.gSun);
      }
      App.view.gSun.visible = App.display.showSunPath && App.view.mode === '3d';
      App.dirty.sunpath = false;
      App.dirty.labels = true;
    }

    if (App.dirty.rays) {
      if (App.rays.enabled && App.bvh) {
        App.rayStats = buildSunRays(App.view.gRays, App.view, App.model, App.bvh,
          App.materials, App.sun, App.rays);
      } else {
        disposeGroup(App.view.gRays);
        App.rayStats = null;
      }
      App.dirty.rays = false;
    }

    if (App.dirty.dims) {
      App.dims = collectDimensions(App.model, App.built,
        UI.selectedAperture ? { apertureId: UI.selectedAperture } : null);
      buildDimensionLines(App.view.gDims, App.view, App.dims, App.display.dims);
      App.dirty.dims = false;
      App.dirty.labels = true;
    }

    if (App.view.dirty) { App.view.render(); App.dirty.labels = true; }
    if (App.dirty.labels) App.refreshLabels();

    requestAnimationFrame(frame);
  })(performance.now());
}

/* --- go ------------------------------------------------------------------ */

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function () { App.init(); });
} else {
  App.init();
}
