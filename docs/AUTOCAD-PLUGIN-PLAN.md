# AutoCAD plugin — feasibility and plan

**Decision taken:** the tool runs as a plugin **inside AutoCAD**, so it works on the open DWG directly. That removes
the file-format problem entirely: no ODA licence, no DWG parser, no conversion step.

---

## 1. Confirmed architecture

| Layer | Choice | Note |
|---|---|---|
| Host | AutoCAD 2025+ (full, not LT) | LT cannot load .NET plugins, ever |
| Runtime | .NET 8 class library, AutoCAD .NET API | .NET Framework 4.8 build too, if 2023/2024 seats remain |
| Entry | `[CommandMethod("WPELAYOUT")]` + a modeless palette | command for scripting, palette for planners |
| Loading | `NETLOAD` for the pilot, autoload bundle (`PackageContents.xml`) for rollout | signing + trusted path needed for silent load |
| Geometry | live `DatabaseServices` objects | `BlockReference`, `GeometricExtents`, `Polyline` |
| Solver | existing planner + checker, embedded | see §3 |
| Output | new layers + blocks in the same drawing, one transaction | a single `U` reverts a run |

## 2. Read path — what the plugin needs from the drawing

- **Hall**: one closed polyline on layer `WPE-HALL` (or the drawing extents of that layer). Converted to mm using the
  drawing's `INSUNITS`.
- **Resources**: block references whose block name, or XDATA/attribute (`WPE-TYPE`), identifies the role — robot,
  machine, fixture, controller, trolley. Everything else is ignored.
- **Footprint**: `GeometricExtents` in WCS, so rotation and scale are already baked in. Non-uniform scale flagged.
- **Validation dialog** before any planning: found / unrecognised / unmeasurable counts, plus a list of the offending
  handles. This is the difference between a tool and a toy.

### Naming — AutoCAD native, not a house scheme

No invented prefixes. The plugin follows the conventions an AutoCAD user already expects:

- **Only six reserved layers**, hyphen separated, uppercase, no spaces: `WPE-HALL` (boundary), `WPE-PLAN`,
  `WPE-FENCE`, `WPE-WALK`, `WPE-DIM`, `WPE-TEXT`.
- **Names stay inside AutoCAD's legal character set** — `< > / \ " : ; ? * | , =` are illegal, names are unique and
  case-insensitive.
- **Resource identity comes from the block name their library already uses**, resolved through a mapping table stored
  per project. Nothing in their drawing is renamed to suit the tool.
- **One optional attribute**, `WPE-TYPE`, disambiguates blocks whose names are shared. Optional, not mandatory.
- **Commands are single tokens**, uppercase, no separators: `WPELAYOUT`, `WPECHECK`.

Known bad cases, all of which must be reported rather than guessed: proxy objects from Architecture/Civil 3D,
exploded blocks (plain lines, no identity), nested xrefs (traverse or require bind), annotative scaling, drawings in
metres rather than millimetres.

## 3. Solver reuse

The planner, the eight-rule checker and the search are complete and tested; they contain no DOM code. Two routes:

- **Embed the JS** with ClearScript or Jint (~3–5 days). One source of truth, instant reuse, plain JSON at the boundary.
- **Port to C#** (~2–3 weeks). Cleaner long-term, no interop, easier debugging, better perf headroom.

Recommendation: embed for the pilot, decide on the port only if the plugin becomes the primary product.

## 4. Write path

Inside one transaction: create layers `WPE-PLAN`, `WPE-FENCE`, `WPE-WALK`; insert blocks at the computed transforms;
draw the fence as a closed polyline offset 600 from the robot envelope; hatch the walkway; add dimensions and labels.
Source blocks are **not** moved or deleted — the plan is additive, so the review copy and the proposal sit side by side.
Optionally a second command `WPELAYOUTAPPLY` that moves the originals once the plan is approved.

## 5. UI

Modeless `PaletteSet` with a WPF control: hall + line rate, resource list auto-filled from the selection, objective
toggle (flow / compact), rule thresholds, Run, and the same compliance table the web app shows. Double-clicking a rule
zooms to the offending pair — cheap to build, and it's what makes reviewers trust the numbers.

## 6. Phases

| Phase | Deliverable | Exit criterion | Time |
|---|---|---|---|
| 0. Spike | Open one real DWG, classify blocks, write one rectangle back | Classification report on a real drawing | 2–3 days |
| 1. MVP | Read → plan → write, validation + compliance report, undo | Client's drawing produces 8/8 and a usable plan | 2–3 weeks |
| 2. Productise | Palette UI, rule editor, presets, units handling, installer | Another planner can use it unaided | 2–3 weeks |
| 3. Harden | Version matrix, proxy/xref handling, signing, docs, batch via Core Console | Passes on 2 releases, 3 real drawings | 1–2 weeks |

Total **6–9 weeks** for one experienced .NET/CAD developer. The algorithm work is already done and tested; the
remaining effort is CAD data hygiene, UI and deployment.

## 7. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Blocks lack identity (exploded / arbitrary names) | High — nothing to plan | Convention + mapping dialog + validation report; this is the phase-0 gate |
| Proxy objects from vertical products | Medium | Detect, report, exclude; never guess extents |
| Machine set lives in an xref | Medium | Traverse nested references, or require bind (decide in phase 0) |
| AutoCAD LT seats | Blocking | Confirm variant before phase 1 |
| Version spread (2023–2027) | Medium | Multi-target build; test on the two releases they actually use |
| Unsigned DLL blocked by IT | Low | Sign + trusted location, or per-user autoload registry key |
| No AutoCAD on the dev machine | Medium | Needs one licensed seat for build-and-run, or client QA loop |

## 8. What the client must provide

1. AutoCAD variant and exact release(s) — full or LT, 2024/2025/2026/2027.
2. One real DWG with the machine set as they actually draw it.
3. The block library, or confirmation that names/attributes can be standardised.
4. A licensed seat (or a QA slot) to verify the plugin.
5. Who signs off the drawing convention, since the plugin's accuracy depends on it.

## 9. Relationship to what already ships

The web application stays: it is the review and demo surface, and the DXF round-trip remains the fallback for anyone
without a seat. The plugin is a shell over the same solver, so a fix to a rule fixes both.
