/* ==========================================================================
   Metrics.

   Turns raw engine output into the displayed fields, and computes the single
   -number summaries a student writes into a report.

   Illuminance   lux at the workplane, for one instant
   DF            E_inside / E_unobstructed-horizontal, CIE overcast sky, %
   UDI           % of occupied hours falling in each illuminance interval
                 (Nabil & Mardaljevic 2005; five-interval classification)
   DA / sDA      % of occupied hours at or above the target; spatial DA
   ASE           hours of direct sun above the ASE threshold; ASE% of area
   Sun hours     hours per year with any direct beam at the point
   ========================================================================== */

var UDI_BINS = [
  { key: 'fell',   label: 'Too low',   short: '<t1' },
  { key: 'low',    label: 'Low',       short: 't1–t2' },
  { key: 'range',  label: 'In range',  short: 't2–t3' },
  { key: 'high',   label: 'High',      short: 't3–t4' },
  { key: 'excess', label: 'Too high',  short: '>t4' }
];

var METRICS = {
  illuminance: {
    label: 'Illuminance', short: 'E', unit: 'lux', decimals: 0,
    annual: false, ramp: 'viridis',
    about: 'illuminance'
  },
  df: {
    label: 'Daylight Factor', short: 'DF', unit: '%', decimals: 1,
    annual: false, ramp: 'df', fixedMax: 10,
    about: 'df'
  },
  udi: {
    label: 'Useful Daylight Illuminance', short: 'UDI', unit: '% of hours', decimals: 0,
    annual: true, ramp: 'udi', fixedMin: 0, fixedMax: 100,
    about: 'udi'
  },
  da: {
    label: 'Daylight Autonomy', short: 'DA', unit: '% of hours', decimals: 0,
    annual: true, ramp: 'da', fixedMin: 0, fixedMax: 100,
    about: 'da'
  },
  ase: {
    label: 'Annual Sunlight Exposure', short: 'ASE', unit: 'hours', decimals: 0,
    annual: true, ramp: 'heat',
    about: 'ase'
  },
  sunhours: {
    label: 'Direct sun hours', short: 'Sun', unit: 'hours', decimals: 0,
    annual: true, ramp: 'heat',
    about: 'sunhours'
  }
};

/** UDI interval selector — which bin (or combination) drives the colours. */
var UDI_VIEWS = [
  { id: 'useful', label: 'Useful — in range + high', bins: [2, 3] },
  { id: 'range',  label: 'In range only',            bins: [2] },
  { id: 'excess', label: 'Too high (over-lit)',      bins: [4] },
  { id: 'fell',   label: 'Too low',                  bins: [0] },
  { id: 'low',    label: 'Low',                      bins: [1] },
  { id: 'high',   label: 'High',                     bins: [3] },
  { id: 'lowsum', label: 'Below target — too low + low', bins: [0, 1] }
];

/** Human-readable interval labels from the four editable thresholds. */
function udiLabels(t) {
  return [
    '< ' + num(t[0]) + ' lx',
    num(t[0]) + '–' + num(t[1]) + ' lx',
    num(t[1]) + '–' + num(t[2]) + ' lx',
    num(t[2]) + '–' + num(t[3]) + ' lx',
    '> ' + num(t[3]) + ' lx'
  ];
}

/**
 * Extract the displayed scalar field for a metric.
 * @param {string} metric
 * @param {object} res  the engine result bundle
 * @param {object} opts {udiView, thresholds}
 * @returns {Float32Array}
 */
function metricField(metric, res, opts) {
  opts = opts || {};
  switch (metric) {
    case 'illuminance': return res.lux;
    case 'df': return res.df;
    case 'da': {
      if (!res.annual) return null;
      var n = res.n, out = new Float32Array(n), h = res.annual.hours || 1;
      for (var i = 0; i < n; i++) out[i] = 100 * res.annual.daHours[i] / h;
      return out;
    }
    case 'udi': {
      if (!res.annual) return null;
      var view = null, id = opts.udiView || 'useful';
      for (var k = 0; k < UDI_VIEWS.length; k++) if (UDI_VIEWS[k].id === id) view = UDI_VIEWS[k];
      view = view || UDI_VIEWS[0];
      var m = res.n, o2 = new Float32Array(m), hh = res.annual.hours || 1;
      for (i = 0; i < m; i++) {
        var s = 0;
        for (var b = 0; b < view.bins.length; b++) s += res.annual.udi[i * 5 + view.bins[b]];
        o2[i] = 100 * s / hh;
      }
      return o2;
    }
    case 'ase': return res.annual ? res.annual.aseHours : null;
    case 'sunhours': return res.annual ? res.annual.sunHours : null;
  }
  return null;
}

