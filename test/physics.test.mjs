import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEng, curveStats, impulseClass } from '../src/physics/eng.js';
import { allMotors, getMotor, MotorInstance } from '../src/physics/motors.js';
import { analyzeRocket, aeroForSection, estimateAirframeMass } from '../src/physics/geometry.js';
import { detectParts, assembleParts } from '../src/physics/assembly.js';
import { buildVehicle, simulate } from '../src/physics/simulator.js';
import { loadStlPositions } from './helpers.mjs';

test('parses RASP .eng files and integrates impulse', () => {
  const eng = parseEng(`; test\nC6 18 70 0-3-5-7 0.0108 0.0231 Estes\n0.1 10\n1.0 10\n1.1 0\n`);
  assert.equal(eng.name, 'C6');
  assert.equal(eng.diameter, 18);
  assert.deepEqual(eng.points[0], [0, 0]);
  const s = curveStats(eng.points);
  assert.ok(Math.abs(s.impulse - 10) < 1e-9);
  assert.equal(impulseClass(9.5), 'C');
  assert.equal(impulseClass(1.0), '1/2A');
});

test('motor database covers A–F with every delay variant', () => {
  const motors = allMotors();
  const des = new Set(motors.map((m) => m.designation));
  for (const d of ['A8-3', 'A8-5', 'B6-0', 'B6-4', 'B6-6', 'C6-0', 'C6-3', 'C6-5', 'C6-7', 'C11-5', 'D12-0', 'D12-7', 'E9-6', 'E12-8', 'E16-6', 'F15-0', 'F15-8', 'F39-6T', 'F50-9']) {
    assert.ok(des.has(d), `missing ${d}`);
  }
  for (const cls of ['A', 'B', 'C', 'D', 'E', 'F']) assert.ok(motors.some((m) => m.cls === cls), `no ${cls} motors`);
  // impulses fall in their NAR class
  for (const m of motors) assert.equal(impulseClass(m.impulse), m.cls);
  const c6 = getMotor('Estes-C6-5');
  assert.ok(c6.impulse > 8.5 && c6.impulse < 10, `C6 impulse ${c6.impulse}`);
  assert.ok(c6.peakThrust > 13 && c6.peakThrust < 15);
  assert.equal(c6.delay, 5);
  assert.equal(getMotor('Estes-C6-0').usage, 'booster');
  assert.equal(getMotor('Estes-C6-7').usage, 'upper');
});

test('motor instance burns propellant in proportion to impulse', () => {
  const m = new MotorInstance(getMotor('Estes-C6-5'), { ignitionTime: 0 });
  assert.ok(Math.abs(m.mass(0) - 0.0231) < 0.0015);
  assert.ok(Math.abs(m.mass(5) - (0.0231 - 0.0108)) < 0.0015);
  assert.ok(m.thrust(0.19) > 12);
  assert.equal(m.thrust(3), 0);
  assert.ok(Math.abs(m.ejectionTime() - (m.burnTime + 5)) < 1e-9);
});

test('analyzes the example STL: axis, fins, CP and motor mount', () => {
  const g = analyzeRocket(loadStlPositions('public/examples/sparrow-c.stl'), {});
  assert.equal(g.axisName, 'z');
  assert.ok(g.noseAtMax);
  assert.ok(Math.abs(g.length - 0.415) < 0.003);
  assert.ok(Math.abs(g.refDiameter - 0.0248) < 0.0005);
  assert.equal(g.finSets.length, 1);
  assert.equal(g.finSets[0].count, 3);
  assert.ok(Math.abs(g.finSets[0].span - 0.055) < 0.004);
  assert.equal(g.motorMounts.length, 1);
  assert.equal(g.motorMounts[0].motorDiameter, 18);
  const a = aeroForSection(g);
  assert.ok(a.xcp > 0.3 && a.xcp < 0.4, `xcp ${a.xcp}`);
  const mass = estimateAirframeMass(g);
  assert.ok(mass > 0.02 && mass < 0.06, `mass ${mass}`);
});

test('detects a minimum-diameter 24 mm mount and fins overhanging the tail', () => {
  const g = analyzeRocket(loadStlPositions('public/examples/stratos-e.stl'), {});
  assert.equal(g.motorMounts[0].motorDiameter, 24);
  assert.ok(g.bodyAftY > 0.005); // fins hang below the body tube
  assert.ok(Math.abs(g.refDiameter - 0.0248) < 0.0005);
});

test('orientation does not matter: rotated STL gives the same rocket', () => {
  const pos = loadStlPositions('public/examples/sparrow-c.stl');
  const rot = new Float32Array(pos.length);
  for (let i = 0; i < pos.length; i += 3) {
    rot[i] = -pos[i + 2]; // nose now points along −X
    rot[i + 1] = pos[i + 1];
    rot[i + 2] = pos[i];
  }
  const g = analyzeRocket(rot, {});
  assert.equal(g.axisName, 'x');
  assert.equal(g.noseAtMax, false);
  assert.ok(Math.abs(aeroForSection(g).xcp - aeroForSection(analyzeRocket(pos, {})).xcp) < 0.004);
});

