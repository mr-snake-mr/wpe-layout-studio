# WPE Layout Studio — specification

**Status:** v1.0, written against the build that is live at
[`mr-snake-mr.github.io/wpe-layout-studio`](https://mr-snake-mr.github.io/wpe-layout-studio/).
Sections marked **[confirm]** are places where the brief is silent and a decision was taken; they need the client's
answer before they can be treated as fixed requirements.

---

## 1. Source requirement

The brief, verbatim:

> **WPE_Layout** — Sample Data which gives the details of the inputs and requirements related to layout of two stations.
> Available floor space is often limited, and the challenge is to find the best possible arrangement of resources that
> satisfies all clearance rules while optimising the flow of material.

The deck adds, as the method, `resources ≈ work time ÷ cycle time`, and as the deliverables, a shopfloor layout for
**two stations** (Station 1: 3 robots, Machine 1, Machine 2, 8 + 1 trolleys; Station 2: 5 robots, Machine 1,
8 + 2 trolleys).

## 2. Scope

**In scope**

- Resource planning from a line rate (JPH).
- Generation of a shopfloor arrangement inside a rectangular floor area.
- Verification of that arrangement against the clearance rules.
- Choosing between alternative arrangements by a stated objective.
- Export of the plan for downstream use (CAD, report, slide).
- Manual adjustment with the same verification applied.

**Out of scope**

- 3D geometry, heights, crane envelopes, cable routing, utilities, foundations.
- Structural or safety certification; ISO 10218 / ANSI-RIA compliance sign-off.
- Costing, staffing levels, cycle-time simulation, discrete-event simulation.
- Reading binary DWG (see A1).
- Persistence of a user session between visits (exports are the record).

## 3. Functional requirements

| ID | Requirement | Acceptance criterion | Where |
|----|-------------|----------------------|-------|
| FR-1 | Accept a rectangular hall footprint, typed or read from a DXF | A 30 × 18 m closed outline in a DXF yields a 30.0 × 18.0 m hall; mm, cm, m, inch and foot files all convert | `importer.js`, footprint panel |
| FR-2 | Accept a line rate in jobs per hour and operation work content | `cycle time = 3600 ÷ JPH`; `robots = ceil(robot work ÷ cycle)`; 150 s at 60 JPH → 3, 280 s → 5 | `config.js`, `planner.js` |
| FR-3 | Build the process chain and its equipment | load fixture → fenced cell → Machine 1 → Machine 2 → fenced cell → unload, plus one controller per robot | `planner.js` |
| FR-4 | Generate alternative arrangements and keep the best | 25–50 candidates evaluated per run; every candidate is a complete, checkable layout | `plan()`, alternatives list |
| FR-5 | Verify every candidate against all rules | 8 rules, each reporting its measured minimum; a deliberately broken layout is rejected | `checker.js`, `tests/run.js` |
| FR-6 | Support one station or both stations of the brief | Two-station mode produces one plan with both chains, a shared walkway, and 8/8 passing | `plan()` dual mode |
| FR-7 | Deliver the plan | PNG, DXF R12 (mm), JSON, CSV and a self-contained HTML report | `exporters.js` |
| FR-8 | Allow manual editing with live verification | Dragging a resource re-runs all checks before the pointer is released; undo restores the exact prior state | `app.js`, `planner.recomputeFlow` |
| FR-9 | Respect a choosable objective | "Shortest flow" and "compact cell" can pick different plans; the chosen goal is stated in the verdict | `plan()` sort |
| FR-10 | Run without installation | Whole app works from a static host or a local file, no backend, no build step | repo layout |

## 4. Rule specification

All values are **edge-to-edge** (shortest distance between footprints), in millimetres.

| ID | Rule | Threshold | How it is enforced |
|----|------|-----------|--------------------|
| R0 | Resources must not overlap | 0 | pairwise rectangle intersection, every resource |
| R1 | Robot to machine or other equipment | ≥ 800 | pairwise distance, robots against machines / fixtures / controllers / trolleys |
| R2 | Robot to robot | ≥ 700 | pairwise distance, within and across cells |
| R3 | Pedestrian walkway | 1200 wide, one connected loop | walkway bands generated, then a 200 mm raster flood-fill from the ring must reach all four sides |
| R4 | Equipment to safety fence | ≥ 600 | distance from every non-robot resource to each fence rectangle; robots inside the fence are exempt |
| R5 | Trolley accessibility | ≥ 900 clear in front | a 900 mm strip on the aisle side of each trolley must be free of other resources |
| R6 | Trolley to trolley | ≥ 100 | pairwise distance along each wall |
| R7 | Trolleys on the perimeter | within the storage band | each trolley inside the hall, outside the walkway ring, within 800 mm of a wall |

Derived dimensions used by the generator: storage band 1000 deep, walkway ring 1200, fence offset from robot
envelope 600, inter-row corridor ≥ 1200, manual-move snap 50.

## 5. Assumptions

**[A1] Hall dimensions are an input, not a measurement.** The supplied DWG is binary and cannot be parsed without a
converter, so the footprint is typed or imported as DXF. Defaults: 24 × 13 m (Station 1), 26 × 13 m (Station 2),
34 × 16 m (both stations). These are plausible cells, **not** values read from the sample drawing.

**[A2] Clearances are edge-to-edge**, not centre-to-centre. This is the conservative reading and matches how a safety
fence is dimensioned.

**[A3] "Safety zone 2" means two fenced cells per station.** Robots are split `ceil(n/2)` / `floor(n/2)`; a single
robot produces one cell.

**[A4] Robot controllers sit outside the fence**, one per robot, 600 mm clear of it, so R4 holds without special cases.

**[A5] Trolleys belong to the hall, not to a station**, and are shared in two-station mode. Long side runs along the
wall, 100 mm off it.

**[A6] Floor area is rectangular and empty.** No columns, pits, doors, or existing equipment inside the area.

**[A7] Equipment footprints** are engineering estimates, since the deck gives counts but not sizes: Machine 1
3200 × 2200, Machine 2 2600 × 2000, fixtures 1400 × 1000, robot 800 × 800, controller 600 × 600, trolley 1200 × 800
and 1000 × 800.

**[A8] The process sequence is fixed** as load → cell → M1 → M2 → cell → unload. The generator optimises placement,
not the order of operations.

**[A9] Only computed resources count as requirements.** The solution does not invent equipment the brief does not
mention; safety fence and controllers are the only derived items.

## 6. Open questions **[confirm]**

1. What are the real dimensions of the allocated area, and is it the same area for both stations?
2. Are the trolley counts (8 + 1, 8 + 2) fixed, or should they follow from the line rate?
3. Is the 600 mm fence clearance measured to the fence line or to the guarded opening?
4. In two-station mode, should trolleys be shared (as built) or dedicated per station?
5. Are the machine footprints available from the DWG, so A7 can be replaced by real geometry?
6. Must the walkway be a closed loop, or is access to each resource sufficient?
7. Is 60 JPH required per station simultaneously, or is it the plant rate shared between them?

## 7. Verification

The specification is met when all of the following hold, and all of them are automated:

- `node tests/run.js` — resource maths, 8/8 compliance on 3 presets and a 60-combination hall/robot sweep, negative
  tests that a broken layout is rejected, two-station plan, objective trade-off, flow recompute.
- `node tests/import-test.js` — DXF import in mm, inches, legacy R12 vertices, and a garbage file.
- `node tests/render-smoke.js` — the real canvas code against a stub context; DXF/JSON/CSV/report output.
- `node tests/dom-check.js` — every element the UI touches exists.
- `python tests/validate_dxf.py` — the exported drawing parsed by an independent CAD library.
