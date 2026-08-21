/* ==========================================================================
   Engine facade.

   Presents one promise-based API to the rest of the app and hides whether the
   work is running in a Web Worker or, when a Worker cannot be constructed
   (some browsers block Blob workers from file://), time-sliced on the main
   thread. Both paths drive exactly the same DaylightCore.
   ========================================================================== */

function Engine() {
  this.worker = null;
  this.inline = null;
  this.seq = 0;
  this.pending = {};
  this.mode = 'starting';
  this.busy = false;
  this.onProgress = null;
  this._annual = null;
}

Engine.prototype.start = function () {
  var self = this;
  try {
    var src = document.getElementById('worker-src').textContent;
    var url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    this.worker = new Worker(url);
    URL.revokeObjectURL(url);
    this.worker.onmessage = function (ev) { self._onMessage(ev.data); };
    this.worker.onerror = function () { self._fallback(); };
    this.mode = 'worker';
  } catch (e) {
    this._fallback();
  }
  return this;
};

Engine.prototype._fallback = function () {
  if (this.mode === 'inline') return;
  if (this.worker) { try { this.worker.terminate(); } catch (e) {} this.worker = null; }
  this.inline = new DaylightCore();
  this.mode = 'inline';
};

Engine.prototype._onMessage = function (d) {
  if (d.progress != null && d.ok == null) {
    var pw = this.pending[d.id];
    if (pw && pw.onProgress) pw.onProgress(d.progress, d.note);
    return;
  }
  var p = this.pending[d.id];
  if (!p) return;
  delete this.pending[d.id];
  if (d.ok) p.resolve(d); else p.reject(new Error(d.error || 'engine error'));
};

Engine.prototype._post = function (msg, transfer, onProgress) {
  var self = this;
  msg.id = ++this.seq;
  return new Promise(function (resolve, reject) {
    self.pending[msg.id] = { resolve: resolve, reject: reject, onProgress: onProgress };
    self.worker.postMessage(msg, transfer || []);
  });
};

/** Yield to the browser between chunks so the UI keeps painting. */
function nextTick() {
  return new Promise(function (r) { setTimeout(r, 0); });
}

/* --- public API --------------------------------------------------------- */

Engine.prototype.setGeometry = function (tri, materials) {
  if (this.mode === 'worker') {
    var pos = tri.pos.slice(), mat = tri.mat.slice();
    return this._post({ cmd: 'geometry', pos: pos, mat: mat, materials: materials },
                      [pos.buffer, mat.buffer]);
  }
  return Promise.resolve(this.inline.setGeometry(tri, materials));
};

Engine.prototype.bake = function (pts, nrm, cfg, onProgress) {
  var self = this;
  if (this.mode === 'worker') {
    var a = pts.slice(), b = nrm.slice();
    return this._post({ cmd: 'bake', pts: a, nrm: b, cfg: cfg }, [a.buffer, b.buffer], onProgress);
  }
  // main thread: bake in slices, yielding between them
  var t0 = Date.now();
  var info = this.inline.beginBake(pts, nrm, cfg);
  var step = Math.max(1, Math.ceil(info.nPts / 60)), p = 0, rays = 0;
  return (function loop() {
    if (p >= info.nPts) {
      return Promise.resolve({ nPatch: info.nPatch, nPts: info.nPts, rays: rays, ms: Date.now() - t0 });
    }
    rays += self.inline.bakeChunk(p, p + step);
    p += step;
    if (onProgress) onProgress(Math.min(1, p / info.nPts), 'Tracing');
    return nextTick().then(loop);
  })();
};

/** Illuminance for one instant: sky dot product plus the direct beam. */
Engine.prototype.point = function (o) {
  if (this.mode === 'worker') {
    var lum = Float64Array.from(o.lum);
    return this._post({
      cmd: 'point', lum: lum, ground: o.ground, sunDir: o.sunDir,
      Enormal: o.Enormal, radius: o.radius, samples: o.samples
    }, [lum.buffer]);
  }
  var c = this.inline;
  var df = c.diffuse(o.lum, o.ground);
  var dir = new Float32Array(df.length);
  if (o.Enormal > 0 && o.sunDir && o.sunDir.y > 0) {
    c.directSun(o.sunDir, o.Enormal, o.radius, o.samples || 1, dir);
  }
  var out = new Float32Array(df.length);
  for (var i = 0; i < df.length; i++) out[i] = df[i] + dir[i];
  return Promise.resolve({ lux: out, diffuse: df, direct: dir });
};

Engine.prototype.sunVisible = function (sunDir) {
  if (this.mode === 'worker') return this._post({ cmd: 'sunvis', sunDir: sunDir });
  return Promise.resolve({ vis: this.inline.sunVisible(sunDir, 1) });
};

/** Full annual run, streamed so the progress bar moves. */
Engine.prototype.annual = function (o, onProgress) {
  var self = this;
  if (this.mode === 'worker') {
    var c = o.climate;
    return this._post({
      cmd: 'annualBegin',
      dni: c.dni.slice(), dhi: c.dhi.slice(), ghi: c.ghi.slice(), temp: c.temp.slice(),
      climateName: c.name, site: o.site, udi: o.udi, targetLux: o.targetLux,
      occStart: o.occStart, occEnd: o.occEnd, aseLux: o.aseLux,
      groundRefl: o.groundRefl, sunRadius: o.sunRadius
    }).then(function step() {
      return self._post({ cmd: 'annualStep', days: 15 }).then(function (r) {
        if (r.done) return r.result;
        if (onProgress) onProgress(r.progress);
        return step();
      });
    });
  }
  var st = this.inline.annualBegin(o);
  return (function loop() {
    var pr = self.inline.annualStep(st, 8);
    if (onProgress) onProgress(pr);
    if (pr >= 1) return Promise.resolve(self.inline.annualEnd(st));
    return nextTick().then(loop);
  })();
};

Engine.prototype.dispose = function () {
  if (this.worker) { try { this.worker.terminate(); } catch (e) {} this.worker = null; }
  this.inline = null;
  this.pending = {};
};
