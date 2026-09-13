# Daylight Lab

An interactive daylighting tool for architecture students. A parametric room with
real wall, roof and floor thickness; windows, skylights and doors you can add,
size and move; horizontal and vertical shading devices; a 3D sun path with
shadows and visible solar rays; and a workplane grid reporting **illuminance**,
**daylight factor** and **useful daylight illuminance** — plus daylight autonomy,
sDA, annual sunlight exposure and direct sun hours.

Everything ships as **one self-contained HTML file** with no CDN, no build step
for the end user, and no install. It runs offline, on a phone, and inside a
WordPress page.

© Karam Al-Obaidi

---

## Embedding in WordPress

`daylight-lab.html` is the whole application. Nothing else needs to be uploaded.

1. **Upload the file to your server**, for example to
   `/wp-content/uploads/daylight-lab.html`.

   WordPress blocks `.html` in the Media Library by default, so use FTP/SFTP,
   your host's file manager, or a plugin that permits HTML uploads. Do not paste
   the file into a Custom HTML block — it is around 1 MB.

2. **Add a Custom HTML block** to the page where it should appear:

   ```html
   <div style="position:relative;width:100%;height:0;padding-bottom:66%;min-height:520px;">
     <iframe src="/wp-content/uploads/daylight-lab.html"
             style="position:absolute;inset:0;width:100%;height:100%;border:0;"
             loading="lazy" title="Daylight Lab"></iframe>
   </div>
   ```

   The `padding-bottom` sets the aspect ratio; `min-height` keeps it usable on
   narrow screens. A full-width or full-screen page template gives students the
   most room. The app is responsive on its own and works down to phone width.

**Alternatives.** Linking straight to the file (`/wp-content/uploads/daylight-lab.html`)
gives students the whole browser window, which is the best experience for
coursework. The file also opens directly from a USB stick or a local folder with
no server at all.

**If your host sets a restrictive Content-Security-Policy**, allow `worker-src blob:`
so the analysis worker can start. Without it the app still works — it falls back
to a time-sliced single-threaded mode and says so in the status bar.

---

## What it computes

| Metric | Definition | Sky |
|---|---|---|
| **Illuminance** | Workplane lux at one instant | any |
| **Daylight Factor** | Indoor ÷ unobstructed outdoor horizontal, × 100 | CIE overcast |
| **UDI** | % of occupied hours in each illuminance interval | Perez, from climate |
| **Daylight Autonomy / sDA** | % of hours ≥ target; % of area with DA ≥ 50% | Perez, from climate |
| **ASE** | Hours of direct sun above threshold; % of area over the hour limit | direct beam |
| **Direct sun hours** | Hours per year the sun disc is visible at the point | geometry only |

UDI ships with the five-interval classification — too low `< 150`, low `150–300`,
in range `300–500`, high `500–3000`, too high `> 3000` lux — and every threshold
is editable, with one-click presets for the 4-bin `100/300/3000` convention and
the original Nabil & Mardaljevic `100–2000` definition.

### Two calculation engines

**Raytraced daylight coefficients (default).** Several hundred cosine-weighted
rays are traced from every grid point through the actual geometry. A ray that
escapes is recorded against the sky patch it left through (Tregenza/Reinhart, 145
patches, 577 at the finest quality); a ray that hits a surface reflects diffusely
with that surface's reflectance and continues. Glazing is passed through with its
transmittance rather than blocking.

The result is a matrix — lux per unit luminance of each sky patch — so one bake
serves the daylight factor, any instant, and all 8760 hours of the year. It sees
overhangs, fins, louvre banks, the reveal formed by wall thickness, the well
formed by roof thickness, and true interreflection.

**Split-flux (BRE).** `DF = SC + ERC + IRC`. The sky component is integrated over
the aperture, the externally reflected component comes from the obstruction angle,
and the internally reflected component from the BRE average formula. Milliseconds
rather than seconds.

**Both engines see shading devices and direct sun.** Overhangs, louvre banks and
fins are tested against the real geometry in both, and the beam is pure sun
geometry traced identically — so **ASE and Direct sun hours give the same answer
whichever engine is selected**, as they should.

They still differ where the methods genuinely differ. The raytracer sees the
reveal formed by wall thickness cutting off oblique sky, and the well formed by
roof thickness; it also simulates interreflection bounce by bounce, where
split-flux applies one uniform internally-reflected value across the room.

Put the glazing at the *inside* face of the wall and take the daylight factor at
0.10 m thickness and again at 0.90 m. The raytraced number falls by about 45%;
the split-flux number does not move at all, because the BRE method works from the
net glazed area and has no term for the depth of the opening. Move the glazing to
the outside face and repeat — split-flux now moves, but only because the pane is
further away and subtends a smaller angle, never because of the reveal. That
distinction is the clearest remaining demonstration of what a simplified method
cannot see.

One departure from the textbook: the BRE internally reflected component has no
shading term, so this tool scales it by the fraction of sky flux the devices
remove. Without that, a deep room's back half would not respond to an overhang at
all. It is an extension of BS 8206-2, not part of it.

