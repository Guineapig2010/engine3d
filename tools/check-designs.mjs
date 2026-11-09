// Flies every bundled example through the same pipeline the game uses and
// prints stability, motor fit and predicted flight. Run: node tools/check-designs.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { analyzeRocket, estimateAirframeMass, detectMotorMounts } from '../src/physics/geometry.js';
import { detectParts, assembleParts } from '../src/physics/assembly.js';
import { buildVehicle, simulate, clusterOffsets } from '../src/physics/simulator.js';
import { getMotor } from '../src/physics/motors.js';
import { EXAMPLES } from '../src/data/examples.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROD = { '1/8x36': 0.9144, '3/16x36': 0.9144, '3/16x48': 1.2192, '1/4x72': 1.8288 };
const only = process.argv[2];
let bad = 0;
for (const ex of EXAMPLES) {
  if (only && ex.id !== only) continue;
  const buf = fs.readFileSync(path.join(root, 'public', ex.file));
  const raw = new STLLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)).attributes.position.array;
  const det = detectParts(raw, { unitScale: 0.001 });
  let geom;
  let stations;
  let asm = null;
  if (det) {
    asm = assembleParts(det);
    geom = analyzeRocket(asm.positions, { unitScale: 1, axis: 'y', noseAt: 'max' });
    stations = asm.stations;
  } else {
    geom = analyzeRocket(raw, { unitScale: 0.001 });
    stations = ex.stations || [];
  }
  const n = stations.length + 1;
  const problems = [];
  if (ex.stages.length !== n) problems.push(`preset has ${ex.stages.length} stages, geometry has ${n}`);
  const L = geom.length;
  const stages = ex.stages.map((sg, k) => {
    const motor = getMotor(sg.motorId);
    const bottom = k === 0 ? geom.bodyAftY : stations[k - 1];
    let yAft = bottom - (k === 0 ? 0.004 : 0.008);
    if (k > 0 && asm) {
      const lower = asm.placed.filter((p) => p.stage === k - 1 && p.part.hasFins).pop();
      if (lower) yAft = bottom + lower.part.topStub + 0.001;
    }
    const mounts = k === 0 ? geom.motorMounts : detectMotorMounts(geom, bottom);
    const count = sg.count || 1;
    if (!mounts.length) problems.push(`stage ${k + 1}: no motor mount found`);
    else if (Math.abs(mounts[0].motorDiameter - motor.diameter) > 1.5) problems.push(`stage ${k + 1}: mount ${mounts[0].motorDiameter} mm vs motor ${motor.diameter} mm`);
    if (count > 1 && mounts.length !== count) problems.push(`stage ${k + 1}: ${mounts.length} mounts found for ${count} motors`);
    const lats = mounts.length === count && count > 1 ? mounts.map((m) => [m.x, m.z]) : clusterOffsets(count, motor.diameter / 1000);
    return { yBottom: k === 0 ? 0 : stations[k - 1], yTop: k === n - 1 ? L : stations[k], motors: lats.map((l) => ({ id: motor.id, x: l[0], z: l[1], yAft })) };
  });
  const r = ex.recovery || {};
  const recovery = { type: r.type || 'parachute', diameter: (r.diameterIn || 12) * 0.0254, cd: r.cd ?? 0.75, streamerWidth: (r.streamerWidth || 50) / 1000, streamerLength: (r.streamerLength || 750) / 1000, mass: (r.massG ?? 8) / 1000 };
  let res;
  try {
    const v = buildVehicle({ geom, airframeMass: ex.massG != null ? ex.massG / 1000 : estimateAirframeMass(geom), noseWeight: (ex.noseWeightG || 0) / 1000, stages, recovery, staging: { method: 'direct' } });
    res = simulate(v, { rodLength: ROD[ex.rod] || 0.914, windSpeed: 0 });
  } catch (e) {
    problems.push('sim error ' + e.message);
  }
  const s = res?.summary;
  const margins = res ? res.stability.map((x) => x.margin.toFixed(2)).join('/') : '-';
  if (process.env.DEBUG) console.log(JSON.stringify(res?.stability.map((x) => ({ cg: +x.xcg.toFixed(3), cp: +x.xcp.toFixed(3), cna: +x.cna.toFixed(1) }))), "stations", stations.map((s) => +s.toFixed(3)), "fins", JSON.stringify(geom.finSets.map((f) => ({ n: f.count, xLE: +f.xLE.toFixed(3), Cr: +f.Cr.toFixed(3), s: +f.span.toFixed(3) }))), "L", geom.length.toFixed(3));
  if (res && res.stability.some((x) => x.margin < 1)) problems.push('UNSTABLE (<1 cal)');
  if (res && !res.events.some((e) => e.type === 'deploy') && recovery.type !== 'none') problems.push('recovery never deployed');
  console.log(
    `${ex.id.padEnd(12)} L ${(L * 1000).toFixed(0).padStart(5)} mm Ø ${(geom.refDiameter * 1000).toFixed(1).padStart(5)} fins ${geom.finSets.map((f) => f.count).join('+').padEnd(8)} stab ${margins.padEnd(18)} apogee ${s ? s.apogee.toFixed(0).padStart(5) : '-'} m  vmax ${s ? s.maxSpeed.toFixed(0).padStart(4) : '-'}  rod ${s?.rodExitSpeed?.toFixed(1) ?? '-'}  ej ${s?.ejection ? s.ejection.v.toFixed(1) : '-'}  land ${s?.landing ? s.landing.v.toFixed(1) : '-'}  mass ${s ? (s.liftoffMass * 1000).toFixed(0) : '-'} g`
  );
  if (problems.length) {
    bad++;
    console.log('   !! ' + problems.join('; '));
  }
}
process.exitCode = bad ? 1 : 0;
