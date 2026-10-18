# Changelog

Every release of Daylight Lab, newest first. Each entry is a summary; the
release page linked from its heading has the full notes, and a version DOI
resolves to the archived copy of exactly that build. To cite the software in
general rather than one build, use the concept DOI
[10.5281/zenodo.22796355](https://doi.org/10.5281/zenodo.22796355).

## Unreleased

On `main` since 1.0.1, not yet in a release:

- **Added** a message over the model when the browser runs scripts without
  its compiler, as Microsoft Edge's "Enhance your security on the web" does
  for sites it does not know. Every calculation then takes about ten times as
  long (Calculate 1.0 s against 11.6 s), and the app seems to hang. In Edge
  the message gives the steps (the padlock, "Enhanced security is active for
  this site", turn it off, Refresh); in any other browser in that mode, to use
  Chrome or Firefox. It stays until hidden. Recognised by timing, the same
  check as Urban Wind Lab's.
- **Added** the release (version and date) shown in the app, beside the build
  hash, read from `CITATION.cff`.
- **Changed** the tab icon travels inside the file, so a copy opened from
  disk or another domain shows the same mark.
- **Changed** the cube device (the icon and logo) is reserved from both
  licences, in `NOTICE`, the app and the Zenodo metadata.
- **Docs** citations name the 1.0.1 version DOI, and `.zenodo.json` no longer
  drifts from `CITATION.cff`.
- **Docs** the method notes count thirty-six city presets, not thirty-seven:
  the dropdown's "Custom coordinates…" row is not a preset.
- **Fixed** the README cited 1.0.0 and its DOI a release after the notes had
  moved to 1.0.1; it now cites 1.0.1.
- **Added** a release guard (`npm run check-release`, first in `npm run
  all`): 16 checks holding every version, date and DOI stamp to
  `CITATION.cff`, including the built page and the README.
- **Docs** `ARCHITECTURE.md`, `CHANGELOG.md` and `DESIGN.md`, and a "How this
  was developed" statement in the README, the method notes and the Zenodo
  metadata.

## [1.0.1](https://github.com/arch85-km/daylight-lab/releases/tag/v1.0.1) — 30 September 2026

Version DOI [10.5281/zenodo.23069949](https://doi.org/10.5281/zenodo.23069949)

A patch release. **Results change** for anyone who used Project north:
annual figures computed in 1.0.0 with the dial away from 0° were wrong.

- **Fixed** Project north now reaches the annual run. Daylight autonomy, sDA,
  ASE, UDI and direct sun hours were computed as though the dial were at 0°.
- **Fixed** the site controls (city, latitude, longitude, time zone, Project
  north) and loading an EPW file now refresh the single-moment result, which
  could be left arbitrarily wrong on screen.
- **Changed** Project north can be typed exactly, not only dragged.
- **Added** `npm run dirty`, a staleness suite: every result-affecting control
  must move the number, and the settled result must match a full
  recalculation.
- **Docs** the method notes describe what Project north reaches and that the
  angle runs clockwise; figures quoted more precisely than they can hold were
  softened; `docs/ENGINE-VALIDATION.md` regenerated against this build.

## [1.0.0](https://github.com/arch85-km/daylight-lab/releases/tag/v1.0.0) — 16 September 2026

Version DOI [10.5281/zenodo.22796356](https://doi.org/10.5281/zenodo.22796356)

First release. A parametric room with real wall, roof and floor thickness;
windows, skylights and doors; horizontal and vertical shading; a 3D sun path
with shadows and solar rays; and a workplane grid reporting illuminance,
daylight factor, useful daylight illuminance, daylight autonomy, sDA, annual
sunlight exposure and direct sun hours. Two independent engines, a
Monte-Carlo daylight-coefficient raytracer and a BRE split-flux
implementation, whose agreement is measured in `docs/ENGINE-VALIDATION.md`.
One self-contained HTML file, with no install and nothing fetched.
