/* ==========================================================================
   Toolbar, panels and the teaching layer.

   Controls are declared, not hand-wired: each returns an element plus a
   refresh() that pulls its value back out of the model, so App.sync() keeps
   the whole toolbar consistent no matter what changed it — a slider, a
   dimension edit in the viewport, a preset, or a loaded scenario.
   ========================================================================== */

var UI = {
  refreshers: [],
  panels: {},
  selectedAperture: null
};

/* --- control factory ----------------------------------------------------- */

function reg(fn) { UI.refreshers.push(fn); return fn; }

function ctlNumber(get, set, o) {
  o = o || {};
  var i = el('input', {
    type: 'number', class: 'ctl',
    min: o.min, max: o.max, step: o.step == null ? 0.05 : o.step
  });
  var commit = function () {
    var v = parseFloat(i.value);
    if (!isFinite(v)) { i.value = fmtN(get(), o); return; }
    if (o.min != null) v = Math.max(o.min, v);
    if (o.max != null) v = Math.min(o.max, v);
    set(v);
    i.value = fmtN(v, o);
  };
  i.addEventListener('change', commit);
  i.addEventListener('keydown', function (e) { if (e.key === 'Enter') { commit(); i.blur(); } });
  reg(function () { if (document.activeElement !== i) i.value = fmtN(get(), o); });
  return i;
}
function fmtN(v, o) {
  var d = o.decimals != null ? o.decimals : (o.step && o.step < 0.01 ? 3 : o.step && o.step < 1 ? 2 : 0);
  return isFinite(v) ? (+v).toFixed(d) : '';
}

function ctlRange(get, set, o) {
  o = o || {};
  var wrap = el('div', { class: 'slider ctl' });
  var i = el('input', { type: 'range', min: o.min, max: o.max, step: o.step == null ? 1 : o.step });
  var out = el('output');
  var show = function (v) { out.textContent = (o.fmt ? o.fmt(v) : fmtN(v, o)) + (o.unit || ''); };
  i.addEventListener('input', function () { var v = +i.value; show(v); set(v, true); });
  i.addEventListener('change', function () { set(+i.value, false); });
  reg(function () { var v = get(); i.value = v; show(v); });
  wrap.appendChild(i); wrap.appendChild(out);
  return wrap;
}

function ctlSelect(items, get, set, o) {
  var s = el('select', { class: 'ctl' });
  (o && o.wide) && (s.className = 'ctl');
  items.forEach(function (it) {
    s.appendChild(el('option', { value: it.value, text: it.label }));
  });
  s.addEventListener('change', function () { set(s.value); });
  reg(function () { s.value = String(get()); });
  return s;
}

function ctlCheck(get, set, label) {
  var i = el('input', { type: 'checkbox' });
  i.addEventListener('change', function () { set(i.checked); });
  reg(function () { i.checked = !!get(); });
  return i;
}

function ctlSeg(items, get, set) {
  var w = el('div', { class: 'seg ctl' });
  var btns = items.map(function (it) {
    var b = el('button', { type: 'button', text: it.label, title: it.title || it.label });
    b.addEventListener('click', function () { set(it.value); UI.sync(); });
    w.appendChild(b);
    return { b: b, v: it.value };
  });
  reg(function () {
    var v = String(get());
    btns.forEach(function (x) { x.b.classList.toggle('on', String(x.v) === v); });
  });
  return w;
}

function row(label, ctl, o) {
  o = o || {};
  var kids = [];
  if (o.info) {
    kids.push(el('span', { class: 'lbl' }, [
      document.createTextNode(label + ' '),
      el('button', { class: 'info-btn', type: 'button', text: '?', title: 'What is this?',
        onclick: function (e) { e.stopPropagation(); App.openInfo(o.info); } })
    ]));
  } else {
    kids.push(el('label', { class: 'lbl', text: label }));
  }
  kids.push(ctl);
  return el('div', { class: 'row' + (o.wide ? ' wide' : '') }, kids);
}
function rowCheck(label, ctl, o) {
  return el('div', { class: 'row check' }, [ctl, el('label', { class: 'lbl', text: label })]);
}
function field(label, ctl) {
  return el('div', { class: 'field' }, [el('span', { text: label }), ctl]);
}
function subhead(text) { return el('div', { class: 'subhead', text: text }); }
function hint(text) { return el('div', { class: 'hint', text: text }); }

function panel(id, title, open, build) {
  var body = el('div', { class: 'panel-body' });
  var tag = el('span', { class: 'sum-tag' });
  var d = el('details', { class: 'panel', id: 'panel-' + id }, [
    el('summary', {}, [
      el('span', { class: 'chev', html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px"><polyline points="9 18 15 12 9 6"/></svg>' }),
      el('span', { text: title }),
      tag
    ]),
    body
  ]);
  if (open) d.setAttribute('open', '');
  build(body, tag);
  UI.panels[id] = { el: d, body: body, tag: tag };
  return d;
}

/* --- the rail ------------------------------------------------------------ */

UI.build = function (rail) {
  UI.refreshers = [];
  rail.innerHTML = '';
  rail.appendChild(panelLocation());
  rail.appendChild(panelTime());
  rail.appendChild(panelSolar());
  rail.appendChild(panelClimate());
  rail.appendChild(panelRoom());
  rail.appendChild(panelOpenings());
  rail.appendChild(panelShading());
  rail.appendChild(panelAnalysis());
  rail.appendChild(panelRays());
  rail.appendChild(panelDisplay());
  rail.appendChild(panelScenarios());
  rail.appendChild(panelExport());
};

UI.sync = function () {
  for (var i = 0; i < UI.refreshers.length; i++) {
    try { UI.refreshers[i](); } catch (e) { /* a rebuilt sub-panel dropped its node */ }
  }
  UI.updateTags();
};

UI.updateTags = function () {
  var m = App.model;
  var set = function (id, txt) { if (UI.panels[id]) UI.panels[id].tag.textContent = txt; };
  set('location', m.site.city);
  set('time', dateLabel(m.when.month, m.when.day) + ' ' + hhmm(m.when.hour));
  set('climate', App.climate ? (App.climate.synthetic ? 'built-in' : 'EPW') : '—');
  set('room', m2(m.room.L) + ' × ' + m2(m.room.W) + ' × ' + m2(m.room.H) + ' m');
  var win = 0, sky = 0, door = 0;
  m.apertures.forEach(function (a) {
    if (a.enabled === false) return;
    if (a.kind === 'skylight') sky++; else if (a.kind === 'door') door++; else win++;
  });
  set('openings', win + 'W · ' + sky + 'S · ' + door + 'D');
  var sh = 0;
  m.apertures.forEach(function (a) {
    if (a.shading && a.shading.h && a.shading.h.on) sh++;
    if (a.shading && a.shading.v && a.shading.v.on) sh++;
  });
  set('shading', sh ? sh + ' device' + (sh > 1 ? 's' : '') : 'none');
  set('analysis', (m.analysis.engine === 'raytrace' ? 'Raytraced' : 'Split-flux'));
  set('rays', App.rays.enabled ? App.rays.density + '/m²' : 'off');
  set('display', ({ light: 'Studio Light', dark: 'Dark Lab', clay: 'Clay' })[App.display.theme]);
  set('scenarios', App.scenarios.length + ' saved');
};

/* --- 1. location --------------------------------------------------------- */
function panelLocation() {
  return panel('location', 'Location & site', false, function (b) {
    var items = CITIES.map(function (c) { return { value: c.name, label: c.name }; });
    items.unshift({ value: '__custom', label: 'Custom coordinates…' });
    b.appendChild(row('City', ctlSelect(items,
      function () { return App.model.site.city; },
      function (v) {
        if (v === '__custom') { App.model.site.city = 'Custom'; UI.sync(); return; }
        var c = CITIES.filter(function (x) { return x.name === v; })[0];
        if (!c) return;
        var s = App.model.site;
        s.city = c.name; s.lat = c.lat; s.lon = c.lon; s.tz = c.tz;
        App.onSiteChanged();
      }), { wide: true }));

    b.appendChild(el('div', { class: 'grid3' }, [
      field('Latitude °', ctlNumber(
        function () { return App.model.site.lat; },
        function (v) { App.model.site.lat = v; App.model.site.city = 'Custom'; App.onSiteChanged(); },
        { min: -90, max: 90, step: 0.01, decimals: 2 })),
      field('Longitude °', ctlNumber(
        function () { return App.model.site.lon; },
        function (v) { App.model.site.lon = v; App.model.site.city = 'Custom'; App.onSiteChanged(); },
        { min: -180, max: 180, step: 0.01, decimals: 2 })),
      field('Time zone', ctlNumber(
        function () { return App.model.site.tz; },
        function (v) { App.model.site.tz = v; App.onSiteChanged(); },
        { min: -12, max: 14, step: 0.5, decimals: 1 }))
    ]));

    b.appendChild(row('Project north', ctlRange(
      function () { return App.model.room.northAngle; },
      function (v) { App.model.room.northAngle = v; App.onSiteChanged(); },
      { min: -180, max: 180, step: 1, unit: '°', decimals: 0 })));

    b.appendChild(row('Ground reflectance', ctlRange(
      function () { return App.model.room.refl.ground; },
      function (v, live) { App.model.room.refl.ground = v; App.markDirty('materials', live); },
      { min: 0, max: 0.9, step: 0.01, decimals: 2 })));

    b.appendChild(row('Obstruction angle', ctlRange(
      function () { return App.model.site.obstructionAngle; },
      function (v, live) { App.model.site.obstructionAngle = v; App.markDirty('splitflux', live); },
      { min: 0, max: 80, step: 1, unit: '°', decimals: 0 }), { info: 'obstruction' }));

    b.appendChild(rowCheck('Daylight saving in effect', ctlCheck(
      function () { return App.model.site.dst; },
      function (v) { App.model.site.dst = v; App.updateSun(); UI.sync(); })));
  });
}

/* --- 2. date & time ------------------------------------------------------ */
function panelTime() {
  return panel('time', 'Date & time', false, function (b) {
    b.appendChild(el('div', { class: 'grid3' }, [
      field('Day', ctlNumber(
        function () { return App.model.when.day; },
        function (v) { App.model.when.day = clamp(Math.round(v), 1, MDAYS[App.model.when.month - 1]); App.updateSun(); UI.sync(); },
        { min: 1, max: 31, step: 1, decimals: 0 })),
      field('Month', ctlSelect(MONTHS.map(function (m, i) { return { value: i + 1, label: m }; }),
        function () { return App.model.when.month; },
        function (v) {
          App.model.when.month = +v;
          App.model.when.day = clamp(App.model.when.day, 1, MDAYS[+v - 1]);
          App.updateSun(); UI.sync();
        })),
      field('Year', ctlNumber(
        function () { return App.model.when.year; },
        function (v) { App.model.when.year = clamp(Math.round(v), 1900, 2100); App.updateSun(); UI.sync(); },
        { min: 1900, max: 2100, step: 1, decimals: 0 }))
    ]));

    b.appendChild(row('Time', ctlRange(
      function () { return App.model.when.hour * 60; },
      function (v) { App.model.when.hour = v / 60; App.updateSun(); },
      { min: 0, max: 1439, step: 5, fmt: function (v) { return hhmm(v / 60); } })));

    b.appendChild(el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn sm', text: 'Solar noon', onclick: function () {
        App.model.when.hour = clamp(App.sun.solarNoon, 0, 23.99); App.updateSun(); UI.sync();
      } }),
      el('button', { class: 'btn sm', text: '9:00' , onclick: function () { App.model.when.hour = 9; App.updateSun(); UI.sync(); } }),
      el('button', { class: 'btn sm', text: '15:00', onclick: function () { App.model.when.hour = 15; App.updateSun(); UI.sync(); } })
    ]));
    b.appendChild(el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn sm', text: '21 Mar', onclick: function () { App.setDate(3, 21); } }),
      el('button', { class: 'btn sm', text: '21 Jun', onclick: function () { App.setDate(6, 21); } }),
      el('button', { class: 'btn sm', text: '21 Sep', onclick: function () { App.setDate(9, 21); } }),
      el('button', { class: 'btn sm', text: '21 Dec', onclick: function () { App.setDate(12, 21); } })
    ]));
    b.appendChild(el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn sm', id: 'anim-day', text: '▶ Animate day',
        onclick: function () { App.toggleAnimate('day'); } }),
      el('button', { class: 'btn sm', id: 'anim-year', text: '▶ Animate year',
        onclick: function () { App.toggleAnimate('year'); } })
    ]));
  });
}

