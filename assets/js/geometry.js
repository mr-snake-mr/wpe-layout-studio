/* ============================================================
   Geometry helpers — axis aligned rectangles in millimetres.
   Model space: origin bottom-left, +y upwards.
   ============================================================ */
(function (root) {
  'use strict';
  const WPE = (root.WPE = root.WPE || {});

  const r = (x, y, w, h) => ({ x: x, y: y, w: w, h: h });
  const right = (a) => a.x + a.w;
  const top = (a) => a.y + a.h;

  /** shortest gap between two rectangles: {dx,dy,dist,overlap} */
  function gap(a, b) {
    const dx = Math.max(0, Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w)));
    const dy = Math.max(0, Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h)));
    const overlap = dx === 0 && dy === 0;
    return { dx: dx, dy: dy, dist: overlap ? 0 : Math.hypot(dx, dy), overlap: overlap };
  }

  function overlapArea(a, b) {
    const ox = Math.min(right(a), right(b)) - Math.max(a.x, b.x);
    const oy = Math.min(top(a), top(b)) - Math.max(a.y, b.y);
    return ox > 0 && oy > 0 ? ox * oy : 0;
  }

  function union(rects) {
    const list = rects.filter(Boolean);
    if (!list.length) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    list.forEach((q) => {
      x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y);
      x1 = Math.max(x1, q.x + q.w); y1 = Math.max(y1, q.y + q.h);
    });
    return r(x0, y0, x1 - x0, y1 - y0);
  }

  function inflate(a, d) { return r(a.x - d, a.y - d, a.w + 2 * d, a.h + 2 * d); }

  function centroid(a) { return { x: a.x + a.w / 2, y: a.y + a.h / 2 }; }

  function contains(outer, inner, tol) {
    tol = tol || 0;
    return inner.x >= outer.x - tol && inner.y >= outer.y - tol &&
      right(inner) <= right(outer) + tol && top(inner) <= top(outer) + tol;
  }

  function intersects(a, b) { return overlapArea(a, b) > 0; }

  function pointIn(p, a) {
    return p.x >= a.x && p.x <= right(a) && p.y >= a.y && p.y <= top(a);
  }

  /** mark a rectangle on a raster grid */
  function rasterize(grid, rect, value) {
    const cs = grid.cell;
    const i0 = Math.max(0, Math.floor((rect.x - grid.originX) / cs));
    const j0 = Math.max(0, Math.floor((rect.y - grid.originY) / cs));
    const i1 = Math.min(grid.cols - 1, Math.ceil((right(rect) - grid.originX) / cs) - 1);
    const j1 = Math.min(grid.rows - 1, Math.ceil((top(rect) - grid.originY) / cs) - 1);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) grid.cells[j * grid.cols + i] = value;
    }
  }

  function makeGrid(rect, cell) {
    const cols = Math.max(1, Math.round(rect.w / cell));
    const rows = Math.max(1, Math.round(rect.h / cell));
    return {
      rect: rect, cell: cell, cols: cols, rows: rows,
      originX: rect.x, originY: rect.y,
      cells: new Uint8Array(cols * rows)
    };
  }

  function cellIndexAt(grid, p) {
    const i = Math.floor((p.x - grid.originX) / grid.cell);
    const j = Math.floor((p.y - grid.originY) / grid.cell);
    if (i < 0 || j < 0 || i >= grid.cols || j >= grid.rows) return -1;
    return j * grid.cols + i;
  }

  /** 4-connected flood fill over free cells; returns Uint8Array visited */
  function flood(grid, seedIndex) {
    const seen = new Uint8Array(grid.cols * grid.rows);
    if (seedIndex < 0 || grid.cells[seedIndex]) return seen;
    const stack = [seedIndex];
    seen[seedIndex] = 1;
    while (stack.length) {
      const idx = stack.pop();
      const i = idx % grid.cols;
      const j = (idx - i) / grid.cols;
      const push = (ii, jj) => {
        if (ii < 0 || jj < 0 || ii >= grid.cols || jj >= grid.rows) return;
        const k = jj * grid.cols + ii;
        if (!seen[k] && !grid.cells[k]) { seen[k] = 1; stack.push(k); }
      };
      push(i - 1, j); push(i + 1, j); push(i, j - 1); push(i, j + 1);
    }
    return seen;
  }

  function fmtMm(v) {
    return v >= 1000 ? (v / 1000).toFixed(2).replace(/\.00$/, '') + ' m' : Math.round(v) + ' mm';
  }
  function fmtNum(v, d) {
    return Number(v).toLocaleString('en-US', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 });
  }

  WPE.Geom = {
    r, right, top, gap, overlapArea, union, inflate, centroid, contains, intersects,
    pointIn, rasterize, makeGrid, cellIndexAt, flood, fmtMm, fmtNum
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
