/* ==========================================================================
   Colour ramps and legends.

   Every ramp is defined as evenly spaced sRGB stops and sampled with linear
   interpolation. Three of them (viridis, cividis, greys) are safe for the
   common forms of colour vision deficiency; turbo and heat are offered
   because students will meet them in Ladybug and IESVE output and need to be
   able to read those too.
   ========================================================================== */

var RAMPS = {
  viridis: { label: 'Viridis (CVD-safe)', cvd: true, stops: [
    '#440154', '#472d7b', '#3b528b', '#2c728e', '#21918c', '#28ae80', '#5ec962', '#addc30', '#fde725'] },
  cividis: { label: 'Cividis (CVD-safe)', cvd: true, stops: [
    '#00224e', '#123570', '#3b496c', '#575d6d', '#707173', '#8a8678', '#a59c74', '#c3b369', '#e1cc55', '#fee838'] },
  turbo: { label: 'Turbo', cvd: false, stops: [
    '#30123b', '#4145ab', '#4675ed', '#39a2fc', '#1bcfd4', '#62fa9e', '#a4fc3b', '#d2e935', '#fe9b2d', '#db3a07', '#7a0403'] },
  heat: { label: 'Inferno', cvd: false, stops: [
    '#000004', '#1b0c41', '#4a0c6b', '#781c6d', '#a52c60', '#cf4446', '#ed6925', '#fb9b06', '#fcffa4'] },
  greys: { label: 'Greyscale (CVD-safe)', cvd: true, stops: [
    '#1a1a1a', '#3d3d3d', '#616161', '#878787', '#adadad', '#d1d1d1', '#f4f4f4'] },
  df: { label: 'Daylight Factor', cvd: false, stops: [
    '#1f2a5a', '#2a5599', '#3f9ac4', '#6fc7ad', '#b3dd82', '#f2e06a', '#f0a04b', '#d94f34'] },
  da: { label: 'Autonomy', cvd: false, stops: [
    '#40004b', '#7b3294', '#9970ab', '#c2a5cf', '#d9f0d3', '#7fbc41', '#4d9221', '#276419'] },
  udi: { label: 'UDI', cvd: false, stops: [
    '#3b4cc0', '#6f8fd4', '#a8bfe0', '#d9e3ee', '#f5e3c0', '#f3bd6a', '#e07b39', '#b40426'] },
  ice: { label: 'Ice', cvd: true, stops: [
    '#03051a', '#122a4f', '#1d5384', '#2b7fae', '#54abcb', '#8fd0de', '#cdeced'] }
};

/** The five UDI interval swatches (fixed, categorical). */
var UDI_COLORS = ['#3b4cc0', '#8aa9dd', '#4caf50', '#f4b942', '#cf3721'];

/** Sample a ramp at t in [0,1]; returns {r,g,b} in 0..1. */
function rampColor(name, t) {
  var r = RAMPS[name] || RAMPS.viridis, s = r.stops;
  t = clamp(t, 0, 1) * (s.length - 1);
  var i = Math.min(Math.floor(t), s.length - 2), f = t - i;
  var a = hex2rgb(s[i]), b = hex2rgb(s[i + 1]);
  return { r: lerp(a.r, b.r, f), g: lerp(a.g, b.g, f), b: lerp(a.b, b.b, f) };
}
function rampHex(name, t) { var c = rampColor(name, t); return rgb2hex(c.r, c.g, c.b); }

/** CSS gradient string for a ramp, bottom (0) to top (1). */
function rampGradient(name, steps) {
  var out = [];
  steps = steps || 12;
  for (var i = 0; i <= steps; i++) out.push(rampHex(name, i / steps) + ' ' + (i / steps * 100).toFixed(1) + '%');
  return 'linear-gradient(to top, ' + out.join(', ') + ')';
}

/**
 * Decide the colour scale for a metric.
 * `auto` uses a robust 2nd–98th percentile range so a single hot grid point
 * next to a window cannot flatten the whole field.
 */
