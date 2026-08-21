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

  var titleH = o.showTitle === false ? 0 : Math.round(78 * scale);
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
  drawNorthArrow(g, W - 52, 52, 26, ctx.northAngle || 0, ink, ink3, panel, line);

  if (o.showLegend !== false && ctx.scale) {
    drawLegendCanvas(g, W - 200, 96, 186, ctx.metric === 'udi' ? 300 : 260, ctx, ink, panel, line);
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

  // metadata, laid out in two columns
  var mid = ctx.meta || [];
  g.font = '10.5px ui-monospace, SFMono-Regular, monospace';
  var colW = 190, x0 = 210;
  for (var i = 0; i < mid.length; i++) {
    var col = Math.floor(i / 3), row = i % 3;
    var mx = x0 + col * colW, my = Y + 20 + row * 15;
    if (mx > W - 210) break;
    g.fillStyle = ink3; g.fillText(mid[i][0], mx, my);
    g.fillStyle = ink2; g.fillText(mid[i][1], mx + 74, my);
  }

  // copyright, bottom left — always present in an exported image
  g.fillStyle = ink; g.font = '650 12px system-ui, sans-serif';
  g.fillText(COPYRIGHT, 16, Y + H - 12);

  g.fillStyle = ink3; g.font = '10px system-ui, sans-serif'; g.textAlign = 'right';
  g.fillText('Daylight Lab — daylighting teaching tool', W - 16, Y + H - 12);
  g.restore();
}

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