/* --- 3. solar information ------------------------------------------------ */
function panelSolar() {
  return panel('solar', 'Solar information', false, function (b) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = 'spchart';
    b.appendChild(svg);
    // draw on open, and whenever the panel is already open and the sun moves
    setTimeout(function () {
      var d = UI.panels.solar && UI.panels.solar.el;
      if (!d) return;
      d.addEventListener('toggle', function () {
        if (d.open) renderSunChart(svg, App.model, App.sun);
      });
      if (d.open) renderSunChart(svg, App.model, App.sun);
    }, 0);
    b.appendChild(hint('Stereographic sun-path diagram. Bold arcs are the solstices and equinox; the highlighted arc is the selected date.'));

    var grid = el('div', { class: 'grid2', id: 'solar-facts' });
    b.appendChild(grid);
    reg(function () {
      var s = App.sun, m = App.model;
      var irr = App.currentIrradiance();
      var pairs = [
        ['Altitude', deg(s.altitude)], ['Azimuth', deg(s.azimuth)],
        ['Declination', deg(s.declination)], ['Hour angle', deg(s.hourAngle)],
        ['Equation of time', s.eqTime.toFixed(1) + ' min'], ['Solar time', hhmm(s.solarTime)],
        ['Sunrise', hhmm(s.sunrise + (m.site.dst ? 1 : 0))], ['Sunset', hhmm(s.sunset + (m.site.dst ? 1 : 0))],
        ['Solar noon', hhmm(s.solarNoon + (m.site.dst ? 1 : 0))], ['Day length', s.dayLength.toFixed(2) + ' h'],
        ['DNI', num(irr.dni) + ' W/m²'], ['DHI', num(irr.dhi) + ' W/m²'],
        ['GHI', num(irr.ghi) + ' W/m²'], ['Sky', (SKY_MODELS[m.analysis.skyModel] || {}).label]
      ];
      grid.innerHTML = '';
      pairs.forEach(function (p) {
        grid.appendChild(el('div', { class: 'row' }, [
          el('span', { class: 'lbl', text: p[0] }),
          el('span', { style: 'font-family:var(--font-num);font-size:11px', text: p[1] })
        ]));
      });
    });
  });
}

/* --- 4. climate ---------------------------------------------------------- */
function panelClimate() {
  return panel('climate', 'Climate & EPW', false, function (b) {
    var drop = el('div', { class: 'drop', id: 'epw-drop' }, [
      el('b', { text: 'Drop an .epw file here' }),
      el('span', { text: 'or click to choose — EnergyPlus Weather, 8760 hours' })
    ]);
    drop.addEventListener('click', function () { $('#file-epw').click(); });
    ['dragenter', 'dragover'].forEach(function (e) {
      drop.addEventListener(e, function (ev) { ev.preventDefault(); drop.classList.add('over'); });
    });
    ['dragleave', 'drop'].forEach(function (e) {
      drop.addEventListener(e, function (ev) { ev.preventDefault(); drop.classList.remove('over'); });
    });
    drop.addEventListener('drop', function (ev) {
      var f = ev.dataTransfer.files && ev.dataTransfer.files[0];
      if (f) App.loadEpwFile(f);
    });
    b.appendChild(drop);

    var info = el('div', { style: 'display:flex;flex-direction:column;gap:5px' });
    b.appendChild(info);
    var bars = el('div', { class: 'climate-bars' });
    var labs = el('div', { class: 'climate-lbl' });
    b.appendChild(bars); b.appendChild(labs);

    reg(function () {
      var c = App.climate;
      info.innerHTML = '';
      if (!c) return;
      info.appendChild(el('div', { class: 'row' }, [
        el('span', { class: 'lbl', text: 'Source' }),
        el('span', { style: 'font-family:var(--font-num);font-size:11px', text: c.name })
      ]));
      info.appendChild(el('div', { class: 'row' }, [
        el('span', { class: 'lbl', text: 'Annual global' }),
        el('span', { style: 'font-family:var(--font-num);font-size:11px',
          text: num(c.monthly.reduce(function (s, m) { return s + m.ghiMean * MDAYS[m.month - 1] * 24 / 1000; }, 0)) + ' kWh/m²' })
      ]));
      bars.innerHTML = ''; labs.innerHTML = '';
      var mx = Math.max.apply(null, c.monthly.map(function (m) { return m.ghiMean; })) || 1;
      c.monthly.forEach(function (m) {
        bars.appendChild(el('i', {
          style: 'height:' + (100 * m.ghiMean / mx).toFixed(1) + '%',
          title: MONTHS[m.month - 1] + ': ' + num(m.ghiMean) + ' W/m² mean GHI'
        }));
        labs.appendChild(el('span', { text: MONTHS[m.month - 1][0] }));
      });
    });

    b.appendChild(row('Sky model', ctlSelect(
      Object.keys(SKY_MODELS).map(function (k) { return { value: k, label: SKY_MODELS[k].label }; }),
      function () { return App.model.analysis.skyModel; },
      function (v) { App.model.analysis.skyModel = v; App.markDirty('sky'); UI.sync(); }), { info: 'skies' }));

    b.appendChild(row('Design sky', ctlNumber(
      function () { return App.model.analysis.designLux; },
      function (v) { App.model.analysis.designLux = v; App.markDirty('sky'); },
      { min: 1000, max: 40000, step: 500, decimals: 0 }), { info: 'designsky' }));

    b.appendChild(el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn sm', text: 'Reset to built-in climate',
        onclick: function () { App.useSyntheticClimate(); } })
    ]));
    b.appendChild(hint('Without an EPW the app uses a deterministic synthetic climate for the site, so every annual metric still runs. Import a real EPW before quoting any number.'));
  });
}