function scaleFor(metric, field, opts) {
  opts = opts || {};
  var M = METRICS[metric] || {};
  var lo, hi;
  if (opts.manual && isFinite(opts.min) && isFinite(opts.max) && opts.max > opts.min) {
    lo = opts.min; hi = opts.max;
  } else if (M.fixedMin != null && M.fixedMax != null) {
    lo = M.fixedMin; hi = M.fixedMax;
  } else if (field && field.length) {
    var s = describe(field);
    lo = 0;
    hi = s.p ? s.p(0.98) : s.max;
    if (metric === 'df' && hi < 4) hi = 4;
    if (hi <= lo) hi = lo + 1;
    hi = niceCeil(hi);
  } else { lo = 0; hi = 1; }
  return { min: lo, max: hi, ramp: opts.ramp || M.ramp || 'viridis', reverse: !!opts.reverse };
}

/** Round up to a readable axis value (1, 2, 2.5, 5, 10 x 10^n). */
function niceCeil(v) {
  if (!(v > 0)) return 1;
  var e = Math.pow(10, Math.floor(Math.log10(v))), m = v / e;
  var n = m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10;
  return n * e;
}

/** Normalised position of a value on the current scale. */
function scaleT(scale, v) {
  var t = invLerp(scale.min, scale.max, v);
  return clamp(scale.reverse ? 1 - t : t, 0, 1);
}
function scaleColor(scale, v) { return rampColor(scale.ramp, scaleT(scale, v)); }

/* --- legend DOM ---------------------------------------------------------- */

/**
 * Render the legend for the active metric.
 * Continuous metrics get a gradient bar with ticks; UDI additionally lists
 * the five intervals with the area-mean percentage in each.
 */
function renderLegend(host, ctx) {
  var metric = ctx.metric, M = METRICS[metric], scale = ctx.scale;
  host.innerHTML = '';

  host.appendChild(el('div', { class: 'lg-title', text: M.label }));
  host.appendChild(el('div', { class: 'lg-unit', text: legendSubtitle(ctx) }));

  if (metric === 'udi' && ctx.compliance) {
    var labels = udiLabels(ctx.analysis.udi);
    var bins = el('div', { class: 'lg-bins' });
    for (var i = 4; i >= 0; i--) {
      bins.appendChild(el('div', { class: 'lg-bin' }, [
        el('div', { class: 'lg-sw', style: 'background:' + UDI_COLORS[i] }),
        el('div', { class: 'lg-lb', text: UDI_BINS[i].label, title: labels[i] }),
        el('div', { class: 'lg-pc', text: ctx.compliance.udiMean[i].toFixed(0) + '%' })
      ]));
    }
    host.appendChild(bins);
    host.appendChild(el('div', { class: 'lg-foot',
      text: labels.join(' · ').replace(/ lx/g, '') + ' lx' }));
  }

  var wrap = el('div', { class: 'lg-cont' });
  wrap.appendChild(el('div', {
    class: 'lg-bar',
    style: 'background:' + rampGradient(scale.ramp) + (scale.reverse ? ';transform:scaleY(-1)' : '')
  }));
  var ticks = el('div', { class: 'lg-ticks' });
  var steps = 5;
  for (var k = steps; k >= 0; k--) {
    var v = lerp(scale.min, scale.max, k / steps);
    ticks.appendChild(el('span', { text: num(v, M.decimals) + (k === steps ? ' ' + tickUnit(M) : '') }));
  }
  wrap.appendChild(ticks);
  host.appendChild(wrap);

  if (metric === 'df') {
    host.appendChild(el('div', { class: 'lg-foot',
      html: 'Bands: <b>&lt;1%</b> poor · <b>1–2%</b> modest · <b>2–5%</b> good · <b>&gt;5%</b> very high' }));
  }
  if (metric === 'ase' && ctx.compliance) {
    host.appendChild(el('div', { class: 'lg-foot',
      text: 'ASE' + num(ctx.analysis.aseLux) + ',' + num(ctx.analysis.aseHours) + ' = ' +
            ctx.compliance.ase.toFixed(0) + '% of area' }));
  }
  if (metric === 'da' && ctx.compliance) {
    host.appendChild(el('div', { class: 'lg-foot',
      text: 'sDA' + num(ctx.analysis.targetLux) + '/50% = ' + ctx.compliance.sda.toFixed(0) + '% of area' }));
  }
}

