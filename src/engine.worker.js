/* ==========================================================================
   Analysis Worker message loop.

   The build inlines util / solar / sky / bvh / engine.core above this block,
   then this file wires them to postMessage. The Worker owns the BVH and the
   daylight-coefficient matrix for the whole session: the main thread sends a
   sky and gets illuminance back, which keeps a re-slice under a millisecond.
   ========================================================================== */

var core = new DaylightCore();
var annualState = null;

function reply(id, payload, transfer) {
  payload.id = id; payload.ok = true;
  self.postMessage(payload, transfer || []);
}
function fail(id, err) {
  self.postMessage({ id: id, ok: false, error: String(err && err.message || err) });
}
function progress(id, value, note) {
  self.postMessage({ id: id, progress: value, note: note });
}

self.onmessage = function (ev) {
  var msg = ev.data, id = msg.id;
  try {
    switch (msg.cmd) {
      case 'ping':
        reply(id, { pong: true });
        break;

      case 'geometry':
        reply(id, core.setGeometry({ pos: msg.pos, mat: msg.mat }, msg.materials));
        break;

      case 'points':
        reply(id, core.setPoints(msg.pts, msg.nrm));
        break;

      case 'bake': {
        var t0 = Date.now();
        var info = core.beginBake(msg.pts, msg.nrm, msg.cfg);
        // chunk so progress is reported while the bake runs
        var step = Math.max(1, Math.ceil(info.nPts / 40)), rays = 0;
        for (var p = 0; p < info.nPts; p += step) {
          rays += core.bakeChunk(p, p + step);
          progress(id, Math.min(1, (p + step) / info.nPts), 'Tracing');
        }
        reply(id, { nPatch: info.nPatch, nPts: info.nPts, rays: rays, ms: Date.now() - t0 });
        break;
      }

      case 'diffuse': {
        var lux = core.diffuse(msg.lum, msg.ground);
        reply(id, { lux: lux }, [lux.buffer]);
        break;
      }

      case 'direct': {
        var d = core.directSun(msg.sunDir, msg.Enormal, msg.radius, msg.samples || 1);
        reply(id, { lux: d }, [d.buffer]);
        break;
      }

      case 'point': {
        // one instant: diffuse + direct in a single round trip
        var df = core.diffuse(msg.lum, msg.ground);
        var out = new Float32Array(df.length), dirOnly = new Float32Array(df.length);
        if (msg.Enormal > 0 && msg.sunDir && msg.sunDir.y > 0) {
          core.directSun(msg.sunDir, msg.Enormal, msg.radius, msg.samples || 1, dirOnly);
        }
        for (var i = 0; i < df.length; i++) out[i] = df[i] + dirOnly[i];
        reply(id, { lux: out, diffuse: df, direct: dirOnly },
              [out.buffer, df.buffer, dirOnly.buffer]);
        break;
      }

      case 'sunvis': {
        var v = core.sunVisible(msg.sunDir, 1);
        reply(id, { vis: v }, [v.buffer]);
        break;
      }

      case 'annualBegin':
        annualState = core.annualBegin({
          df: msg.df || null,
          climate: makeClimate({
            dni: msg.dni, dhi: msg.dhi, ghi: msg.ghi, temp: msg.temp,
            name: msg.climateName, loc: msg.site
          }),
          site: msg.site, udi: msg.udi, targetLux: msg.targetLux,
          occStart: msg.occStart, occEnd: msg.occEnd,
          aseLux: msg.aseLux, groundRefl: msg.groundRefl, sunRadius: msg.sunRadius
        });
        reply(id, { started: true });
        break;

      case 'annualStep': {
        if (!annualState) throw new Error('annual run was not started');
        var pr = core.annualStep(annualState, msg.days || 10);
        if (pr >= 1) {
          var r = core.annualEnd(annualState);
          annualState = null;
          reply(id, { done: true, result: r },
                [r.udi.buffer, r.daHours.buffer, r.aseHours.buffer,
                 r.sunHours.buffer, r.meanLux.buffer, r.maxLux.buffer]);
        } else {
          reply(id, { done: false, progress: pr });
        }
        break;
      }

      default:
        throw new Error('unknown command: ' + msg.cmd);
    }
  } catch (e) {
    fail(id, e);
  }
};
