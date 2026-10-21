/* Writes a DXF for the default scenario so tests/validate_dxf.py can parse it.
   Run:  node tests/export-dxf.js  &&  python tests/validate_dxf.py          */
'use strict';
const fs = require('fs');
const path = require('path');

const base = path.join(__dirname, '..', 'assets', 'js');
['config.js', 'geometry.js', 'checker.js', 'planner.js', 'exporters.js'].forEach((f) => {
  new Function(fs.readFileSync(path.join(base, f), 'utf8'))();
});

const WPE = globalThis.WPE;
const state = WPE.Config.cloneState(WPE.Config.DEFAULT_STATE);
const result = WPE.Planner.plan(state);
const dxf = WPE.Exporters.dxf(result.layout, { title: 'Station 1 validation' });
const out = path.join(__dirname, '_out.dxf');
fs.writeFileSync(out, dxf, 'utf8');
console.log('wrote ' + out + ' (' + fs.statSync(out).size + ' bytes, ' +
  result.layout.items.length + ' resources)');