/* --- 5. room & materials ------------------------------------------------- */
function panelRoom() {
  return panel('room', 'Room & materials', false, function (b) {
    b.appendChild(subhead('Internal dimensions (m)'));
    b.appendChild(el('div', { class: 'grid3' }, [
      field('Length X', ctlNumber(
        function () { return App.model.room.L; },
        function (v) { App.model.room.L = v; App.markDirty('geometry'); },
        { min: 1, max: 60, step: 0.1, decimals: 2 })),
      field('Width Z', ctlNumber(
        function () { return App.model.room.W; },
        function (v) { App.model.room.W = v; App.markDirty('geometry'); },
        { min: 1, max: 60, step: 0.1, decimals: 2 })),
      field('Height Y', ctlNumber(
        function () { return App.model.room.H; },
        function (v) { App.model.room.H = v; App.markDirty('geometry'); },
        { min: 1.8, max: 15, step: 0.1, decimals: 2 }))
    ]));

    b.appendChild(subhead('Construction thickness (m)'));
    b.appendChild(el('div', { class: 'grid3' }, [
      field('Walls', ctlNumber(
        function () { return App.model.room.tWall; },
        function (v) { App.model.room.tWall = v; App.markDirty('geometry'); },
        { min: 0.05, max: 1.5, step: 0.01, decimals: 2 })),
      field('Roof', ctlNumber(
        function () { return App.model.room.tRoof; },
        function (v) { App.model.room.tRoof = v; App.markDirty('geometry'); },
        { min: 0.05, max: 2, step: 0.01, decimals: 2 })),
      field('Floor', ctlNumber(
        function () { return App.model.room.tFloor; },
        function (v) { App.model.room.tFloor = v; App.markDirty('geometry'); },
        { min: 0.05, max: 2, step: 0.01, decimals: 2 }))
    ]));
    b.appendChild(hint('Wall thickness creates real reveals and the roof thickness a real skylight well. Both shade the workplane and both are in the calculation.'));

    b.appendChild(subhead('Surface reflectance'));
    b.appendChild(row('Preset', ctlSelect(
      [{ value: '', label: 'Choose…' }].concat(Object.keys(REFL_PRESETS).map(function (k) { return { value: k, label: k }; })),
      function () { return ''; },
      function (v) {
        if (!v) return;
        Object.assign(App.model.room.refl, REFL_PRESETS[v]);
        App.model.room.refl.reveal = App.model.room.refl.wall;
        App.markDirty('materials'); UI.sync();
      }), { wide: true }));

    [['floor', 'Floor'], ['wall', 'Walls'], ['ceiling', 'Ceiling'], ['ext', 'External surfaces'], ['shade', 'Shading devices']]
      .forEach(function (p) {
        b.appendChild(row(p[1], ctlRange(
          function () { return App.model.room.refl[p[0]]; },
          function (v, live) {
            App.model.room.refl[p[0]] = v;
            if (p[0] === 'wall') App.model.room.refl.reveal = v;
            App.markDirty('materials', live);
          },
          { min: 0, max: 0.95, step: 0.01, decimals: 2 })));
      });
    b.appendChild(hint('Visible reflectance, 0–1. Typical: floor 0.20, walls 0.50, ceiling 0.70.'));
  });
}

/* --- 6. openings --------------------------------------------------------- */
var SIDE_LABELS = { N: 'North', E: 'East', S: 'South', W: 'West', roof: 'Roof' };
var SIDE_COLORS = { N: '#5b8def', E: '#f2a33c', S: '#e05252', W: '#8a5cd6', roof: '#3fae8e' };

function panelOpenings() {
  return panel('openings', 'Openings', false, function (b) {
    b.appendChild(el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn sm', text: '+ Window', onclick: function () { App.addAperture('window'); } }),
      el('button', { class: 'btn sm', text: '+ Skylight', onclick: function () { App.addAperture('skylight'); } }),
      el('button', { class: 'btn sm', text: '+ Door', onclick: function () { App.addAperture('door'); } })
    ]));

    var list = el('div', { class: 'ap-list' });
    b.appendChild(list);
    reg(function () { renderApertureList(list); });

    b.appendChild(hint('Click a row to select it — the selected opening is the one the Shading panel and the aperture dimensions refer to.'));
    b.appendChild(hint('Or just drag the opening in the viewport: windows and doors slide along their wall and up or down, skylights slide across the roof. Positions snap to 0.05 m — hold Alt for free placement, and Ctrl+Z to undo.'));
  });
}

function renderApertureList(list) {
  var m = App.model;
  list.innerHTML = '';
  if (!m.apertures.length) {
    list.appendChild(hint('No openings. The room is sealed — every metric will read zero.'));
    return;
  }
  m.apertures.forEach(function (ap, idx) {
    var sel = UI.selectedAperture === ap.id;
    var item = el('div', { class: 'ap-item' + (sel ? ' sel' : '') });
    var head = el('div', { class: 'ap-head' }, [
      el('div', { class: 'ap-dot', style: 'background:' + SIDE_COLORS[ap.side] }),
      el('div', { class: 'ap-name', text: ap.name }),
      el('div', { class: 'ap-dim', text: m2(ap.w) + '×' + m2(ap.h) })
    ]);
    head.addEventListener('click', function () {
      UI.selectedAperture = sel ? null : ap.id;
      App.markDirty('dims'); UI.sync();
    });
    item.appendChild(head);

    if (sel) item.appendChild(apertureBody(ap, idx));
    list.appendChild(item);
  });
}

function apertureBody(ap, idx) {
  var body = el('div', { class: 'ap-body' });
  var d = function () { App.markDirty('geometry'); };

  body.appendChild(el('div', { class: 'grid2' }, [
    field('Name', (function () {
      var i = el('input', { type: 'text', value: ap.name });
      i.addEventListener('change', function () { ap.name = i.value || 'Opening'; UI.sync(); });
      return i;
    })()),
    field('Wall', ctlSelect(
      (ap.kind === 'skylight' ? ['roof'] : ['N', 'E', 'S', 'W']).map(function (s) {
        return { value: s, label: SIDE_LABELS[s] };
      }),
      function () { return ap.side; },
      function (v) { ap.side = v; d(); UI.sync(); }))
  ]));

  body.appendChild(el('div', { class: 'grid2' }, [
    field('Width (m)', ctlNumber(function () { return ap.w; },
      function (v) { ap.w = v; d(); }, { min: 0.1, max: 30, step: 0.05, decimals: 2 })),
    field(ap.side === 'roof' ? 'Depth (m)' : 'Height (m)', ctlNumber(function () { return ap.h; },
      function (v) { ap.h = v; d(); }, { min: 0.1, max: 30, step: 0.05, decimals: 2 }))
  ]));

  if (ap.side === 'roof') {
    body.appendChild(el('div', { class: 'grid2' }, [
      field('Offset X (m)', ctlNumber(function () { return ap.offset; },
        function (v) { ap.offset = v; d(); }, { min: -30, max: 30, step: 0.05, decimals: 2 })),
      field('Offset Z (m)', ctlNumber(function () { return ap.offset2; },
        function (v) { ap.offset2 = v; d(); }, { min: -30, max: 30, step: 0.05, decimals: 2 }))
    ]));
  } else {
    body.appendChild(el('div', { class: 'grid2' }, [
      field('Sill height (m)', ctlNumber(function () { return ap.sill; },
        function (v) { ap.sill = v; d(); }, { min: 0, max: 12, step: 0.05, decimals: 2 })),
      field('Offset along wall', ctlNumber(function () { return ap.offset; },
        function (v) { ap.offset = v; d(); }, { min: -30, max: 30, step: 0.05, decimals: 2 }))
    ]));
  }

  if (ap.kind === 'door') {
    body.appendChild(rowCheck('Door open (acts as an aperture)', ctlCheck(
      function () { return ap.open; }, function (v) { ap.open = v; d(); })));
  } else {
    body.appendChild(row('Glazing', ctlSelect(
      Object.keys(GLAZING_PRESETS).map(function (k) { return { value: GLAZING_PRESETS[k], label: k }; }),
      function () { return ap.tau; },
      function (v) { ap.tau = +v; App.markDirty('materials'); UI.sync(); }), { wide: true }));
    body.appendChild(el('div', { class: 'grid3' }, [
      field('τ visible', ctlNumber(function () { return ap.tau; },
        function (v) { ap.tau = v; App.markDirty('materials'); }, { min: 0, max: 1, step: 0.01, decimals: 2 })),
      field('Maintenance', ctlNumber(function () { return ap.maintenance; },
        function (v) { ap.maintenance = v; App.markDirty('materials'); }, { min: 0.3, max: 1, step: 0.01, decimals: 2 })),
      field('Frame (m)', ctlNumber(function () { return ap.frameWidth; },
        function (v) { ap.frameWidth = v; d(); }, { min: 0, max: 0.4, step: 0.005, decimals: 3 }))
    ]));
    body.appendChild(row('Glass position in reveal', ctlRange(
      function () { return ap.glassPos; },
      function (v, live) { ap.glassPos = v; App.markDirty('geometry', live); },
      { min: 0, max: 1, step: 0.05, decimals: 2,
        fmt: function (v) { return v < 0.2 ? 'inside' : v > 0.8 ? 'outside' : 'centre'; } })));
  }

  body.appendChild(el('div', { class: 'btn-row' }, [
    el('button', { class: 'btn sm', text: 'Duplicate', onclick: function () { App.duplicateAperture(idx); } }),
    el('button', { class: 'btn sm', text: ap.enabled === false ? 'Enable' : 'Disable',
      onclick: function () { ap.enabled = ap.enabled === false; App.markDirty('geometry'); UI.sync(); } }),
    el('button', { class: 'btn sm danger', text: 'Delete', onclick: function () { App.deleteAperture(idx); } })
  ]));
  return body;
}

