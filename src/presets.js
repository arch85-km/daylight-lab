/* ==========================================================================
   Default model, material presets, city list and the guided case studies.
   ========================================================================== */

var CITIES = [
  { name: 'London, UK',            lat: 51.51,  lon: -0.13,   tz: 0 },
  { name: 'Edinburgh, UK',         lat: 55.95,  lon: -3.19,   tz: 0 },
  { name: 'Dublin, IE',            lat: 53.35,  lon: -6.26,   tz: 0 },
  { name: 'Paris, FR',             lat: 48.86,  lon: 2.35,    tz: 1 },
  { name: 'Berlin, DE',            lat: 52.52,  lon: 13.40,   tz: 1 },
  { name: 'Stockholm, SE',         lat: 59.33,  lon: 18.07,   tz: 1 },
  { name: 'Rome, IT',              lat: 41.90,  lon: 12.50,   tz: 1 },
  { name: 'Madrid, ES',            lat: 40.42,  lon: -3.70,   tz: 1 },
  { name: 'Athens, GR',            lat: 37.98,  lon: 23.73,   tz: 2 },
  { name: 'Cairo, EG',             lat: 30.04,  lon: 31.24,   tz: 2 },
  { name: 'Istanbul, TR',          lat: 41.01,  lon: 28.98,   tz: 3 },
  { name: 'Baghdad, IQ',           lat: 33.32,  lon: 44.37,   tz: 3 },
  { name: 'Riyadh, SA',            lat: 24.71,  lon: 46.68,   tz: 3 },
  { name: 'Dubai, AE',             lat: 25.20,  lon: 55.27,   tz: 4 },
  { name: 'Karachi, PK',           lat: 24.86,  lon: 67.01,   tz: 5 },
  { name: 'Delhi, IN',             lat: 28.61,  lon: 77.21,   tz: 5.5 },
  { name: 'Kuala Lumpur, MY',      lat: 3.14,   lon: 101.69,  tz: 8 },
  { name: 'Singapore, SG',         lat: 1.35,   lon: 103.82,  tz: 8 },
  { name: 'Hong Kong, HK',         lat: 22.32,  lon: 114.17,  tz: 8 },
  { name: 'Beijing, CN',           lat: 39.90,  lon: 116.41,  tz: 8 },
  { name: 'Tokyo, JP',             lat: 35.68,  lon: 139.69,  tz: 9 },
  { name: 'Sydney, AU',            lat: -33.87, lon: 151.21,  tz: 10 },
  { name: 'Melbourne, AU',         lat: -37.81, lon: 144.96,  tz: 10 },
  { name: 'Auckland, NZ',          lat: -36.85, lon: 174.76,  tz: 12 },
  { name: 'Johannesburg, ZA',      lat: -26.20, lon: 28.05,   tz: 2 },
  { name: 'Nairobi, KE',           lat: -1.29,  lon: 36.82,   tz: 3 },
  { name: 'Lagos, NG',             lat: 6.52,   lon: 3.38,    tz: 1 },
  { name: 'São Paulo, BR',         lat: -23.55, lon: -46.63,  tz: -3 },
  { name: 'Santiago, CL',          lat: -33.45, lon: -70.67,  tz: -4 },
  { name: 'New York, US',          lat: 40.71,  lon: -74.01,  tz: -5 },
  { name: 'Chicago, US',           lat: 41.88,  lon: -87.63,  tz: -6 },
  { name: 'Denver, US',            lat: 39.74,  lon: -104.99, tz: -7 },
  { name: 'Los Angeles, US',       lat: 34.05,  lon: -118.24, tz: -8 },
  { name: 'Vancouver, CA',         lat: 49.28,  lon: -123.12, tz: -8 },
  { name: 'Mexico City, MX',       lat: 19.43,  lon: -99.13,  tz: -6 },
  { name: 'Reykjavík, IS',         lat: 64.15,  lon: -21.94,  tz: 0 }
];

/** Surface reflectance presets (visible reflectance, CIBSE-typical). */
var REFL_PRESETS = {
  'Typical office':  { floor: 0.20, wall: 0.50, ceiling: 0.70, ground: 0.20, ext: 0.30 },
  'Light finishes':  { floor: 0.35, wall: 0.70, ceiling: 0.80, ground: 0.20, ext: 0.45 },
  'Dark finishes':   { floor: 0.10, wall: 0.30, ceiling: 0.50, ground: 0.15, ext: 0.20 },
  'Gallery white':   { floor: 0.30, wall: 0.85, ceiling: 0.90, ground: 0.20, ext: 0.60 },
  'Exposed concrete':{ floor: 0.20, wall: 0.35, ceiling: 0.35, ground: 0.20, ext: 0.35 }
};

