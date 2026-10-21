/* ============================================================
   Rule engine — verifies a layout against the seven WPE rules.
   Everything is recomputed from the geometry, so the report can
   never disagree with what is drawn on screen.
   ============================================================ */
(function (root) {
  'use strict';
  const WPE = (root.WPE = root.WPE || {});
  const G = () => WPE.Geom;
  const CONFIG = () => WPE.Config;

  const EQUIPMENT = { machine: 1, fixture: 1, controller: 1, trolley: 1 };

  function evaluate(layout, rules, hall) {
    const g = G();
    const items = layout.items || [];
    const fences = layout.fences || [];
    const zones = layout.zones || {};
    const R = Object.assign({}, CONFIG().RULES, rules || {});
    const out = [];
    const solid = items.filter((it) => it.kind !== 'fence');

    /* ---------------- R0 : no overlaps ---------------- */
    const overlaps = [];
    for (let i = 0; i < solid.length; i++) {
      for (let j = i + 1; j < solid.length; j++) {
        const a = g.gap(solid[i].rect, solid[j].rect);
        if (a.overlap) overlaps.push({ a: solid[i], b: solid[j] });
      }
    }
    out.push({
      id: 'R0',
      pass: overlaps.length === 0,
      actual: overlaps.length ? overlaps.length + ' overlap(s)' : '0 overlaps',
      detail: overlaps.length
        ? 'Overlapping: ' + overlaps.slice(0, 3).map((o) => o.a.label + ' / ' + o.b.label).join(', ')
        : 'All ' + solid.length + ' resources occupy clean footprints.',
      items: overlaps.reduce((acc, o) => acc.concat([o.a.id, o.b.id]), [])
    });

    /* ---------------- R1 : robot <-> machine ---------------- */
    let worstR1 = { d: Infinity, a: null, b: null };
    let r1bad = 0;
    const robots = solid.filter((it) => it.kind === 'robot');
    const equip = solid.filter((it) => EQUIPMENT[it.kind]);
    robots.forEach((rb) => {
      equip.forEach((eq) => {
        const gg = g.gap(rb.rect, eq.rect);
        if (gg.dist < worstR1.d) worstR1 = { d: gg.dist, a: rb, b: eq };
        if (gg.dist < R.robotMachine - 0.5) r1bad++;
      });
    });
    out.push({
      id: 'R1',
      pass: r1bad === 0,
      actual: robots.length && equip.length ? Math.round(worstR1.d) + ' mm min' : 'n/a',
      detail: robots.length
        ? (r1bad === 0
          ? 'Closest robot/equipment pair: ' + Math.round(worstR1.d) + ' mm (limit ' + R.robotMachine + ' mm).'
          : r1bad + ' robot/equipment pair(s) below ' + R.robotMachine + ' mm.')
        : 'No robots placed.',
      items: worstR1.a ? [worstR1.a.id, worstR1.b.id] : []
    });

    /* ---------------- R2 : robot <-> robot ---------------- */
    let worstR2 = { d: Infinity, a: null, b: null };
    let r2bad = 0;
    for (let i = 0; i < robots.length; i++) {
      for (let j = i + 1; j < robots.length; j++) {
        const gg = g.gap(robots[i].rect, robots[j].rect);
        if (gg.dist < worstR2.d) worstR2 = { d: gg.dist, a: robots[i], b: robots[j] };
        if (gg.dist < R.robotRobot - 0.5) r2bad++;
      }
    }
    out.push({
      id: 'R2',
      pass: r2bad === 0,
      actual: worstR2.a ? Math.round(worstR2.d) + ' mm min' : 'n/a',
      detail: robots.length > 1
        ? (r2bad === 0
          ? 'Closest robot pair: ' + Math.round(worstR2.d) + ' mm (limit ' + R.robotRobot + ' mm).'
          : r2bad + ' robot pair(s) below ' + R.robotRobot + ' mm.')
        : 'Fewer than two robots — not applicable.',
      items: worstR2.a ? [worstR2.a.id, worstR2.b.id] : []
    });

    /* ---------------- R3 : pedestrian walkway ---------------- */
    out.push(walkwayCheck(layout, R));

    /* ---------------- R4 : equipment <-> safety fence ---------------- */
    let worstR4 = { d: Infinity, a: null, b: null };
    let r4bad = 0;
    if (fences.length) {
      equip.forEach((eq) => {
        fences.forEach((f) => {
          const gg = g.gap(eq.rect, f.rect);
          if (gg.dist < worstR4.d) worstR4 = { d: gg.dist, a: eq, b: f };
          if (gg.dist < R.fenceClearance - 0.5) r4bad++;
        });
      });
    }
    out.push({
      id: 'R4',
      pass: r4bad === 0,
      actual: fences.length ? (worstR4.a ? Math.round(worstR4.d) + ' mm min' : 'n/a') : 'n/a',
      detail: !fences.length
        ? 'No safety fence in this configuration.'
        : (r4bad === 0
          ? 'Closest equipment/fence pair: ' + Math.round(worstR4.d) + ' mm (limit ' + R.fenceClearance + ' mm).'
          : r4bad + ' equipment/fence pair(s) below ' + R.fenceClearance + ' mm.'),
      items: worstR4.a ? [worstR4.a.id, worstR4.b.id] : []
    });

    /* ---------------- R5 : trolley accessibility ---------------- */
    const trolleys = solid.filter((it) => it.kind === 'trolley');
    let r5bad = [];
    trolleys.forEach((t) => {
      const strip = accessStrip(t, hall);
      const blocked = solid.some((o) => o.id !== t.id && g.intersects(o.rect, strip));
      const inside = g.contains(hall, strip, 1);
      if (blocked || !inside) r5bad.push(t.id);
    });
    out.push({
      id: 'R5',
      pass: r5bad.length === 0,
      actual: trolleys.length ? (r5bad.length ? r5bad.length + ' blocked' : 'all clear') : 'n/a',
      detail: !trolleys.length
        ? 'No material trolleys placed.'
        : (r5bad.length === 0
          ? 'Every trolley has a clear ' + R.trolleyAccess + ' mm operator approach.'
          : r5bad.length + ' trolley(s) have a blocked approach.'),
      items: r5bad
    });

    /* ---------------- R6 : trolley <-> trolley ---------------- */
    let worstR6 = { d: Infinity, a: null, b: null };
    let r6bad = 0;
    for (let i = 0; i < trolleys.length; i++) {
      for (let j = i + 1; j < trolleys.length; j++) {
        const gg = g.gap(trolleys[i].rect, trolleys[j].rect);
        if (gg.dist < worstR6.d) worstR6 = { d: gg.dist, a: trolleys[i], b: trolleys[j] };
        if (gg.dist < R.trolleyGap - 0.5) r6bad++;
      }
    }
    out.push({
      id: 'R6',
      pass: r6bad === 0,
      actual: worstR6.a ? Math.round(worstR6.d) + ' mm min' : 'n/a',
      detail: trolleys.length > 1
        ? (r6bad === 0
          ? 'Closest trolley pair: ' + Math.round(worstR6.d) + ' mm (limit ' + R.trolleyGap + ' mm).'
          : r6bad + ' trolley pair(s) below ' + R.trolleyGap + ' mm.')
        : 'Fewer than two trolleys — not applicable.',
      items: worstR6.a ? [worstR6.a.id, worstR6.b.id] : []
    });

    /* ---------------- R7 : trolleys on the perimeter ---------------- */
    const ring = zones.ring;
    let r7bad = [];
    trolleys.forEach((t) => {
      const inHall = g.contains(hall, t.rect, 1);
      const inRing = ring ? g.intersects(t.rect, ring) : false;
      const band = R.bandDepth;
      const distWall = Math.min(t.rect.x, t.rect.y, hall.w - (t.rect.x + t.rect.w), hall.h - (t.rect.y + t.rect.h));
      if (!inHall || inRing || distWall > band - 200 + 1) r7bad.push(t.id);
    });
    out.push({
      id: 'R7',
      pass: r7bad.length === 0,
      actual: trolleys.length ? (r7bad.length ? r7bad.length + ' misplaced' : 'perimeter OK') : 'n/a',
      detail: !trolleys.length
        ? 'No material trolleys placed.'
        : (r7bad.length === 0
          ? 'All trolleys sit in the perimeter band and stay clear of the walkway ring.'
          : r7bad.length + ' trolley(s) outside the perimeter band or encroaching the walkway.'),
      items: r7bad
    });

    const passCount = out.filter((x) => x.pass).length;
    return {
      rules: out,
      passCount: passCount,
      failCount: out.length - passCount,
      compliant: passCount === out.length
    };
  }

  /** clear operator approach strip in front of a trolley (towards hall interior) */
  function accessStrip(t, hall) {
    const a = t.access || 'up';
    const d = (WPE.Config.RULES.trolleyAccess);
    const r = t.rect;
    if (a === 'up') return { x: r.x, y: r.y + r.h, w: r.w, h: d };
    if (a === 'down') return { x: r.x, y: r.y - d, w: r.w, h: d };
    if (a === 'right') return { x: r.x + r.w, y: r.y, w: d, h: r.h };
    return { x: r.x - d, y: r.y, w: d, h: r.h };
  }

  /** raster based walkway continuity + width verification */
  function walkwayCheck(layout, R) {
    const g = G();
    const zones = layout.zones || {};
    const ring = zones.ring;
    const hall = layout.hall;
    if (!ring) {
      return { id: 'R3', pass: false, actual: 'n/a', detail: 'No walkway zone defined.', items: [] };
    }
    const cell = 200;
    const grid = g.makeGrid(hall, cell);
    (layout.items || []).forEach((it) => g.rasterize(grid, it.rect, 1));
    (layout.fences || []).forEach((f) => g.rasterize(grid, f.rect, 1));

    const seed = { x: ring.x + R.aisleWidth / 2, y: hall.h / 2 };
    const seen = g.flood(grid, g.cellIndexAt(grid, seed));
    const samples = [
      { x: ring.x + R.aisleWidth / 2, y: hall.h / 2, name: 'left' },
      { x: hall.w - ring.x - R.aisleWidth / 2, y: hall.h / 2, name: 'right' },
      { x: hall.w / 2, y: ring.y + R.aisleWidth / 2, name: 'bottom' },
      { x: hall.w / 2, y: hall.h - ring.y - R.aisleWidth / 2, name: 'top' }
    ];
    const unreached = samples.filter((s) => !seen[g.cellIndexAt(grid, s)]).map((s) => s.name);

    // walkway band must be free of resources
    let encroach = 0;
    (layout.items || []).forEach((it) => {
      const bands = [
        { x: ring.x, y: ring.y, w: ring.w, h: R.aisleWidth },
        { x: ring.x, y: ring.y + ring.h - R.aisleWidth, w: ring.w, h: R.aisleWidth },
        { x: ring.x, y: ring.y, w: R.aisleWidth, h: ring.h },
        { x: ring.x + ring.w - R.aisleWidth, y: ring.y, w: R.aisleWidth, h: ring.h }
      ];
      if (bands.some((b) => g.overlapArea(b, it.rect) > 1)) encroach++;
    });

    const freeCells = seen.reduce((a, b) => a + b, 0);
    const ok = unreached.length === 0 && encroach === 0;
    return {
      id: 'R3',
      pass: ok,
      actual: ok ? R.aisleWidth + ' mm connected' : (unreached.length ? 'broken: ' + unreached.join('/') : encroach + ' blocked'),
      detail: ok
        ? 'Pedestrian ring plus inter-row aisles form one connected, unobstructed ' + R.aisleWidth +
          ' mm walkway (' + freeCells + ' free cells reachable).'
        : (unreached.length
          ? 'Walkway is not continuous — could not reach: ' + unreached.join(', ') + '.'
          : encroach + ' resource(s) protrude into the walkway band.'),
      items: []
    };
  }

  WPE.Checker = { evaluate, accessStrip, walkwayCheck };
})(typeof globalThis !== 'undefined' ? globalThis : this);