/* --- 7. shading ---------------------------------------------------------- */
function panelShading() {
  return panel('shading', 'Shading devices', false, function (b) {
    var host = el('div', { style: 'display:flex;flex-direction:column;gap:9px' });
    b.appendChild(host);
    reg(function () { renderShading(host); });
  });
}

function renderShading(host) {
  host.innerHTML = '';
  var m = App.model;
  var ap = null;
  for (var i = 0; i < m.apertures.length; i++) if (m.apertures[i].id === UI.selectedAperture) ap = m.apertures[i];
  if (!ap) {
    var sel = el('select');
    sel.appendChild(el('option', { value: '', text: 'Select an opening…' }));
    m.apertures.forEach(function (a) {
      if (a.kind === 'door') return;
      sel.appendChild(el('option', { value: a.id, text: a.name + ' (' + SIDE_LABELS[a.side] + ')' }));
    });
    sel.addEventListener('change', function () { UI.selectedAperture = sel.value || null; App.markDirty('dims'); UI.sync(); });
    host.appendChild(sel);
    host.appendChild(hint('Shading devices belong to an opening. Choose one above, or click it in the Openings panel.'));
    host.appendChild(el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn sm', text: 'Apply overhang to all windows',
        onclick: function () { App.applyShadingToAll('h'); } }),
      el('button', { class: 'btn sm', text: 'Remove all shading',
        onclick: function () { App.clearAllShading(); } })
    ]));
    return;
  }

  host.appendChild(el('div', { class: 'row' }, [
    el('span', { class: 'lbl', text: 'Opening' }),
    el('span', { style: 'font-family:var(--font-num);font-size:11px', text: ap.name })
  ]));

  var d = function (live) { App.markDirty('geometry', live); };
  var s = ap.shading || (ap.shading = defaultShading());

  /* horizontal */
  host.appendChild(subhead('Horizontal — overhang / louvres'));
  host.appendChild(rowCheck('Enabled', ctlCheck(
    function () { return s.h.on; }, function (v) { s.h.on = v; d(); UI.sync(); })));
  if (s.h.on) {
    host.appendChild(el('div', { class: 'grid2' }, [
      field('Depth (m)', ctlNumber(function () { return s.h.depth; },
        function (v) { s.h.depth = v; d(); }, { min: 0.02, max: 6, step: 0.05, decimals: 2 })),
      field('Thickness (m)', ctlNumber(function () { return s.h.thickness; },
        function (v) { s.h.thickness = v; d(); }, { min: 0.005, max: 0.8, step: 0.005, decimals: 3 }))
    ]));
    host.appendChild(el('div', { class: 'grid2' }, [
      field('Above head (m)', ctlNumber(function () { return s.h.offset; },
        function (v) { s.h.offset = v; d(); }, { min: 0, max: 4, step: 0.05, decimals: 2 })),
      field('Past jambs (m)', ctlNumber(function () { return s.h.extend; },
        function (v) { s.h.extend = v; d(); }, { min: 0, max: 4, step: 0.05, decimals: 2 }))
    ]));
    host.appendChild(el('div', { class: 'grid2' }, [
      field('Blades', ctlNumber(function () { return s.h.count; },
        function (v) { s.h.count = Math.max(1, Math.round(v)); d(); }, { min: 1, max: 30, step: 1, decimals: 0 })),
      field('Tilt (°)', ctlNumber(function () { return s.h.tilt; },
        function (v) { s.h.tilt = v; d(); }, { min: -80, max: 80, step: 1, decimals: 0 }))
    ]));
  }

  /* vertical */
  host.appendChild(subhead('Vertical — fins'));
  host.appendChild(rowCheck('Enabled', ctlCheck(
    function () { return s.v.on; }, function (v) { s.v.on = v; d(); UI.sync(); })));
  if (s.v.on) {
    host.appendChild(el('div', { class: 'grid2' }, [
      field('Depth (m)', ctlNumber(function () { return s.v.depth; },
        function (v) { s.v.depth = v; d(); }, { min: 0.02, max: 6, step: 0.05, decimals: 2 })),
      field('Thickness (m)', ctlNumber(function () { return s.v.thickness; },
        function (v) { s.v.thickness = v; d(); }, { min: 0.005, max: 0.8, step: 0.005, decimals: 3 }))
    ]));
    host.appendChild(el('div', { class: 'grid2' }, [
      field('From jamb (m)', ctlNumber(function () { return s.v.offset; },
        function (v) { s.v.offset = v; d(); }, { min: 0, max: 3, step: 0.05, decimals: 2 })),
      field('Beyond head (m)', ctlNumber(function () { return s.v.extend; },
        function (v) { s.v.extend = v; d(); }, { min: 0, max: 4, step: 0.05, decimals: 2 }))
    ]));
    host.appendChild(el('div', { class: 'grid3' }, [
      field('Fins', ctlNumber(function () { return s.v.count; },
        function (v) { s.v.count = Math.max(1, Math.round(v)); d(); }, { min: 1, max: 30, step: 1, decimals: 0 })),
      field('Tilt (°)', ctlNumber(function () { return s.v.tilt; },
        function (v) { s.v.tilt = v; d(); }, { min: -80, max: 80, step: 1, decimals: 0 })),
      field('Side', ctlSelect(
        [{ value: 'both', label: 'Both' }, { value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }],
        function () { return s.v.side; }, function (v) { s.v.side = v; d(); }))
    ]));
  }

  var ang = shadingAngles(ap);
  if (ang.vsa != null || ang.hsa != null) {
    host.appendChild(subhead('Shadow angles'));
    if (ang.vsa != null) host.appendChild(el('div', { class: 'row' }, [
      el('span', { class: 'lbl', text: 'Vertical shadow angle' }),
      el('span', { style: 'font-family:var(--font-num);font-size:11px', text: deg(ang.vsa) })
    ]));
    if (ang.hsa != null) host.appendChild(el('div', { class: 'row' }, [
      el('span', { class: 'lbl', text: 'Horizontal shadow angle' }),
      el('span', { style: 'font-family:var(--font-num);font-size:11px', text: deg(ang.hsa) })
    ]));
    host.appendChild(hint('The overhang fully shades the opening whenever the solar altitude exceeds the vertical shadow angle.'));
  }
}

/* --- 8. analysis --------------------------------------------------------- */
function panelAnalysis() {
  return panel('analysis', 'Analysis', false, function (b) {
    b.appendChild(row('Engine', ctlSeg([
      { value: 'raytrace', label: 'Raytraced', title: 'Daylight coefficients — sees shading, reveals and interreflection' },
      { value: 'splitflux', label: 'Split-flux', title: 'BRE method with shading and direct sun — instant, but no reveals and a uniform interreflected component' }
    ], function () { return App.model.analysis.engine; },
       function (v) { App.model.analysis.engine = v; App.markDirty('engine'); }), { wide: true, info: 'engines' }));

    b.appendChild(row('Quality', ctlSelect(
      Object.keys(QUALITY).map(function (k) { return { value: k, label: QUALITY[k].label + ' — ' + QUALITY[k].rays + ' rays' }; }),
      function () { return App.model.analysis.quality; },
      function (v) { App.model.analysis.quality = v; App.markDirty('bake'); UI.sync(); }), { wide: true }));

    b.appendChild(subhead('Workplane grid'));
    b.appendChild(el('div', { class: 'grid3' }, [
      field('Spacing (m)', ctlNumber(
        function () { return App.model.grid.spacing; },
        function (v) { App.model.grid.spacing = v; App.markDirty('grid'); UI.sync(); },
        { min: 0.1, max: 3, step: 0.05, decimals: 2 })),
      field('Height (m)', ctlNumber(
        function () { return App.model.grid.height; },
        function (v) { App.model.grid.height = v; App.markDirty('grid'); },
        { min: 0, max: 5, step: 0.05, decimals: 2 })),
      field('Margin (m)', ctlNumber(
        function () { return App.model.grid.margin; },
        function (v) { App.model.grid.margin = v; App.markDirty('grid'); UI.sync(); },
        { min: 0, max: 3, step: 0.05, decimals: 2 }))
    ]));
    var gtxt = el('div', { class: 'hint' });
    b.appendChild(gtxt);
    reg(function () {
      var g = App.gridInfo();
      gtxt.textContent = g.nx + ' × ' + g.nz + ' = ' + g.n + ' points, ' +
        m2(App.model.grid.spacing) + ' m spacing at ' + m2(App.model.grid.height) + ' m above floor.';
    });

    b.appendChild(subhead('Thresholds'));
    b.appendChild(el('div', { class: 'grid2' }, [
      field('Target (lux)', ctlNumber(
        function () { return App.model.analysis.targetLux; },
        function (v) { App.model.analysis.targetLux = v; App.markDirty('annual'); },
        { min: 50, max: 3000, step: 50, decimals: 0 })),
      field('Occupied hours', (function () {
        var w = el('div', { style: 'display:flex;gap:4px' });
        w.appendChild(ctlNumber(function () { return App.model.analysis.occStart; },
          function (v) { App.model.analysis.occStart = clamp(Math.round(v), 0, 23); App.markDirty('annual'); },
          { min: 0, max: 23, step: 1, decimals: 0 }));
        w.appendChild(ctlNumber(function () { return App.model.analysis.occEnd; },
          function (v) { App.model.analysis.occEnd = clamp(Math.round(v), 1, 24); App.markDirty('annual'); },
          { min: 1, max: 24, step: 1, decimals: 0 }));
        return w;
      })())
    ]));

    b.appendChild(row('UDI thresholds (lux)', el('span', { class: 'lbl' }), { wide: true, info: 'udi' }));
    var udiRow = el('div', { class: 'grid2', style: 'gap:5px' });
    [0, 1, 2, 3].forEach(function (i) {
      udiRow.appendChild(field(['t1 too low', 't2 low', 't3 in range', 't4 too high'][i], ctlNumber(
        function () { return App.model.analysis.udi[i]; },
        function (v) {
          var u = App.model.analysis.udi;
          u[i] = v;
          for (var k = 1; k < 4; k++) u[k] = Math.max(u[k], u[k - 1] + 1);
          App.markDirty('annual'); UI.sync();
        }, { min: 10, max: 20000, step: 10, decimals: 0 })));
    });
    b.appendChild(udiRow);
    b.appendChild(el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn sm', text: '150/300/500/3000',
        onclick: function () { App.setUdi([150, 300, 500, 3000]); } }),
      el('button', { class: 'btn sm', text: '100/300/3000 (4-bin)',
        onclick: function () { App.setUdi([100, 300, 3000, 3001]); } }),
      el('button', { class: 'btn sm', text: '100/2000 (2005)',
        onclick: function () { App.setUdi([100, 101, 2000, 2001]); } })
    ]));

    b.appendChild(el('div', { class: 'grid2' }, [
      field('ASE lux', ctlNumber(
        function () { return App.model.analysis.aseLux; },
        function (v) { App.model.analysis.aseLux = v; App.markDirty('annual'); },
        { min: 100, max: 10000, step: 100, decimals: 0 })),
      field('ASE hours', ctlNumber(
        function () { return App.model.analysis.aseHours; },
        function (v) { App.model.analysis.aseHours = v; App.markDirty('compliance'); },
        { min: 10, max: 2000, step: 10, decimals: 0 }))
    ]));

    b.appendChild(subhead('Compliance summary'));
    var comp = el('div', { style: 'display:flex;flex-direction:column;gap:2px' });
    b.appendChild(comp);
    reg(function () { renderCompliance(comp); });
  });
}

