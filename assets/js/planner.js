/* ============================================================
   Layout planner / optimiser
   ------------------------------------------------------------
   1. builds the process modules from the resource plan
   2. generates alternative arrangements (row gap, module gap,
      serpentine vs straight flow)
   3. scores each alternative with the rule engine
   4. keeps the cheapest fully compliant alternative
   ============================================================ */
(function (root) {
  'use strict';
  const WPE = (root.WPE = root.WPE || {});
  const cfg = () => WPE.Config;
  const g = () => WPE.Geom;

  /* ---------- module builders (local coordinates) ---------- */
  function fixtureUnit(id, type, label) {
    const d = cfg().DIMS[type];
    return {
      id: id, label: label, kind: 'fixture',
      w: d.w, h: d.h,
      flowPoint: { x: d.w / 2, y: d.h / 2 },
      items: [{ id: id, kind: 'fixture', type: type, label: label, rect: { x: 0, y: 0, w: d.w, h: d.h } }],
      fences: []
    };
  }

  function machineUnit(id, type, label) {
    const d = cfg().DIMS[type];
    return {
      id: id, label: label, kind: 'machine',
      w: d.w, h: d.h,
      flowPoint: { x: d.w / 2, y: d.h / 2 },
      items: [{ id: id, kind: 'machine', type: type, label: label, rect: { x: 0, y: 0, w: d.w, h: d.h } }],
      fences: []
    };
  }

  /** a fenced robot cell: robots inside, controllers outside the fence */
  function cellUnit(id, n, rules, cellName) {
    const D = cfg().DIMS;
    const rw = D.robot.w, rh = D.robot.h;
    const pad = rules.fencePadding;
    const rGap = rules.robotRobot;
    const cw = D.controller.w, ch = D.controller.h, cGap = 100;

    const robotsW = n * rw + (n - 1) * rGap;
    const ctrlsW = n * cw + (n - 1) * cGap;
    const width = Math.max(robotsW + 2 * pad, ctrlsW);
    const fenceH = rh + 2 * pad;
    const depth = ch + rules.fenceClearance + fenceH;

    const fenceX = (width - (robotsW + 2 * pad)) / 2;
    const fenceY = ch + rules.fenceClearance;

    const items = [];
    const fences = [];
    fences.push({
      id: id + '-fence', label: cellName + ' safety fence', kind: 'fence', cell: id,
      rect: { x: fenceX, y: fenceY, w: robotsW + 2 * pad, h: fenceH }
    });
    for (let i = 0; i < n; i++) {
      items.push({
        id: id + '-r' + (i + 1), kind: 'robot', type: 'robot',
        label: 'Robot ' + (i + 1) + ' (' + cellName + ')', cell: id,
        rect: { x: fenceX + pad + i * (rw + rGap), y: fenceY + pad, w: rw, h: rh }
      });
    }
    const cx0 = (width - ctrlsW) / 2;
    for (let i = 0; i < n; i++) {
      items.push({
        id: id + '-c' + (i + 1), kind: 'controller', type: 'controller',
        label: 'Controller R' + (i + 1) + ' (' + cellName + ')', cell: id,
        rect: { x: cx0 + i * (cw + cGap), y: 0, w: cw, h: ch }
      });
    }
    return {
      id: id, label: cellName, kind: 'cell', w: width, h: depth,
      flowPoint: { x: width / 2, y: fenceY + pad + rh / 2 },
      items: items, fences: fences
    };
  }

  function buildUnits(state, rules) {
    const c = state.counts || {};
    const units = [];
    units.push(fixtureUnit('u-load', 'loading_fixture', 'Loading fixture'));
    const n = Math.max(0, c.robots | 0);
    let cellA = 0, cellB = 0;
    if (n > 0) {
      const cells = n >= 2 ? 2 : 1;
      cellA = Math.ceil(n / cells);
      cellB = n - cellA;
      units.push(cellUnit('cell-a', cellA, rules, 'Safety zone A'));
    }
    const m1 = Math.max(0, c.machine1 | 0);
    for (let i = 0; i < m1; i++) {
      units.push(machineUnit('m1-' + (i + 1), 'machine1', m1 > 1 ? 'Machine 1.' + (i + 1) : 'Machine 1'));
    }
    const m2 = Math.max(0, c.machine2 | 0);
    for (let i = 0; i < m2; i++) {
      units.push(machineUnit('m2-' + (i + 1), 'machine2', m2 > 1 ? 'Machine 2.' + (i + 1) : 'Machine 2'));
    }
    if (cellB > 0) units.push(cellUnit('cell-b', cellB, rules, 'Safety zone B'));
    units.push(fixtureUnit('u-unload', 'unload_fixture', 'Unload fixture'));
    return units;
  }

  /* ---------- row packing ---------- */
  function pack(units, prod, unitGap, rowGap, snake) {
    const rows = [];
    let cur = { units: [], width: 0, height: 0 };
    units.forEach((u) => {
      const add = cur.units.length ? unitGap + u.w : u.w;
      if (cur.units.length && cur.width + add > prod.w + 0.5) {
        rows.push(cur);
        cur = { units: [], width: 0, height: 0 };
      }
      const add2 = cur.units.length ? unitGap + u.w : u.w;
      cur.width += add2;
      cur.height = Math.max(cur.height, u.h);
      cur.units.push(u);
    });
    if (cur.units.length) rows.push(cur);

    const neededW = rows.reduce((m, r) => Math.max(m, r.width), 0);
    const totalH = rows.reduce((a, r) => a + r.height, 0) + Math.max(0, rows.length - 1) * rowGap;

    // vertical placement, rows from the top of the production area downwards
    const padTop = Math.max(0, (prod.h - totalH) / 2);
    let cursor = prod.y + prod.h - padTop;
    rows.forEach((row) => {
      row.y = cursor - row.height;
      cursor = row.y - rowGap;
    });

    const items = [];
    const fences = [];
    const placed = [];
    rows.forEach((row, idx) => {
      const rtl = snake && idx % 2 === 1;
      let x = prod.x + (prod.w - row.width) / 2;
      if (rtl) x = prod.x + (prod.w + row.width) / 2;
      row.placed = [];
      row.units.forEach((u) => {
        let ux;
        if (rtl) { x -= u.w; ux = x; x -= unitGap; }
        else { ux = x; x += u.w + unitGap; }
        const uy = row.y + (row.height - u.h) / 2;
        u.origin = { x: ux, y: uy };
        u.items.forEach((it) => {
          items.push({
            id: it.id, kind: it.kind, type: it.type, label: it.label, cell: it.cell,
            rect: { x: ux + it.rect.x, y: uy + it.rect.y, w: it.rect.w, h: it.rect.h }
          });
        });
        u.fences.forEach((f) => {
          fences.push({
            id: f.id, kind: 'fence', label: f.label, cell: f.cell,
            rect: { x: ux + f.rect.x, y: uy + f.rect.y, w: f.rect.w, h: f.rect.h }
          });
        });
        row.placed.push({
          id: u.id, label: u.label,
          center: { x: ux + u.w / 2, y: uy + u.h / 2 },
          flow: { x: ux + u.flowPoint.x, y: uy + u.flowPoint.y },
          bbox: { x: ux, y: uy, w: u.w, h: u.h }
        });
      });
      placed.push.apply(placed, rtl ? row.placed.slice().reverse() : row.placed);
    });

    // material flow = travel between consecutive process modules
    let flow = 0;
    const legs = [];
    for (let i = 1; i < placed.length; i++) {
      const a = placed[i - 1].flow, b = placed[i].flow;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      flow += d;
      legs.push({ from: placed[i - 1].id, to: placed[i].id, distance: d });
    }

    return {
      items: items, fences: fences, rows: rows, order: placed, legs: legs,
      flow: flow, neededW: neededW, totalH: totalH, fits: neededW <= prod.w + 0.5 && totalH <= prod.h + 0.5
    };
  }

  /* ---------- perimeter trolleys ---------- */
  function placeTrolleys(hall, rules, counts, band) {
    const D = cfg().DIMS;
    const gapMin = rules.trolleyGap;
    const inset = 100;
    // corner margin keeps each trolley's operator approach clear of the neighbouring wall
    const endMargin = inset + Math.min(900, rules.trolleyAccess) + 100;

    const wallDefs = {
      bottom: { id: 'bottom', len: hall.w - 2 * endMargin },
      top: { id: 'top', len: hall.w - 2 * endMargin },
      left: { id: 'left', len: hall.h - 2 * endMargin },
      right: { id: 'right', len: hall.h - 2 * endMargin }
    };

    const groups = [
      { type: 'trolley1', count: Math.max(0, counts.trolley1 | 0), walls: ['bottom', 'top', 'left', 'right'] },
      { type: 'trolley2', count: Math.max(0, counts.trolley2 | 0), walls: ['left', 'right', 'bottom', 'top'] }
    ];

    const state = {};
    Object.keys(wallDefs).forEach((k) => { state[k] = { used: 0, list: [] }; });

    const unplaced = [];
    groups.forEach((grp) => {
      const d = D[grp.type];
      const along = Math.max(d.w, d.h);
      let left = grp.count;
      grp.walls.forEach((wk) => {
        if (!left) return;
        const wd = wallDefs[wk];
        const st = state[wk];
        const room = wd.len - st.used - (st.list.length ? gapMin : 0);
        const cap = Math.floor((room + gapMin) / (along + gapMin));
        const take = Math.max(0, Math.min(left, cap));
        for (let i = 0; i < take; i++) st.list.push({ type: grp.type, along: along, depth: Math.min(d.w, d.h) });
        st.used += take * (along + gapMin);
        left -= take;
      });
      for (let i = 0; i < left; i++) unplaced.push(grp.type);
    });

    const items = [];
    Object.keys(state).forEach((wk) => {
      const st = state[wk];
      const n = st.list.length;
      if (!n) return;
      const wd = wallDefs[wk];
      const span = st.list.reduce((a, t) => a + t.along, 0) + (n - 1) * gapMin;
      const slack = wd.len - span;
      const spread = n > 1 ? Math.min(600, Math.max(0, slack / (n + 1))) : 0;
      const total = span + (n - 1) * spread;
      const pitch = n > 1 ? st.list[0].along + gapMin + spread : 0;
      let pos = endMargin + Math.max(0, (wd.len - total) / 2);

      st.list.forEach((t, i) => {
        const along = t.along, depth = t.depth;
        let rect, access;
        if (wk === 'bottom') {
          rect = { x: pos, y: inset, w: along, h: depth };
          access = 'up';
        } else if (wk === 'top') {
          rect = { x: pos, y: hall.h - inset - depth, w: along, h: depth };
          access = 'down';
        } else if (wk === 'left') {
          rect = { x: inset, y: pos, w: depth, h: along };
          access = 'right';
        } else {
          rect = { x: hall.w - inset - depth, y: pos, w: depth, h: along };
          access = 'left';
        }
        items.push({
          id: 'trolley-' + (items.length + 1),
          kind: 'trolley', type: t.type,
          label: D[t.type].label + ' ' + (items.length + 1),
          wall: wk, access: access, rect: rect
        });
        if (n > 1) pos += pitch;
      });
    });

    return { items: items, unplaced: unplaced };
  }

  /* ---------- top level ---------- */
  function plan(state) {
    const C = cfg();
    const geo = g();
    const rules = Object.assign({}, C.RULES, state.rules || {});
    const hall = { x: 0, y: 0, w: Math.max(4000, state.hall.w), h: Math.max(4000, state.hall.h) };
    const band = rules.bandDepth;
    const aisle = rules.aisleWidth;
    const ring = { x: band, y: band, w: hall.w - 2 * band, h: hall.h - 2 * band };
    const prod = {
      x: band + aisle, y: band + aisle,
      w: hall.w - 2 * (band + aisle), h: hall.h - 2 * (band + aisle)
    };
    const zones = { band: band, ring: ring, production: prod, aisle: aisle };
    const notes = [];

    if (prod.w < 3000 || prod.h < 3000) {
      notes.push('Production area after the perimeter band and walkway is only ' +
        geo.fmtMm(prod.w) + ' x ' + geo.fmtMm(prod.h) + ' — enlarge the hall footprint.');
    }

    const units = buildUnits(state, rules);
    const unitGapBase = Math.max(rules.machineGap, rules.fenceClearance);
    const candidates = [];
    const rowExtras = [0, 200, 400];
    const unitExtras = [0, 200];
    const snakes = [true, false];

    rowExtras.forEach((rx) => {
      unitExtras.forEach((ux) => {
        snakes.forEach((snake) => {
          const rowGap = aisle + rx;
          const unitGap = unitGapBase + ux;
          const packed = pack(units, prod, unitGap, rowGap, snake);
          const trol = placeTrolleys(hall, rules, state.counts || {}, band);
          const layout = {
            hall: hall, zones: zones, rules: rules,
            items: packed.items.concat(trol.items),
            fences: packed.fences,
            order: packed.order,
            legs: packed.legs,
            metrics: {
              flow: packed.flow,
              rows: packed.rows.length,
              rowGap: rowGap,
              unitGap: unitGap,
              snake: snake,
              fits: packed.fits,
              neededW: packed.neededW,
              neededH: packed.totalH,
              prodW: prod.w,
              prodH: prod.h
            }
          };
          const check = WPE.Checker.evaluate(layout, rules, hall);
          const usedArea = layout.items
            .filter((it) => it.kind !== 'trolley')
            .reduce((a, it) => a + it.rect.w * it.rect.h, 0);
          layout.metrics.usedArea = usedArea;
          layout.metrics.utilisation = usedArea / (prod.w * prod.h);
          layout.metrics.footprint = (packed.neededW * packed.totalH) / (prod.w * prod.h);
          candidates.push({
            label: 'row gap ' + rowGap + ' mm · module gap ' + unitGap + ' mm · ' +
              (snake ? 'serpentine' : 'straight') + ' flow',
            layout: layout, check: check,
            fails: check.failCount, flow: packed.flow,
            fits: packed.fits
          });
        });
      });
    });

    // dedupe identical metrics (small halls can collapse variants)
    const seen = new Set();
    const unique = [];
    candidates.forEach((c) => {
      const key = [c.layout.metrics.rows, Math.round(c.flow), c.layout.metrics.rowGap, c.fits].join('|');
      if (!seen.has(key)) { seen.add(key); unique.push(c); }
    });

    const feasible = unique.filter((c) => c.fits && c.check.compliant);
    const pool = feasible.length ? feasible : unique.filter((c) => c.fits);
    pool.sort((a, b) => {
      if (a.fails !== b.fails) return a.fails - b.fails;
      if (Math.abs(a.flow - b.flow) > 1) return a.flow - b.flow;
      return b.layout.metrics.utilisation - a.layout.metrics.utilisation;
    });
    const best = pool[0] || unique[0];

    // notes / diagnostics
    if (!best.fits) {
      if (best.layout.metrics.neededW > prod.w + 0.5) {
        notes.push('The process chain needs ' + geo.fmtMm(best.layout.metrics.neededW) +
          ' of width but only ' + geo.fmtMm(prod.w) + ' is available — widen the hall.');
      }
      if (best.layout.metrics.neededH > prod.h + 0.5) {
        notes.push('The layout needs ' + geo.fmtMm(best.layout.metrics.neededH) +
          ' of depth but only ' + geo.fmtMm(prod.h) + ' is available — extend the hall.');
      }
    }
    const trolleyCount = (state.counts.trolley1 | 0) + (state.counts.trolley2 | 0);
    const unplacedTrolleys = best.layout.items.filter((i) => i.kind === 'trolley').length;
    if (unplacedTrolleys < trolleyCount) {
      notes.push((trolleyCount - unplacedTrolleys) + ' trolley(s) could not be placed on the available perimeter.');
    }
    if (best.check.failCount) {
      notes.push(best.check.failCount + ' rule(s) are not satisfied by this arrangement.');
    }

    const robotNeed = C.robotsRequired(
      (state.activities || []).find((a) => /robot/i.test(a.name)) ?
        (state.activities.find((a) => /robot/i.test(a.name)).time) : 0,
      state.jph
    );
    if (robotNeed && (state.counts.robots | 0) !== robotNeed) {
      notes.push('Resource plan suggests ' + robotNeed + ' robot(s) at ' + state.jph +
        ' JPH — ' + (state.counts.robots | 0) + ' planned.');
    }

    return {
      status: best.check.compliant && best.fits ? 'ok' : (best.fits ? 'violations' : 'infeasible'),
      layout: best.layout,
      check: best.check,
      alternatives: unique.map((c) => ({
        label: c.label, fails: c.fails, flow: c.flow, fits: c.fits,
        rows: c.layout.metrics.rows, rowGap: c.layout.metrics.rowGap,
        compliant: c.check.compliant
      })).sort((a, b) => (a.fails - b.fails) || (a.flow - b.flow)),
      best: { label: best.label, flow: best.flow, fails: best.fails },
      notes: notes
    };
  }

  WPE.Planner = { plan, buildUnits, pack, placeTrolleys };
})(typeof globalThis !== 'undefined' ? globalThis : this);
