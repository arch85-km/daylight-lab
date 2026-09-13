/* ==========================================================================
   Sun path — a 3D dome over the model and a 2D stereographic chart.

   Both are driven by the same solar module, so the dot on the chart and the
   sphere on the dome are always the same instant, and both rotate with the
   project north angle.
   ========================================================================== */

var KEY_DATES = [
  { month: 6, day: 21, label: 'Jun 21', key: true },
  { month: 5, day: 21, label: 'May/Jul 21' },
  { month: 4, day: 21, label: 'Apr/Aug 21' },
  { month: 3, day: 21, label: 'Mar/Sep 21', key: true },
  { month: 2, day: 21, label: 'Feb/Oct 21' },
  { month: 1, day: 21, label: 'Jan/Nov 21' },
  { month: 12, day: 21, label: 'Dec 21', key: true }
];

/** Build the 3D sun-path dome into `group`. */
function buildSunPath(group, view, model, sun, opts) {
  disposeGroup(group);
  opts = opts || {};
  var t = view.theme;
  var b = view.built ? view.built.outer : { x0: -4, x1: 4, y0: 0, y1: 3, z0: -4, z1: 4 };
  var R = Math.max(b.x1 - b.x0, b.z1 - b.z0, b.y1 - b.y0) * (opts.scale || 1.3);
  var cy = b.y0;
  var site = model.site, north = model.room.northAngle || 0;
  var year = model.when.year;

  var lineMat = function (color, opacity, width) {
    return new THREE.LineBasicMaterial({
      color: new THREE.Color(color), transparent: true, opacity: opacity, linewidth: width || 1
    });
  };
  var addLine = function (pts, mat, loop) {
    if (pts.length < 2) return;
    var a = [];
    for (var i = 0; i < pts.length; i++) a.push(pts[i][0], pts[i][1], pts[i][2]);
    if (loop) a.push(pts[0][0], pts[0][1], pts[0][2]);
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(a), 3));
    group.add(new THREE.Line(g, mat));
  };
  var P = function (alt, azi, rad) {
    var v = sunVector(alt, azi, north);
    return [v.x * (rad || R), cy + v.y * (rad || R), v.z * (rad || R)];
  };

  // --- compass ring and altitude rings ---------------------------------
  var ringMat = lineMat(t['grid-major'], 0.55);
  var faintMat = lineMat(t.sunpath, 0.3);
  [0, 15, 30, 45, 60, 75].forEach(function (alt) {
    var pts = [];
    for (var a = 0; a <= 360; a += 4) pts.push(P(alt, a));
    addLine(pts, alt === 0 ? ringMat : faintMat, true);
  });
  for (var az = 0; az < 360; az += 30) {
    addLine([P(0, az), P(88, az)], faintMat);
  }

  // --- day arcs for the 21st of each month ------------------------------
  var arcMat = lineMat(t.sunpath, 0.75);
  var keyMat = lineMat(t.sunpath, 1.0);
  KEY_DATES.forEach(function (d) {
    var pts = [];
    for (var h = 0; h <= 24; h += 0.15) {
      var s = sunPosition(site, year, d.month, d.day, Math.min(h, 23.999));
      if (s.altitude < -1) { if (pts.length > 1) addLine(pts, d.key ? keyMat : arcMat); pts = []; continue; }
      pts.push(P(Math.max(s.altitude, 0), s.azimuth));
    }
    if (pts.length > 1) addLine(pts, d.key ? keyMat : arcMat);
  });

  // --- hour analemmas ---------------------------------------------------
  var hourMat = lineMat(t.sunpath, 0.42);
  for (var hh = 0; hh < 24; hh++) {
    var pts2 = [], any = false;
    for (var n = 1; n <= 365; n += 4) {
      var md = fromDoy(n);
      var s2 = sunPosition(site, year, md.month, md.day, hh);
      if (s2.altitude < 0) { if (pts2.length > 1) { addLine(pts2, hourMat); any = true; } pts2 = []; continue; }
      pts2.push(P(s2.altitude, s2.azimuth));
    }
    if (pts2.length > 1) { addLine(pts2, hourMat); any = true; }
    if (any) group.add(hourTick(hh, site, year, north, R, cy, t));
  }

  // --- today's arc, highlighted ----------------------------------------
  var todayMat = lineMat(t['sunpath-hi'], 1);
  var tp = [];
  for (var h2 = 0; h2 <= 24; h2 += 0.08) {
    var s3 = sunPosition(site, year, model.when.month, model.when.day, Math.min(h2, 23.999));
    if (s3.altitude < 0) { if (tp.length > 1) addLine(tp, todayMat); tp = []; continue; }
    tp.push(P(s3.altitude, s3.azimuth));
  }
  if (tp.length > 1) addLine(tp, todayMat);

  // --- the sun itself ---------------------------------------------------
  if (sun && sun.altitude > -2) {
    var size = clamp((opts.sunSizeDeg || 0.53), 0.1, 12) * DEG * R * 0.5;
    size = Math.max(size, R * 0.012);
    var p = P(sun.altitude, sun.azimuth);
    var sphere = new THREE.Mesh(
      new THREE.SphereGeometry(size, 20, 14),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(t.sun), toneMapped: false })
    );
    sphere.position.set(p[0], p[1], p[2]);
    group.add(sphere);
    var halo = new THREE.Mesh(
      new THREE.SphereGeometry(size * 2.4, 16, 12),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(t.sun), transparent: true, opacity: 0.16,
        depthWrite: false, toneMapped: false
      })
    );
    halo.position.copy(sphere.position);
    group.add(halo);
    if (sun.altitude > 0) {
      addLine([[0, cy, 0], p], lineMat(t.sun, 0.35));
    }
  }

  // --- compass labels ---------------------------------------------------
  group.userData.labels = [
    { text: 'N', pos: P(0, 0, R * 1.06) }, { text: 'E', pos: P(0, 90, R * 1.06) },
    { text: 'S', pos: P(0, 180, R * 1.06) }, { text: 'W', pos: P(0, 270, R * 1.06) }
  ];
  group.userData.radius = R;
  view.dirty = true;
}