var GLAZING_PRESETS = {
  'Clear single (τ 0.90)':   0.90,
  'Clear double (τ 0.78)':   0.78,
  'Low-E double (τ 0.70)':   0.70,
  'Low-E triple (τ 0.62)':   0.62,
  'Solar control (τ 0.45)':  0.45,
  'Tinted (τ 0.30)':         0.30,
  'Translucent (τ 0.20)':    0.20
};

var apUid = 0;
/** One aperture with every field populated. */
function makeAperture(o) {
  var a = {
    id: 'ap' + (++apUid),
    name: o.name || 'Window',
    kind: o.kind || 'window',          // window | skylight | door
    side: o.side || 'S',               // N E S W roof
    enabled: o.enabled !== false,
    w: o.w == null ? 2.0 : o.w,
    h: o.h == null ? 1.5 : o.h,
    sill: o.sill == null ? 0.9 : o.sill,
    offset: o.offset == null ? 0 : o.offset,
    offset2: o.offset2 == null ? 0 : o.offset2,   // skylights only (along Z)
    tau: o.tau == null ? 0.78 : o.tau,
    maintenance: o.maintenance == null ? 0.92 : o.maintenance,
    frameFactor: o.frameFactor == null ? 1 : o.frameFactor,
    frameWidth: o.frameWidth == null ? 0.05 : o.frameWidth,
    glassPos: o.glassPos == null ? 0.5 : o.glassPos,
    open: !!o.open,
    shading: o.shading || defaultShading()
  };
  return a;
}

/** The model the app opens with: an 8 x 6 x 3.2 m studio classroom. */
function defaultModel() {
  apUid = 0;
  return {
    version: 1,
    name: 'Studio classroom',
    room: {
      L: 8.0, W: 6.0, H: 3.2,
      tWall: 0.20, tRoof: 0.30, tFloor: 0.20,
      northAngle: 0,
      refl: {
        floor: 0.20, wall: 0.50, ceiling: 0.70,
        ground: 0.20, ext: 0.30, reveal: 0.50,
        frame: 0.50, shade: 0.35, door: 0.30
      }
    },
    apertures: [
      makeAperture({ name: 'South window', side: 'S', w: 4.0, h: 1.5, sill: 0.9, offset: 0 }),
      makeAperture({ name: 'North window', side: 'N', w: 3.0, h: 1.5, sill: 0.9, offset: -1.0 }),
      makeAperture({ name: 'East window',  side: 'E', w: 2.0, h: 1.5, sill: 0.9, offset: 0 }),
      makeAperture({ name: 'West window',  side: 'W', w: 2.0, h: 1.5, sill: 0.9, offset: 0 }),
      makeAperture({ name: 'Skylight',     side: 'roof', kind: 'skylight',
                     w: 1.2, h: 1.2, offset: 0, offset2: 0, tau: 0.70 }),
      makeAperture({ name: 'Door', side: 'N', kind: 'door',
                     w: 0.9, h: 2.1, sill: 0, offset: 2.4, tau: 0, open: false })
    ],
    grid: { spacing: 0.5, height: 0.75, margin: 0.25 },
    analysis: {
      engine: 'raytrace',            // raytrace | splitflux
      quality: 'standard',
      skyModel: 'overcast',
      designLux: 10000,
      bounces: 3,
      targetLux: 300,
      occStart: 8, occEnd: 18,
      udi: [150, 300, 500, 3000],   // the five-interval classification
      aseLux: 1000, aseHours: 250,
      sunHoursMode: 'annual'
    },
    site: {
      city: 'London, UK', lat: 51.51, lon: -0.13, tz: 0,
      dst: false, obstructionAngle: 0
    },
    when: { year: 2024, month: 6, day: 21, hour: 12 }
  };
}

/** Quality tiers: rays per grid point and sky subdivision. */
var QUALITY = {
  preview:  { rays: 192,  mf: 1, bounces: 1, label: 'Preview' },
  standard: { rays: 768,  mf: 1, bounces: 3, label: 'Standard' },
  high:     { rays: 2048, mf: 1, bounces: 4, label: 'High' },
  fine:     { rays: 4096, mf: 2, bounces: 5, label: 'Fine (MF:2 sky)' }
};

