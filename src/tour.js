/* ==========================================================================
   Guided tour.

   A spotlight walkthrough that runs once on a student's first visit and can
   be replayed from the Help panel at any time. The dimmed backdrop is a
   single element with a very large box-shadow spread, so the "hole" is the
   element itself — no SVG mask, no four-panel gymnastics, and it follows the
   target exactly.

   Steps whose target is missing or hidden (the statistics panel on a phone,
   for instance) drop out of the sequence automatically, so the same script
   works at every width.
   ========================================================================== */

var TOUR_KEY = 'daylightlab.tour.v1';

var TOUR_STEPS = [
  {
    target: null,
    title: 'Welcome to Daylight Lab',
    body: 'Build a room, put a real sun over it, and read the daylight on the workplane. ' +
          'This takes about a minute — you can skip it and start it again from the help button any time.'
  },
  {
    target: '#metric-tabs', place: 'below',
    title: 'Choose what to measure',
    body: 'Illuminance and Daylight Factor are instant. UDI, DA, ASE and Sun hours run the whole ' +
          'year against a climate file and take a few seconds. Double-click any tab for the definition ' +
          'and the standard it comes from.'
  },
  {
    target: '#view', place: 'centre', padding: -140,
    title: 'The model',
    body: 'Drag to orbit, scroll to zoom, right-drag to pan. Drag any window, skylight or door to ' +
          'move it along its wall — Ctrl+Z undoes that. Click a dimension label to type an exact size.'
  },
  {
    target: '#rail', place: 'right',
    title: 'The toolbar',
    body: 'Twelve panels, collapsed to keep the model visible. Location, date and time, the room and ' +
          'its materials, openings, shading devices, the analysis settings, and how it all looks. ' +
          'The grey text on the right of each heading shows what is currently set.',
    before: function () { var d = $('#panel-room'); if (d) d.setAttribute('open', ''); },
    after: function () { var d = $('#panel-room'); if (d) d.removeAttribute('open'); }
  },
  {
    target: '#legend', place: 'left',
    title: 'The legend',
    body: 'The colour scale for the metric on screen, with the bands that matter for it — the ' +
          'daylight factor grades here, the five UDI intervals when you switch to UDI. Set the range ' +
          'by hand from the Display panel if you need two runs to share a scale.'
  },
  {
    target: '#stats', place: 'left',
    title: 'The numbers to write down',
    body: 'Minimum, mean, median and maximum, the min:mean uniformity ratio, and the percentage of ' +
          'floor area meeting the target. On Daylight Factor it also gives the BS 8206-2 average as a ' +
          'cross-check on the simulated mean.'
  },
  {
    target: '#timebar', place: 'above',
    title: 'Move the sun',
    body: 'The top slider scrubs the time of day, the bottom one the day of the year. The pale band ' +
          'marks daylight hours. Everything — shadows, solar rays, illuminance — follows instantly.'
  },
  {
    target: '#viewtools', place: 'below',
    title: 'Views and overlays',
    body: 'Plan view drops the camera under the roof and looks straight down, so you can read the ' +
          'workplane while the room stays fully enclosed in the calculation. The rest toggle solar ' +
          'rays, dimensions and values on the grid.'
  },
  {
    target: '#btn-run', place: 'below',
    title: 'Calculate, then export',
    body: 'The grid recalculates on its own whenever the model changes; this button forces a full-quality ' +
          'run. The download button next to it writes a presentation image with a title block, or the ' +
          'grid as CSV.'
  },
  {
    target: null,
    title: 'Try this first',
    body: 'Open Scenarios & case studies in the toolbar and run “Adding a 0.6 m overhang”. Look at the ' +
          'Daylight Factor, switch the engine to Split-flux, and see which one notices the overhang.'
  }
];