/** Small tick at each hour analemma so the dome can be read like a clock. */
function hourTick(hour, site, year, north, R, cy, t) {
  var s = sunPosition(site, year, 6, 21, hour);
  var v = sunVector(Math.max(s.altitude, 0), s.azimuth, north);
  var g = new THREE.SphereGeometry(R * 0.006, 8, 6);
  var m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
    color: new THREE.Color(t.sunpath), transparent: true, opacity: 0.7, toneMapped: false
  }));
  m.position.set(v.x * R, cy + v.y * R, v.z * R);
  return m;
}

/* --- 2D stereographic sun-path chart ------------------------------------- */

/** Stereographic projection: altitude/azimuth -> chart x,y with north up. */
function stereo(alt, azi, north, R) {
  var r = R * Math.tan((90 - clamp(alt, 0, 90)) / 2 * DEG);
  var a = (azi - (north || 0)) * DEG;
  return [r * Math.sin(a), -r * Math.cos(a)];
}

/** Render the SVG sun-path diagram. */
function renderSunChart(svg, model, sun) {
  var S = 220, C = S / 2, R = S / 2 - 16;
  var site = model.site, north = model.room.northAngle || 0, year = model.when.year;
  var ns = 'http://www.w3.org/2000/svg';
  svg.setAttribute('viewBox', '0 0 ' + S + ' ' + S);
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  var mk = function (tag, attrs) {
    var n = document.createElementNS(ns, tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  };
  var path = function (pts, cls) {
    if (pts.length < 2) return null;
    var d = 'M' + pts.map(function (p) { return p[0].toFixed(2) + ',' + p[1].toFixed(2); }).join('L');
    return mk('path', { d: d, class: cls });
  };

  // altitude rings + azimuth spokes
  [0, 15, 30, 45, 60, 75].forEach(function (alt) {
    var r = R * Math.tan((90 - alt) / 2 * DEG);
    svg.appendChild(mk('circle', { cx: C, cy: C, r: r.toFixed(2), class: alt === 0 ? 'sp-axis' : 'sp-grid' }));
  });
  for (var az = 0; az < 360; az += 30) {
    var p = stereo(0, az, north, R);
    svg.appendChild(mk('line', { x1: C, y1: C, x2: C + p[0], y2: C + p[1], class: 'sp-grid' }));
  }
  [['N', 0], ['E', 90], ['S', 180], ['W', 270]].forEach(function (d) {
    var q = stereo(0, d[1], north, R + 9);
    var tn = mk('text', { x: C + q[0], y: C + q[1] + 2.5, 'text-anchor': 'middle' });
    tn.textContent = d[0];
    svg.appendChild(tn);
  });

  // monthly day arcs
  KEY_DATES.forEach(function (d) {
    var pts = [];
    for (var h = 0; h <= 24; h += 0.2) {
      var s = sunPosition(site, year, d.month, d.day, Math.min(h, 23.999));
      if (s.altitude < 0) { var el0 = path(pts, 'sp-month' + (d.key ? ' key' : '')); if (el0) svg.appendChild(el0); pts = []; continue; }
      var q2 = stereo(s.altitude, s.azimuth, north, R);
      pts.push([C + q2[0], C + q2[1]]);
    }
    var e = path(pts, 'sp-month' + (d.key ? ' key' : ''));
    if (e) svg.appendChild(e);
  });

  // hour analemmas
  for (var hh = 0; hh < 24; hh++) {
    var pts2 = [];
    for (var n = 1; n <= 365; n += 6) {
      var md = fromDoy(n);
      var s2 = sunPosition(site, year, md.month, md.day, hh);
      if (s2.altitude < 0) { var e2 = path(pts2, 'sp-hour'); if (e2) svg.appendChild(e2); pts2 = []; continue; }
      var q3 = stereo(s2.altitude, s2.azimuth, north, R);
      pts2.push([C + q3[0], C + q3[1]]);
    }
    var e3 = path(pts2, 'sp-hour');
    if (e3) svg.appendChild(e3);
  }

  // today's arc
  var tp = [];
  for (var h2 = 0; h2 <= 24; h2 += 0.1) {
    var s3 = sunPosition(site, year, model.when.month, model.when.day, Math.min(h2, 23.999));
    if (s3.altitude < 0) { var e4 = path(tp, 'sp-today'); if (e4) svg.appendChild(e4); tp = []; continue; }
    var q4 = stereo(s3.altitude, s3.azimuth, north, R);
    tp.push([C + q4[0], C + q4[1]]);
  }
  var e5 = path(tp, 'sp-today');
  if (e5) svg.appendChild(e5);

  // the sun now
  if (sun && sun.altitude > 0) {
    var q5 = stereo(sun.altitude, sun.azimuth, north, R);
    svg.appendChild(mk('circle', { cx: C + q5[0], cy: C + q5[1], r: 4, class: 'sp-now' }));
  }
}