function tickUnit(M) {
  return M.unit === 'lux' ? 'lx' : M.unit === '%' ? '%' : M.unit === 'hours' ? 'h' : '%';
}

function legendSubtitle(ctx) {
  switch (ctx.metric) {
    case 'illuminance':
      return 'lux · ' + (SKY_MODELS[ctx.analysis.skyModel] || {}).label + ' · ' +
             dateLabel(ctx.when.month, ctx.when.day) + ' ' + hhmm(ctx.when.hour);
    case 'df': return '% · CIE overcast sky';
    case 'udi': {
      var view = null;
      for (var i = 0; i < UDI_VIEWS.length; i++) if (UDI_VIEWS[i].id === (ctx.udiView || 'useful')) view = UDI_VIEWS[i];
      return (view ? view.label : 'Useful') + ' · % of ' +
             num(ctx.compliance ? ctx.compliance.hours : 0) + ' h';
    }
    case 'da': return '% of hours ≥ ' + num(ctx.analysis.targetLux) + ' lx';
    case 'ase': return 'hours ≥ ' + num(ctx.analysis.aseLux) + ' lx direct';
    case 'sunhours': return 'hours of direct sun per year';
  }
  return '';
}

/** Wrap `text` to `maxW` at the current font, returning an array of lines. */
function wrapText(g, text, maxW) {
  var words = String(text).split(' '), lines = [], line = '';
  for (var i = 0; i < words.length; i++) {
    var trial = line ? line + ' ' + words[i] : words[i];
    if (g.measureText(trial).width > maxW && line) { lines.push(line); line = words[i]; }
    else line = trial;
  }
  if (line) lines.push(line);
  return lines;
}

var LEGEND_MIN_W = 150, LEGEND_MAX_W = 330;

/**
 * Draw the legend onto a 2D canvas for the exported image.
 *
 * It sizes itself: the box is measured from its own title, subtitle, ticks and
 * (for UDI) interval rows, so nothing can escape it the way the old fixed
 * 186 px box did. The unit rides on the top tick exactly as it does in the DOM
 * legend, instead of being a separate label that collided with the value.
 *
 * @returns {object} the rectangle actually used, so the caller can place it
 */
