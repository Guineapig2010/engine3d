// Runtime motor database: lookup, thrust interpolation, mass flow.
import { CURVES, MOTORS } from '../data/motors.generated.js';
import { curveStats, impulseClass, classPercent, parseEng } from './eng.js';

const curves = { ...CURVES };
const motors = MOTORS.map((m) => ({ ...m }));

function enrich(m) {
  const c = curves[m.curve];
  if (!c._stats) c._stats = curveStats(c.points);
  const s = c._stats;
  m.impulse = s.impulse;
  m.peakThrust = s.peak;
  m.avgThrust = s.avgThrust;
  m.burnTime = s.burnTime;
  m.certBurnTime = s.certBurnTime;
  // The class comes from the designation (a C6-0 is a C even though its certified
  // sample measured 10.02 N·s); fall back to the measured impulse for odd names.
  const named = /^(1\/[248]A|[A-O])/.exec(m.common || '');
  m.cls = named ? named[1] : impulseClass(s.impulse);
  m.classPercent = Math.max(0, Math.min(100, classPercent(s.impulse, m.cls)));
  return m;
}
motors.forEach(enrich);

export function allMotors() {
  return motors;
}

export function getMotor(id) {
  return motors.find((m) => m.id === id) || null;
}

export function getCurve(curveId) {
  return curves[curveId];
}

const CLASS_ORDER = ['1/4A', '1/2A', 'A', 'B', 'C', 'D', 'E', 'F', 'G'];
export function motorsByClass() {
  const groups = new Map();
  for (const m of motors) {
    if (!groups.has(m.cls)) groups.set(m.cls, []);
    groups.get(m.cls).push(m);
  }
  return [...groups.entries()].sort((a, b) => CLASS_ORDER.indexOf(a[0]) - CLASS_ORDER.indexOf(b[0]));
}

/** Register a user-supplied .eng file; returns the created motor variants. */
export function registerEngText(text, fileName = 'custom.eng') {
  const eng = parseEng(text);
  const id = 'custom_' + fileName.replace(/[^a-z0-9]+/gi, '_') + '_' + Object.keys(curves).length;
  curves[id] = {
    id,
    mfr: eng.mfr,
    diameter: eng.diameter,
    length: eng.length,
    propMass: eng.propMass,
    totalMass: eng.totalMass,
    headerDelays: eng.delays,
    points: eng.points,
    source: 'User file ' + fileName,
    notes: eng.comments.join(' '),
  };
  const delays = String(eng.delays)
    .split(/[-,]/)
    .map((d) => (/^(P|100)$/i.test(d) ? 'P' : Number(d)))
    .filter((d) => d === 'P' || Number.isFinite(d));
  if (!delays.length) delays.push('P');
  const created = [];
  for (const d of delays) {
    const plugged = d === 'P';
    const m = enrich({
      id: `${id}-${d}`,
      mfr: eng.mfr,
      designation: `${eng.name}-${d}`,
      common: eng.name,
      curve: id,
      delay: plugged ? null : d,
      plugged,
      usage: plugged ? 'plugged' : d === 0 ? 'booster' : 'single',
      propellant: 'User supplied',
      blackPowder: /estes|quest/i.test(eng.mfr),
      diameter: eng.diameter,
      length: eng.length,
      propMass: eng.propMass * 1000,
      totalMass: eng.totalMass * 1000,
      custom: true,
    });
    motors.push(m);
    created.push(m);
  }
  return created;
}

/**
 * A burning motor instance used by the simulator. Handles thrust lookup,
 * propellant consumption proportional to delivered impulse, delay and ejection.
 */
export class MotorInstance {
  constructor(motor, { impulseScale = 1, delayScale = 1, ignitionTime = 0 } = {}) {
    this.motor = motor;
    this.curve = curves[motor.curve];
    this.pts = this.curve.points;
    this.impulseScale = impulseScale;
    this.ignitionTime = ignitionTime; // sim time at ignition, null = not lit
    this.burnTime = this.pts[this.pts.length - 1][0];
    this.delay = motor.plugged ? null : motor.delay * delayScale;
    this.totalImpulse = motor.impulse;
    // Cumulative impulse table for mass depletion.
    this.cum = [0];
    for (let i = 1; i < this.pts.length; i++) {
      const [t0, f0] = this.pts[i - 1];
      const [t1, f1] = this.pts[i];
      this.cum.push(this.cum[i - 1] + 0.5 * (f0 + f1) * (t1 - t0));
    }
    this.caseMass = (motor.totalMass - motor.propMass) / 1000; // kg
    this.propMass = motor.propMass / 1000;
    // Delay grain/ejection charge mass is in the case mass; it burns off slowly
    // but that effect is < 1 g and ignored.
  }

  localTime(t) {
    return this.ignitionTime === null ? -1 : t - this.ignitionTime;
  }

  thrust(t) {
    const lt = this.localTime(t);
    if (lt <= 0 || lt >= this.burnTime) return 0;
    const p = this.pts;
    // binary search
    let lo = 0;
    let hi = p.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (p[mid][0] <= lt) lo = mid;
      else hi = mid;
    }
    const [t0, f0] = p[lo];
    const [t1, f1] = p[hi];
    const f = t1 === t0 ? f1 : f0 + ((f1 - f0) * (lt - t0)) / (t1 - t0);
    return f * this.impulseScale;
  }

  impulseDelivered(t) {
    const lt = this.localTime(t);
    if (lt <= 0) return 0;
    if (lt >= this.burnTime) return this.cum[this.cum.length - 1];
    const p = this.pts;
    let i = 1;
    while (i < p.length && p[i][0] < lt) i++;
    const [t0, f0] = p[i - 1];
    const f = this.thrust(t) / this.impulseScale;
    return this.cum[i - 1] + 0.5 * (f0 + f) * (lt - t0);
  }

  mass(t) {
    const frac = this.impulseDelivered(t) / this.cum[this.cum.length - 1];
    return this.caseMass + this.propMass * (1 - frac);
  }

  /** Mass flow rate (kg/s) — used for jet damping. */
  massFlow(t) {
    const f = this.thrust(t) / this.impulseScale;
    return (this.propMass * f) / this.cum[this.cum.length - 1];
  }

  burning(t) {
    const lt = this.localTime(t);
    return lt > 0 && lt < this.burnTime;
  }

  burnoutTime() {
    return this.ignitionTime === null ? null : this.ignitionTime + this.burnTime;
  }

  ejectionTime() {
    if (this.ignitionTime === null || this.delay === null) return null;
    return this.ignitionTime + this.burnTime + this.delay;
  }
}
