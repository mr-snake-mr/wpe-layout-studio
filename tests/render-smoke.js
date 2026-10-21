/* Renderer smoke test — executes the real canvas code against a stub 2D context.
   Catches runtime errors (undefined variables, bad canvas calls) without a browser,
   and checks that the exporters produce well formed DXF / JSON. */
'use strict';
const path = require('path');
const fs = require('fs');

const base = path.join(__dirname, '..', 'assets', 'js');
['config.js', 'geometry.js', 'checker.js', 'planner.js', 'renderer.js', 'exporters.js'].forEach((f) => {
  new Function(fs.readFileSync(path.join(base, f), 'utf8'))();
});

const WPE = globalThis.WPE;
let calls = { fill: 0, stroke: 0, text: 0, rect: 0 };

function stubCtx() {
  const ctx = {
    canvas: null,
    setTransform() {}, save() {}, restore() {}, translate() {}, rotate() {}, scale() {},
    beginPath() {}, moveTo() {}, lineTo() {}, quadraticCurveTo() {}, closePath() {},
    arc() {}, rect() { calls.rect++; }, clip() {}, fill() { calls.fill++; }, stroke() { calls.stroke++; },
    fillRect() { calls.rect++; }, strokeRect() { calls.rect++; }, clearRect() {},
    setLineDash() {}, fillText() { calls.text++; },
    measureText(s) { return { width: String(s).length * 6 }; },
    set globalCompositeOperation(v) {}, get globalCompositeOperation() { return 'source-over'; }
  };
  return ctx;
}

const ctx = stubCtx();
const canvas = {
  width: 1600, height: 1000,
  clientWidth: 1600, clientHeight: 1000,
  getContext: () => ctx,
  getBoundingClientRect: () => ({ width: 1600, height: 1000, left: 0, top: 0 }),
  toBlob: (cb) => cb(null)
};
globalThis.window = { devicePixelRatio: 1 };

let failures = 0;
const assert = (c, m) => { console.log((c ? '  PASS  ' : '  FAIL  ') + m); if (!c) failures++; };

const state = WPE.Config.cloneState(WPE.Config.DEFAULT_STATE);
const result = WPE.Planner.plan(state);

console.log('Renderer');
const R = WPE.Render.create(canvas);
R.setLayout(result.layout);
R.size();
let threw = null;
try {
  R.fit();
  R.zoomAt(1.15, { x: 800, y: 500 });
  R.setHighlight([result.layout.items[0].id]);
  R.setOption('grid', false);
  R.draw();
  R.setHover(result.layout.items[0]);
  R.draw();
  R.toWorld({ x: 400, y: 300 });
  R.hitTest({ x: 700, y: 400 });
} catch (e) { threw = e; }
assert(!threw, 'draw pipeline runs without throwing' + (threw ? ' (' + threw.message + ')' : ''));
assert(calls.fill > 10, 'shapes were filled (' + calls.fill + ' fills)');
assert(calls.rect > 5, 'rectangles were drawn (' + calls.rect + ' rects)');
assert(calls.text > 3, 'labels were drawn (' + calls.text + ' texts)');

const scene = R.toScreen({ x: 0, y: 0 });
assert(isFinite(scene.x) && isFinite(scene.y), 'view transform produces finite coordinates');

console.log('\nExporters');
const dxf = WPE.Exporters.dxf(result.layout, { title: 'smoke' });
assert(dxf.startsWith('0\r\nSECTION'), 'DXF starts with a SECTION');
assert(dxf.trim().endsWith('EOF'), 'DXF terminates with EOF');
assert((dxf.match(/\r\nLINE\r\n/g) || []).length > 20, 'DXF contains line entities');
assert(dxf.includes('ROBOT') && dxf.includes('FENCE') && dxf.includes('TROLLEY'), 'DXF has the expected layers');
assert(!/[×]/.test(dxf), 'DXF text is ASCII safe');
const blocks = (dxf.match(/\r\nSECTION\r\n/g) || []).length;
assert(blocks === 3, 'DXF has header / tables / entities sections (' + blocks + ')');

const json = WPE.Exporters.summaryJson(state, result);
const parsed = JSON.parse(json);
assert(parsed.status === 'ok', 'JSON export records status');
assert(parsed.compliance.length === 8, 'JSON export carries 8 compliance records');
assert(parsed.layout.items.length === result.layout.items.length, 'JSON export carries every resource');

const csv = WPE.Exporters.csv(result.layout);
const lines = csv.split('\r\n');
assert(lines[0] === 'item,type,x_mm,y_mm,width_mm,depth_mm,area_m2', 'CSV header is stable');
assert(lines.length === result.layout.items.length + 1, 'CSV has one row per resource');

console.log('\n' + (failures ? failures + ' renderer/export assertion(s) failed' : 'Renderer and exporters OK'));
process.exit(failures ? 1 : 0);
