/* DXF import checks — parses the committed fixtures and a synthetic file.
   Run:  node tests/import-test.js                                        */
'use strict';
const fs = require('fs');
const path = require('path');

const base = path.join(__dirname, '..', 'assets', 'js');
['config.js', 'geometry.js', 'checker.js', 'planner.js', 'importer.js'].forEach((f) => {
  new Function(fs.readFileSync(path.join(base, f), 'utf8'))();
});

const WPE = globalThis.WPE;
let failures = 0;
const assert = (c, m) => { console.log((c ? '  PASS  ' : '  FAIL  ') + m); if (!c) failures++; };
const near = (a, b, tol) => Math.abs(a - b) <= (tol || 1);

console.log('Metres drawing (mm units)');
const mm = WPE.Importer.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'hall-30x18.dxf'), 'utf8'));
assert(mm.ok, 'file parses');
assert(mm.units === 4, '$INSUNITS read as millimetres (4)');
assert(mm.entities >= 4, 'entities counted (' + mm.entities + ')');
assert(near(mm.bbox.w, 30000) && near(mm.bbox.h, 18000), 'outline is 30000 x 18000 mm, got ' +
  Math.round(mm.bbox.w) + ' x ' + Math.round(mm.bbox.h));
assert(mm.usedClosedOutline, 'the closed outline wins over the drawing extents');
assert(mm.layers.indexOf('HALL') >= 0 && mm.layers.indexOf('EQUIP') >= 0, 'layers reported');

console.log('\nInch drawing');
const inch = WPE.Importer.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'hall-30x18-inch.dxf'), 'utf8'));
assert(inch.units === 1, '$INSUNITS read as inches (1)');
assert(near(inch.bbox.w, 30000, 2) && near(inch.bbox.h, 18000, 2),
  'inches converted to mm, got ' + Math.round(inch.bbox.w) + ' x ' + Math.round(inch.bbox.h));

console.log('\nR12 style (POLYLINE + VERTEX)');
const r12 = [
  '0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC',
  '0', 'SECTION', '2', 'ENTITIES',
  '0', 'POLYLINE', '8', 'HALL', '70', '1',
  '0', 'VERTEX', '8', 'HALL', '10', '0', '20', '0',
  '0', 'VERTEX', '8', 'HALL', '10', '12000', '20', '0',
  '0', 'VERTEX', '8', 'HALL', '10', '12000', '20', '8000',
  '0', 'VERTEX', '8', 'HALL', '10', '0', '20', '8000',
  '0', 'SEQEND',
  '0', 'ENDSEC', '0', 'EOF'
].join('\n');
const old = WPE.Importer.parse(r12);
assert(old.ok, 'old-style drawing parses');
assert(near(old.bbox.w, 12000) && near(old.bbox.h, 8000),
  'vertex stream gives 12000 x 8000 mm, got ' + Math.round(old.bbox.w) + ' x ' + Math.round(old.bbox.h));

console.log('\nBad input');
const empty = WPE.Importer.parse('this is not a drawing');
assert(!empty.ok && !!empty.error, 'garbage input is rejected with a message');

console.log('\n' + (failures ? failures + ' import assertion(s) failed' : 'DXF import OK'));
process.exit(failures ? 1 : 0);