/**
 * Descriptive statistics plus the daylighting-specific ratios.
 * `targetKey` decides what "% meeting target" means for this metric.
 */
function metricStats(metric, field, opts) {
  opts = opts || {};
  if (!field || !field.length) return null;
  var s = describe(field);
  var target = metric === 'df' ? (opts.dfTarget == null ? 2 : opts.dfTarget)
             : metric === 'illuminance' ? (opts.targetLux == null ? 300 : opts.targetLux)
             : metric === 'da' ? 50
             : metric === 'udi' ? 50
             : null;

  var pass = null;
  if (target != null) {
    var c = 0;
    for (var i = 0; i < field.length; i++) if (field[i] >= target) c++;
    pass = 100 * c / field.length;
  }
  return {
    n: s.n, min: s.min, max: s.max, mean: s.mean, median: s.median, sd: s.sd,
    uniformity: s.mean > 0 ? s.min / s.mean : 0,
    diversity: s.max > 0 ? s.min / s.max : 0,
    target: target, pass: pass
  };
}

/**
 * The three headline compliance numbers.
 *   sDA(target, 50%)  — LEED v4 / IES LM-83
 *   ASE(1000, 250)    — % of area with more than `aseHours` sunlit hours
 *   Mean UDI intervals
 */
function complianceSummary(res, a) {
  if (!res.annual) return null;
  var n = res.n, ann = res.annual, h = ann.hours || 1;
  var sda = 0, ase = 0;
  for (var i = 0; i < n; i++) {
    if (ann.daHours[i] / h >= 0.5) sda++;
    if (ann.aseHours[i] > a.aseHours) ase++;
  }
  var udiMean = [0, 0, 0, 0, 0];
  for (i = 0; i < n; i++) for (var b = 0; b < 5; b++) udiMean[b] += 100 * ann.udi[i * 5 + b] / h / n;
  return {
    sda: 100 * sda / n, ase: 100 * ase / n,
    udiMean: udiMean, hours: h,
    targetLux: a.targetLux, aseLux: a.aseLux, aseHours: a.aseHours
  };
}

/** Daylight Factor grades used by the DF legend and the info panel. */
var DF_BANDS = [
  { max: 1,   label: 'Poor — supplementary lighting needed all day' },
  { max: 2,   label: 'Modest — daylight perceptible, lighting still needed' },
  { max: 5,   label: 'Good — predominantly daylit' },
  { max: 1e9, label: 'Very high — glare and overheating likely' }
];
function dfGrade(df) {
  for (var i = 0; i < DF_BANDS.length; i++) if (df < DF_BANDS[i].max) return DF_BANDS[i];
  return DF_BANDS[DF_BANDS.length - 1];
}

/** Grid values as CSV, with the coordinates so it can be re-plotted. */
function gridToCsv(res, metric, field, meta) {
  var lines = [];
  lines.push('# Daylight Lab — ' + (METRICS[metric] ? METRICS[metric].label : metric));
  for (var k in meta) lines.push('# ' + k + ': ' + meta[k]);
  lines.push('index,x_m,y_m,z_m,' + metric + '_' + (METRICS[metric] ? METRICS[metric].unit.replace(/[^a-z%]/gi, '') : ''));
  for (var i = 0; i < res.n; i++) {
    lines.push(i + ',' + res.pts[i * 3].toFixed(3) + ',' + res.pts[i * 3 + 1].toFixed(3) + ',' +
               res.pts[i * 3 + 2].toFixed(3) + ',' + (field ? field[i].toFixed(3) : ''));
  }
  return lines.join('\n');
}
