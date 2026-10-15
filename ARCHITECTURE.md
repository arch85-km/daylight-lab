# Architecture

How Daylight Lab is put together: what lives where, how a model becomes a
daylight result, and what the tooling around it does. For the methods behind
the numbers and what they do not model, read
[`docs/method-notes.html`](docs/method-notes.html); for how the two engines
were tested against independent answers, read
[`docs/ENGINE-VALIDATION.md`](docs/ENGINE-VALIDATION.md). This file is the
map.

## Source and deliverable

| File | What it is |
|---|---|
| `src/` | The source: 22 JavaScript modules, `index.html` and `theme.css`. |
| `daylight-lab.html` | The deliverable: one self-contained file, about 1.1 MB, built from `src/` by `tools/build.mjs`. This is the file uploaded to the website. |

`tools/build.mjs` concatenates the source into one file:

- **three.js r160** (`vendor/three.min.js`, MIT) is inlined as a classic
  script, so the result works from disk, inside a WordPress Custom HTML block
  and inside an iframe, with no import map, module loader or CDN;
- `src/engine.worker.js` is inlined as text and started from a Blob URL at
  run time, with a fallback that runs the same engine on the main thread in
  time-sliced chunks when a Worker cannot be created;
- everything else is wrapped in a single scope, in dependency order;
- the release (version and date, read from `CITATION.cff`) and a build stamp
  (build date and source hash) go into meta tags in the page.

The app makes no network requests. It keeps two things in the browser:
scenarios the user saves (`daylightlab.scenarios.v1`) and whether to show the
guided tour (`daylightlab.tour.v1`, `daylightlab.tour.hide.v1`).

## Conventions

- Units are metres, with dimensions shown to two decimals.
- Axes: **Y up, +X east, +Z south, −Z north**. Azimuth is measured clockwise
  from north (0 N, 90 E, 180 S, 270 W).
- **Project north** turns the model against true north; the annual run
  receives it too (a 1.0.1 fix).
- The room is a solid with real thickness: walls, roof and floor are slabs,
  and openings are cut through them.

## Two independent engines

| Engine | Module | Method |
|---|---|---|
| **Daylight-coefficient raytracer** | `engine.core.js`, `bvh.js`, behind `engine.js` | Casts cosine-weighted hemisphere rays from every workplane point through a triangle BVH and records where each ray escapes to sky. The result is a matrix of illuminance per unit luminance of each sky patch, so any sky is then a dot product. Glazing is traversed with its transmittance, and interreflection is a real Monte-Carlo bounce against each surface's reflectance. |
| **BRE split-flux** | `splitflux.js` | Daylight factor as sky component + externally reflected + internally reflected components, following BS 8206-2. |

Their agreement is measured, not asserted: `docs/ENGINE-VALIDATION.md`
records it.

**Quality tiers** (rays per grid point, sky subdivision, bounces):

| Tier | Rays | Sky | Bounces |
|---|---|---|---|
| Preview | 192 | MF:1 (145 patches) | 1 |
| Standard | 768 | MF:1 | 3 |
| High | 2,048 | MF:1 | 4 |
| Fine | 4,096 | MF:2 (577 patches) | 5 |

## From a model to a result

1. `geometry.js` builds the room, its apertures and `shading.js`'s devices
   (overhangs, louvres, fins) as a triangle soup with material slots.
2. The engine bakes the daylight-coefficient matrix for the workplane grid,
   in the Worker where it can.
3. `sky.js` supplies the sky: a CIE standard sky (types 1–15), or a Perez
   all-weather sky for an hour of an EPW file (`epw.js`). The sun's position
   comes from `solar.js` (the NOAA calculator, after Meeus).
4. A single instant is one dot product; an annual run applies all 8,760
   hours of the climate file.
5. `metrics.js` turns the raw values into the displayed fields:
   illuminance, daylight factor (CIE overcast), useful daylight illuminance
   (Nabil & Mardaljevic 2005, five intervals), daylight autonomy and sDA,
   ASE, and direct sun hours.
6. `view.js` draws the model and the analysis grid (deliberately unlit, so
   the colours are the values); `legend.js` holds the colour ramps.

Each control raises a dirty flag naming what it invalidates, and both engines
recompute only that. A control that forgot its flag would leave a stale
number on screen; `test/dirty.mjs` exists to catch that.

## Around the analysis

| Module | Does |
|---|---|
| `sunpath.js` | The 3D sun-path dome over the model and a 2D stereographic chart, driven by the same solar module. |
| `rays.js` | Solar ray access: which points of each opening the sun actually reaches. |
| `dimensions.js` | Measured dimensions with extension lines. |
| `export.js` | The presentation image (a drawing, not a screenshot), the grid as CSV, and the model as JSON. |
| `presets.js` | The default room, material presets, 36 cities, the quality tiers and eight guided case studies. |
| `tour.js` | The guided tour, which opens on each launch until switched off. |
| `ui.js`, `main.js` | The controls and panels; the app's state and recompute pipeline. |

## Tests

| Suite | Command | Checks |
|---|---|---|
| Validation | `npm run validate` | 111 assertions: physics run against the app's own modules inside the page, so what is tested is what ships, and the interface driven in a headless browser |
| Staleness | `npm run dirty` | 47 assertions: every result-affecting control moves the number, and the settled result matches a forced full recalculation |
| Engine audit | `npm run audit` | Runs both engines against independent answers (closed-form configuration factors, analytic sky integrals, symmetry, conservation) and rewrites `docs/ENGINE-VALIDATION.md` |

| Release guard | `npm run check-release` | 16 checks: every version, date and DOI stamp agrees with `CITATION.cff` (below) |

`npm run all` runs the guard, builds, and runs all three suites. The audit's
figures move slightly from run to run, because the raytracer is Monte-Carlo;
the run date and timings change every time.

The build reads the version and date from `CITATION.cff`.
`tools/check-release-metadata.mjs` holds every other copy to it:
`package.json` and `.zenodo.json`; the release stamp in the built
`daylight-lab.html`, so a build left behind after a bump fails; the README's
APA, Harvard and BibTeX citations; and both method notes pages, whose bylines
must name the version and the date spelled long and whose citations must use
the version DOI once it is minted and the concept DOI until then.

## The repository

```
src/                      the source modules, index.html, theme.css
vendor/three.min.js       three.js r160, with its licence
tools/build.mjs           builds daylight-lab.html from src/
tools/check-release-metadata.mjs  holds every version, date and DOI stamp to CITATION.cff
daylight-lab.html         the deliverable
test/validate.mjs         validation suite
test/dirty.mjs            staleness suite
test/audit.mjs            engine audit, writes docs/ENGINE-VALIDATION.md
docs/                     method notes (full and short), ENGINE-VALIDATION.md
CITATION.cff, .zenodo.json  citation and archive metadata
LICENSE, NOTICE           MIT for code, CC BY 4.0 for documentation, third-party notices
```

A release goes: bump every stamp, run `npm run all`, cut the tag,
let Zenodo archive it, then record the new version DOI in a separate commit.