function renderCompliance(host) {
  host.innerHTML = '';
  var c = App.compliance, a = App.model.analysis;
  if (!c) { host.appendChild(hint('Run an annual calculation (choose UDI, DA, ASE or Sun hours) to fill this in.')); return; }
  var rows = [
    ['sDA' + num(a.targetLux) + '/50%', c.sda.toFixed(0) + '% of area'],
    ['ASE' + num(a.aseLux) + ',' + num(a.aseHours), c.ase.toFixed(0) + '% of area'],
    ['Mean UDI in range', c.udiMean[2].toFixed(0) + '%'],
    ['Mean UDI useful', (c.udiMean[2] + c.udiMean[3]).toFixed(0) + '%'],
    ['Mean UDI too high', c.udiMean[4].toFixed(0) + '%'],
    ['Occupied hours/yr', num(c.hours)]
  ];
  rows.forEach(function (r) {
    host.appendChild(el('div', { class: 'row' }, [
      el('span', { class: 'lbl', text: r[0] }),
      el('span', { style: 'font-family:var(--font-num);font-size:11px;font-weight:600', text: r[1] })
    ]));
  });
}

/* --- 9. sun rays & shadows ----------------------------------------------- */
function panelRays() {
  return panel('rays', 'Solar rays & shadows', false, function (b) {
    b.appendChild(rowCheck('Show solar ray access', ctlCheck(
      function () { return App.rays.enabled; },
      function (v) { App.rays.enabled = v; App.markDirty('rays'); UI.sync(); })));
    b.appendChild(hint('Rays are traced from the sun through the glazing, so an overhang or a fin visibly cuts the bundle. Only openings facing the sun contribute.'));

    b.appendChild(row('Ray density', ctlRange(
      function () { return App.rays.density; },
      function (v, live) { App.rays.density = v; App.markDirty('rays', live); },
      { min: 2, max: 300, step: 2, unit: ' /m²', decimals: 0 })));

    b.appendChild(row('Sun apparent size', ctlRange(
      function () { return App.rays.sunSizeDeg; },
      function (v, live) { App.rays.sunSizeDeg = v; App.markDirty('sunsize', live); },
      { min: 0.1, max: 10, step: 0.1, unit: '°', decimals: 1 }), { info: 'sunsize' }));
    b.appendChild(hint('The real sun subtends 0.53°. Opening it up widens the ray bundle and softens the shadow penumbra to match — useful on a projector.'));

    b.appendChild(row('Ray length outside', ctlRange(
      function () { return App.rays.length; },
      function (v, live) { App.rays.length = v; App.markDirty('rays', live); },
      { min: 0, max: 25, step: 0.5, unit: ' m', decimals: 1 })));
    b.appendChild(row('Ray opacity', ctlRange(
      function () { return App.rays.opacity; },
      function (v, live) { App.rays.opacity = v; App.markDirty('rays', live); },
      { min: 0.05, max: 1, step: 0.05, decimals: 2 })));
    b.appendChild(rowCheck('Mark where rays land', ctlCheck(
      function () { return App.rays.showSpots; },
      function (v) { App.rays.showSpots = v; App.markDirty('rays'); })));

    b.appendChild(subhead('Shadows'));
    b.appendChild(rowCheck('Cast shadows', ctlCheck(
      function () { return App.display.shadows; },
      function (v) { App.display.shadows = v; App.updateSun(); })));
    b.appendChild(rowCheck('Show 3D sun path', ctlCheck(
      function () { return App.display.showSunPath; },
      function (v) { App.display.showSunPath = v; App.markDirty('sunpath'); })));

    var rtxt = el('div', { class: 'hint' });
    b.appendChild(rtxt);
    reg(function () {
      var r = App.rayStats;
      rtxt.textContent = App.rays.enabled && r
        ? r.lit + ' of ' + r.count + ' sampled glazing points are in direct sun.'
        : '';
    });
  });
}

/* --- 10. display --------------------------------------------------------- */
var STYLES = [
  { value: 'smooth',  label: 'Smooth false colour' },
  { value: 'cells',   label: 'Discrete cells' },
  { value: 'contour', label: 'Filled contours' },
  { value: 'dots',    label: 'Dot matrix' },
  { value: 'numbers', label: 'Values only' },
  { value: 'relief',  label: '3D relief' }
];

