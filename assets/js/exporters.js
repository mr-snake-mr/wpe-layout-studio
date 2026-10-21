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

  WPE.Exporters = { dxf, csv, summaryJson, download, downloadBlob, png, bomRows };
})(typeof globalThis !== 'undefined' ? globalThis : this);
