/* ============================================================
   Canvas renderer — world units (mm) -> screen pixels.
   ============================================================ */
(function (root) {
  'use strict';
  const WPE = (root.WPE = root.WPE || {});

  const COLORS = {
    hall: '#0d1526',
    hallStroke: '#334155',
    grid: 'rgba(148,163,184,0.10)',
    band: 'rgba(148,163,184,0.06)',
    walkway: 'rgba(56,189,248,0.10)',
    walkwayStroke: 'rgba(56,189,248,0.55)',
    production: 'rgba(148,163,184,0.28)',
    fence: '#fb7185',
    flow: 'rgba(34,211,238,0.75)',
    text: '#e2e8f0',
    textDim: '#94a3b8',
    bad: '#f43f5e'
  };

  function create(canvas) {
    const ctx = canvas.getContext('2d');
    const view = { x: 0, y: 0, scale: 0.02 };
    const opts = { labels: true, grid: true, zones: true, flow: true, dims: true, highlight: [] };
    let layout = null;
    let hover = null;
    let dpr = window.devicePixelRatio || 1;

    function size() {
      const rect = canvas.getBoundingClientRect();
      dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      return { w: rect.width, h: rect.height };
    }

    function viewSize() {
      return { w: canvas.width / dpr, h: canvas.height / dpr };
    }

    function fit() {
      if (!layout) return;
      const { w, h } = viewSize();
      const pad = 56;
      const s = Math.min((w - pad * 2) / layout.hall.w, (h - pad * 2) / layout.hall.h);
      view.scale = s;
      view.x = layout.hall.x - (w / s - layout.hall.w) / 2;
      view.y = layout.hall.y - (h / s - layout.hall.h) / 2;
      draw();
    }

    function toScreen(p) {
      return {
        x: (p.x - view.x) * view.scale,
        y: viewSize().h - (p.y - view.y) * view.scale
      };
    }
    function toWorld(p) {
      const { h } = viewSize();
      return { x: p.x / view.scale + view.x, y: (h - p.y) / view.scale + view.y };
    }
    function sr(r) {
      const a = toScreen({ x: r.x, y: r.y + r.h });
      return { x: a.x, y: a.y, w: r.w * view.scale, h: r.h * view.scale };
    }
    function font(px) { ctx.font = px + 'px "Inter", "Segoe UI", system-ui, sans-serif'; }

    function zoomAt(factor, screenPoint) {
      const before = toWorld(screenPoint);
      view.scale = Math.max(0.004, Math.min(1.2, view.scale * factor));
      const after = toWorld(screenPoint);
      view.x += before.x - after.x;
      view.y += before.y - after.y;
      draw();
    }

    function roundRect(r) {
      const s = r;
      const k = Math.min(6, r.w / 2, r.h / 2);
      ctx.beginPath();
      ctx.moveTo(s.x + k, s.y);
      ctx.lineTo(s.x + s.w - k, s.y);
      ctx.quadraticCurveTo(s.x + s.w, s.y, s.x + s.w, s.y + k);
      ctx.lineTo(s.x + s.w, s.y + s.h - k);
      ctx.quadraticCurveTo(s.x + s.w, s.y + s.h, s.x + s.w - k, s.y + s.h);
      ctx.lineTo(s.x + k, s.y + s.h);
      ctx.quadraticCurveTo(s.x, s.y + s.h, s.x, s.y + s.h - k);
      ctx.lineTo(s.x, s.y + k);
      ctx.quadraticCurveTo(s.x, s.y, s.x + k, s.y);
      ctx.closePath();
    }

    /** fill the four strips between an outer and an inner screen rect */
    function fillFrame(outer, inner, color) {
      if (!color || !inner) return;
      const topH = inner.y - outer.y;
      const botH = (outer.y + outer.h) - (inner.y + inner.h);
      const leftW = inner.x - outer.x;
      const rightW = (outer.x + outer.w) - (inner.x + inner.w);
      ctx.fillStyle = color;
      if (topH > 0) ctx.fillRect(outer.x, outer.y, outer.w, topH);
      if (botH > 0) ctx.fillRect(outer.x, inner.y + inner.h, outer.w, botH);
      if (leftW > 0) ctx.fillRect(outer.x, inner.y, leftW, inner.h);
      if (rightW > 0) ctx.fillRect(inner.x + inner.w, inner.y, rightW, inner.h);
    }

    function draw() {
      const { w, h } = viewSize();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (!layout) return;

      const hall = layout.hall;
      const hs = sr(hall);

      // hall plate
      ctx.fillStyle = COLORS.hall;
      roundRect(hs);
      ctx.fill();
      ctx.strokeStyle = COLORS.hallStroke;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // grid (1 m)
      if (opts.grid) {
        ctx.save();
        ctx.strokeStyle = COLORS.grid;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = 0; x <= hall.w; x += 1000) {
          const a = toScreen({ x: x, y: 0 }), b = toScreen({ x: x, y: hall.h });
          if (view.scale * 1000 < 6) break;
          ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
        }
        for (let y = 0; y <= hall.h; y += 1000) {
          const a = toScreen({ x: 0, y: y }), b = toScreen({ x: hall.w, y: y });
          if (view.scale * 1000 < 6) break;
          ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
        }
        ctx.stroke();
        ctx.restore();
      }

      // perimeter band + walkway ring + production area
      if (opts.zones && layout.zones.ring) {
        const ps0 = sr(layout.zones.production);
        // walkway ring = frame between the storage band and the production area
        fillFrame(hs, ps0, COLORS.walkway);
        // storage band = frame between the hall edge and the walkway ring
        fillFrame(hs, sr(layout.zones.ring), COLORS.band);

        const ring = sr(layout.zones.ring);
        ctx.strokeStyle = COLORS.walkwayStroke;
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 5]);
        ctx.strokeRect(ring.x, ring.y, ring.w, ring.h);
        const ps2 = sr(layout.zones.production);
        ctx.strokeStyle = COLORS.production;
        ctx.strokeRect(ps2.x, ps2.y, ps2.w, ps2.h);
        ctx.setLineDash([]);

        // walkway caption
        if (view.scale * 1200 > 26) {
          ctx.save();
          ctx.translate(ring.x + 10, ring.y + ring.h / 2);
          ctx.rotate(-Math.PI / 2);
          font(10);
          ctx.fillStyle = 'rgba(56,189,248,0.85)';
          ctx.textAlign = 'center';
          ctx.fillText('PEDESTRIAN WALKWAY ' + layout.rules.aisleWidth + ' mm', 0, 0);
          ctx.restore();
        }
      }

      // material flow legs
      if (opts.flow && layout.legs && layout.legs.length) {
        const byId = {};
        (layout.order || []).forEach((u) => { byId[u.id] = u; });
        ctx.save();
        ctx.strokeStyle = COLORS.flow;
        ctx.fillStyle = COLORS.flow;
        ctx.lineWidth = 1.4;
        ctx.setLineDash([6, 5]);
        layout.legs.forEach((leg) => {
          const a = byId[leg.from], b = byId[leg.to];
          if (!a || !b) return;
          const p1 = toScreen(a.flow), p2 = toScreen(b.flow);
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.stroke();
          const ang = Math.atan2(p2.y - p1.y, p2.x - p1.x);
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.moveTo(p2.x, p2.y);
          ctx.lineTo(p2.x - 8 * Math.cos(ang - 0.4), p2.y - 8 * Math.sin(ang - 0.4));
          ctx.lineTo(p2.x - 8 * Math.cos(ang + 0.4), p2.y - 8 * Math.sin(ang + 0.4));
          ctx.closePath();
          ctx.fill();
          ctx.setLineDash([6, 5]);
        });
        ctx.restore();
      }

      // fences
      (layout.fences || []).forEach((f) => {
        const s = sr(f.rect);
        const bad = opts.highlight.indexOf(f.id) >= 0;
        ctx.save();
        ctx.strokeStyle = bad ? COLORS.bad : COLORS.fence;
        ctx.lineWidth = bad ? 3 : 2;
        ctx.setLineDash([9, 6]);
        ctx.strokeRect(s.x, s.y, s.w, s.h);
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(251,113,133,0.05)';
        ctx.fillRect(s.x, s.y, s.w, s.h);
        if (opts.labels) {
          font(10);
          ctx.fillStyle = 'rgba(251,113,133,0.9)';
          ctx.textAlign = 'left';
          ctx.fillText(f.label + ' (600 mm clear)', s.x + 6, s.y - 6);
        }
        ctx.restore();
      });

      // resources
      (layout.items || []).forEach((it) => {
        const s = sr(it.rect);
        if (s.x + s.w < -40 || s.y + s.h < -40 || s.x > w + 40 || s.y > h + 40) return;
        const dim = cfgColor(it);
        const bad = opts.highlight.indexOf(it.id) >= 0;
        const isHover = hover && hover.id === it.id;
        ctx.save();
        ctx.fillStyle = dim.fill;
        ctx.strokeStyle = bad ? COLORS.bad : (isHover ? '#f8fafc' : dim.stroke);
        ctx.lineWidth = bad ? 2.5 : (isHover ? 2 : 1.2);
        if (it.kind === 'trolley') {
          ctx.beginPath();
          ctx.rect(s.x, s.y, s.w, s.h);
          ctx.fill();
          ctx.stroke();
          ctx.save();
          ctx.beginPath();
          ctx.rect(s.x, s.y, s.w, s.h);
          ctx.clip();
          ctx.strokeStyle = 'rgba(15,23,42,0.35)';
          ctx.lineWidth = 1;
          for (let k = -s.h; k < s.w; k += 7) {
            ctx.beginPath();
            ctx.moveTo(s.x + k, s.y + s.h);
            ctx.lineTo(s.x + k + s.h, s.y);
            ctx.stroke();
          }
          ctx.restore();
        } else {
          roundRect(s);
          ctx.fill();
          ctx.stroke();
        }
        if (it.kind === 'robot') {
          ctx.beginPath();
          ctx.arc(s.x + s.w / 2, s.y + s.h / 2, Math.max(2, s.w * 0.22), 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(15,23,42,0.45)';
          ctx.fill();
        }
        if (opts.labels && s.w > 34 && s.h > 18) {
          font(Math.min(12, Math.max(8, s.h * 0.26)));
          ctx.fillStyle = 'rgba(248,250,252,0.95)';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          const label = shortLabel(it);
          if (s.w > ctx.measureText(label).width + 8) {
            ctx.fillText(label, s.x + s.w / 2, s.y + s.h / 2);
          }
        }
        ctx.restore();
      });

      // dimensions
      if (opts.dims) drawDims(hall);
      drawScaleBar();
    }

    function cfgColor(it) {
      const map = {
        machine: { fill: 'rgba(34,197,94,0.30)', stroke: 'rgba(34,197,94,0.95)' },
        fixture: { fill: 'rgba(59,130,246,0.30)', stroke: 'rgba(96,165,250,0.95)' },
        robot: { fill: 'rgba(245,158,11,0.45)', stroke: 'rgba(251,191,36,0.98)' },
        controller: { fill: 'rgba(168,85,247,0.30)', stroke: 'rgba(192,132,252,0.95)' },
        trolley: { fill: 'rgba(239,68,68,0.32)', stroke: 'rgba(248,113,113,0.95)' }
      };
      return map[it.kind] || { fill: 'rgba(148,163,184,0.3)', stroke: 'rgba(148,163,184,0.9)' };
    }

    function shortLabel(it) {
      if (it.kind === 'robot') return 'R' + (it.label.match(/\d+/) ? it.label.match(/\d+/)[0] : '');
      if (it.kind === 'controller') return 'C' + (it.label.match(/\d+/) ? it.label.match(/\d+/)[0] : '');
      return it.label;
    }

    function drawDims(hall) {
      const p0 = toScreen({ x: hall.x, y: hall.y });
      const p1 = toScreen({ x: hall.x + hall.w, y: hall.y });
      ctx.save();
      ctx.strokeStyle = 'rgba(148,163,184,0.7)';
      ctx.fillStyle = 'rgba(148,163,184,0.9)';
      ctx.lineWidth = 1;
      const y = Math.min(viewSize().h - 12, p0.y + 26);
      ctx.beginPath();
      ctx.moveTo(p0.x, y); ctx.lineTo(p1.x, y);
      ctx.moveTo(p0.x, y - 4); ctx.lineTo(p0.x, y + 4);
      ctx.moveTo(p1.x, y - 4); ctx.lineTo(p1.x, y + 4);
      ctx.stroke();
      font(11);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText((hall.w / 1000).toFixed(1) + ' m', (p0.x + p1.x) / 2, y + 4);
      ctx.restore();
    }

    function drawScaleBar() {
      const { w, h } = viewSize();
      const targetPx = 110;
      const candidates = [500, 1000, 2000, 5000, 10000, 20000];
      let metres = 1;
      candidates.forEach((mm) => { if (mm * view.scale <= targetPx) metres = mm; });
      const px = metres * view.scale;
      ctx.save();
      ctx.strokeStyle = 'rgba(226,232,240,0.8)';
      ctx.fillStyle = 'rgba(226,232,240,0.8)';
      ctx.lineWidth = 1.5;
      const x0 = 18, y0 = h - 22;
      ctx.beginPath();
      ctx.moveTo(x0, y0); ctx.lineTo(x0 + px, y0);
      ctx.moveTo(x0, y0 - 4); ctx.lineTo(x0, y0 + 4);
      ctx.moveTo(x0 + px, y0 - 4); ctx.lineTo(x0 + px, y0 + 4);
      ctx.stroke();
      font(10);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText((metres / 1000) + ' m', x0, y0 - 6);
      ctx.restore();
    }

    function hitTest(screenPoint) {
      if (!layout) return null;
      const p = toWorld(screenPoint);
      let found = null;
      (layout.items || []).forEach((it) => {
        const r = it.rect;
        if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) found = it;
      });
      if (!found) {
        (layout.fences || []).forEach((f) => {
          const r = f.rect;
          if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) found = f;
        });
      }
      return found;
    }

    function setLayout(l) { layout = l; }
    function setHover(item) { if ((hover && hover.id) !== (item && item.id)) { hover = item; draw(); } }
    function setHighlight(ids) { opts.highlight = ids || []; draw(); }
    function setOption(k, v) { opts[k] = v; draw(); }
    function getOption(k) { return opts[k]; }

    return {
      size, fit, draw, toScreen, toWorld, zoomAt, hitTest,
      setLayout, setHover, setHighlight, setOption, getOption,
      view, opts, resize() { size(); fit(); }
    };
  }

  WPE.Render = { create };
})(typeof globalThis !== 'undefined' ? globalThis : this);

