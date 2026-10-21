/* ============================================================
   DXF reader — enough of the format to pick up a hall outline.
   Handles LINE, LWPOLYLINE, POLYLINE/VERTEX, CIRCLE and ARC,
   honours $INSUNITS, and returns the drawing extents in mm.
   ============================================================ */
(function (root) {
  'use strict';
  const WPE = (root.WPE = root.WPE || {});

  const UNIT_SCALE = { 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000, 0: 1 };

  /** DXF is a stream of (code, value) pairs — build them, skipping junk lines. */
  function pairs(text) {
    const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let i = 0;
    while (i + 1 < lines.length) {
      const code = lines[i].trim();
      if (/^-?\d+$/.test(code)) {
        out.push({ code: parseInt(code, 10), value: lines[i + 1] });
        i += 2;
      } else {
        i += 1;
      }
    }
    return out;
  }

  function parse(text) {
    const list = pairs(text);
    const entities = [];
    const layers = {};
    let section = null;
    let headerVar = null;
    let insunits = null;

    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (p.code === 0) {
        const v = String(p.value).trim().toUpperCase();
        if (v === 'SECTION') {
          const next = list[i + 1];
          section = next && next.code === 2 ? String(next.value).trim().toUpperCase() : null;
          i++;
          continue;
        }
        if (v === 'ENDSEC') { section = null; continue; }
        if (v === 'EOF') break;
        if (section === 'ENTITIES') entities.push({ type: v, data: {}, layer: '0' });
        continue;
      }
      if (section === 'HEADER') {
        if (p.code === 9) { headerVar = String(p.value).trim(); continue; }
        if (headerVar === '$INSUNITS') insunits = parseInt(p.value, 10);
        continue;
      }
      if (section === 'ENTITIES' && entities.length) {
        const e = entities[entities.length - 1];
        if (p.code === 8) e.layer = String(p.value).trim();
        (e.data[p.code] = e.data[p.code] || []).push(p.value);
        if (p.code === 8) layers[e.layer] = true;
      }
    }

    // fold old-style POLYLINE / VERTEX / SEQEND runs into one vertex list
    let poly = null;
    entities.forEach((e) => {
      if (e.type === 'POLYLINE') { poly = e; return; }
      if (e.type === 'VERTEX' && poly) {
        const vx = e.data[10] && parseFloat(e.data[10][0]);
        const vy = e.data[20] && parseFloat(e.data[20][0]);
        if (isFinite(vx)) (poly.data[10] = poly.data[10] || []).push(String(vx));
        if (isFinite(vy)) (poly.data[20] = poly.data[20] || []).push(String(vy));
        return;
      }
      if (e.type === 'SEQEND') { poly = null; return; }
      if (e.type !== 'VERTEX') poly = null;
    });

    const scale = UNIT_SCALE[insunits] != null ? UNIT_SCALE[insunits] : 1;
    const xs = [];
    const ys = [];
    const polylines = [];

    const num = (arr, idx) => {
      const v = arr && arr[idx];
      const n = parseFloat(v);
      return isFinite(n) ? n : 0;
    };

    entities.forEach((e) => {
      const d = e.data;
      if (e.layer === 'DEFPOINTS') return;
      if (e.type === 'LINE') {
        xs.push(num(d[10], 0), num(d[11], 0));
        ys.push(num(d[20], 0), num(d[21], 0));
      } else if (e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') {
        const px = (d[10] || []).map((v) => parseFloat(v) || 0);
        const py = (d[20] || []).map((v) => parseFloat(v) || 0);
        const closed = ((parseInt(num(d[70], 0), 10)) & 1) === 1;
        if (!px.length) return;
        polylines.push({ points: px.map((x, k) => ({ x: x, y: py[k] || 0 })), closed: closed });
        px.forEach((x) => xs.push(x));
        py.forEach((y) => ys.push(y));
      } else if (e.type === 'CIRCLE' || e.type === 'ARC') {
        const cx = num(d[10], 0), cy = num(d[20], 0), r = num(d[40], 0);
        xs.push(cx - r, cx + r);
        ys.push(cy - r, cy + r);
      }
    });

    if (!xs.length) {
      return { ok: false, error: 'No geometry found — is this a DXF with model-space lines or polylines?' };
    }

    const bbox = {
      x: Math.min.apply(null, xs), y: Math.min.apply(null, ys),
      w: Math.max.apply(null, xs) - Math.min.apply(null, xs),
      h: Math.max.apply(null, ys) - Math.min.apply(null, ys)
    };

    // the hall is usually the biggest closed outline; fall back to the drawing extents
    let outline = null;
    polylines.forEach((pl) => {
      if (!pl.closed || pl.points.length < 4) return;
      const px = pl.points.map((p) => p.x), py = pl.points.map((p) => p.y);
      const w = Math.max.apply(null, px) - Math.min.apply(null, px);
      const h = Math.max.apply(null, py) - Math.min.apply(null, py);
      const area = w * h;
      if (!outline || area > outline.area) {
        outline = { area: area, w: w, h: h, x: Math.min.apply(null, px), y: Math.min.apply(null, py) };
      }
    });
    const useOutline = outline && outline.area > 0 && outline.area >= bbox.w * bbox.h * 0.3;

    const box = useOutline ? outline : bbox;
    return {
      ok: true,
      units: insunits,
      scale: scale,
      entities: entities.length,
      layers: Object.keys(layers),
      bbox: { x: box.x * scale, y: box.y * scale, w: box.w * scale, h: box.h * scale },
      drawingBbox: { x: bbox.x * scale, y: bbox.y * scale, w: bbox.w * scale, h: bbox.h * scale },
      usedClosedOutline: !!useOutline
    };
  }

  /** read a File object (browser) and return the parsed result */
  function readFile(file, cb) {
    const reader = new FileReader();
    reader.onerror = () => cb({ ok: false, error: 'Could not read the file.' });
    reader.onload = () => {
      let out;
      try { out = parse(String(reader.result)); }
      catch (err) { out = { ok: false, error: String(err && err.message ? err.message : err) }; }
      out.name = file.name;
      cb(out);
    };
    reader.readAsText(file);
  }

  WPE.Importer = { parse, readFile };
})(typeof globalThis !== 'undefined' ? globalThis : this);
