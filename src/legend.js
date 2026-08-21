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

/**
 * Draw the same legend onto a 2D canvas, for the exported image.
 * Kept deliberately close to the DOM version so the export matches the screen.
 */
function drawLegendCanvas(g, x, y, w, h, ctx, ink, panel, line) {
  var M = METRICS[ctx.metric], scale = ctx.scale;
  g.save();
  g.fillStyle = panel; g.strokeStyle = line; g.lineWidth = 1;
  roundRect(g, x, y, w, h, 6); g.fill(); g.stroke();

  g.fillStyle = ink;
  g.font = '600 13px system-ui, sans-serif';
  g.fillText(M.label, x + 12, y + 22);
  g.font = '11px ui-monospace, monospace';
  g.globalAlpha = 0.65;
  g.fillText(legendSubtitle(ctx), x + 12, y + 38);
  g.globalAlpha = 1;

  var barX = x + 12, barY = y + 50, barW = 18, barH = h - 68;
  var grd = g.createLinearGradient(0, barY + barH, 0, barY);
  for (var i = 0; i <= 12; i++) grd.addColorStop(i / 12, rampHex(scale.ramp, scale.reverse ? 1 - i / 12 : i / 12));
  g.fillStyle = grd; g.fillRect(barX, barY, barW, barH);
  g.strokeStyle = line; g.strokeRect(barX, barY, barW, barH);

  g.fillStyle = ink; g.font = '11px ui-monospace, monospace';
  for (i = 0; i <= 5; i++) {
    var v = lerp(scale.min, scale.max, 1 - i / 5);
    g.fillText(num(v, M.decimals), barX + barW + 8, barY + barH * i / 5 + 4);
  }
  g.font = '600 11px ui-monospace, monospace';
  g.fillText(tickUnit(M), barX + barW + 8, barY - 6);
  g.restore();
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
