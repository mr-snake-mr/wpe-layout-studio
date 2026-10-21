/* Headless verification of the layout engine.
   Run:  node tests/run.js
   Loads the same browser scripts into a node context and asserts that
   every featured configuration produces a rule-compliant layout.        */
'use strict';
const path = require('path');
const fs = require('fs');

const base = path.join(__dirname, '..', 'assets', 'js');
['config.js', 'geometry.js', 'checker.js', 'planner.js'].forEach((f) => {
  const code = fs.readFileSync(path.join(base, f), 'utf8');
  new Function(code)();
});

const WPE = globalThis.WPE;
const C = WPE.Config;

let failures = 0;
function assert(cond, msg) {
  if (/^\s*$/.test(msg || '')) return;
  if (cond) { console.log('  PASS  ' + msg); }
  else { failures++; console.log('  FAIL  ' + msg); }
}

function runState(name, state) {
  const res = WPE.Planner.plan(state);
  const m = res.layout.metrics;
  console.log('\n' + name);
  console.log('  status      : ' + res.status);
  console.log('  rows        : ' + m.rows + '   flow: ' + (m.flow / 1000).toFixed(1) + ' m');
  console.log('  used area   : ' + (m.utilisation * 100).toFixed(1) + ' % of production area');
  console.log('  alternatives: ' + res.alternatives.length);
  console.log('  rules       : ' + res.check.passCount + '/' + res.check.rules.length + ' pass');
  res.check.rules.forEach((r) => console.log('    ' + r.id + ' ' + (r.pass ? 'ok  ' : 'FAIL') + ' ' + r.actual));
  res.notes.forEach((n) => console.log('  note        : ' + n));
  return res;
}

/* 1. deck stations */
const s1 = C.cloneState(C.DEFAULT_STATE);
const r1 = runState('Station 1 — 3 robots, 60 JPH', s1);
assert(r1.status === 'ok', 'station 1 layout is compliant and fits');
assert(r1.layout.items.filter((i) => i.kind === 'robot').length === 3, 'station 1 places 3 robots');
assert(r1.layout.fences.length === 2, 'station 1 has 2 safety zones');

const s2 = C.cloneState(C.PRESETS.station2);
s2.preset = 'station2';
s2.hall = { w: 26000, h: 16000 };
s2.counts = { robots: 5, machine1: 1, machine2: 0, trolley1: 8, trolley2: 2 };
s2.activities = JSON.parse(JSON.stringify(C.PRESETS.station2.activities));
const r2 = runState('Station 2 — 5 robots, 60 JPH', s2);
assert(r2.status === 'ok', 'station 2 layout is compliant');
assert(r2.layout.items.filter((i) => i.kind === 'robot').length === 5, 'station 2 places 5 robots');

/* 2. compact hall */
const s3 = C.cloneState(C.PRESETS.compact);
s3.preset = 'compact';
const r3 = runState('Compact cell — 19 x 13 m', s3);
assert(r3.status === 'ok', 'compact cell is compliant');

/* 2b. both stations of the brief in one hall */
const s4 = C.cloneState({
  preset: 'dual',
  mode: 'dual',
  hall: C.PRESETS.dual.hall,
  rules: C.RULES,
  jph: 60,
  activities: C.PRESETS.dual.activities,
  counts: C.PRESETS.dual.counts,
  countsB: C.PRESETS.dual.countsB
});
const r4 = runState('Two stations — 3 + 5 robots', s4);
assert(r4.status === 'ok', 'two-station layout is compliant and fits');
assert(r4.layout.items.filter((i) => i.kind === 'robot').length === 8, 'two-station layout places 8 robots');
assert(r4.layout.fences.length === 4, 'each station gets its two fenced cells');
assert(r4.layout.metrics.rowsByStation.length === 2, 'rows are reported per station');
assert(r4.layout.stations && r4.layout.stations[1].rect.x > r4.layout.stations[0].rect.x,
  'station 2 sits beside station 1');

