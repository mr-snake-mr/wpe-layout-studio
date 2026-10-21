/* ============================================================
   WPE Layout Studio — configuration & reference data
   All geometry in millimetres.
   ============================================================ */
(function (root) {
  'use strict';
  const WPE = (root.WPE = root.WPE || {});

  /* --- catalogue of physical resources --------------------- */
  const DIMS = {
    loading_fixture: { w: 1400, h: 1000, kind: 'fixture', label: 'Loading fixture', color: '#3b82f6' },
    unload_fixture: { w: 1400, h: 1000, kind: 'fixture', label: 'Unload fixture', color: '#6366f1' },
    robot: { w: 800, h: 800, kind: 'robot', label: 'Robot', color: '#f59e0b' },
    controller: { w: 600, h: 600, kind: 'controller', label: 'Robot controller', color: '#a855f7' },
    machine1: { w: 3200, h: 2200, kind: 'machine', label: 'Machine 1', color: '#22c55e' },
    machine2: { w: 2600, h: 2000, kind: 'machine', label: 'Machine 2', color: '#14b8a6' },
    trolley1: { w: 1200, h: 800, kind: 'trolley', label: 'Material trolley 1', color: '#ef4444' },
    trolley2: { w: 1000, h: 800, kind: 'trolley', label: 'Material trolley 2', color: '#f97316' }
  };

  /* --- the seven rules from the problem statement ---------- */
  const RULES = {
    aisleWidth: 1200,      // pedestrian walkway width
    walkwayMin: 1200,
    robotMachine: 800,     // R1 robot <-> machine / equipment
    robotRobot: 700,       // R2 robot <-> robot
    fenceClearance: 600,   // R4 equipment <-> safety fence
    trolleyGap: 100,       // R6 trolley <-> trolley
    trolleyAccess: 900,    // R5 clear operator approach in front of a trolley
    fencePadding: 600,     // fence offset around the robot cluster
    bandDepth: 1000,       // perimeter material-storage band
    machineGap: 600        // generic equipment <-> equipment gap
  };

  const RULE_META = [
    { id: 'R0', title: 'No overlapping resources', rule: 'Every placed resource occupies its own footprint.', ref: 'General' },
    { id: 'R1', title: 'Robot to machine / equipment', rule: 'A minimum clearance of 800 mm between a robot and any machine or equipment.', ref: '800 mm' },
    { id: 'R2', title: 'Robot to robot', rule: 'A minimum clearance of 700 mm between two robots.', ref: '700 mm' },
    { id: 'R3', title: 'Pedestrian walkway', rule: 'A clear, unobstructed pedestrian walkway runs around and through the layout.', ref: '≥ 1200 mm' },
    { id: 'R4', title: 'Equipment to safety fence', rule: 'A minimum clearance of 600 mm between any resource/equipment and the safety fence.', ref: '600 mm' },
    { id: 'R5', title: 'Trolley accessibility', rule: 'Material storage is reachable: a clear operator approach in front of every trolley.', ref: '≥ 900 mm' },
    { id: 'R6', title: 'Trolley to trolley', rule: 'A minimum clearance of 100 mm between adjacent material storage trolleys.', ref: '100 mm' },
    { id: 'R7', title: 'Trolleys on the perimeter', rule: 'Trolleys sit along the layout boundary and never obstruct resources or pedestrian paths.', ref: 'perimeter band' }
  ];

  /* --- hall / station presets ------------------------------ */
  const PRESETS = {
    station1: {
      name: 'Station 1 — 3 robots (deck)',
      hall: { w: 24000, h: 13000 },
      jph: 60,
      activities: [
        { name: 'Load part on fixture', time: 20 },
        { name: 'Robotic welding / handling', time: 150 },
        { name: 'Machine 1 process', time: 45 },
        { name: 'Machine 2 process', time: 50 },
        { name: 'Unload part', time: 20 }
      ],
      counts: { robots: 3, machine1: 1, machine2: 1, trolley1: 8, trolley2: 1 }
    },
    station2: {
      name: 'Station 2 — 5 robots (deck)',
      hall: { w: 26000, h: 13000 },
      jph: 60,
      activities: [
        { name: 'Load part on fixture', time: 20 },
        { name: 'Robotic welding / handling', time: 280 },
        { name: 'Machine 1 process', time: 45 },
        { name: 'Machine 2 process', time: 0 },
        { name: 'Unload part', time: 20 }
      ],
      counts: { robots: 5, machine1: 1, machine2: 0, trolley1: 8, trolley2: 2 }
    },
    compact: {
      name: 'Compact cell — 19 x 13 m',
      hall: { w: 19000, h: 13000 },
      jph: 45,
      activities: [
        { name: 'Load part on fixture', time: 18 },
        { name: 'Robotic welding / handling', time: 120 },
        { name: 'Machine 1 process', time: 40 },
        { name: 'Machine 2 process', time: 0 },
        { name: 'Unload part', time: 18 }
      ],
      counts: { robots: 2, machine1: 1, machine2: 0, trolley1: 6, trolley2: 1 }
    }
  };

  const DEFAULT_STATE = {
    preset: 'station1',
    hall: { w: 24000, h: 13000 },
    rules: Object.assign({}, RULES),
    jph: 60,
    activities: PRESETS.station1.activities.map((a) => ({ name: a.name, time: a.time })),
    counts: Object.assign({}, PRESETS.station1.counts)
  };

  /* --- JPH helpers ---------------------------------------- */
  function cycleTime(jph) {
    jph = Number(jph);
    if (!isFinite(jph) || jph <= 0) return 0;
    return 3600 / jph;
  }
  function robotsRequired(robotWorkSeconds, jph) {
    const ct = cycleTime(jph);
    if (!ct) return 0;
    return Math.max(1, Math.ceil(Number(robotWorkSeconds || 0) / ct));
  }
  function resourceTable(activities, jph) {
    const ct = cycleTime(jph);
    return activities.map((a) => ({
      name: a.name,
      time: a.time,
      required: ct ? Math.ceil(Number(a.time || 0) / ct) : 0,
      utilisation: ct ? Math.min(1, Number(a.time || 0) / ct) : 0
    }));
  }

  WPE.Config = {
    DIMS, RULES, RULE_META, PRESETS, DEFAULT_STATE,
    cycleTime, robotsRequired, resourceTable,
    cloneState(s) { return JSON.parse(JSON.stringify(s)); }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

