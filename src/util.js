/* Small shared helpers. Everything in the build shares one IIFE scope. */

var DEG = Math.PI / 180, RAD = 180 / Math.PI;
var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
var lerp = function (a, b, t) { return a + (b - a) * t; };
var invLerp = function (a, b, v) { return b === a ? 0 : (v - a) / (b - a); };
var fract = function (v) { return v - Math.floor(v); };

/** Format a number with fixed decimals, stripped of a trailing ".00". */
function fmt(v, d) {
  if (!isFinite(v)) return '–';
  d = d == null ? 2 : d;
  var s = v.toFixed(d);
  return s.replace(/\.?0+$/, function (m) { return m.indexOf('.') === 0 ? '' : m; });
}
/** Metres, always 2 dp — the convention for every dimension in the app. */
function m2(v) { return v.toFixed(2); }
/** Big numbers with thin thousands separators. */
function num(v, d) {
  if (!isFinite(v)) return '–';
  return (d == null ? Math.round(v) : +v.toFixed(d)).toLocaleString('en-GB',
    { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 });
}
function hhmm(hours) {
  if (!isFinite(hours)) return '–';
  var h = Math.floor(hours), m = Math.round((hours - h) * 60);
  if (m === 60) { m = 0; h += 1; }
  return String((h % 24 + 24) % 24).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}
function deg(v, d) { return isFinite(v) ? v.toFixed(d == null ? 1 : d) + '°' : '–'; }

/** Day-of-year, 1..365 (no leap handling — the app uses a 365-day year). */
var MDAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
var MCUM = (function () { var c = [0], s = 0; for (var i = 0; i < 12; i++) { s += MDAYS[i]; c.push(s); } return c; })();
var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function doy(month, day) { return MCUM[clamp(month, 1, 12) - 1] + clamp(day, 1, 31); }
function fromDoy(n) {
  n = clamp(Math.round(n), 1, 365);
  for (var m = 11; m >= 0; m--) if (n > MCUM[m]) return { month: m + 1, day: n - MCUM[m] };
  return { month: 1, day: 1 };
}
function dateLabel(month, day) { return String(day).padStart(2, '0') + ' ' + MONTHS[month - 1]; }

/** Sort a copy ascending and pull percentiles / basic descriptive stats. */
function describe(values) {
  var n = values.length;
  if (!n) return { n: 0, min: NaN, max: NaN, mean: NaN, median: NaN, sd: NaN };
  var s = Float64Array.from(values); s.sort();
  var sum = 0; for (var i = 0; i < n; i++) sum += s[i];
  var mean = sum / n, vs = 0;
  for (i = 0; i < n; i++) { var d = s[i] - mean; vs += d * d; }
  return {
    n: n, min: s[0], max: s[n - 1], mean: mean, sd: Math.sqrt(vs / n),
    median: n % 2 ? s[(n - 1) >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2,
    p: function (q) { return s[clamp(Math.round(q * (n - 1)), 0, n - 1)]; }
  };
}

/** Xorshift PRNG — deterministic, so a re-run of the same model matches. */
function Rng(seed) {
  this.s = (seed | 0) || 0x9e3779b9;
}
Rng.prototype.next = function () {
  var x = this.s;
  x ^= x << 13; x |= 0; x ^= x >>> 17; x ^= x << 5; x |= 0;
  this.s = x;
  return (x >>> 0) / 4294967296;
};

/** Van der Corput / Halton low-discrepancy sequence for stable ray sampling. */
function halton(i, base) {
  var f = 1, r = 0;
  while (i > 0) { f /= base; r += f * (i % base); i = Math.floor(i / base); }
  return r;
}

function debounce(fn, ms) {
  var t = 0;
  return function () {
    var a = arguments, self = this;
    clearTimeout(t);
    t = setTimeout(function () { fn.apply(self, a); }, ms);
  };
}
function throttleRaf(fn) {
  var q = false, la = null, self = null;
  return function () {
    la = arguments; self = this;
    if (q) return;
    q = true;
    requestAnimationFrame(function () { q = false; fn.apply(self, la); });
  };
}

function el(tag, attrs, kids) {
  var n = document.createElement(tag);
  if (attrs) for (var k in attrs) {
    if (k === 'class') n.className = attrs[k];
    else if (k === 'text') n.textContent = attrs[k];
    else if (k === 'html') n.innerHTML = attrs[k];
    else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]);
    else if (attrs[k] != null && attrs[k] !== false) n.setAttribute(k, attrs[k]);
  }
  if (kids) for (var i = 0; i < kids.length; i++) if (kids[i]) n.appendChild(kids[i]);
  return n;
}
function $(sel, root) { return (root || document).querySelector(sel); }
function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

/** #rrggbb -> {r,g,b} 0..1 */
function hex2rgb(h) {
  var v = parseInt(h.slice(1), 16);
  return { r: ((v >> 16) & 255) / 255, g: ((v >> 8) & 255) / 255, b: (v & 255) / 255 };
}
function rgb2hex(r, g, b) {
  var f = function (x) { return String(clamp(Math.round(x * 255), 0, 255).toString(16)).padStart(2, '0'); };
  return '#' + f(r) + f(g) + f(b);
}
/** Read a resolved CSS custom property off <html>. */
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