/* 3. resource maths */
console.log('\nJPH maths');
assert(Math.abs(C.cycleTime(60) - 60) < 1e-9, 'cycle time for 60 JPH = 60 s');
assert(Math.abs(C.cycleTime(45) - 80) < 1e-9, 'cycle time for 45 JPH = 80 s');
assert(C.robotsRequired(150, 60) === 3, '150 s robot work at 60 JPH -> 3 robots (deck)');
assert(C.robotsRequired(280, 60) === 5, '280 s robot work at 60 JPH -> 5 robots (deck)');

/* 4. rule engine must detect a violation */
console.log('\nNegative tests');
const badState = C.cloneState(C.DEFAULT_STATE);
const bad = WPE.Planner.plan(badState);
const brokenLayout = JSON.parse(JSON.stringify(bad.layout));
const robot = brokenLayout.items.find((i) => i.kind === 'robot');
const machine = brokenLayout.items.find((i) => i.kind === 'machine');
robot.rect.x = machine.rect.x + 100;   // teleport a robot into the machine
const chk = WPE.Checker.evaluate(brokenLayout, badState.rules, brokenLayout.hall);
assert(chk.rules.find((r) => r.id === 'R1').pass === false, 'checker flags robot/machine clearance');
assert(chk.compliant === false, 'checker rejects the broken layout');

const tight = JSON.parse(JSON.stringify(bad.layout));
const t1 = tight.items.find((i) => i.kind === 'trolley');
tight.items.filter((i) => i.kind === 'trolley').slice(1).forEach((t, k) => {
  t.rect.x = t1.rect.x + (k + 1) * (t1.rect.w + 50);
  t.rect.y = t1.rect.y;
});
t1.rect.y = 10; // push a trolley into the walkway band
const chk2 = WPE.Checker.evaluate(tight, badState.rules, tight.hall);
assert(chk2.rules.find((r) => r.id === 'R7').pass === false, 'checker flags trolleys outside the perimeter band');

/* 4b. flow recompute (used by drag-to-adjust) */
console.log('\nManual edit maths');
const editState = C.cloneState(C.DEFAULT_STATE);
const editPlan = WPE.Planner.plan(editState);
const before = editPlan.layout.metrics.flow;
WPE.Planner.recomputeFlow(editPlan.layout);
assert(Math.abs(editPlan.layout.metrics.flow - before) < 1e-6,
  'recomputing flow on an untouched layout keeps the figure');
const moved = editPlan.layout.items.find((i) => i.kind === 'machine');
moved.rect.x += 1000;
const after = WPE.Planner.recomputeFlow(editPlan.layout);
assert(Math.abs(after - before) > 1, 'flow responds to a manual move (one leg shortens, the next lengthens)');
assert(Math.abs(after - before) <= 2000, 'flow change stays within the size of the move');
const movedCheck = WPE.Checker.evaluate(editPlan.layout, editState.rules, editPlan.layout.hall);
assert(movedCheck.rules.length === 8, 'rule engine still runs on an edited layout');

/* 5. scaling sweep */
console.log('\nSweep');
let sweepBad = 0, sweepCount = 0;
[2, 3, 4, 5, 6].forEach((robots) => {
  [20000, 24000, 28000, 32000].forEach((w) => {
    [14000, 16000, 18000].forEach((h) => {
      const st = C.cloneState(C.DEFAULT_STATE);
      st.hall = { w: w, h: h };
      st.counts = { robots: robots, machine1: 1, machine2: 1, trolley1: 8, trolley2: 2 };
      const res = WPE.Planner.plan(st);
      sweepCount++;
      if (!res.check.compliant || !res.layout.metrics.fits) {
        sweepBad++;
        console.log('    ' + robots + ' robots ' + w + 'x' + h + ' -> ' + res.status +
          ' (' + res.check.failCount + ' rules failed)');
      }
    });
  });
});
assert(sweepBad === 0, sweepCount + ' hall/robot combinations all produce compliant layouts');

console.log('\n' + (failures ? failures + ' assertion(s) failed' : 'All assertions passed'));
process.exit(failures ? 1 : 0);