function panelDisplay() {
  return panel('display', 'Display', false, function (b) {
    b.appendChild(row('Appearance', ctlSeg([
      { value: 'light', label: 'Studio', title: 'Studio Light — neutral, projector-friendly' },
      { value: 'dark', label: 'Dark Lab', title: 'Dark Lab — high contrast for false colour' },
      { value: 'clay', label: 'Clay', title: 'Architectural Clay — warm presentation render' }
    ], function () { return App.display.theme; },
       function (v) { App.setTheme(v); }), { wide: true }));

    var udiRow = row('UDI interval shown', ctlSelect(
      UDI_VIEWS.map(function (v) { return { value: v.id, label: v.label }; }),
      function () { return App.udiView || 'useful'; },
      function (v) { App.udiView = v; App.markDirty('display'); }), { wide: true, info: 'udi' });
    b.appendChild(udiRow);
    reg(function () { udiRow.style.display = App.metric === 'udi' ? '' : 'none'; });

    b.appendChild(row('Presentation style', ctlSelect(STYLES,
      function () { return App.display.style; },
      function (v) { App.display.style = v; App.markDirty('display'); UI.sync(); }), { wide: true }));

    b.appendChild(row('Colour ramp', ctlSelect(
      Object.keys(RAMPS).map(function (k) { return { value: k, label: RAMPS[k].label }; }),
      function () { return App.display.ramp || (METRICS[App.metric] || {}).ramp || 'viridis'; },
      function (v) { App.display.ramp = v; App.markDirty('display'); }), { wide: true }));
    b.appendChild(rowCheck('Reverse ramp', ctlCheck(
      function () { return App.display.reverseRamp; },
      function (v) { App.display.reverseRamp = v; App.markDirty('display'); })));

    b.appendChild(subhead('Legend range'));
    b.appendChild(rowCheck('Set the range manually', ctlCheck(
      function () { return App.display.manualScale; },
      function (v) { App.display.manualScale = v; App.markDirty('display'); UI.sync(); })));
    b.appendChild(el('div', { class: 'grid2' }, [
      field('Minimum', ctlNumber(function () { return App.display.scaleMin; },
        function (v) { App.display.scaleMin = v; App.markDirty('display'); }, { step: 1, decimals: 1 })),
      field('Maximum', ctlNumber(function () { return App.display.scaleMax; },
        function (v) { App.display.scaleMax = v; App.markDirty('display'); }, { step: 1, decimals: 1 }))
    ]));
    b.appendChild(el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn sm', text: 'Fit to data', onclick: function () { App.fitScale(); } })
    ]));

    b.appendChild(subhead('Values on the workplane'));
    b.appendChild(rowCheck('Show values', ctlCheck(
      function () { return App.display.showValues; },
      function (v) { App.display.showValues = v; App.markDirty('labels'); UI.sync(); })));
    b.appendChild(el('div', { class: 'grid2' }, [
      field('Decimals', ctlSelect(
        [{ value: 'auto', label: 'Auto' }, { value: '0', label: '0' },
         { value: '1', label: '1' }, { value: '2', label: '2' }, { value: '3', label: '3' }],
        function () { return App.display.decimals == null ? 'auto' : String(App.display.decimals); },
        function (v) {
          App.display.decimals = v === 'auto' ? null : clamp(parseInt(v, 10), 0, 3);
          App.markDirty('labels');
        })),
      field('Label every', ctlNumber(function () { return App.display.labelEvery; },
        function (v) { App.display.labelEvery = clamp(Math.round(v), 1, 8); App.markDirty('labels'); },
        { min: 1, max: 8, step: 1, decimals: 0 }))
    ]));

    b.appendChild(subhead('Dimensions'));
    var dw = el('div', { class: 'btn-row' });
    DIM_GROUPS.forEach(function (g) {
      var bt = el('button', { class: 'btn sm', text: g.charAt(0).toUpperCase() + g.slice(1) });
      bt.addEventListener('click', function () {
        App.display.dims[g] = !App.display.dims[g];
        App.markDirty('dims'); UI.sync();
      });
      reg(function () { bt.classList.toggle('on', !!App.display.dims[g]); });
      dw.appendChild(bt);
    });
    b.appendChild(dw);
    b.appendChild(hint('Click any dimension label in the viewport to type a new value — the model updates immediately.'));

    b.appendChild(subhead('Model visibility'));
    b.appendChild(row('Roof opacity', ctlRange(
      function () { return App.display.roofOpacity; },
      function (v, live) { App.display.roofOpacity = v; App.markDirty('visibility', live); },
      { min: 0, max: 1, step: 0.05, decimals: 2 })));
    b.appendChild(rowCheck('Hide roof (view only — still calculated)', ctlCheck(
      function () { return App.display.hideRoof; },
      function (v) { App.display.hideRoof = v; App.markDirty('visibility'); })));
    b.appendChild(rowCheck('Remove roof from the CALCULATION', ctlCheck(
      function () { return App.display.roofRemoved; },
      function (v) { App.display.roofRemoved = v; App.markDirty('geometry'); UI.sync(); }), { info: 'roof' }));
    b.appendChild(rowCheck('Show glazing', ctlCheck(
      function () { return App.display.showGlass; },
      function (v) { App.display.showGlass = v; App.markDirty('visibility'); })));
    b.appendChild(rowCheck('Show ground plane', ctlCheck(
      function () { return App.display.showGround; },
      function (v) { App.display.showGround = v; App.markDirty('visibility'); })));

    b.appendChild(subhead('Section cut'));
    b.appendChild(rowCheck('Enabled', ctlCheck(
      function () { return App.display.section.on; },
      function (v) { App.display.section.on = v; App.markDirty('section'); UI.sync(); })));
    b.appendChild(el('div', { class: 'grid3' }, [
      field('Axis', ctlSelect([{ value: 'x', label: 'X' }, { value: 'y', label: 'Y' }, { value: 'z', label: 'Z' }],
        function () { return App.display.section.axis; },
        function (v) { App.display.section.axis = v; App.markDirty('section'); })),
      field('Position', ctlNumber(function () { return App.display.section.pos; },
        function (v) { App.display.section.pos = v; App.markDirty('section'); }, { step: 0.1, decimals: 2 })),
      field('Flip', ctlCheck(function () { return App.display.section.flip; },
        function (v) { App.display.section.flip = v; App.markDirty('section'); }))
    ]));
  });
}

/* --- 11. scenarios & case studies ---------------------------------------- */
function panelScenarios() {
  return panel('scenarios', 'Scenarios & case studies', false, function (b) {
    b.appendChild(el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn sm primary', text: 'Save current', onclick: function () { App.saveScenario(); } }),
      el('button', { class: 'btn sm', text: 'Compare two…', onclick: function () { App.openCompare(); } })
    ]));
    var list = el('div', { class: 'sc-list' });
    b.appendChild(list);
    reg(function () { renderScenarios(list); });

    b.appendChild(subhead('Guided case studies'));
    b.appendChild(hint('Each one rebuilds the model and jumps to the metric that shows the point.'));
    var pw = el('div', { style: 'display:flex;flex-direction:column;gap:5px' });
    PRESETS.forEach(function (p) {
      pw.appendChild(el('button', { class: 'preset', onclick: function () { App.applyPreset(p); } }, [
        el('b', { text: p.title }), el('span', { text: p.note })
      ]));
    });
    b.appendChild(pw);
    b.appendChild(el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn sm', text: 'Reset to default model', onclick: function () { App.resetModel(); } })
    ]));
  });
}

function renderScenarios(list) {
  list.innerHTML = '';
  if (!App.scenarios.length) {
    list.appendChild(hint('No saved scenarios yet. Save one, change something, save another, then compare them.'));
    return;
  }
  App.scenarios.forEach(function (sc, i) {
    list.appendChild(el('div', { class: 'sc-item' }, [
      el('span', { class: 'sc-name', text: sc.name, title: sc.name }),
      el('span', { class: 'sc-meta', text: sc.summary || '' }),
      el('button', { class: 'btn sm', text: 'Load', onclick: function () { App.loadScenario(i); } }),
      el('button', { class: 'btn sm danger', text: '×', title: 'Delete',
        onclick: function () { App.deleteScenario(i); } })
    ]));
  });
}

/* --- 12. export ---------------------------------------------------------- */
function panelExport() {
  return panel('export', 'Export', false, function (b) {
    b.appendChild(row('Image scale', ctlSeg(
      [{ value: 1, label: '1×' }, { value: 2, label: '2×' }, { value: 3, label: '3×' }, { value: 4, label: '4×' }],
      function () { return App.exportOpts.scale; },
      function (v) { App.exportOpts.scale = +v; }), { wide: true }));
    ['showTitle', 'showLegend', 'showStats', 'showDimensions', 'showValues'].forEach(function (k, i) {
      b.appendChild(rowCheck(
        ['Include title block', 'Include legend', 'Include statistics',
         'Include dimensions', 'Include workplane values'][i],
        ctlCheck(function () { return App.exportOpts[k]; }, function (v) { App.exportOpts[k] = v; })));
    });
    b.appendChild(el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn primary', text: 'Export image (PNG)', onclick: function () { App.exportImage(); } })
    ]));
    b.appendChild(el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn sm', text: 'Grid values (CSV)', onclick: function () { App.exportCsv(); } }),
      el('button', { class: 'btn sm', text: 'Model (JSON)', onclick: function () { App.exportModel(); } }),
      el('button', { class: 'btn sm', text: 'Load model…', onclick: function () { $('#file-json').click(); } })
    ]));
  });
}

/* --- statistics HUD ------------------------------------------------------ */
function renderStats(host, ctx) {
  host.innerHTML = '';
  var s = ctx.stats, M = METRICS[ctx.metric];
  if (!s) {
    host.appendChild(el('div', { class: 'k', text: 'No result yet', style: 'grid-column:1/-1' }));
    return;
  }
  var u = tickUnit(M);
  var add = function (k, v) {
    host.appendChild(el('div', { class: 'k', text: k }));
    host.appendChild(el('div', { class: 'v', text: v }));
  };
  add('Minimum', num(s.min, M.decimals) + ' ' + u);
  add('Mean', num(s.mean, M.decimals) + ' ' + u);
  add('Median', num(s.median, M.decimals) + ' ' + u);
  add('Maximum', num(s.max, M.decimals) + ' ' + u);
  host.appendChild(el('div', { class: 'sep' }));
  add('Uniformity min:mean', s.uniformity.toFixed(2));
  add('Diversity min:max', s.diversity.toFixed(2));
  if (s.pass != null) add('Area ≥ ' + num(s.target, M.decimals) + u, s.pass.toFixed(0) + '%');
  if (ctx.metric === 'df' && ctx.adf != null) {
    host.appendChild(el('div', { class: 'sep' }));
    add('ADF (BS 8206-2)', num(ctx.adf, 1) + ' %');
  }
  add('Grid points', num(s.n));
}

/* --- solar HUD ----------------------------------------------------------- */
function renderSolarHud(host) {
  host.innerHTML = '';
  var s = App.sun, m = App.model;
  var add = function (k, v) {
    host.appendChild(el('div', { class: 'k', text: k }));
    host.appendChild(el('div', { class: 'v', text: v }));
  };
  add('Altitude', deg(s.altitude));
  add('Azimuth', deg(s.azimuth));
  add('Sunrise', hhmm(s.sunrise + (m.site.dst ? 1 : 0)));
  add('Sunset', hhmm(s.sunset + (m.site.dst ? 1 : 0)));
  add('Day length', s.dayLength.toFixed(2) + ' h');
  var irr = App.currentIrradiance();
  add('DNI / DHI', num(irr.dni) + ' / ' + num(irr.dhi));
}

/* --- teaching layer: metric information ---------------------------------- */

