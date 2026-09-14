/* ==========================================================================
   Export: presentation image, grid CSV, model JSON.

   The exported image is a drawing, not a screenshot: the viewport is
   re-rendered at the requested scale, then a title block, north arrow,
   legend, statistics and the copyright line are composited on top so the
   image can go straight into a report or a crit panel.
   ========================================================================== */

var COPYRIGHT = '© Karam Al-Obaidi';

function download(name, blobOrText, mime) {
  var blob = blobOrText instanceof Blob ? blobOrText : new Blob([blobOrText], { type: mime || 'text/plain' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 400);
}

/**
 * Compose and download the presentation image.
 * @param {View} view
 * @param {object} ctx  everything the title block needs
 * @param {object} o    {scale, showLegend, showStats, showTitle, showValues, filename}
 */
function exportImage(view, ctx, o) {
  o = o || {};
  var scale = clamp(o.scale || 2, 1, 4);
  var W = view.canvas.clientWidth, H = view.canvas.clientHeight;
  var cw = Math.round(W * scale), ch = Math.round(H * scale);

  // re-render at export resolution
  var oldRatio = view.renderer.getPixelRatio();
  view.renderer.setPixelRatio(scale);
  view.renderer.setSize(W, H, false);
  view.render();

  var titleH = 0, titleRows = 3;
  if (o.showTitle !== false) {
    // measure the metadata first: the block grows if it needs a fourth row
    var probeC = document.createElement('canvas').getContext('2d');
    probeC.font = '650 15px system-ui, sans-serif';
    var hW = probeC.measureText((METRICS[ctx.metric] || {}).label || '').width;
    var mx0 = Math.max(210, Math.ceil(16 + hW + 28));
    titleRows = titleBlockLayout(probeC, ctx.meta || [], Math.max(220, W - mx0 - 210)).rows;
    titleH = Math.round(titleBlockHeight(titleRows) * scale);
  }
  var out = document.createElement('canvas');
  out.width = cw; out.height = ch + titleH;
  var g = out.getContext('2d');

  var panel = cssVar('--panel') || '#fff';
  var ink = cssVar('--ink') || '#111';
  var ink2 = cssVar('--ink-2') || '#555';
  var ink3 = cssVar('--ink-3') || '#888';
  var line = cssVar('--line') || '#ccc';

  g.fillStyle = panel; g.fillRect(0, 0, out.width, out.height);
  g.drawImage(view.renderer.domElement, 0, 0, cw, ch);

  // restore the live viewport straight away
  view.renderer.setPixelRatio(oldRatio);
  view.renderer.setSize(W, H, false);
  view.dirty = true;

  g.save();
  g.scale(scale, scale);

  if (o.showValues && ctx.labels && ctx.labels.length) drawValueLabels(g, ctx.labels, ink, panel);
  if (o.showDimensions !== false && ctx.dimLabels && ctx.dimLabels.length) {
    drawDimensionLabels(g, ctx.dimLabels, ink, panel, line);
  }
  drawNorthArrow(g, W - 52, 52, 26, ctx.northAngle || 0, ink, ink3, panel, line);

  if (o.showLegend !== false && ctx.scale) {
    // measured once at x = 0 to learn its width, then placed flush right
    var probe = drawLegendCanvas(g, -9999, -9999, ctx, ink, panel, line, ink2, ink3);
    drawLegendCanvas(g, W - 14 - probe.w, 96, ctx, ink, panel, line, ink2, ink3);
  }
  if (o.showStats !== false && ctx.stats) {
    drawStatsCanvas(g, 14, H - 128, 200, 114, ctx, ink, ink2, panel, line);
  }
  g.restore();

  if (titleH) drawTitleBlock(g, 0, ch, cw, titleH, scale, ctx, ink, ink2, ink3, panel, line);

  var name = o.filename || ('daylight-lab-' + ctx.metric + '-' +
    (ctx.model ? ctx.model.name.replace(/[^\w-]+/g, '-').toLowerCase() : 'model') + '.png');
  out.toBlob(function (b) { download(name, b); }, 'image/png');
  return name;
}

function drawValueLabels(g, labels, ink, panel) {
  g.save();
  g.font = '600 9.5px ui-monospace, SFMono-Regular, monospace';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 3; g.strokeStyle = panel; g.fillStyle = ink;
  for (var i = 0; i < labels.length; i++) {
    var L = labels[i];
    g.strokeText(L.text, L.x, L.y);
    g.fillText(L.text, L.x, L.y);
  }
  g.restore();
}

/**
 * Dimension labels, as bordered chips matching the on-screen `.dim` style.
 * The dimension LINES already survive the export, being 3D geometry — only
 * their numbers live in the HTML overlay and have to be composited here.
 */
function drawDimensionLabels(g, labels, ink, panel, line) {
  g.save();
  g.font = '600 10.5px ui-monospace, SFMono-Regular, monospace';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (var i = 0; i < labels.length; i++) {
    var L = labels[i], w = g.measureText(L.text).width + 10, h = 15;
    g.fillStyle = panel; g.globalAlpha = 0.92;
    roundRect(g, L.x - w / 2, L.y - h / 2, w, h, 3); g.fill();
    g.globalAlpha = 1;
    g.strokeStyle = line; g.lineWidth = 1; g.stroke();
    g.fillStyle = ink;
    g.fillText(L.text, L.x, L.y + 0.5);
  }
  g.restore();
}

function drawNorthArrow(g, cx, cy, r, northAngle, ink, ink3, panel, line) {
  g.save();
  g.translate(cx, cy);
  g.fillStyle = panel; g.globalAlpha = 0.82;
  g.beginPath(); g.arc(0, 0, r + 6, 0, Math.PI * 2); g.fill();
  g.globalAlpha = 1;
  g.strokeStyle = line; g.lineWidth = 1;
  g.beginPath(); g.arc(0, 0, r + 6, 0, Math.PI * 2); g.stroke();

  g.rotate(-northAngle * DEG);
  g.fillStyle = ink;
  g.beginPath();
  g.moveTo(0, -r); g.lineTo(r * 0.42, r * 0.55); g.lineTo(0, r * 0.22); g.closePath(); g.fill();
  g.fillStyle = ink3;
  g.beginPath();
  g.moveTo(0, -r); g.lineTo(-r * 0.42, r * 0.55); g.lineTo(0, r * 0.22); g.closePath(); g.fill();
  g.rotate(northAngle * DEG);
  g.fillStyle = ink;
  g.font = '700 10px system-ui, sans-serif'; g.textAlign = 'center';
  g.fillText('N', 0, -r - 10);
  g.restore();
}

function drawStatsCanvas(g, x, y, w, h, ctx, ink, ink2, panel, line) {
  var s = ctx.stats, M = METRICS[ctx.metric];
  g.save();
  g.fillStyle = panel; g.strokeStyle = line; g.lineWidth = 1;
  roundRect(g, x, y, w, h, 6); g.fill(); g.stroke();
  g.fillStyle = ink; g.font = '600 11px system-ui, sans-serif';
  g.fillText('Workplane statistics', x + 11, y + 18);

  var rows = [
    ['Minimum', num(s.min, M.decimals)], ['Mean', num(s.mean, M.decimals)],
    ['Maximum', num(s.max, M.decimals)], ['Uniformity min:mean', s.uniformity.toFixed(2)]
  ];
  if (s.pass != null) rows.push(['Area ≥ ' + num(s.target, M.decimals) + ' ' + tickUnit(M), s.pass.toFixed(0) + '%']);
  g.font = '11px system-ui, sans-serif';
  for (var i = 0; i < rows.length; i++) {
    var yy = y + 36 + i * 15;
    g.fillStyle = ink2; g.textAlign = 'left'; g.fillText(rows[i][0], x + 11, yy);
    g.fillStyle = ink; g.textAlign = 'right';
    g.font = '600 11px ui-monospace, monospace';
    g.fillText(rows[i][1], x + w - 11, yy);
    g.font = '11px system-ui, sans-serif';
  }
  g.restore();
}

/**
 * Metadata layout for the title block: columns are measured from the actual
 * text rather than assumed, so a long climate name or a wide UDI threshold
 * string can never overrun the next column's key. (The old fixed
 * colW = 190 / keyOff = 74 put "Reflectance" on top of "…3.20 m".)
 */
function titleBlockLayout(g, meta, availW) {
  g.save();
  g.font = '10.5px ui-monospace, SFMono-Regular, monospace';
  var keyW = 0, valW = 0;
  for (var i = 0; i < meta.length; i++) {
    keyW = Math.max(keyW, g.measureText(meta[i][0]).width);
    valW = Math.max(valW, g.measureText(meta[i][1]).width);
  }
  g.restore();
  var keyOff = Math.ceil(keyW) + 10;
  var colW = keyOff + Math.ceil(valW) + 26;
  var cols = Math.max(1, Math.floor(availW / colW));
  var rows = Math.max(3, Math.ceil(meta.length / cols));
  return { keyOff: keyOff, colW: colW, cols: cols, rows: rows };
}

/** Height the title block needs for `rows` metadata rows. */
function titleBlockHeight(rows) { return Math.max(78, 40 + rows * 15 + 16); }

function drawTitleBlock(g, x, y, w, h, scale, ctx, ink, ink2, ink3, panel, line) {
  g.save();
  g.fillStyle = panel; g.fillRect(x, y, w, h);
  g.strokeStyle = line; g.lineWidth = Math.max(1, scale);
  g.beginPath(); g.moveTo(x, y + 0.5 * scale); g.lineTo(x + w, y + 0.5 * scale); g.stroke();
  g.scale(scale, scale);
  var W = w / scale, H = h / scale, Y = y / scale;

  var M = METRICS[ctx.metric];
  g.fillStyle = ink;
  g.font = '650 15px system-ui, sans-serif'; g.textAlign = 'left';
  g.fillText(M.label, 16, Y + 24);
  g.font = '11.5px system-ui, sans-serif'; g.fillStyle = ink2;
  g.fillText(ctx.model ? ctx.model.name : 'Model', 16, Y + 41);

  var meta = ctx.meta || [];
  // Start the metadata after the title, not at a fixed 210 — "Useful Daylight
  // Illuminance" is wider than that and used to sit on top of the first key.
  g.font = '650 15px system-ui, sans-serif';
  var headW = g.measureText(M.label).width;
  g.font = '11.5px system-ui, sans-serif';
  headW = Math.max(headW, g.measureText(ctx.model ? ctx.model.name : 'Model').width);
  var x0 = Math.max(210, Math.ceil(16 + headW + 28)), rightReserve = 210;
  var lay = titleBlockLayout(g, meta, Math.max(colWMin(), W - x0 - rightReserve));

  g.font = '10.5px ui-monospace, SFMono-Regular, monospace';
  for (var i = 0; i < meta.length; i++) {
    var col = Math.floor(i / lay.rows), row = i % lay.rows;
    var mx = x0 + col * lay.colW, my = Y + 20 + row * 15;
    if (mx + lay.colW - 26 > W - rightReserve + 26) break;
    g.fillStyle = ink3; g.fillText(meta[i][0], mx, my);
    g.fillStyle = ink2; g.fillText(meta[i][1], mx + lay.keyOff, my);
  }

  // copyright, bottom left — always present in an exported image
  g.fillStyle = ink; g.font = '650 12px system-ui, sans-serif';
  g.fillText(COPYRIGHT, 16, Y + H - 12);

  g.fillStyle = ink3; g.font = '10px system-ui, sans-serif'; g.textAlign = 'right';
  g.fillText('Daylight Lab — daylight simulation tool', W - 16, Y + H - 12);
  g.restore();
}
function colWMin() { return 220; }

/** Model + settings as JSON, round-trippable through loadModelJson(). */
function exportJson(model, extra) {
  var payload = {
    app: 'Daylight Lab', version: 1,
    exported: new Date().toISOString(),
    copyright: COPYRIGHT,
    model: model
  };
  for (var k in extra) payload[k] = extra[k];
  return JSON.stringify(payload, function (key, v) {
    return key === 'matSlot' ? undefined : v;
  }, 2);
}

/** Restore a model exported by exportJson, refilling any missing fields. */
function importJson(text) {
  var o = JSON.parse(text);
  var m = o.model || o;
  if (!m.room || !m.apertures) throw new Error('Not a Daylight Lab model file.');
  var base = defaultModel();
  // merge so files written by an older build still load
  m.room = Object.assign({}, base.room, m.room);
  m.room.refl = Object.assign({}, base.room.refl, m.room.refl || {});
  m.grid = Object.assign({}, base.grid, m.grid || {});
  m.analysis = Object.assign({}, base.analysis, m.analysis || {});
  m.site = Object.assign({}, base.site, m.site || {});
  m.when = Object.assign({}, base.when, m.when || {});
  m.apertures = m.apertures.map(function (a) { return makeAperture(Object.assign({}, a)); });
  m.name = m.name || 'Imported model';
  return m;
}