test('separated stage parts are found, ordered and stacked', () => {
  const pos = loadStlPositions('public/examples/triple-threat-3stage-separated.stl');
  const d = detectParts(pos, {});
  assert.ok(d, 'parts not detected');
  assert.equal(d.parts.length, 3);
  const roles = d.parts.map((p) => p.role).sort();
  assert.deepEqual(roles, ['booster', 'booster', 'sustainer']);
  const asm = assembleParts(d);
  // bottom booster has the biggest fins (it was on the left in the file)
  assert.ok(asm.placed[0].part.layout.u < 0);
  assert.equal(asm.placed[2].role, 'sustainer');
  // couplers seated: 80 mm booster + 78 mm middle + 390 mm sustainer
  assert.ok(Math.abs(asm.stations[0] - 0.08) < 0.004, `station ${asm.stations[0]}`);
  assert.ok(Math.abs(asm.stations[1] - 0.158) < 0.004, `station ${asm.stations[1]}`);
  const g = analyzeRocket(asm.positions, { unitScale: 1, axis: 'y', noseAt: 'max' });
  assert.ok(Math.abs(g.length - 0.548) < 0.004, `length ${g.length}`);
  assert.equal(g.finSets.length, 3);
  // a single assembled model is NOT split
  assert.equal(detectParts(loadStlPositions('public/examples/twin-falcon-2stage.stl'), {}), null);
});

function fly(file, stages, recovery, launch = {}) {
  const g = analyzeRocket(loadStlPositions(file), {});
  const v = buildVehicle({ geom: g, airframeMass: estimateAirframeMass(g), stages: stages(g), recovery, staging: { method: 'direct' } });
  return simulate(v, { windSpeed: 0, ...launch });
}
const chute = { type: 'parachute', diameter: 0.3048, cd: 0.75, mass: 0.008 };
const streamer = { type: 'streamer', streamerWidth: 0.05, streamerLength: 0.75, cd: 0.25, mass: 0.004 };

test('single-stage C6-5 flight is realistic', () => {
  const r = fly('public/examples/sparrow-c.stl', (g) => [{ yBottom: 0, yTop: g.length, motors: [{ id: 'Estes-C6-5' }] }], chute);
  const s = r.summary;
  assert.ok(s.apogee > 200 && s.apogee < 400, `apogee ${s.apogee}`);
  assert.ok(s.rodExitSpeed > 12);
  assert.ok(r.stability[0].margin > 1.5 && r.stability[0].margin < 3.5);
  assert.ok(s.ejection && Math.abs(s.ejection.t - (getMotor('Estes-C6-5').burnTime + 5)) < 0.05);
  assert.ok(s.descentRate > 2.5 && s.descentRate < 6);
  assert.ok(r.events.some((e) => e.type === 'landing'));
});

test('bigger motors fly higher (A < B < C)', () => {
  const apo = (id) => fly('public/examples/sparrow-c.stl', (g) => [{ yBottom: 0, yTop: g.length, motors: [{ id }] }], chute).summary.apogee;
  const a = apo('Estes-A8-3');
  const b = apo('Estes-B6-4');
  const c = apo('Estes-C6-5');
  assert.ok(a < b && b < c, `${a} ${b} ${c}`);
});

test('two-stage C6-0 → C6-7 stages and both stages land', () => {
  const r = fly(
    'public/examples/twin-falcon-2stage.stl',
    (g) => [
      { yBottom: 0, yTop: 0.0785, motors: [{ id: 'Estes-C6-0', yAft: -0.003 }] },
      { yBottom: 0.0785, yTop: g.length, motors: [{ id: 'Estes-C6-7', yAft: 0.07 }] },
    ],
    streamer
  );
  const types = r.events.map((e) => e.type);
  assert.ok(types.includes('stage-ignition'));
  assert.ok(types.includes('separation'));
  assert.equal(r.boosters.length, 1);
  assert.ok(r.boosters[0].landing.t > 3);
  assert.ok(r.summary.apogee > 350, `apogee ${r.summary.apogee}`);
});

test('a delayed booster motor fails to stage (real black-powder behaviour)', () => {
  const r = fly(
    'public/examples/twin-falcon-2stage.stl',
    (g) => [
      { yBottom: 0, yTop: 0.0785, motors: [{ id: 'Estes-C6-5', yAft: -0.003 }] },
      { yBottom: 0.0785, yTop: g.length, motors: [{ id: 'Estes-C6-7', yAft: 0.07 }] },
    ],
    streamer
  );
  assert.ok(r.events.some((e) => e.type === 'staging-fail'));
  assert.ok(!r.events.some((e) => e.type === 'stage-ignition'));
});

test('wind makes the rocket drift downwind', () => {
  const r = fly('public/examples/sparrow-c.stl', (g) => [{ yBottom: 0, yTop: g.length, motors: [{ id: 'Estes-B6-4' }] }], chute, { windSpeed: 4, windFrom: 270 });
  const land = r.summary.landing.p;
  assert.ok(land[0] > 20, `east drift ${land[0]}`); // wind from the west blows east (+x)
});

test('E-motor high-altitude rocket goes much higher', () => {
  const r = fly('public/examples/stratos-e.stl', (g) => [{ yBottom: 0, yTop: g.length, motors: [{ id: 'Estes-E12-8', yAft: g.bodyAftY - 0.004 }] }], streamer, { rodLength: 0.914 });
  assert.ok(r.summary.apogee > 450 && r.summary.apogee < 900, `apogee ${r.summary.apogee}`);
  assert.ok(r.summary.maxMach < 0.8);
});
