/* ============================================================
   App shell — DOM wiring for WPE Layout Studio
   ============================================================ */
(function () {
  'use strict';
  const C = window.WPE.Config;
  const P = window.WPE.Planner;
  const X = window.WPE.Exporters;
  const G = window.WPE.Geom;

  const $ = (id) => document.getElementById(id);
  const num = (el, fallback) => {
    const v = parseFloat(el.value);
    return isFinite(v) ? v : fallback;
  };

  const canvas = $('canvas');
  const renderer = window.WPE.Render.create(canvas);

  let state = C.cloneState(C.DEFAULT_STATE);
  let result = null;
  let activeRule = null;
  let needsFit = true;
  let timer = null;
  let edited = false;
  let pristine = null;
  let history = [];
  const SNAP = 50; // manual moves snap to 5 cm

  /* ---------------- state <-> inputs ---------------- */
  function readState() {
    const hallWm = Math.max(4, num($('hallW'), 24));
    const hallHm = Math.max(4, num($('hallH'), 16));
    state.hall = { w: Math.round(hallWm * 1000), h: Math.round(hallHm * 1000) };
    state.jph = Math.max(1, num($('jphInput'), 60));
    state.rules = {
      aisleWidth: Math.max(600, num($('rAisle'), C.RULES.aisleWidth)),
      robotMachine: Math.max(0, num($('rRobotMachine'), C.RULES.robotMachine)),
      robotRobot: Math.max(0, num($('rRobotRobot'), C.RULES.robotRobot)),
      fenceClearance: Math.max(0, num($('rFence'), C.RULES.fenceClearance)),
      trolleyGap: Math.max(0, num($('rTrolleyGap'), C.RULES.trolleyGap)),
      trolleyAccess: C.RULES.trolleyAccess,
      fencePadding: C.RULES.fencePadding,
      bandDepth: C.RULES.bandDepth,
      machineGap: C.RULES.machineGap,
      walkwayMin: C.RULES.walkwayMin
    };
    state.counts = {
      robots: Math.max(0, Math.round(num($('cRobots'), 3))),
      machine1: Math.max(0, Math.round(num($('cMachine1'), 1))),
      machine2: Math.max(0, Math.round(num($('cMachine2'), 1))),
      trolley1: Math.max(0, Math.round(num($('cTrolley1'), 8))),
      trolley2: Math.max(0, Math.round(num($('cTrolley2'), 1)))
    };
    state.countsB = {
      robots: Math.max(0, Math.round(num($('bRobots'), 5))),
      machine1: Math.max(0, Math.round(num($('bMachine1'), 1))),
      machine2: Math.max(0, Math.round(num($('bMachine2'), 0)))
    };
    state.objective = state.objective === 'compact' ? 'compact' : 'flow';
    return state;
  }

  function writeState(next, opts) {
    state = next;
    $('hallW').value = (state.hall.w / 1000).toFixed(1);
    $('hallH').value = (state.hall.h / 1000).toFixed(1);
    $('jphInput').value = state.jph;
    $('rAisle').value = state.rules.aisleWidth;
    $('rRobotMachine').value = state.rules.robotMachine;
    $('rRobotRobot').value = state.rules.robotRobot;
    $('rFence').value = state.rules.fenceClearance;
    $('rTrolleyGap').value = state.rules.trolleyGap;
    $('cRobots').value = state.counts.robots;
    $('cMachine1').value = state.counts.machine1;
    $('cMachine2').value = state.counts.machine2;
    $('cTrolley1').value = state.counts.trolley1;
    $('cTrolley2').value = state.counts.trolley2;
    $('bRobots').value = (state.countsB || {}).robots != null ? state.countsB.robots : 5;
    $('bMachine1').value = (state.countsB || {}).machine1 || 0;
    $('bMachine2').value = (state.countsB || {}).machine2 || 0;
    setMode(state.mode === 'dual' ? 'dual' : 'single', true);
    document.querySelectorAll('#objSeg .segbtn').forEach((btn) => {
      btn.classList.toggle('on', btn.dataset.obj === (state.objective || 'flow'));
    });
    if (opts && opts.activities) buildActivityRows();
    if (!opts || opts.fit !== false) needsFit = true;
  }

  /** mode = one process line, or the two stations of the brief side by side */
  let widenedFrom = null;
  function setMode(mode, silent) {
    state.mode = mode === 'dual' ? 'dual' : 'single';
    document.querySelectorAll('#modeSeg .segbtn').forEach((btn) => {
      btn.classList.toggle('on', btn.dataset.mode === state.mode);
    });
    $('stationBBlock').hidden = state.mode !== 'dual';
    if (silent) return;

    if (state.mode === 'dual' && state.hall.w < 30000) {
      // two lines need a wider footprint than a single cell — remember what to go back to
      widenedFrom = { w: state.hall.w, h: state.hall.h };
      state.hall = { w: 34000, h: Math.max(16000, state.hall.h) };
      writeState(state, { fit: true });
    } else if (state.mode === 'single' && widenedFrom) {
      state.hall = widenedFrom;
      widenedFrom = null;
      writeState(state, { fit: true });
    } else {
      needsFit = true;
    }
    compute();
  }

  /* ---------------- activity table ---------------- */
  function buildActivityRows() {
    const body = $('activityBody');
    body.innerHTML = '';
    state.activities.forEach((a, idx) => {
      const tr = document.createElement('tr');
      const name = document.createElement('td');
      name.textContent = a.name;
      const timeTd = document.createElement('td');
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '0';
      input.max = '3600';
      input.step = '5';
      input.value = a.time;
      input.dataset.idx = String(idx);
      input.addEventListener('input', () => {
        state.activities[idx].time = Math.max(0, parseFloat(input.value) || 0);
        refreshPlanPreview();
        schedule();
      });
      timeTd.appendChild(input);
      const reqTd = document.createElement('td');
      reqTd.textContent = '–';
      reqTd.dataset.req = String(idx);
      tr.append(name, timeTd, reqTd);
      body.appendChild(tr);
    });
    refreshPlanPreview();
  }

  function refreshPlanPreview() {
    const ct = C.cycleTime(state.jph);
    $('cycleOut').textContent = ct.toFixed(1) + ' s';
    $('taktOut').textContent = Math.round(state.jph) + ' jobs/h';
    const table = C.resourceTable(state.activities, state.jph);
    table.forEach((row, idx) => {
      const cell = document.querySelector('[data-req="' + idx + '"]');
      if (cell) cell.textContent = row.required || '–';
    });
  }

  /* ---------------- compute + render ---------------- */
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(compute, 160);
  }

  function compute() {
    readState();
    refreshPlanPreview();
    // keep the segmented controls in step with the state they drive
    document.querySelectorAll('#objSeg .segbtn').forEach((btn) => {
      btn.classList.toggle('on', btn.dataset.obj === state.objective);
    });
    edited = false;
    history = [];
    try {
      result = P.plan(state);
    } catch (err) {
      console.error(err);
      $('statusPill').textContent = 'error';
      $('verdictText').textContent = String(err && err.message ? err.message : err);
      return;
    }
    const layout = result.layout;
    renderer.setLayout(layout);
    pristine = snapshot();
    if (needsFit) { renderer.fit(); needsFit = false; } else { renderer.draw(); }
    renderVerdict();
    renderKpis();
    renderRules();
    renderAlternatives();
    renderNotes();
    $('cZones').value = state.counts.robots > 0 ? (state.counts.robots >= 2 ? 2 : 1) : 0;
  }

  function renderVerdict() {
    const el = $('verdict');
    el.className = 'verdict';
    const pass = result.check.passCount;
    const total = result.check.rules.length;
    const fits = result.layout.metrics.fits;
    const suffix = edited ? ' Manually adjusted — press Optimise to regenerate.' : '';
    if (result.check.compliant && fits) {
      $('statusPill').textContent = 'compliant';
      $('verdictText').textContent =
        'All ' + total + ' checks pass. Best of ' + result.alternatives.length +
        ' arrangements for ' + (result.objective === 'compact' ? 'the smallest footprint' : 'shortest material flow') +
        ' — ' + (result.layout.metrics.flow / 1000).toFixed(1) +
        ' m travel, ' + result.layout.metrics.rows + ' row(s).' + suffix;
    } else if (fits) {
      el.className = 'verdict warn';
      $('statusPill').textContent = 'violations';
      $('verdictText').textContent =
        'Layout fits but ' + (total - pass) + ' of ' + total +
        ' rules fail. Relax a clearance, add floor area or reduce resources.' + suffix;
    } else {
      el.className = 'verdict bad';
      $('statusPill').textContent = 'does not fit';
      $('verdictText').textContent =
        'The process chain cannot be placed inside this footprint. See the notes below for the missing dimension.';
    }
  }

  function renderKpis() {
    const m = result.layout.metrics;
    $('kpiFlow').textContent = (m.flow / 1000).toFixed(1) + ' m';
    $('kpiRows').textContent = m.rows;
    $('kpiRowsEm').textContent = m.dual
      ? 'A ' + m.rowsByStation[0] + ' · B ' + m.rowsByStation[1] + ' rows'
      : (m.snake ? 'serpentine' : 'straight') + ' · gap ' + (m.rowGap / 1000).toFixed(1) + ' m';
    $('kpiUtil').textContent = Math.round(m.utilisation * 100) + ' %';
    $('kpiRules').textContent = result.check.passCount + '/' + result.check.rules.length;
    $('kpiFoot').textContent = (m.neededW / 1000).toFixed(1) + ' × ' + (m.neededH / 1000).toFixed(1) + ' m';
    $('kpiFootEm').textContent = Math.round(m.footprintArea / 1e6) + ' m² · ' +
      (result.objective === 'compact' ? 'compact' : 'flow');
    $('kpiAlts').textContent = result.alternatives.length;
    $('stageNote').textContent = edited
      ? 'editing manually · drag resources · Ctrl+Z undo'
      : 'drag a resource to adjust · Ctrl+Z undo · ' + (m.snake ? 'serpentine' : 'straight') + ' flow';
  }

  function renderRules() {
    const list = $('ruleList');
    list.innerHTML = '';
    const meta = {};
    C.RULE_META.forEach((m) => { meta[m.id] = m; });
    result.check.rules.forEach((r) => {
      const li = document.createElement('li');
      li.className = 'rule-item' + (r.pass ? '' : ' fail') + (activeRule === r.id ? ' active' : '');
      const dot = document.createElement('i');
      dot.className = 'dot';
      const body = document.createElement('div');
      const title = document.createElement('div');
      title.className = 'rid';
      title.textContent = r.id + ' · ' + (meta[r.id] ? meta[r.id].title : r.title);
      const txt = document.createElement('div');
      txt.className = 'rtext';
      txt.textContent = r.detail;
      body.append(title, txt);
      const actual = document.createElement('div');
      actual.className = 'ractual';
      actual.textContent = r.actual;
      li.append(dot, body, actual);
      li.title = meta[r.id] ? meta[r.id].rule : '';
      li.addEventListener('click', () => {
        activeRule = activeRule === r.id ? null : r.id;
        renderer.setHighlight(activeRule ? r.items : []);
        renderRules();
      });
      list.appendChild(li);
    });
  }

  function renderAlternatives() {
    const list = $('altList');
    list.innerHTML = '';
    result.alternatives.slice(0, 6).forEach((a) => {
      const li = document.createElement('li');
      const ok = a.compliant && a.fits;
      li.className = 'alt-item' + (ok && a.label === result.best.label ? ' best' : '');
      const left = document.createElement('span');
      left.innerHTML = '<span class="tag">' + (ok ? 'pass' : a.fails + ' fail') + '</span> ' +
        a.rows + ' row · gap ' + a.rowGap;
      const right = document.createElement('span');
      right.className = 'val';
      right.textContent = (a.flow / 1000).toFixed(1) + ' m';
      li.append(left, right);
      list.appendChild(li);
    });
    if (!result.alternatives.length) {
      list.innerHTML = '<li class="alt-item">no arrangement fits this footprint</li>';
    }
  }

  function renderNotes() {
    const box = $('notes');
    box.innerHTML = '';
    result.notes.forEach((n) => {
      const d = document.createElement('div');
      d.className = 'note';
      d.textContent = n;
      box.appendChild(d);
    });
  }

  /* ---------------- manual editing with live rule feedback ---------------- */
  function snapshot() {
    return (result ? result.layout.items.map((it) => ({ id: it.id, x: it.rect.x, y: it.rect.y })) : []);
  }
  function restore(snap) {
    if (!result || !snap) return;
    const byId = {};
    result.layout.items.forEach((it) => { byId[it.id] = it; });
    snap.forEach((s) => {
      if (byId[s.id]) { byId[s.id].rect.x = s.x; byId[s.id].rect.y = s.y; }
    });
  }

  /** true when every resource still sits where the generator put it */
  function isPristine() {
    if (!result || !pristine) return true;
    const now = snapshot();
    if (now.length !== pristine.length) return false;
    for (let i = 0; i < now.length; i++) {
      if (now[i].id !== pristine[i].id) return false;
      if (Math.abs(now[i].x - pristine[i].x) > 0.5 || Math.abs(now[i].y - pristine[i].y) > 0.5) return false;
    }
    return true;
  }

  function liveCheck() {
    if (!result) return;
    P.recomputeFlow(result.layout);
    result.check = WPE.Checker.evaluate(result.layout, state.rules, result.layout.hall);
    edited = !isPristine();
    renderVerdict();
    renderKpis();
    renderRules();
  }

  function undo() {
    const snap = history.pop();
    if (!snap) return;
    restore(snap);
    liveCheck();
    renderer.draw();
  }

  /* ---------------- interactions ---------------- */
  function applyPreset(key) {
    if (key === 'custom') return;
    const p = C.PRESETS[key];
    state = C.cloneState({
      preset: key,
      mode: p.mode || 'single',
      hall: p.hall,
      rules: Object.assign({}, C.RULES, state.rules),
      jph: p.jph,
      activities: p.activities,
      counts: p.counts,
      countsB: p.countsB || { robots: 5, machine1: 1, machine2: 0 }
    });
    widenedFrom = null;
    writeState(state, { activities: true, fit: true });
    compute();
  }

  $('presetSelect').addEventListener('change', (e) => applyPreset(e.target.value));

  document.querySelectorAll('#modeSeg .segbtn').forEach((btn) => {
    btn.addEventListener('click', () => setMode(btn.dataset.mode));
  });

  document.querySelectorAll('#objSeg .segbtn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.objective = btn.dataset.obj === 'compact' ? 'compact' : 'flow';
      needsFit = true;
      compute();
    });
  });

  /* read the hall footprint straight from a CAD drawing */
  $('importBtn').addEventListener('click', () => $('dxfInput').click());
  $('dxfInput').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    $('importHint').textContent = 'Reading ' + file.name + '…';
    window.WPE.Importer.readFile(file, (res) => {
      if (!res.ok) {
        $('importHint').textContent = 'Import failed — ' + res.error;
        return;
      }
      const snap = (v) => Math.round(v / 500) * 500;
      const w = snap(res.bbox.w);
      const h = snap(res.bbox.h);
      if (w < 4000 || h < 4000 || w > 200000 || h > 200000) {
        $('importHint').textContent = 'Detected ' + (res.bbox.w / 1000).toFixed(1) + ' × ' +
          (res.bbox.h / 1000).toFixed(1) + ' m — outside the supported 4–200 m range.';
        return;
      }
      state.hall = { w: w, h: h };
      writeState(state, { fit: true });
      compute();
      $('importHint').textContent = 'Imported ' + res.name + ': ' +
        (w / 1000).toFixed(1) + ' × ' + (h / 1000).toFixed(1) + ' m from ' +
        (res.usedClosedOutline ? 'the closed outline' : 'the drawing extents') +
        ' (' + res.entities + ' entities).';
    });
    e.target.value = '';
  });

  ['hallW', 'hallH', 'jphInput', 'cRobots', 'cMachine1', 'cMachine2', 'cTrolley1', 'cTrolley2',
    'bRobots', 'bMachine1', 'bMachine2']
    .forEach((id) => {
      $(id).addEventListener('input', () => {
        if (id === 'hallW' || id === 'hallH') needsFit = true;
        if (id === 'jphInput') refreshPlanPreview();
        schedule();
      });
    });

  ['rAisle', 'rRobotMachine', 'rRobotRobot', 'rFence', 'rTrolleyGap'].forEach((id) => {
    $(id).addEventListener('input', schedule);
  });

  $('applyPlan').addEventListener('click', () => {
    readState();
    const robotRow = state.activities.find((a) => /robot/i.test(a.name));
    const need = C.robotsRequired(robotRow ? robotRow.time : 0, state.jph);
    $('cRobots').value = need;
    compute();
  });

  $('resetRules').addEventListener('click', () => {
    writeState(Object.assign({}, state, { rules: Object.assign({}, C.RULES) }), { fit: false });
    compute();
  });

  $('optimizeBtn').addEventListener('click', () => { needsFit = true; compute(); });

  $('zoomIn').addEventListener('click', () => {
    const v = renderer.view;
    renderer.zoomAt(1.22, { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 });
  });
  $('zoomOut').addEventListener('click', () => {
    renderer.zoomAt(1 / 1.22, { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 });
  });
  $('fitBtn').addEventListener('click', () => renderer.fit());
  $('undoBtn').addEventListener('click', undo);

  document.querySelectorAll('.toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.opt;
      const on = btn.classList.toggle('on');
      renderer.setOption(key, on);
    });
  });

  /* canvas pan / item drag / zoom / hover */
  let dragging = false;
  let dragStart = null;
  let moved = false;
  let itemDrag = null;

  canvas.addEventListener('pointerdown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const hit = renderer.hitTest(screen);
    if (hit && hit.kind !== 'fence') {
      const w = renderer.toWorld(screen);
      history.push(snapshot());
      if (history.length > 30) history.shift();
      itemDrag = { item: hit, dx: w.x - hit.rect.x, dy: w.y - hit.rect.y };
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = 'grabbing';
      return;
    }
    dragging = true;
    moved = false;
    dragStart = { x: e.clientX, y: e.clientY, vx: renderer.view.x, vy: renderer.view.y };
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointermove', (e) => {
    const rect = canvas.getBoundingClientRect();
    if (itemDrag) {
      const w = renderer.toWorld({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      itemDrag.item.rect.x = Math.round((w.x - itemDrag.dx) / SNAP) * SNAP;
      itemDrag.item.rect.y = Math.round((w.y - itemDrag.dy) / SNAP) * SNAP;
      renderer.draw();
      liveCheck();
      hideTooltip();
      return;
    }
    if (dragging && dragStart) {
      const dx = (e.clientX - dragStart.x) / renderer.view.scale;
      const dy = (e.clientY - dragStart.y) / renderer.view.scale;
      if (Math.abs(dx) + Math.abs(dy) > 0.5) moved = true;
      renderer.view.x = dragStart.vx - dx;
      renderer.view.y = dragStart.vy + dy;
      renderer.draw();
      hideTooltip();
      return;
    }
    const it = renderer.hitTest({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    renderer.setHover(it);
    canvas.style.cursor = it && it.kind !== 'fence' ? 'move' : 'grab';
    if (it) showTooltip(it, e.clientX - rect.left, e.clientY - rect.top);
    else hideTooltip();
  });

  canvas.addEventListener('pointerup', (e) => {
    if (itemDrag) {
      itemDrag = null;
      canvas.style.cursor = 'grab';
      liveCheck();
    }
    dragging = false;
    dragStart = null;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointerleave', () => {
    renderer.setHover(null);
    hideTooltip();
    dragging = false;
    if (itemDrag) { itemDrag = null; liveCheck(); }
  });

  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      undo();
    }
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const p = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    renderer.zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, p);
  }, { passive: false });

  function showTooltip(item, x, y) {
    const tip = $('tooltip');
    const r = item.rect;
    const parts = [];
    parts.push('<b>' + item.label + '</b>');
    parts.push('<span>' + Math.round(r.w) + ' × ' + Math.round(r.h) + ' mm · ' +
      ((r.w * r.h) / 1e6).toFixed(2) + ' m²</span>');
    parts.push('<span>position ' + Math.round(r.x) + ', ' + Math.round(r.y) + ' mm</span>');
    if (item.kind === 'trolley') parts.push('<span>perimeter: ' + (item.wall || '–') + ' wall · approach ' + item.access + '</span>');
    if (item.kind === 'robot' || item.kind === 'controller') parts.push('<span>cell: ' + (item.cell || '–') + '</span>');
    tip.innerHTML = parts.join('<br>');
    tip.hidden = false;
    const maxX = canvas.clientWidth - tip.offsetWidth - 12;
    const maxY = canvas.clientHeight - tip.offsetHeight - 12;
    tip.style.left = Math.max(8, Math.min(maxX, x + 16)) + 'px';
    tip.style.top = Math.max(8, Math.min(maxY, y + 14)) + 'px';
  }
  function hideTooltip() { $('tooltip').hidden = true; }

  /* exports */
  function stamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
  }

  $('exportPng').addEventListener('click', () => {
    renderer.draw();
    X.png(canvas, 'wpe-layout-' + stamp() + '.png');
  });
  $('exportDxf').addEventListener('click', () => {
    if (!result) return;
    const dxf = X.dxf(result.layout, { title: (C.PRESETS[state.preset] || {}).name || 'custom layout' });
    X.download('wpe-layout-' + stamp() + '.dxf', dxf, 'application/dxf');
  });
  $('exportJson').addEventListener('click', () => {
    if (!result) return;
    X.download('wpe-layout-' + stamp() + '.json', X.summaryJson(state, result), 'application/json');
  });
  $('exportReport').addEventListener('click', () => {
    if (!result) return;
    renderer.draw();
    X.download('wpe-layout-report-' + stamp() + '.html',
      X.reportHtml(state, result, canvas), 'text/html;charset=utf-8');
  });

  /* rules reference in the about section */
  (function buildRulesRef() {
    const ol = $('rulesRef');
    C.RULE_META.filter((r) => r.id !== 'R0').forEach((r) => {
      const li = document.createElement('li');
      const b = document.createElement('b');
      b.textContent = r.title + ' — ';
      li.appendChild(b);
      li.appendChild(document.createTextNode(r.rule));
      ol.appendChild(li);
    });
  })();

  /* resize handling */
  const wrap = document.querySelector('.canvas-wrap');
  if (window.ResizeObserver) {
    let first = true;
    new ResizeObserver(() => {
      renderer.size();
      if (first) { first = false; renderer.fit(); } else { renderer.draw(); }
    }).observe(wrap);
  } else {
    window.addEventListener('resize', () => renderer.resize());
  }

  /* boot — the preset is the single source of truth for the first paint */
  buildActivityRows();
  renderer.size();
  writeState(C.cloneState(C.DEFAULT_STATE), { activities: true, fit: true });
  compute();
  renderer.fit();
  setTimeout(() => renderer.fit(), 120);
})();