var Tour = {
  active: false,
  steps: [],
  i: 0,

  /** Only keep steps whose target is actually on screen at this width. */
  _visible: function () {
    return TOUR_STEPS.filter(function (s) {
      if (!s.target) return true;
      var n = $(s.target);
      if (!n) return false;
      var r = n.getBoundingClientRect();
      return r.width > 4 && r.height > 4;
    });
  },

  start: function (fromUser) {
    if (this.active) return;
    this.steps = this._visible();
    if (!this.steps.length) return;
    this.i = 0;
    this.active = true;
    this.fromUser = !!fromUser;
    $('#tour').classList.add('on');
    this.render();
    if (!this._resize) {
      var self = this;
      this._resize = function () { if (self.active) self.render(true); };
      window.addEventListener('resize', this._resize);
    }
  },

  end: function (completed) {
    if (!this.active) return;
    var s = this.steps[this.i];
    if (s && s.after) s.after();
    this.active = false;
    $('#tour').classList.remove('on');
    markTourSeen(completed ? 'done' : 'skipped');
    if (App.view) { App.view.dirty = true; App.dirty.labels = true; }
  },

  go: function (delta) {
    var prev = this.steps[this.i];
    if (prev && prev.after) prev.after();
    var next = this.i + delta;
    if (next < 0) return;
    if (next >= this.steps.length) { this.end(true); return; }
    this.i = next;
    this.render();
  },

  /** Position the spotlight and the card for the current step. */
  render: function (keepActions) {
    var s = this.steps[this.i];
    if (!s) return;
    if (s.before && !keepActions) s.before();

    var hole = $('#tour-hole'), card = $('#tour-card');
    var pad = s.padding == null ? 6 : s.padding;
    var vw = window.innerWidth, vh = window.innerHeight;
    var r = null;

    if (s.target) {
      var n = $(s.target);
      if (n) {
        var b = n.getBoundingClientRect();
        r = { left: b.left - pad, top: b.top - pad, width: b.width + pad * 2, height: b.height + pad * 2 };
      }
    }
    $('#tour').classList.toggle('no-hole', !r);
    if (r) {
      hole.style.display = 'block';
      hole.style.left = Math.max(-pad, r.left) + 'px';
      hole.style.top = Math.max(-pad, r.top) + 'px';
      hole.style.width = Math.min(r.width, vw) + 'px';
      hole.style.height = Math.min(r.height, vh) + 'px';
    } else {
      hole.style.display = 'none';
    }

    // ---- card contents
    $('#tour-step').textContent = (this.i + 1) + ' / ' + this.steps.length;
    $('#tour-title').textContent = s.title;
    $('#tour-body').textContent = s.body;
    $('#tour-back').disabled = this.i === 0;
    $('#tour-next').textContent = this.i === this.steps.length - 1 ? 'Finish' : 'Next';

    var dots = $('#tour-dots');
    dots.innerHTML = '';
    for (var k = 0; k < this.steps.length; k++) {
      dots.appendChild(el('i', { class: k === this.i ? 'on' : '' }));
    }

    // ---- placement: try the requested side, then fall back to whatever fits
    card.style.left = '0px'; card.style.top = '0px';
    var cw = card.offsetWidth, ch = card.offsetHeight, m = 14;
    var x, y;
    if (!r || s.place === 'centre') {
      x = (vw - cw) / 2;
      y = r ? Math.min(vh - ch - m, r.top + r.height / 2 - ch / 2) : (vh - ch) / 2;
    } else {
      var order = [s.place || 'below', 'below', 'above', 'right', 'left'];
      for (var q = 0; q < order.length; q++) {
        var p = order[q];
        if (p === 'below' && r.top + r.height + m + ch < vh) {
          x = r.left + r.width / 2 - cw / 2; y = r.top + r.height + m; break;
        }
        if (p === 'above' && r.top - m - ch > 0) {
          x = r.left + r.width / 2 - cw / 2; y = r.top - m - ch; break;
        }
        if (p === 'right' && r.left + r.width + m + cw < vw) {
          x = r.left + r.width + m; y = r.top + r.height / 2 - ch / 2; break;
        }
        if (p === 'left' && r.left - m - cw > 0) {
          x = r.left - m - cw; y = r.top + r.height / 2 - ch / 2; break;
        }
      }
      if (x == null) { x = (vw - cw) / 2; y = vh - ch - m; }
    }
    card.style.left = clamp(x, m, Math.max(m, vw - cw - m)) + 'px';
    card.style.top = clamp(y, m, Math.max(m, vh - ch - m)) + 'px';
  }
};

/** Build the tour DOM once, and wire its controls. */
function initTour() {
  var root = el('div', { id: 'tour' }, [
    el('div', { id: 'tour-hole' }),
    el('div', { id: 'tour-card' }, [
      el('div', { class: 't-head' }, [
        el('span', { id: 'tour-step', class: 't-step' }),
        el('button', { class: 'btn sm', id: 'tour-skip', text: 'Skip tour',
          onclick: function () { Tour.end(false); } })
      ]),
      el('h3', { id: 'tour-title' }),
      el('p', { id: 'tour-body' }),
      el('div', { class: 't-foot' }, [
        el('div', { id: 'tour-dots', class: 't-dots' }),
        el('button', { class: 'btn sm', id: 'tour-back', text: 'Back',
          onclick: function () { Tour.go(-1); } }),
        el('button', { class: 'btn sm primary', id: 'tour-next', text: 'Next',
          onclick: function () { Tour.go(1); } })
      ])
    ])
  ]);
  document.body.appendChild(root);

  // clicking the dimmed backdrop advances; clicking the card does not
  root.addEventListener('click', function (e) {
    if (e.target === root || e.target.id === 'tour-hole') Tour.go(1);
  });
}

/**
 * Remember that the tour has been seen. An iframe with site data blocked
 * throws on localStorage, so fall back to sessionStorage and then to a plain
 * variable, which at least stops it re-running within the page.
 */
var tourSeenMemory = false;
function tourSeen() {
  if (tourSeenMemory) return true;
  try { if (localStorage.getItem(TOUR_KEY)) return true; } catch (e) {}
  try { if (sessionStorage.getItem(TOUR_KEY)) return true; } catch (e) {}
  return false;
}
function markTourSeen(how) {
  tourSeenMemory = true;
  try { localStorage.setItem(TOUR_KEY, how); return; } catch (e) {}
  try { sessionStorage.setItem(TOUR_KEY, how); } catch (e) {}
}