var INFO = {
  illuminance: {
    title: 'Illuminance',
    html: '<h3>What it is</h3><p>The luminous flux arriving on a surface, in <b>lux</b> (lumens per square metre). ' +
      'It is the quantity a light meter reads and the quantity building standards set targets against.</p>' +
      '<span class="formula">E = ∫ L(ω) · cos θ · dω   [lux]</span>' +
      '<h3>How this app computes it</h3><p>The raytraced engine bakes a daylight-coefficient row for every grid point — ' +
      'how much lux that point receives per unit luminance of each of the 145 sky patches. An instantaneous illuminance is then ' +
      'that row dotted with the sky, plus a direct beam term traced to the sun disc. Changing the date, time or sky re-slices the ' +
      'same bake, which is why it is instant.</p>' +
      '<h3>Typical targets</h3><table><tr><th>Task</th><th>Maintained illuminance</th></tr>' +
      '<tr><td>Circulation</td><td class="n">100 lx</td></tr>' +
      '<tr><td>General classroom / office</td><td class="n">300 lx</td></tr>' +
      '<tr><td>Drawing studio, technical work</td><td class="n">500–750 lx</td></tr>' +
      '<tr><td>Fine detail, colour matching</td><td class="n">1000+ lx</td></tr></table>' +
      '<p class="cite">Values follow the usual CIBSE / EN 12464-1 ranges.</p>'
  },
  df: {
    title: 'Daylight Factor',
    html: '<h3>What it is</h3><p>The ratio of the indoor illuminance at a point to the illuminance on an unobstructed ' +
      'horizontal plane outdoors, both under the <b>CIE Standard Overcast Sky</b>, expressed as a percentage.</p>' +
      '<span class="formula">DF = ( E<sub>inside</sub> / E<sub>outside, horizontal</sub> ) × 100   [%]<br>' +
      'DF = SC + ERC + IRC</span>' +
      '<p>Because the overcast sky has no sun in it, DF is independent of orientation, date and time. That is its ' +
      'great strength as a design tool and its great weakness as a performance metric — it cannot tell you anything ' +
      'about a south façade versus a north one.</p>' +
      '<h3>Reading the bands</h3><table><tr><th>DF</th><th>Interpretation</th></tr>' +
      '<tr><td class="n">&lt; 1%</td><td>Poor — electric lighting needed all day</td></tr>' +
      '<tr><td class="n">1–2%</td><td>Modest — daylight perceptible, lighting still required</td></tr>' +
      '<tr><td class="n">2–5%</td><td>Good — predominantly daylit</td></tr>' +
      '<tr><td class="n">&gt; 5%</td><td>Very high — glare and summer overheating likely</td></tr></table>' +
      '<p>An average DF of 2% is the long-standing threshold for a “daylit” space in BS 8206-2; 5% for a space ' +
      'that needs no electric lighting during the day.</p>' +
      '<h3>Uniformity</h3><p>Report the <b>min : mean</b> ratio alongside the average. Two rooms with the same mean DF ' +
      'and different uniformity are not the same room.</p>'
  },
  udi: {
    title: 'Useful Daylight Illuminance',
    html: '<h3>What it is</h3><p>UDI answers a question DF cannot: <i>for what fraction of the occupied year is the daylight ' +
      'at this point actually useful?</i> Every occupied hour of a real climate file is simulated and binned by the ' +
      'illuminance it delivers.</p>' +
      '<h3>The intervals</h3><p>Nabil &amp; Mardaljevic proposed 100–2000 lux as “useful” in 2005. The thresholds have since ' +
      'been revised upwards, and this app ships the five-interval classification while leaving every threshold editable so a ' +
      'class can compare definitions rather than inherit one.</p>' +
      '<table><tr><th>Interval</th><th>Default</th><th>Meaning</th></tr>' +
      '<tr><td>Too low</td><td class="n">&lt; 150 lx</td><td>Daylight contributes nothing usable</td></tr>' +
      '<tr><td>Low</td><td class="n">150–300 lx</td><td>Supplementary — electric lighting still on</td></tr>' +
      '<tr><td>In range</td><td class="n">300–500 lx</td><td>Daylight alone is sufficient</td></tr>' +
      '<tr><td>High</td><td class="n">500–3000 lx</td><td>Ample, still comfortable</td></tr>' +
      '<tr><td>Too high</td><td class="n">&gt; 3000 lx</td><td>Glare and overheating risk; blinds likely drawn</td></tr></table>' +
      '<h3>How to read it</h3><p>A good design pushes hours out of <i>too low</i> and out of <i>too high</i> at the same time. ' +
      'Enlarging a window moves hours from the first into the last. That trade-off is what the shading devices are for — ' +
      'add an overhang and watch the <i>too high</i> band shrink while <i>in range</i> holds.</p>' +
      '<p class="cite">Nabil A, Mardaljevic J (2005), <i>Useful daylight illuminance: a new paradigm for assessing daylight in ' +
      'buildings</i>, Lighting Research &amp; Technology 37(1).</p>'
  },
  da: {
    title: 'Daylight Autonomy and sDA',
    html: '<h3>Daylight Autonomy</h3><p>The percentage of occupied hours in the year at which daylight alone meets or exceeds ' +
      'the target illuminance at that point.</p>' +
      '<span class="formula">DA = ( hours with E ≥ E<sub>target</sub> / total occupied hours ) × 100   [%]</span>' +
      '<h3>Spatial Daylight Autonomy</h3><p>The percentage of the <i>floor area</i> that achieves DA of at least 50%. ' +
      'Written sDA<sub>300/50%</sub> when the target is 300 lux.</p>' +
      '<p>LEED v4 awards credit at sDA<sub>300/50%</sub> ≥ 55% and more at ≥ 75%, and requires it to be paired with ' +
      'an ASE check so the credit cannot be won by simply over-glazing.</p>' +
      '<p class="cite">Method follows IES LM-83; this tool simplifies the blind-operation schedule that LM-83 requires, ' +
      'so treat the number as indicative rather than as a submission.</p>'
  },
  ase: {
    title: 'Annual Sunlight Exposure',
    html: '<h3>What it is</h3><p>ASE counts the hours per year at which a point receives <b>direct sunlight</b> above a ' +
      'threshold, ignoring the diffuse sky entirely. It is a proxy for glare and overheating risk.</p>' +
      '<span class="formula">ASE<sub>1000,250</sub> = % of floor area receiving more than 1000 lux of<br>' +
      'direct sun for more than 250 occupied hours per year</span>' +
      '<p>LEED v4 asks for ASE<sub>1000,250</sub> below 10% of the area. Above that, the space is judged likely to need ' +
      'blinds so often that the daylight credit is undermined.</p>' +
      '<h3>Why it matters here</h3><p>ASE is the metric that makes shading devices earn their keep. Run sDA and ASE on the ' +
      'same model, then add an overhang: sDA should barely move while ASE falls sharply. If sDA falls too, the device is too deep.</p>'
  },
  sunhours: {
    title: 'Direct sun hours',
    html: '<h3>What it is</h3><p>The number of hours per year at which the sun disc is directly visible from each grid point ' +
      'through the glazing — a purely geometric count, unaffected by cloud.</p>' +
      '<p>It is the most intuitive of all the metrics and the easiest to check by eye: turn on the solar rays, scrub the ' +
      'time slider, and watch the sunlit patch sweep across the same area the map is highlighting.</p>' +
      '<p>Use it to size shading devices, to check that a workstation is not in the sun path, and to demonstrate why a ' +
      'vertical fin works on an east façade where an overhang does not.</p>'
  },
  engines: {
    title: 'The two calculation engines',
    html: '<h3>Raytraced daylight coefficients (default)</h3>' +
      '<p>From every grid point, several hundred cosine-weighted rays are traced through the actual geometry. A ray that ' +
      'escapes is recorded against the sky patch it left through; a ray that hits a surface reflects diffusely with that ' +
      'surface\'s reflectance and carries on, up to the bounce limit. Glazing is passed through with its transmittance ' +
      'rather than blocking.</p>' +
      '<p>The result is a matrix, so one bake serves the daylight factor, any instant, and the full 8760-hour year.</p>' +
      '<h3>Split-flux (BRE)</h3>' +
      '<span class="formula">DF = SC + ERC + IRC<br><br>' +
      'IRC = ( T·W / A(1−ρ) ) · ( C·ρ<sub>fw</sub> + 5(ρ<sub>cw</sub> − ρ<sub>fw</sub>) )</span>' +
      '<p>The sky component is integrated over the aperture, the externally reflected component comes from the ' +
      'obstruction angle, and the internally reflected component from the BRE average formula — a single number applied ' +
      'uniformly across the room.</p>' +
      '<h3>What both engines now share</h3><ul>' +
      '<li><b>Shading devices.</b> Overhangs, louvre banks and fins are tested against the real geometry in both. A ' +
      'brise-soleil is an obstruction, and the split-flux method has always accounted for obstructions.</li>' +
      '<li><b>Direct sun.</b> The beam is pure sun geometry, traced identically for both, so <b>ASE and Direct sun ' +
      'hours are the same number whichever engine is selected</b> — as they should be.</li></ul>' +
      '<h3>Where they still differ, and why</h3><table>' +
      '<tr><th>Effect</th><th>Raytraced</th><th>Split-flux</th></tr>' +
      '<tr><td>Reveal cutting off oblique sky</td><td>yes</td><td><b>no</b></td></tr>' +
      '<tr><td>Glazing sitting deeper in the reveal</td><td>yes</td><td>yes, weakly</td></tr>' +
      '<tr><td>Interreflection</td><td>simulated, bounce by bounce</td><td>one uniform value for the room</td></tr>' +
      '<tr><td>Spatial distribution of bounced light</td><td>varies across the room</td><td>flat</td></tr>' +
      '<tr><td>Speed</td><td>seconds</td><td>milliseconds</td></tr></table>' +
      '<p><b>Try this.</b> Put the glazing at the <i>inside</i> face of the wall (Openings → Glass position in reveal), ' +
      'then take the daylight factor at 0.10 m wall thickness and again at 0.90 m.</p>' +
      '<p>The raytraced number falls by around 45%: a deep reveal cuts off the oblique sky a point near the back of the ' +
      'room could otherwise see. The split-flux number does not move <i>at all</i> — the BRE method works from the net ' +
      'glazed area and has no term for the depth of the opening.</p>' +
      '<p>Now move the glazing to the outside face and repeat. This time split-flux <i>does</i> move, but only because ' +
      'the pane itself is further away and subtends a smaller angle — never because of the reveal. That is precisely ' +
      'what a simplified method cannot see, and it is worth more than the headline number.</p>' +
      '<h3>One departure from the textbook</h3>' +
      '<p>The BRE internally reflected component contains no shading term, so on its own it would not respond to an ' +
      'overhang — and in a deep room, where the IRC dominates the back half, the daylight factor there would look ' +
      'unmoved. This tool scales the IRC by the same fraction of sky flux the devices remove. That is an extension of ' +
      'BS 8206-2, not part of it, and it is the reason the split-flux result here will not exactly match a hand ' +
      'calculation on a shaded window.</p>'
  },
  skies: {
    title: 'Sky models',
    html: '<h3>CIE Overcast</h3><p>Luminance three times brighter at the zenith than at the horizon, no sun, rotationally ' +
      'symmetric. This is the sky the Daylight Factor is defined against — that is the whole reason DF is orientation-blind.</p>' +
      '<span class="formula">L<sub>γ</sub> / L<sub>z</sub> = (1 + 2 sin γ) / 3</span>' +
      '<h3>CIE Clear / Intermediate</h3><p>Standard skies with a solar indicatrix, so the sky brightens towards the sun and ' +
      'the result becomes orientation- and time-dependent. Implemented through the CIE general sky formulation (types 12 and 8).</p>' +
      '<h3>Perez all-weather</h3><p>The model used for every annual run. It takes the direct-normal and diffuse-horizontal ' +
      'irradiance of an actual climate hour and produces the sky luminance distribution that produced them — cloudy hours come ' +
      'out flat and grey, clear hours come out with a bright solar aureole.</p>' +
      '<h3>Uniform</h3><p>Equal luminance in every direction. Physically unrealistic, but useful for isolating pure geometry ' +
      'from sky distribution effects.</p>' +
      '<p class="cite">Perez R, Seals R, Michalsky J (1993), <i>All-weather model for sky luminance distribution</i>, Solar Energy 50(3).</p>'
  },
  designsky: {
    title: 'Design sky illuminance',
    html: '<p>The unobstructed horizontal illuminance assumed for the CIE overcast sky. The Daylight Factor is a <b>ratio</b>, ' +
      'so this value cancels out of it entirely and DF does not change when you change it.</p>' +
      '<p>What it does change is the absolute illuminance reported under the overcast sky. 5000 lux is the traditional UK ' +
      'design sky; 10 000 lux is a common European figure. Set it to whatever your course uses.</p>'
  },
  obstruction: {
    title: 'External obstruction angle',
    html: '<p>The angle, measured from the centre of the window, up to the top of the building opposite. Zero means an ' +
      'unobstructed view of the sky.</p>' +
      '<p>In the split-flux engine it does real work: it decides how much of the aperture sees sky rather than obstruction, ' +
      'and it drives the BRE coefficient <i>C</i> in the internally reflected component.</p>' +
      '<p>In the raytraced engine there is no external context modelled, so this control only affects the split-flux result. ' +
      'That difference is worth pointing out to a class — “no obstruction modelled” is not the same as “no obstruction”.</p>'
  },
  roof: {
    title: 'Reading a fully enclosed room',
    html: '<h3>Plan view keeps the roof on</h3><p>Switch to <b>Plan</b> in the viewport toolbar and the camera drops to just ' +
      'under the roof soffit and looks straight down. The roof meshes are hidden <i>from the camera only</i> — the roof, the ' +
      'skylight well and the ceiling are all still in the geometry the raytracer sees.</p>' +
      '<p>So the readings you take in plan view are the readings of the fully enclosed room. The status bar says so: ' +
      '<code>Roof: CLOSED (in calculation)</code>.</p>' +
      '<h3>Removing the roof really removes it</h3><p><b>Remove roof from the CALCULATION</b> is a different thing entirely. ' +
      'It deletes the roof from the model, so the workplane now sees the whole sky and the illuminance jumps by an order of ' +
      'magnitude. It is there to make the difference obvious — turn it on and off and watch the legend rescale.</p>' +
      '<p>A sealed room with no roof is not a room. Leave it off for any real reading.</p>'
  },
  sunsize: {
    title: 'Apparent sun size',
    html: '<p>The sun subtends about <b>0.53°</b> from Earth. That small but non-zero size is what gives every shadow a ' +
      'penumbra — a soft edge whose width grows with the distance from the object casting it.</p>' +
      '<p>This control exaggerates it. Raising the apparent diameter simultaneously widens the ray bundle, softens the ' +
      'shadow penumbra, and grows the sun sphere on the sun-path dome, so all three stay consistent.</p>' +
      '<p>Set it to 0.5° for a physically correct result. Set it to 3–5° when you want the penumbra to read from the back ' +
      'of a lecture theatre.</p>'
  },
  help: {
    title: 'Daylight Lab',
    html: '<p>A parametric room, a real sun, and a workplane grid you can read against a legend. Everything recalculates ' +
      'as you change the model.</p>' +
      '<p><button class="btn primary" id="start-tour" type="button">Start the guided tour</button></p>' +
      '<h3>Getting started</h3><ul>' +
      '<li>Pick a <b>metric</b> along the top. Illuminance and Daylight Factor are instant; UDI, DA, ASE and Sun hours run ' +
      'the full year and take a few seconds.</li>' +
      '<li><b>Calculate</b> re-bakes the grid. It re-runs on its own whenever the geometry changes.</li>' +
      '<li>Drag in the viewport to orbit, right-drag or shift-drag to pan, scroll to zoom. One finger orbits and two fingers ' +
      'pan and zoom on a touchscreen. In Plan and Elevation the view is locked square-on, so dragging pans instead of ' +
      'orbiting — use the zoom buttons, the wheel, or <b>+</b> and <b>−</b>. <b>Fit</b> (or <b>F</b>) frames the room in the clear part of the viewport and brings it back from anywhere.</li>' +
      '<li>The <b>hand tool</b> — the hand in the viewport toolbar — turns a plain drag into a pan in every view, and stops ' +
      'you nudging an opening while you are only moving the model about. <b>Hold Space</b> to do the same without switching ' +
      'tools, and <b>Esc</b> always puts you back to orbiting. On a small screen, <b>C</b> clears every floating panel away, ' +
      'and each panel folds to its title bar from the chevron on its right.</li>' +
      '<li><b>Drag any window, skylight or door</b> in the viewport to move it. Hold Shift or use the right button to orbit from on top of one, and Ctrl+Z undoes a move.</li>' +
      '<li>Click any <b>dimension label</b> to type a new value. The model rebuilds immediately.</li>' +
      '<li>The two sliders at the bottom scrub time of day and day of year.</li></ul>' +
      '<h3>Suggested sequence for a class</h3><ol>' +
      '<li>Start on <b>Daylight Factor</b> with the default room. Note the mean and the min:mean uniformity.</li>' +
      '<li>Switch the engine to <b>Split-flux</b>. The numbers are close.</li>' +
      '<li>Add a 0.6 m overhang to the south window. Both engines drop, but raytraced drops further — split-flux only sees the sky the device blocks, never the light it bounces back in. Discuss why.</li>' +
      '<li>Switch to <b>UDI</b>. Watch the “too high” band before and after the overhang.</li>' +
      '<li>Turn on <b>solar rays</b> and scrub the time slider through 21 June and 21 December.</li></ol>' +
      '<h3>What this tool does not model</h3><ul>' +
      '<li>Specular or directional glazing — transmittance is treated as diffuse-equivalent.</li>' +
      '<li>External context beyond a single obstruction angle in the split-flux engine.</li>' +
      '<li>Blind operation schedules, so sDA and ASE are indicative rather than LM-83 submissions.</li>' +
      '<li>Spectral or colour effects.</li></ul>' +
      '<p>It is built to teach relationships and orders of magnitude. For a compliance submission, use IESVE, Radiance ' +
      'via Ladybug and Honeybee, or an equivalent validated tool.</p>' +
      '<h3>Licence and credits</h3>' +
      '<p>© Karam Al-Obaidi. Licensed <b>CC BY-NC 4.0</b> — use, share and adapt it for teaching and study with ' +
      'attribution; commercial use is not permitted. ' +
      '<a href="https://creativecommons.org/licenses/by-nc/4.0/" target="_blank" rel="noopener">creativecommons.org/licenses/by-nc/4.0</a></p>' +
      '<p>Built with <a href="https://threejs.org" target="_blank" rel="noopener">three.js</a> r160 (MIT), inlined into ' +
      'this file along with its licence. Legend colour maps: viridis, inferno and cividis (CC0), turbo (Google, ' +
      'Apache-2.0). The full notice is at the top of the file itself — view source to read it.</p>'
  }
};

function openModal(title, html) {
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = html;
  $('#modal-bg').classList.add('on');
}
function closeModal() { $('#modal-bg').classList.remove('on'); }