/**
 * Guided case studies. Each returns a patch applied over the current model,
 * plus the metric and view the lesson is best read in.
 */
var PRESETS = [
  {
    id: 'unilateral',
    title: 'Unilateral vs bilateral',
    note: 'One south window, then the same area split across two opposite walls. Watch uniformity, not the mean.',
    metric: 'df',
    apply: function (m) {
      m.apertures = [
        makeAperture({ name: 'South window', side: 'S', w: 6.0, h: 1.6, sill: 0.9 })
      ];
    }
  },
  {
    id: 'bilateral',
    title: 'Bilateral daylighting',
    note: 'The same glazed area as the unilateral case, split north and south. Compare the min:mean uniformity.',
    metric: 'df',
    apply: function (m) {
      m.apertures = [
        makeAperture({ name: 'South window', side: 'S', w: 3.0, h: 1.6, sill: 0.9 }),
        makeAperture({ name: 'North window', side: 'N', w: 3.0, h: 1.6, sill: 0.9 })
      ];
    }
  },
  {
    id: 'overhang',
    title: 'Adding a 0.6 m overhang',
    note: 'A south window with a continuous overhang. Switch to UDI and watch the over-lit band shrink.',
    metric: 'udi',
    apply: function (m) {
      var w = makeAperture({ name: 'South window', side: 'S', w: 5.0, h: 1.8, sill: 0.8 });
      w.shading.h = { on: true, depth: 0.60, thickness: 0.08, offset: 0.15, extend: 0.30, count: 1, tilt: 0 };
      m.apertures = [w];
    }
  },
  {
    id: 'louvres',
    title: 'Horizontal louvre bank',
    note: 'Five blades instead of one overhang: similar cut-off angle, far less view obstruction.',
    metric: 'udi',
    apply: function (m) {
      var w = makeAperture({ name: 'South window', side: 'S', w: 5.0, h: 1.8, sill: 0.8 });
      w.shading.h = { on: true, depth: 0.35, thickness: 0.04, offset: 0.10, extend: 0.20, count: 5, tilt: 15 };
      m.apertures = [w];
    }
  },
  {
    id: 'fins',
    title: 'Vertical fins on an east wall',
    note: 'Fins work on low morning and evening sun where an overhang cannot. Read this one with Direct sun hours.',
    metric: 'sunhours',
    apply: function (m) {
      var w = makeAperture({ name: 'East window', side: 'E', w: 4.0, h: 1.8, sill: 0.8 });
      w.shading.v = { on: true, depth: 0.50, thickness: 0.05, offset: 0.05, extend: 0.10, count: 6, tilt: 25, side: 'both' };
      m.apertures = [w];
    }
  },
  {
    id: 'skylight',
    title: 'Toplighting only',
    note: 'Four skylights and no windows. The most uniform daylight there is — and the hardest to shade.',
    metric: 'df',
    apply: function (m) {
      m.apertures = [];
      for (var i = -1; i <= 1; i += 2) for (var j = -1; j <= 1; j += 2) {
        m.apertures.push(makeAperture({
          name: 'Skylight', side: 'roof', kind: 'skylight',
          w: 1.4, h: 1.4, offset: i * m.room.L / 4, offset2: j * m.room.W / 4, tau: 0.70
        }));
      }
    }
  },
  {
    id: 'deepplan',
    title: 'Deep plan, one window',
    note: 'A 12 m deep room lit from one end. Find the no-sky line and the point where DF drops below 2%.',
    metric: 'df',
    apply: function (m) {
      m.room.L = 5.0; m.room.W = 12.0; m.room.H = 3.2;
      m.apertures = [makeAperture({ name: 'South window', side: 'S', w: 4.0, h: 2.0, sill: 0.8 })];
      m.grid.spacing = 0.5;
    }
  },
  {
    id: 'thickwall',
    title: 'Thin wall vs thick wall',
    note: 'Set wall thickness to 0.60 m and re-run. The reveal alone removes a surprising amount of sky.',
    metric: 'df',
    apply: function (m) {
      m.room.tWall = 0.60;
      m.apertures = [makeAperture({ name: 'South window', side: 'S', w: 4.0, h: 1.5, sill: 0.9, glassPos: 1 })];
    }
  }
];