### Sky models

CIE Overcast, Clear and Intermediate via the CIE general sky formulation
(CIE S 011), a Uniform sky, and the **Perez all-weather model** driven by the
direct-normal and diffuse-horizontal irradiance of a real climate hour.

### Climate

Drag any `.epw` file onto the window. The header's latitude, longitude and time
zone are applied automatically and the sky model switches to Perez. Without a file
the app runs on a deterministic synthetic climate for the chosen site, so every
annual metric works from the first second — but import a real EPW before quoting
any number.

---

## Using it

A guided tour opens **every time the app is launched** — nine or ten spotlit
steps covering the metrics, the model, the toolbar, the legend, the statistics,
the time sliders and the export. Students meet the tool once a term and rarely
remember it, so it keeps offering itself. Anyone who has had enough can tick
**Don't show this on launch** in the tour card; that is the only thing that
suppresses it, and unticking the same box brings it back. It can be skipped at
any point and replayed from **Start the guided tour** in the help panel.

- Pick a metric along the top. Illuminance and Daylight Factor are instant; the
  annual metrics take a few seconds.
- Drag to orbit, right-drag or shift-drag to pan, scroll to zoom. One finger
  orbits and two fingers pan and zoom on a touchscreen.
- **Fit** (the toolbar's four corners, or `F`) frames the room in the part of
  the viewport that no floating panel covers, solved against the real
  projection — it recovers the view from any camera, however lost.
- The **hand tool** in the viewport toolbar turns a plain drag into a pan in
  every view mode and stands the opening-drag down while it is on, so moving
  the model about cannot nudge a window. **Hold Space** for the same thing
  without switching tools, and `Esc` always returns you to orbiting.
- On a laptop, `C` clears every floating panel out of the way, and each panel
  folds to its title bar from the chevron on its right.
- **Click any dimension label in the viewport to type a new value.** The model
  rebuilds immediately.
- The two sliders at the bottom scrub time of day and day of year.

**Keyboard:** `1`–`6` metrics · `F` fit · `Space` pan while held · `C` clean
view · `P` plan view · `R` rays · `D` dimensions · `V` values · `H` hide roof ·
`Ctrl+Z` undo a move · `?` help · `Esc` close or leave the hand tool.

### Reading a fully enclosed room

Plan view drops the camera to just under the roof soffit and looks straight down.
The roof meshes are hidden **from the camera only** — the roof, the skylight well
and the ceiling all stay in the geometry the raytracer sees, so the readings are
those of the fully enclosed room. The status bar says so:
`Roof: CLOSED (in calculation) — clipped for viewing`.

*Remove roof from the CALCULATION* is a separate control that really does delete
the roof, for demonstrating the difference. Leave it off for any real reading.

### Presentation

Three appearance themes — Studio Light, Dark Lab, Architectural Clay — and six
workplane styles: smooth false colour, discrete cells, filled contours with
isolines, dot matrix, values only, and 3D relief. Nine colour ramps, three of them
safe for colour vision deficiency. Values can be shown on the workplane with
adjustable decimals and label density.

### Export

- **PNG** with a title block, north arrow, legend, statistics and the copyright
  line, at 1× to 4× resolution.
- **CSV** of every grid point with its coordinates.
- **JSON** of the whole model, which loads back in.

Scenarios save to browser storage and two can be put side by side with their
statistics and a difference summary.

---

## Development

The shipped `daylight-lab.html` is generated from `src/`. The build concatenates
the modules and inlines three.js, the stylesheet and the analysis worker.

```bash
npm install      # playwright, for validation only
npm run build    # src/ + vendor/ -> daylight-lab.html
npm run validate # headless physics + interface checks, writes test/out/
npm run audit    # engine quality audit -> docs/ENGINE-VALIDATION.md
npm run all      # all three
```

| Path | |
|---|---|
| `src/solar.js` | NOAA solar position, sun path, clear-sky irradiance |
| `src/sky.js` | Tregenza/Reinhart patches, CIE general sky, Perez all-weather |
| `src/epw.js` | EPW parser and the synthetic fallback climate |
| `src/geometry.js` | Thick parametric shell, rectangle-with-holes partition, reveals |
| `src/shading.js` | Overhangs, louvre banks, vertical fins |
| `src/bvh.js` | Binned-SAH triangle BVH |
| `src/engine.core.js` | Daylight-coefficient raytracer and the annual run |
| `src/engine.worker.js` | Worker message loop |
| `src/engine.js` | Facade over the worker, with a main-thread fallback |
| `src/splitflux.js` | BRE sky / externally reflected / internally reflected components |
| `src/metrics.js` | DF, UDI, DA, sDA, ASE, sun hours, statistics |
| `src/view.js` | Renderer, camera control, model meshes, workplane styles |
| `src/dimensions.js` | Dimension lines and click-to-edit |
| `src/ui.js` | Toolbar panels and the metric information panels |
| `src/main.js` | State and the recompute pipeline |

### Engine validation

[`docs/ENGINE-VALIDATION.md`](docs/ENGINE-VALIDATION.md) is generated by
`npm run audit` and carries measured numbers rather than claims: closed-form
benchmarks (an unobstructed point, the sky integrals, a rectangular roof
aperture against its configuration factor, a sealed box that must read exactly
zero), Monte-Carlo convergence with a standard deviation for every quality
tier, interreflection and grid-independence sweeps, a symmetry check, a
cross-engine agreement table, and the size of each known approximation.

Read it before quoting a number from this tool in coursework, and re-run it
after any change to the engines.

`npm run validate` asserts the physics against analytic results — an unobstructed
point reads exactly 100% DF, solar positions match published NOAA values to 0.1°,
the sky integrals match `7π/9` and `π`, daylight factor rises monotonically with
reflectance and falls monotonically with overhang depth and wall thickness, UDI
intervals sum to the occupied hours at every point — then drives the real
interface and captures a screenshot of every theme, style and metric.

---

## Limitations

This tool is built to teach relationships and orders of magnitude.

- Glazing transmittance is treated as diffuse-equivalent; specular and
  directional glazing is not modelled.
- No external context beyond a single obstruction angle, which only the
  split-flux engine uses.
- No blind operation schedule, so sDA and ASE are indicative rather than
  IES LM-83 submissions.
- No spectral or colour effects.
- A flat 365-day year; 29 February in an EPW is skipped.

For a compliance submission use IESVE, Radiance via Ladybug and Honeybee, or an
equivalent validated tool.

---

## How to cite

If the tool informs a paper, a thesis, a lecture or a studio brief, cite it as
software. Attribution under the licence is a separate thing — keeping the
copyright notice in the file satisfies that; a citation is the scholarly
courtesy on top of it.

**APA 7**

> Al-Obaidi, K. (2026). *Daylight Lab: a browser-based daylighting teaching
> tool* (Version 1.0.0) [Computer software].
> https://karam.me.uk/apps/daylight-lab/index.html

**Harvard**

> Al-Obaidi, K. (2026) *Daylight Lab: a browser-based daylighting teaching
> tool* (Version 1.0.0). Available at:
> https://karam.me.uk/apps/daylight-lab/index.html

**BibTeX**

```bibtex
@software{alobaidi2026daylightlab,
  author  = {Al-Obaidi, Karam},
  title   = {Daylight Lab: a browser-based daylighting teaching tool},
  year    = {2026},
  version = {1.0.0},
  url     = {https://karam.me.uk/apps/daylight-lab/index.html},
  note    = {MIT licensed}
}
```

Anyone reporting results from the tool should also state the **engine**
(raytraced or split-flux), the **quality tier**, the **sky model** and the
**climate file**, since all four change the numbers. Every exported image
carries them in its title block, and the CSV export carries them as header
comments.

> **Getting a DOI.** A permanent DOI makes the tool far easier to cite, and
> reviewers prefer one to a bare URL. [Zenodo](https://zenodo.org) mints them
> free and can watch a GitHub repository, issuing a new DOI for each release.
> Once minted, add it to the entries above — the DOI then replaces the URL as
> the thing people quote.

---

## Licence

Two licences, because software and writing want different terms. **Both permit
commercial use. Both ask only for credit.**

| | |
|---|---|
| **Software** — `src/`, `tools/`, `test/`, and the built `daylight-lab.html` | **MIT** |
| **Documentation and teaching material** — this README, `docs/`, the method notes, the exercises, the figures | **[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)** |

Use it, change it, host it, teach with it, build it into something else, sell
what you build — just keep the credit. The copyright notice embedded in the
interface, the status bar and every exported image satisfies attribution on its
own when left in place.

Full text and the third-party carve-outs are in [`LICENSE`](LICENSE). The MIT
notice travels **inside** `daylight-lab.html` itself, because the single file is
the thing people actually receive.

## Credits

Built with [three.js](https://threejs.org) (r160, **MIT** — full text in
[`vendor/three.LICENSE`](vendor/three.LICENSE) and reproduced inside the built
file), inlined so the tool needs no CDN.

Legend colour maps are sampled from **viridis** and **inferno** (Nathaniel J.
Smith & Stéfan van der Walt, CC0), **cividis** (Nuñez, Anderton & Renslow, CC0)
and **turbo** (Anton Mikhailov, Google, Apache-2.0).

Methods follow Nabil & Mardaljevic (2005) for UDI, Perez et al. (1993) for the
all-weather sky and Perez et al. (1990) for luminous efficacy, CIE S 011 for the
standard skies, Tregenza/Reinhart for the sky subdivision, the NOAA Solar
Calculator for solar position, BRE/BS 8206-2 for the split-flux components and
the average daylight factor, and IES LM-83 for sDA and ASE. Those standards are
cited, not redistributed.

© Karam Al-Obaidi