function drawLegendCanvas(g, x, y, ctx, ink, panel, line, ink2, ink3) {
  var M = METRICS[ctx.metric], scale = ctx.scale;
  var pad = 12, barW = 18, barGap = 9;
  var isUdi = ctx.metric === 'udi' && ctx.compliance;
  var labels = isUdi ? udiLabels(ctx.analysis.udi) : null;

  // ---- measure everything before drawing anything
  g.save();
  g.font = '600 13px system-ui, sans-serif';
  var titleW = g.measureText(M.label).width;
  g.font = '11px ui-monospace, SFMono-Regular, monospace';
  var subText = legendSubtitle(ctx);
  var tickTexts = [], steps = 5, i;
  for (i = 0; i <= steps; i++) {
    var v = lerp(scale.min, scale.max, 1 - i / steps);
    tickTexts.push(num(v, M.decimals) + (i === 0 ? ' ' + tickUnit(M) : ''));
  }
  var tickW = 0;
  for (i = 0; i < tickTexts.length; i++) tickW = Math.max(tickW, g.measureText(tickTexts[i]).width);

  var binW = 0;
  if (isUdi) {
    g.font = '11px system-ui, sans-serif';
    for (i = 0; i < 5; i++) {
      binW = Math.max(binW, 13 + 7 + g.measureText(UDI_BINS[i].label).width + 10 +
                            g.measureText(ctx.compliance.udiMean[i].toFixed(0) + '%').width);
    }
  }

  var subW = g.measureText(subText).width;
  var contentW = Math.max(titleW, barW + barGap + tickW, binW,
                          Math.min(subW, LEGEND_MAX_W - pad * 2),
                          LEGEND_MIN_W - pad * 2);
  var w = clamp(Math.ceil(contentW + pad * 2), LEGEND_MIN_W, LEGEND_MAX_W);
  var innerW = w - pad * 2;

  g.font = '11px ui-monospace, SFMono-Regular, monospace';
  var subLines = wrapText(g, subText, innerW);

  // ---- height from the content
  var yy = pad + 14;                                   // title baseline
  yy += 4 + subLines.length * 14;                      // subtitle block
  var binTop = yy;
  if (isUdi) yy += 5 * 17 + 8;
  var barTop = yy + 4;
  var barH = 150;
  var h = barTop + barH + pad;
  if (ctx.metric === 'df') h += 26;                    // the band footnote

  // ---- draw
  g.fillStyle = panel; g.strokeStyle = line; g.lineWidth = 1;
  roundRect(g, x, y, w, h, 7); g.fill(); g.stroke();

  g.fillStyle = ink;
  g.font = '600 13px system-ui, sans-serif';
  g.textAlign = 'left';
  g.fillText(M.label, x + pad, y + pad + 11);

  g.font = '11px ui-monospace, SFMono-Regular, monospace';
  g.fillStyle = ink3 || ink2 || ink;
  for (i = 0; i < subLines.length; i++) {
    g.fillText(subLines[i], x + pad, y + pad + 27 + i * 14);
  }

  if (isUdi) {
    g.font = '11px system-ui, sans-serif';
    for (i = 4; i >= 0; i--) {
      var row = y + binTop + (4 - i) * 17 + 10;
      g.fillStyle = UDI_COLORS[i];
      roundRect(g, x + pad, row - 9, 13, 13, 3); g.fill();
      g.strokeStyle = line; g.lineWidth = 1; g.stroke();
      g.fillStyle = ink2 || ink;
      g.textAlign = 'left';
      g.fillText(UDI_BINS[i].label, x + pad + 20, row + 1);
      g.fillStyle = ink3 || ink;
      g.textAlign = 'right';
      g.fillText(ctx.compliance.udiMean[i].toFixed(0) + '%', x + w - pad, row + 1);
      g.textAlign = 'left';
    }
  }

  var barX = x + pad, barY = y + barTop;
  var grd = g.createLinearGradient(0, barY + barH, 0, barY);
  for (i = 0; i <= 12; i++) grd.addColorStop(i / 12, rampHex(scale.ramp, scale.reverse ? 1 - i / 12 : i / 12));
  g.fillStyle = grd; g.fillRect(barX, barY, barW, barH);
  g.strokeStyle = line; g.lineWidth = 1; g.strokeRect(barX, barY, barW, barH);

  g.fillStyle = ink2 || ink;
  g.font = '11px ui-monospace, SFMono-Regular, monospace';
  for (i = 0; i <= steps; i++) {
    g.fillText(tickTexts[i], barX + barW + barGap, barY + barH * i / steps + 4);
  }

  if (ctx.metric === 'df') {
    g.fillStyle = ink3 || ink2 || ink;
    g.font = '10px system-ui, sans-serif';
    var foot = wrapText(g, '<1% poor · 1–2% modest · 2–5% good · >5% very high', innerW);
    for (i = 0; i < Math.min(2, foot.length); i++) {
      g.fillText(foot[i], x + pad, barY + barH + 14 + i * 12);
    }
  }

  g.restore();
  return { x: x, y: y, w: w, h: h };
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
