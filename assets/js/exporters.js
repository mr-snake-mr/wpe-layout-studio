/* ============================================================
   Exporters — DXF (R12), JSON, CSV / BOM, PNG
   ============================================================ */
(function (root) {
  'use strict';
  const WPE = (root.WPE = root.WPE || {});

  const LAYERS = [
    { name: 'HALL', color: 7 },
    { name: 'WALKWAY', color: 4 },
    { name: 'FENCE', color: 1 },
    { name: 'ROBOT', color: 2 },
    { name: 'MACHINE', color: 3 },
    { name: 'FIXTURE', color: 5 },
    { name: 'CONTROLLER', color: 6 },
    { name: 'TROLLEY', color: 1 },
    { name: 'FLOW', color: 4 },
    { name: 'TEXT', color: 7 }
  ];

  function layerFor(it) {
    if (it.kind === 'fence') return 'FENCE';
    if (it.kind === 'robot') return 'ROBOT';
    if (it.kind === 'machine') return 'MACHINE';
    if (it.kind === 'fixture') return 'FIXTURE';
    if (it.kind === 'controller') return 'CONTROLLER';
    if (it.kind === 'trolley') return 'TROLLEY';
    return 'TEXT';
  }

  function dxf(layout, meta) {
    const out = [];
    const p = (code, value) => { out.push(String(code)); out.push(String(value)); };
    const line = (layer, x1, y1, x2, y2) => {
      p(0, 'LINE'); p(8, layer);
      p(10, x1.toFixed(2)); p(20, y1.toFixed(2)); p(30, '0');
      p(11, x2.toFixed(2)); p(21, y2.toFixed(2)); p(31, '0');
    };
    const box = (layer, r) => {
      line(layer, r.x, r.y, r.x + r.w, r.y);
      line(layer, r.x + r.w, r.y, r.x + r.w, r.y + r.h);
      line(layer, r.x + r.w, r.y + r.h, r.x, r.y + r.h);
      line(layer, r.x, r.y + r.h, r.x, r.y);
    };
    const text = (layer, x, y, h, s) => {
      p(0, 'TEXT'); p(8, layer);
      p(10, x.toFixed(2)); p(20, y.toFixed(2)); p(30, '0');
      p(40, h.toFixed(1)); p(1, String(s).replace(/[\r\n]/g, ' '));
    };

    p(0, 'SECTION'); p(2, 'HEADER');
    p(9, '$ACADVER'); p(1, 'AC1009');
    p(9, '$INSUNITS'); p(70, 4);           // millimetres
    p(9, '$EXTMIN'); p(10, 0); p(20, 0); p(30, 0);
    p(9, '$EXTMAX'); p(10, layout.hall.w); p(20, layout.hall.h); p(30, 0);
    p(0, 'ENDSEC');

    p(0, 'SECTION'); p(2, 'TABLES');
    p(0, 'TABLE'); p(2, 'LAYER'); p(70, LAYERS.length);
    LAYERS.forEach((l) => {
      p(0, 'LAYER'); p(2, l.name); p(70, 0); p(62, l.color); p(6, 'CONTINUOUS');
    });
    p(0, 'ENDTAB'); p(0, 'ENDSEC');

    p(0, 'SECTION'); p(2, 'ENTITIES');

    box('HALL', layout.hall);
    if (layout.zones && layout.zones.production) box('WALKWAY', layout.zones.ring);
    if (layout.zones && layout.zones.production) box('WALKWAY', layout.zones.production);

    (layout.fences || []).forEach((f) => {
      box('FENCE', f.rect);
      text('TEXT', f.rect.x, f.rect.y + f.rect.h + 120, 140, f.label);
    });

    (layout.items || []).forEach((it) => {
      box(layerFor(it), it.rect);
      text('TEXT', it.rect.x + 40, it.rect.y + it.rect.h / 2, Math.min(180, it.rect.h * 0.35), it.label);
    });

    // material flow polyline
    (layout.legs || []).forEach((leg) => {
      const a = (layout.order || []).find((u) => u.id === leg.from);
      const b = (layout.order || []).find((u) => u.id === leg.to);
      if (a && b) line('FLOW', a.flow.x, a.flow.y, b.flow.x, b.flow.y);
    });

    text('TEXT', 0, layout.hall.h + 900, 260,
      'WPE LAYOUT — ' + (meta && meta.title ? meta.title : 'optimised layout') +
      ' — hall ' + (layout.hall.w / 1000).toFixed(1) + ' x ' + (layout.hall.h / 1000).toFixed(1) + ' m');
    text('TEXT', 0, layout.hall.h + 500, 180,
      'Generated ' + new Date().toISOString().slice(0, 19).replace('T', ' ') + ' · units: mm');

    p(0, 'ENDSEC'); p(0, 'EOF');
    return out.join('\r\n');
  }

  function bomRows(layout) {
    const rows = [['item', 'type', 'x_mm', 'y_mm', 'width_mm', 'depth_mm', 'area_m2']];
    (layout.items || []).forEach((it) => {
      rows.push([
        it.label, it.kind,
        Math.round(it.rect.x), Math.round(it.rect.y),
        Math.round(it.rect.w), Math.round(it.rect.h),
        ((it.rect.w * it.rect.h) / 1e6).toFixed(2)
      ]);
    });
    return rows;
  }

  function csv(layout) {
    return bomRows(layout).map((r) => r.map((c) => {
      const s = String(c);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(',')).join('\r\n');
  }

  function summaryJson(state, result) {
    const layout = result.layout;
    const counts = {};
    layout.items.forEach((it) => { counts[it.kind] = (counts[it.kind] || 0) + 1; });
    return JSON.stringify({
      generatedAt: new Date().toISOString(),
      app: 'WPE Layout Studio',
      input: state,
      status: result.status,
      metrics: {
        rows: layout.metrics.rows,
        rowGap: layout.metrics.rowGap,
        moduleGap: layout.metrics.unitGap,
        materialFlowM: +(layout.metrics.flow / 1000).toFixed(2),
        productionAreaM2: +((layout.zones.production.w * layout.zones.production.h) / 1e6).toFixed(2),
        usedAreaM2: +(layout.metrics.usedArea / 1e6).toFixed(2),
        utilisation: +(layout.metrics.utilisation * 100).toFixed(1)
      },
      counts: counts,
      compliance: result.check.rules.map((r) => ({
        id: r.id, title: r.title, pass: r.pass, actual: r.actual, detail: r.detail
      })),
      alternatives: result.alternatives,
      notes: result.notes,
      layout: {
        hall: layout.hall,
        zones: layout.zones,
        rules: layout.rules,
        items: layout.items,
        fences: layout.fences,
        order: layout.order,
        legs: layout.legs
      }
    }, null, 2);
  }

  /** self-contained HTML report: plan image + KPIs + compliance + BOM */
  function reportHtml(state, result, canvas) {
    const layout = result.layout;
    const m = layout.metrics;
    const rows = bomRows(layout).slice(1);
    const counts = {};
    layout.items.forEach((it) => { counts[it.kind] = (counts[it.kind] || 0) + 1; });
    let img = '';
    try {
      const url = canvas && canvas.toDataURL ? canvas.toDataURL('image/png') : '';
      if (url) img = '<img class="plan" src="' + url + '" alt="Optimised shopfloor layout" />';
    } catch (e) { /* tainted canvas - report still renders without the image */ }

    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const kpi = [
      ['Material flow', (m.flow / 1000).toFixed(1) + ' m'],
      ['Process rows', m.rows + (m.snake ? ' (serpentine)' : '')],
      ['Space used', Math.round(m.utilisation * 100) + ' %'],
      ['Rules passed', result.check.passCount + ' / ' + result.check.rules.length],
      ['Hall', (layout.hall.w / 1000).toFixed(1) + ' × ' + (layout.hall.h / 1000).toFixed(1) + ' m'],
      ['Line rate', state.jph + ' JPH · ' + (3600 / state.jph).toFixed(1) + ' s cycle']
    ];

    return '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
      '<title>WPE layout report</title><style>' +
      'body{font:13px/1.55 -apple-system,Segoe UI,system-ui,sans-serif;color:#111;margin:32px;max-width:1100px}' +
      'h1{font-size:20px;margin:0 0 2px}h2{font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:#555;margin:26px 0 8px}' +
      '.meta{color:#666;font-size:11.5px;margin-bottom:18px}' +
      '.plan{width:100%;border:1px solid #d5dbe5;border-radius:8px;background:#0d1526}' +
      '.kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:14px 0}' +
      '.kpi{border:1px solid #e2e8f0;border-radius:8px;padding:8px 10px}' +
      '.kpi b{display:block;font-size:9.5px;text-transform:uppercase;letter-spacing:.07em;color:#64748b;font-weight:600}' +
      '.kpi span{font-size:15px;font-variant-numeric:tabular-nums}' +
      'table{width:100%;border-collapse:collapse;font-size:11.5px}' +
      'th,td{text-align:left;padding:5px 7px;border-bottom:1px solid #eef2f7}' +
      'th{background:#f6f8fb;font-size:9.5px;text-transform:uppercase;letter-spacing:.06em;color:#64748b}' +
      '.ok{color:#15803d;font-weight:600}.bad{color:#b91c1c;font-weight:600}' +
      '.note{background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:8px 10px;font-size:11.5px;margin-top:8px}' +
      '@media print{body{margin:12mm}.plan{page-break-after:avoid}}' +
      '</style></head><body>' +
      '<h1>WPE layout report</h1>' +
      '<div class="meta">' + esc((WPE.Config.PRESETS[state.preset] || {}).name || 'Custom scenario') +
      ' · generated ' + new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC · units mm</div>' +
      img +
      '<div class="kpis">' + kpi.map((k) => '<div class="kpi"><b>' + k[0] + '</b><span>' + k[1] + '</span></div>').join('') + '</div>' +
      '<h2>Rule compliance</h2><table><thead><tr><th>Rule</th><th>Measured</th><th>Result</th><th>Detail</th></tr></thead><tbody>' +
      result.check.rules.map((r) =>
        '<tr><td>' + r.id + '</td><td>' + esc(r.actual) + '</td><td class="' + (r.pass ? 'ok' : 'bad') + '">' +
        (r.pass ? 'pass' : 'FAIL') + '</td><td>' + esc(r.detail) + '</td></tr>').join('') +
      '</tbody></table>' +
      '<h2>Resources placed (' + layout.items.length + ')</h2><table><thead><tr>' +
      '<th>Item</th><th>Type</th><th>X</th><th>Y</th><th>Width</th><th>Depth</th><th>Area m²</th></tr></thead><tbody>' +
      rows.map((r) => '<tr>' + r.map((c) => '<td>' + esc(c) + '</td>').join('') + '</tr>').join('') +
      '</tbody></table>' +
      (result.notes.length ? '<h2>Notes</h2>' + result.notes.map((n) => '<div class="note">' + esc(n) + '</div>').join('') : '') +
      '<h2>Assumptions</h2><table><tbody>' +
      '<tr><td>Perimeter storage band</td><td>' + layout.rules.bandDepth + ' mm</td></tr>' +
      '<tr><td>Pedestrian walkway</td><td>' + layout.rules.aisleWidth + ' mm, connected ring plus inter-row aisles</td></tr>' +
      '<tr><td>Robot–machine</td><td>' + layout.rules.robotMachine + ' mm</td></tr>' +
      '<tr><td>Robot–robot</td><td>' + layout.rules.robotRobot + ' mm</td></tr>' +
      '<tr><td>Equipment–fence</td><td>' + layout.rules.fenceClearance + ' mm</td></tr>' +
      '<tr><td>Trolley–trolley</td><td>' + layout.rules.trolleyGap + ' mm</td></tr>' +
      '</tbody></table>' +
      '<p class="meta" style="margin-top:26px">WPE Layout Studio · generated from the rules in the hackathon brief. ' +
      'Verify dimensions against site conditions before fabrication.</p>' +
      '</body></html>';
  }

  function download(name, text, mime) {
    const blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    downloadBlob(name, blob);
  }

  function downloadBlob(name, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1200);
  }

  function png(canvas, name) {
    canvas.toBlob((blob) => { if (blob) downloadBlob(name, blob); }, 'image/png');
  }

  WPE.Exporters = { dxf, csv, summaryJson, reportHtml, download, downloadBlob, png, bomRows };
})(typeof globalThis !== 'undefined' ? globalThis : this);
