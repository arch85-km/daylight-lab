# Design decisions

The decisions behind Daylight Lab, and my reasons for them.
[`ARCHITECTURE.md`](ARCHITECTURE.md) describes how the code is organised,
[`docs/method-notes.html`](docs/method-notes.html) describes the methods and
their limits, and [`docs/ENGINE-VALIDATION.md`](docs/ENGINE-VALIDATION.md)
records how the engines were tested. This file records why the tool is the
way it is. Written in October 2026, at version 1.0.1.

— Karam Al-Obaidi

## Why it exists

My students needed to see daylight in their own rooms, and to understand why
it falls where it does. The tools available to them did not fit that:

- **IESVE and Revit** need a licence and so run only on lab PCs, ask for a
  great deal of set-up before a first daylight answer, and are built for
  compliance reports rather than for learning cause and effect.
- **Radiance and Ladybug** are validated, but the Rhino and Grasshopper
  set-up and the scripting are too steep for most students.
- **DIALux and the VELUX Daylight Visualizer** need installing and licensing,
  and are built for lighting design or product specification rather than
  for teaching.

## Why it runs in the browser

- **University-managed machines.** Nothing to install, no admin rights, no
  licences, nothing for IT to approve.
- **Any device, and embeddable.** It runs on students' own laptops and phones,
  and sits inside my website.

## Method

### Two independent engines

Daylight Lab computes with a Monte-Carlo daylight-coefficient raytracer and,
separately, with the BRE split-flux method.

- **Each checks the other.** Agreement between two different methods is
  evidence; where they disagree shows where one of them breaks down.
- **Split-flux is UK practice.** BS 8206-2 and the BRE split-flux method are
  what students meet in UK guidance and assessments.
- **The raytracer handles what the formula cannot.** Shading devices, deep
  plans and real interreflection need ray tracing.

### Annual metrics as well as the daylight factor

The tool reports daylight autonomy, sDA, ASE, useful daylight illuminance and
direct sun hours alongside the daylight factor.

- **Bridging old and new.** The daylight factor is what UK guidance has used;
  climate-based metrics are where practice is going. Students need both.
- **Climate and orientation.** The daylight factor ignores both; annual
  metrics show what a real place does to a room.
- **The same metrics as professional tools.** Students meet them again in
  Radiance, IESVE and assessments.

## Teaching

I use the tool in undergraduate and postgraduate teaching.

**The three exercises** in the method notes are mine:

1. Window head height, not window area, sets how deep daylight goes.
2. A shading device that lowers the daylight factor can improve the daylight.
3. Why an overhang works on the south façade and a fin is needed on the east.

**The eight guided case studies** in the app are also mine: unilateral
against bilateral, bilateral daylighting, adding a 0.6 m overhang, a
horizontal louvre bank, vertical fins on an east wall, toplighting only, a
deep plan with one window, and a thin wall against a thick one.

Two features came from watching students use the tool:

- **The tour opens on every launch**, because students meet the app about
  once a term and forget it in between. It stays until they switch it off.
- **The case studies**, the comparisons students needed to see side by side.

## What it leaves out

- **Context and specular reflection.** No surrounding buildings or terrain,
  and every surface is diffuse, so light shelves and glossy finishes are not
  represented.
- **Blinds and controls.** No blinds, schedules, electric lighting or
  dimming, so sDA and ASE here are indicative, not LM-83 submissions.
- **Glare and colour.** No glare metric, and no spectral or colour
  calculation.
- **Furniture and interior.** No furniture, partitions or occupants; the
  workplane neither blocks nor reflects light.

Surrounding buildings and a glare metric are the first of these I would add.

## How a release is checked

Before I teach with a release:

- **The automated suites pass**: validation, staleness and the engine audit.
- **I use the live site myself**, as a student would.
- **I work through the exercises and case studies** and check that their
  figures still hold.

## Licensing and archiving

The code is MIT and the teaching material is CC BY 4.0:

- **The code is free to reuse.** Anyone can adapt or embed it.
- **The material is reusable with credit.** Other educators can use the notes,
  exercises and case studies in their own courses, crediting the source.
- **The cube mark is reserved from both**, so a modified copy cannot pass
  itself off as mine.
- **Open licensing is expected** of this kind of work by my university or
  funders.

Every version is archived on Zenodo with its own DOI:

- **Reproducible figures.** A reported number can be traced to the exact build
  that produced it.
- **A citable research output.** The software counts as an output in its own
  right.
- **A permanent archive.** Each version survives even if my website changes.
- **Credit when reused.** Anyone who uses it has a proper way to cite it.

## How this was developed

I designed the application. I defined the problem and the scope: what the tool
is for, who it is for and what it leaves out. I chose the methods and the
sources it relies on, and set the exercises and case studies. I tested it in
use, found and reported the bugs, judged whether each fix worked, and decided
what was released and when.

The code was written with an AI coding assistant, working to my specification
and direction. It wrote most of the code, drafted the documentation, which I
reviewed, diagnosed bugs and proposed fixes, which I then tested, and wrote and
ran the automated tests and release checks. I retain full intellectual
responsibility for the design, the methods and the results, including any
errors.

## Next

- **Surrounding buildings**: context geometry, beyond the single obstruction
  angle.
- **A glare metric**, so "too bright" is more than a UDI interval.
