// Model-rocket flight simulator.
//
// Rigid-body dynamics in 3-D (translation + pitch/yaw rotation, roll ignored),
// integrated with fixed-step RK4. Forces: motor thrust (real thrust curves with
// propellant depletion), gravity, aerodynamic drag (component build-up drag
// model) and normal force from the Barrowman centre of pressure, aerodynamic
// pitch damping and jet damping. Launch-rod guidance, wind with gusts, staging
// (black-powder burn-through or electronic), delay-timed ejection, parachute /
// streamer descent and separated tumbling boosters are all simulated.
//
// World frame: +x = East, +y = Up, −z = North (matches the three.js scene).

import { Atmosphere } from './atmosphere.js';
import { MotorInstance, getMotor } from './motors.js';
import { aeroForSection, dragGeometry, shellMassProperties } from './geometry.js';

const v3 = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  norm: (a) => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  },
};

export function headingVector(deg) {
  const r = (deg * Math.PI) / 180;
  return [Math.sin(r), 0, -Math.cos(r)];
}

/** Seeded PRNG (mulberry32). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand) {
  const u = Math.max(1e-9, rand());
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ---------------------------------------------------------------------------
// Drag model (component build-up, subsonic/transonic) — see README for refs.
// ---------------------------------------------------------------------------
export function dragCoefficient(dg, refArea, { v, rho, mu, mach, thrusting, exitArea = 0, roughness = 40e-6 }) {
  const L = Math.max(0.05, dg.length);
  const nu = mu / rho;
  const Re = Math.max(1e4, (v * L) / nu);
  let cf;
  if (Re < 5e5) cf = 1.328 / Math.sqrt(Re) + 0.0005; // mostly laminar, tripped by joints
  else cf = 1 / Math.pow(1.5 * Math.log(Re) - 5.6, 2);
  const cfRough = 0.032 * Math.pow(roughness / L, 0.2);
  cf = Math.max(cf, cfRough) * (1 - 0.1 * Math.min(mach, 1) ** 2);
  const fB = Math.max(3, dg.fineness);
  const friction =
    (cf * ((1 + 1 / (2 * fB)) * dg.wetBody + (1 + (2 * dg.finThickness) / Math.max(0.01, dg.finChord)) * dg.wetFins)) / refArea;
  const qBase = 0.12 + 0.13 * mach * mach;
  const baseA = Math.max(0, dg.baseArea - (thrusting ? exitArea : 0));
  const base = (qBase * baseA) / refArea;
  const finTE = (0.5 * qBase * dg.finFrontal) / refArea;
  const misc = 0.03; // launch lug, body joints, surface imperfections
  let cd = (friction + base + finTE + misc) * 1.05;
  return cd * compressibility(mach);
}

export function compressibility(M) {
  if (M < 0.8) return 1 + 0.1 * M * M;
  if (M < 1.1) return 1 + 0.1 * M * M + 3.0 * (M - 0.8) * (M - 0.8);
  return 1.334 + 0.27 - 0.3 * (M - 1.1);
}

// ---------------------------------------------------------------------------
// Configuration helpers
// ---------------------------------------------------------------------------

/** Standard cluster patterns: offsets for n motors of diameter d (metres). */
export function clusterOffsets(n, d, centerMotor = false) {
  if (n <= 1) return [[0, 0]];
  const ring = centerMotor ? n - 1 : n;
  const gap = 0.0015;
  let R;
  if (centerMotor) R = d + gap;
  else if (ring === 2) R = d / 2 + gap / 2;
  else R = (d / 2 + gap / 2) / Math.sin(Math.PI / ring);
  const out = centerMotor ? [[0, 0]] : [];
  for (let i = 0; i < ring; i++) {
    const a = (i / ring) * Math.PI * 2 + Math.PI / ring;
    out.push([R * Math.cos(a), R * Math.sin(a)]);
  }
  return out;
}

/**
 * Build the vehicle description from user settings.
 * settings = {
 *   geom, airframeMass (kg, without motors & recovery), noseWeight (kg),
 *   stages: [{ yBottom, yTop, motors: [{ id, x, z, yAft }] }]  (bottom stage first)
 *   recovery: { type, diameter, streamerWidth, streamerLength, cd, mass },
 *   staging: { method: 'direct' | 'electronic', delay },
 * }
 */
export function buildVehicle(settings) {
  const { geom } = settings;
  const L = geom.length;
  const stages = settings.stages.map((s, k) => {
    const xTop = L - s.yTop;
    const xBottom = L - s.yBottom;
    return { ...s, k, xTop, xBottom };
  });
  // Distribute airframe mass across stages by shell area.
  const areas = stages.map((s) => shellMassProperties(geom, 1, s.xTop, s.xBottom).area);
  const totA = areas.reduce((a, b) => a + b, 0) || 1;
  for (let k = 0; k < stages.length; k++) {
    const s = stages[k];
    const m = settings.airframeMass * (areas[k] / totA);
    const mp = shellMassProperties(geom, m, s.xTop, s.xBottom);
    s.airframe = { m, x: mp.cg, I: mp.inertia };
    s.motorDefs = s.motors.map((mm) => {
      const motor = getMotor(mm.id);
      if (!motor) throw new Error('Unknown motor ' + mm.id);
      const len = motor.length / 1000;
      const yAft = mm.yAft ?? s.yBottom - 0.003;
      return { motor, x: L - (yAft + len / 2), xAft: L - yAft, lat: [mm.x || 0, mm.z || 0], len, r: motor.diameter / 2000 };
    });
    // Aerodynamics of the stack from the nose down to (and including) this stage.
    s.aero = aeroForSection(geom, s.xBottom);
    // caliber for this stack's stability margin: its own widest body (not a fat booster below it)
    let rMax = 0;
    for (let i = 0; i < geom.nSlices; i++) if (geom.xs[i] <= s.xBottom) rMax = Math.max(rMax, geom.rb[i]);
    s.caliber = 2 * (rMax || geom.refRadius);
    s.drag = dragGeometry(geom, s.xBottom);
    s.length = s.xBottom - s.xTop;
  }
  return { geom, stages, settings };
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------
export function simulate(vehicle, launch = {}) {
  const { geom, stages, settings } = vehicle;
  const L = geom.length;
  const env = {
    rodLength: launch.rodLength ?? 0.914,
    rodAngle: ((launch.rodAngle ?? 0) * Math.PI) / 180,
    rodAzimuth: launch.rodAzimuth ?? 0,
    windSpeed: launch.windSpeed ?? 0,
    windFrom: launch.windFrom ?? 270,
    gust: launch.gust ?? 0,
    padHeight: launch.padHeight ?? 0.16,
    variability: !!launch.variability,
    seed: launch.seed ?? 1,
    cdOverride: launch.cdOverride || null,
    maxTime: launch.maxTime ?? 400,
  };
  const atm = new Atmosphere({ siteElevation: launch.siteElevation ?? 0, groundTempC: launch.tempC ?? 15 });
  const rand = rng(env.seed);
  const recovery = settings.recovery || { type: 'parachute', diameter: 0.3048, cd: 0.75, mass: 0.008 };

  // ---- motor instances (with optional real-world scatter) --------------
  const scatter = (sd) => (env.variability ? 1 + sd * gaussian(rand) : 1);
  for (const s of stages) {
    s.instances = s.motorDefs.map((md) => ({
      ...md,
      inst: new MotorInstance(md.motor, {
        impulseScale: scatter(0.035),
        delayScale: md.motor.blackPowder ? scatter(0.1) : scatter(0.05),
        ignitionTime: null,
      }),
    }));
  }
  const bottom = stages[0];
  const clusterSpread = env.variability ? 0.06 : 0;
  for (const mi of bottom.instances) mi.inst.ignitionTime = clusterSpread * rand();

  // ---- wind ------------------------------------------------------------
  const windDir = headingVector(env.windFrom + 180);
  const ph = [rand() * 6.28, rand() * 6.28, rand() * 6.28, rand() * 6.28];
  function wind(h, t) {
    if (env.windSpeed <= 0) return [0, 0, 0];
    const prof = Math.pow(Math.max(h, 0.5) / 10, 1 / 7);
    let w = env.windSpeed * prof;
    let dir = windDir;
    if (env.gust > 0) {
      const g = (0.6 * Math.sin(0.53 * t + ph[0]) + 0.4 * Math.sin(1.37 * t + ph[1]) + 0.25 * Math.sin(3.1 * t + ph[2])) / 1.25;
      w *= 1 + env.gust * g;
      const da = env.gust * 0.25 * Math.sin(0.41 * t + ph[3]);
      dir = [windDir[0] * Math.cos(da) - windDir[2] * Math.sin(da), 0, windDir[0] * Math.sin(da) + windDir[2] * Math.cos(da)];
    }
    return v3.scale(dir, Math.max(0, w));
  }

  // ---- vehicle mass properties (stack = stages lowIdx..top) -----------------
  const top = stages[stages.length - 1];
  const recX = Math.max(geom.noseLength + 0.5 * geom.refDiameter, top.xTop + 0.02);
  const noseW = settings.noseWeight || 0;
  const noseWX = geom.noseLength * 0.55;

  function massProps(lowIdx, t, opts = {}) {
    let m = 0;
    let mx = 0;
    const comps = [];
    for (let k = lowIdx; k < stages.length; k++) {
      const s = stages[k];
      comps.push([s.airframe.m, s.airframe.x, s.airframe.I]);
      for (const mi of s.instances) {
        const mm = mi.inst.mass(t);
        const r2 = mi.lat[0] * mi.lat[0] + mi.lat[1] * mi.lat[1];
        comps.push([mm, mi.x, mm * (mi.len * mi.len / 12 + mi.r * mi.r / 4 + r2 / 2)]);
      }
    }
    if (!opts.noRecovery) comps.push([recovery.mass || 0, recX, 0]);
    if (noseW > 0) comps.push([noseW, noseWX, 0]);
    for (const [cm, cx] of comps) {
      m += cm;
      mx += cm * cx;
    }
    const xcg = mx / m;
    let I = 0;
    for (const [cm, cx, ci] of comps) I += ci + cm * (cx - xcg) * (cx - xcg);
    return { m, xcg, I };
  }

  function propulsion(lowIdx, t) {
    let T = 0;
    let mdot = 0;
    let exitA = 0;
    let xNoz = 0;
    let burning = false;
    for (let k = lowIdx; k < stages.length; k++) {
      for (const mi of stages[k].instances) {
        const f = mi.inst.thrust(t);
        if (f > 0) {
          T += f;
          mdot += mi.inst.massFlow(t);
          xNoz = Math.max(xNoz, mi.xAft);
          exitA += Math.PI * Math.pow(mi.r * 0.45, 2);
          burning = true;
        }
      }
    }
    return { T, mdot, exitA, xNoz, burning };
  }

  // ---- state -------------------------------------------------------------
  const rodDir = v3.norm([
    Math.sin(env.rodAngle) * headingVector(env.rodAzimuth)[0],
    Math.cos(env.rodAngle),
    Math.sin(env.rodAngle) * headingVector(env.rodAzimuth)[2],
  ]);
  let lowIdx = 0; // lowest attached stage
  let mp0 = massProps(0, 0);
  const tailStart = launch.tailStart ? launch.tailStart.slice() : [0, env.padHeight, 0];
  const cgOffset0 = L - mp0.xcg; // tail → cg distance along axis
  let state = {
    p: v3.add(tailStart, v3.scale(rodDir, cgOffset0)),
    v: [0, 0, 0],
    a: rodDir.slice(),
    w: [0, 0, 0],
  };
  let xcgCur = mp0.xcg;
  // Launch lug assumed at the CG: guided until the lug passes the rod tip.
  const lugY = Math.min(L * 0.6, L - mp0.xcg);
  const guided = Math.max(0.15, env.rodLength - 0.04 - lugY);
  let rodTravel = 0;

  let phase = 'pad';
  let t = 0;
  const events = [];
  const samples = [];
  const boosters = [];
  let recoveryDeployT = null;
  let apogee = null;
  let maxV = 0;
  let maxA = 0;
  let maxMach = 0;
  let rodExitV = null;
  let liftoffT = null;
  let ejectionInfo = null;
  let lastAccel = 0;
  let maxQ = 0;
  let landing = null;
  const warnings = [];
  let pendingIgnite = null; // { stageIdx, time }
  let pendingSep = null;
  let recoveryDeployed = false;
  let noseOff = false;

  const event = (type, label, extra = {}) => {
    events.push({ t, type, label, alt: state.p[1] - env.padHeight, v: v3.len(state.v), ...extra });
  };

  // stability report at liftoff
  const stab = (lowI) => {
    const mpS = massProps(lowI, 0);
    const a = stages[lowI].aero;
    return { xcg: mpS.xcg, xcp: a.xcp, margin: (a.xcp - mpS.xcg) / stages[lowI].caliber, cna: a.cna, caliber: stages[lowI].caliber };
  };
  const stability = stages.map((_, k) => stab(k));

  function derivs(s, tt, mode) {
    const mpS = massProps(lowIdx, tt, { noRecovery: false });
    const pr = propulsion(lowIdx, tt);
    const h = s.p[1];
    const air = atm.at(h);
    const g = atm.gravity(h);
    const wv = wind(h, tt);
    const vRel = v3.sub(s.v, wv);
    const V = v3.len(vRel);
    const mach = V / air.a;
    const st = stages[lowIdx];
    const Aref = geom.refArea;
    let cd = env.cdOverride
      ? env.cdOverride * compressibility(mach)
      : dragCoefficient(st.drag, Aref, { v: V, rho: air.rho, mu: air.mu, mach, thrusting: pr.burning, exitArea: pr.exitA });
    const q = 0.5 * air.rho * V * V;
    let F = [0, -g * mpS.m, 0];
    F = v3.add(F, v3.scale(s.a, pr.T));
    let torque = [0, 0, 0];
    let alpha = 0;
    if (V > 0.01) {
      const vh = v3.scale(vRel, 1 / V);
      const ca = Math.max(-1, Math.min(1, v3.dot(vh, s.a)));
      alpha = Math.acos(ca);
      // side area for crossflow drag
      const sideA = geom.refDiameter * st.length;
      const sa = Math.sin(alpha);
      const cdEff = cd * Math.abs(ca) + 1.2 * (sideA / Aref) * sa * sa * 0.5;
      F = v3.add(F, v3.scale(vh, -q * Aref * cdEff));
      if (mode === 'free') {
        // normal force
        const perp = v3.sub(vh, v3.scale(s.a, ca));
        const pl = v3.len(perp);
        if (pl > 1e-9) {
          const n = v3.scale(perp, 1 / pl);
          const N = q * Aref * st.aero.cna * sa;
          F = v3.add(F, v3.scale(n, -N));
          torque = v3.add(torque, v3.scale(v3.cross(s.a, n), N * (st.aero.xcp - mpS.xcg)));
        }
      }
    }
    if (mode === 'free') {
      // pitch damping (aerodynamic + jet)
      let c2 = 0;
      for (const part of st.aero.parts) c2 += part.cna * (part.x - mpS.xcg) * (part.x - mpS.xcg);
      c2 = 0.5 * air.rho * V * Aref * c2;
      c2 += pr.mdot * (pr.xNoz - mpS.xcg) * (pr.xNoz - mpS.xcg);
      const wPerp = v3.sub(s.w, v3.scale(s.a, v3.dot(s.w, s.a)));
      torque = v3.add(torque, v3.scale(wPerp, -c2));
    }
    const acc = v3.scale(F, 1 / mpS.m);
    let dw = mode === 'free' ? v3.scale(torque, 1 / Math.max(1e-7, mpS.I)) : [0, 0, 0];
    const da = mode === 'free' ? v3.cross(s.w, s.a) : [0, 0, 0];
    return { dp: s.v, dv: acc, da, dw, info: { mp: mpS, pr, cd, mach, alpha, air, q, acc } };
  }

  function rk4(s, tt, h, mode) {
    const k1 = derivs(s, tt, mode);
    const s2 = addState(s, k1, h / 2);
    const k2 = derivs(s2, tt + h / 2, mode);
    const s3 = addState(s, k2, h / 2);
    const k3 = derivs(s3, tt + h / 2, mode);
    const s4 = addState(s, k3, h);
    const k4 = derivs(s4, tt + h, mode);
    const comb = (key, f) => s[key].map((x, i) => x + (h / 6) * (k1[f][i] + 2 * k2[f][i] + 2 * k3[f][i] + k4[f][i]));
    return { s: { p: comb('p', 'dp'), v: comb('v', 'dv'), a: v3.norm(comb('a', 'da')), w: comb('w', 'dw') }, info: k1.info };
  }
  function addState(s, k, h) {
    return {
      p: s.p.map((x, i) => x + k.dp[i] * h),
      v: s.v.map((x, i) => x + k.dv[i] * h),
      a: v3.norm(s.a.map((x, i) => x + k.da[i] * h)),
      w: s.w.map((x, i) => x + k.dw[i] * h),
    };
  }

  // Recovery: simple point mass with drag from the deployed device.
  function recoveryCdA(tt) {
    const sinceDeploy = tt - recoveryDeployT;
    const infl = Math.min(1, Math.max(0, sinceDeploy / (recovery.type === 'parachute' ? 0.45 : 0.25)));
    let area = 0;
    if (recovery.type === 'parachute') area = recovery.cd * Math.PI * Math.pow(recovery.diameter / 2, 2);
    else if (recovery.type === 'streamer') area = recovery.cd * recovery.streamerWidth * recovery.streamerLength;
    // 'tumble' (featherweight): the ejection charge pushes the motor back and the rocket tumbles; body drag only
    // the rocket body hangs sideways and adds drag too
    const body = 0.6 * geom.refDiameter * stages[stages.length - 1].length + 0.2 * geom.refArea;
    return area * infl * infl + body;
  }

  event('ignition', 'Motor ignition' + (stages[0].instances.length > 1 ? 's' : ''));
  const sample = (info) => {
    const alt = state.p[1] - env.padHeight;
    samples.push({
      t,
      p: state.p.slice(),
      v: state.v.slice(),
      a: state.a.slice(),
      alt,
      speed: v3.len(state.v),
      vy: state.v[1],
      acc: info ? v3.len(v3.sub(info.acc, [0, -atm.gravity(alt), 0])) : 0,
      accY: info ? info.acc[1] : 0,
      thrust: info ? info.pr.T : 0,
      mass: info ? info.mp.m : 0,
      cd: info ? info.cd : 0,
      mach: info ? info.mach : 0,
      alpha: info ? (info.alpha * 180) / Math.PI : 0,
      xcg: info ? info.mp.xcg : 0,
      phase,
      lowIdx,
      noseOff,
      recovery: recoveryDeployed ? Math.min(1, (t - recoveryDeployT) / 0.45) : 0,
    });
  };

  let lastSampleT = -1;
  const SAMPLE_DT = 1 / 60;
  let landed = false;

  while (t < env.maxTime && !landed) {
    // ---- scheduled events ----------------------------------------------
    if (pendingSep && t >= pendingSep.time) {
      separateStage();
      pendingSep = null;
    }
    if (pendingIgnite && t >= pendingIgnite.time) {
      const sIdx = pendingIgnite.stageIdx;
      for (const mi of stages[sIdx].instances) mi.inst.ignitionTime = t;
      event('stage-ignition', `Stage ${sIdx + 1} ignition`);
      pendingIgnite = null;
    }
    // ejection / staging triggers
    for (let k = lowIdx; k < stages.length; k++) {
      for (const mi of stages[k].instances) {
        const et = mi.inst.ejectionTime();
        const bo = mi.inst.burnoutTime();
        if (bo !== null && !mi.boLogged && t >= bo) {
          mi.boLogged = true;
          if (k === lowIdx && stages[k].instances.indexOf(mi) === 0) event('burnout', `Stage ${k + 1} burnout`);
        }
        if (et !== null && !mi.ejLogged && t >= et) {
          mi.ejLogged = true;
          if (k < stages.length - 1 && k === lowIdx) {
            // booster ejection charge fires forward into the upper stage nozzle
            if (settings.staging?.method !== 'electronic' && !pendingIgnite && stages[k + 1].instances[0]?.inst.ignitionTime === null) {
              if (mi.motor.blackPowder && mi.inst.delay < 0.5) {
                pendingIgnite = { stageIdx: k + 1, time: t + 0.03 };
                pendingSep = { time: t + 0.06 };
              } else {
                pendingSep = { time: t };
                event('staging-fail', `Stage ${k + 2} did not light (booster ejection doesn't ignite it)`);
                warnings.push(
                  mi.motor.blackPowder
                    ? `Booster motor ${mi.motor.designation} has a ${mi.motor.delay}s delay: staging happens late. Use a -0 booster motor.`
                    : `Composite motor ${mi.motor.designation} can't direct-stage. Use a black-powder -0 booster or electronic staging.`
                );
              }
            }
          } else if (k === stages.length - 1 && !recoveryDeployed && stages[k].instances.indexOf(mi) === 0) {
            ejection();
          }
        }
      }
    }
    // electronic staging
    if (settings.staging?.method === 'electronic' && lowIdx < stages.length - 1 && !pendingIgnite) {
      const bo = Math.max(...stages[lowIdx].instances.map((mi) => mi.inst.burnoutTime() ?? Infinity));
      const up = stages[lowIdx + 1];
      if (up.instances[0].inst.ignitionTime === null && t >= bo + (settings.staging.delay || 0)) {
        pendingIgnite = { stageIdx: lowIdx + 1, time: t };
        pendingSep = { time: t + 0.02 };
      }
    }

    // ---- integrate -------------------------------------------------------------
    let h;
    let info;
    if (phase === 'pad' || phase === 'rod') {
      h = 0.0005;
      const d = derivs(state, t, 'rod');
      const along = v3.dot(d.dv, rodDir);
      if (phase === 'pad') {
        if (along > 0) {
          phase = 'rod';
          liftoffT = t;
          event('liftoff', 'Liftoff');
        } else {
          t += h;
          if (t > 3 && !propulsion(0, t).burning) {
            event('no-liftoff', 'Motor too weak to lift the rocket');
            warnings.push('The thrust never exceeded the weight. Use a more powerful motor or lighten the rocket.');
            break;
          }
          if (t - lastSampleT >= SAMPLE_DT) {
            sample(d.info);
            lastSampleT = t;
          }
          continue;
        }
      }
      // 1-D motion along the rod
      const speed = v3.dot(state.v, rodDir);
      const acc = Math.max(along, speed > 0 ? along : 0);
      const ns = speed + acc * h;
      const travel = (speed + ns) * 0.5 * h;
      rodTravel += travel;
      state.p = v3.add(state.p, v3.scale(rodDir, travel));
      state.v = v3.scale(rodDir, Math.max(0, ns));
      info = d.info;
      t += h;
      if (rodTravel >= guided) {
        phase = 'flight';
        rodExitV = v3.len(state.v);
        event('rod-clear', 'Cleared launch rod', { v: rodExitV });
      }
    } else if (phase === 'flight') {
      h = propulsion(lowIdx, t).burning ? 0.001 : 0.002;
      const r = rk4(state, t, h, 'free');
      state = r.s;
      info = r.info;
      t += h;
    } else if (phase === 'recovery') {
      h = 0.005;
      const g = atm.gravity(state.p[1]);
      const air = atm.at(state.p[1]);
      const m = massProps(lowIdx, t).m;
      const step = (v) => {
        const vr = v3.sub(v, wind(state.p[1], t));
        const V = v3.len(vr);
        const D = 0.5 * air.rho * V * V * recoveryCdA(t);
        return v3.add([0, -g, 0], V > 1e-6 ? v3.scale(vr, -D / (m * V)) : [0, 0, 0]);
      };
      const a1 = step(state.v);
      const v2 = v3.add(state.v, v3.scale(a1, h));
      const a2 = step(v2);
      const acc = v3.scale(v3.add(a1, a2), 0.5);
      state.p = v3.add(state.p, v3.scale(v3.add(state.v, v2), h / 2));
      state.v = v3.add(state.v, v3.scale(acc, h));
      // body orientation: swing toward horizontal while hanging
      const target = v3.norm([state.v[0] * 0.05 + 1, 0.15, state.v[2] * 0.05]);
      state.a = v3.norm(v3.add(v3.scale(state.a, 1 - 2 * h), v3.scale(target, 2 * h)));
      info = { mp: { m, xcg: xcgCur }, pr: propulsion(lowIdx, t), cd: 0, mach: 0, alpha: 0, acc };
      t += h;
    }

    // ---- bookkeeping ------------------------------------------------------------
    if (info) {
      xcgCur = info.mp.xcg;
      const spd = v3.len(state.v);
      if (phase !== 'recovery') {
        maxV = Math.max(maxV, spd);
        maxMach = Math.max(maxMach, info.mach);
        maxQ = Math.max(maxQ, info.q || 0);
      }
      const accMag = v3.len(v3.sub(info.acc, [0, -atm.gravity(state.p[1]), 0]));
      if (phase !== 'recovery' && t - (recoveryDeployT ?? -1) > 0.6) maxA = Math.max(maxA, accMag);
      lastAccel = accMag;
    }
    const alt = state.p[1] - env.padHeight;
    if (!apogee && liftoffT !== null && phase !== 'rod' && state.v[1] <= 0 && t > liftoffT + 0.2) {
      apogee = { t, alt, p: state.p.slice() };
      event('apogee', 'Apogee');
    }
    if (t - lastSampleT >= SAMPLE_DT) {
      sample(info);
      lastSampleT = t;
    }
    if (liftoffT !== null && phase !== 'rod' && state.p[1] <= 0 && state.v[1] < 0) {
      landed = true;
      state.p[1] = 0;
      landing = { t, v: v3.len(state.v), p: state.p.slice() };
      event('landing', recoveryDeployed ? 'Touchdown' : 'Impact (no recovery)');
      sample(info);
    }
  }

  function separateStage() {
    const old = massProps(lowIdx, t);
    const sep = stages[lowIdx];
    // booster leaves with its own mass
    const bMass = sep.airframe.m + sep.instances.reduce((acc, mi) => acc + mi.inst.mass(t), 0);
    boosters.push(simulateBooster(sep, bMass, state, t));
    lowIdx++;
    const nw = massProps(lowIdx, t);
    // shift the reference point to the new CG (forward along the axis)
    state.p = v3.add(state.p, v3.scale(state.a, old.xcg - nw.xcg));
    event('separation', `Stage ${lowIdx} separation`);
  }

  function simulateBooster(stage, mass, st, t0) {
    const traj = [];
    let p = st.p.slice();
    let v = st.v.slice();
    let tt = t0;
    const sideCdA = 0.7 * geom.refDiameter * stage.length + 0.5 * stage.drag.wetFins * 0.25;
    const spin = 2 + rand() * 6;
    while (tt < t0 + env.maxTime && p[1] > 0) {
      const h = 0.01;
      const air = atm.at(p[1]);
      const vr = v3.sub(v, wind(p[1], tt));
      const V = v3.len(vr);
      const D = 0.5 * air.rho * V * V * sideCdA;
      const acc = v3.add([0, -atm.gravity(p[1]), 0], V > 1e-6 ? v3.scale(vr, -D / (mass * V)) : [0, 0, 0]);
      v = v3.add(v, v3.scale(acc, h));
      p = v3.add(p, v3.scale(v, h));
      tt += h;
      if (traj.length === 0 || tt - traj[traj.length - 1].t >= SAMPLE_DT) traj.push({ t: tt, p: p.slice() });
    }
    p[1] = Math.max(0, p[1]);
    traj.push({ t: tt, p: p.slice() });
    return {
      stageIdx: stage.k,
      yBottom: stage.yBottom,
      yTop: stage.yTop,
      axis0: st.a.slice(),
      spin,
      traj,
      landing: { t: tt, p, v: v3.len(v) },
      cgFromTail: L - (shellMassProperties(geom, 1, stage.xTop, stage.xBottom).cg),
    };
  }

  function ejection() {
    const spd = v3.len(state.v);
    const alt = state.p[1] - env.padHeight;
    ejectionInfo = { t, v: spd, alt, beforeApogee: !apogee, apogeeT: apogee?.t ?? null };
    event('ejection', 'Ejection charge');
    if (recovery.type === 'none' || state.p[1] <= 0) return;
    recoveryDeployed = true;
    recoveryDeployT = t;
    noseOff = true;
    phase = 'recovery';
    state.w = [0, 0, 0];
    event('deploy', recovery.type === 'parachute' ? 'Parachute deployed' : recovery.type === 'tumble' ? 'Tumbling (featherweight recovery)' : 'Streamer deployed');
  }

  // ---- summary -------------------------------------------------------------
  const maxAlt = apogee ? apogee.alt : Math.max(0, ...samples.map((s) => s.alt));
  const top0 = stages[stages.length - 1].instances[0];
  const topBurnout = top0?.inst.burnoutTime();
  const idealDelay = apogee && topBurnout != null ? apogee.t - topBurnout : null;
  const margin = stability[0].margin;
  if (margin < 1) warnings.push(`Stability margin is only ${margin.toFixed(2)} calibers (want ≥ 1). Add nose weight or bigger fins.`);
  if (margin > 3.5) warnings.push(`Stability margin ${margin.toFixed(1)} cal is high — expect strong weathercocking into the wind.`);
  if (stages.length > 1) {
    const ms = stability[stages.length - 1].margin;
    if (ms < 1) warnings.push(`Upper stage alone has only ${ms.toFixed(2)} cal stability after separation.`);
  }
  if (rodExitV !== null && rodExitV < 12) warnings.push(`Rod exit speed is ${rodExitV.toFixed(1)} m/s (want ≥ 12–15 m/s). Use a longer rod or a higher-thrust motor.`);
  if (ejectionInfo) {
    if (ejectionInfo.v > 25)
      warnings.push(`Ejection at ${ejectionInfo.v.toFixed(0)} m/s — ${ejectionInfo.beforeApogee ? 'too early' : 'too late'}; risk of a zippered body tube or stripped parachute.`);
    if (idealDelay !== null && top0) {
      if (Math.abs(idealDelay - top0.motor.delay) > 1.5) {
        warnings.push(`Ideal delay ≈ ${idealDelay.toFixed(1)} s (you used ${top0.motor.delay} s) — pick the delay variant closest to it.`);
      }
    }
  } else if (top0 && top0.motor.plugged) {
    warnings.push('Plugged motor: there is no ejection charge, so the recovery system never deploys.');
  }
  const hardLanding = recovery.type === 'streamer' || recovery.type === 'tumble' ? 9 : 7;
  if (landing && landing.v > hardLanding && recoveryDeployed)
    warnings.push(`Landing at ${landing.v.toFixed(1)} m/s is hard — use a bigger ${recovery.type === 'streamer' ? 'streamer or a parachute' : 'parachute'}.`);

  return {
    samples,
    events,
    boosters,
    stability,
    warnings,
    summary: {
      apogee: maxAlt,
      apogeeTime: apogee?.t ?? null,
      maxSpeed: maxV,
      maxMach,
      maxAccel: maxA,
      maxQ,
      rodExitSpeed: rodExitV,
      liftoffTime: liftoffT,
      ejection: ejectionInfo,
      idealDelay,
      landing,
      flightTime: landing ? landing.t - (liftoffT || 0) : t,
      drift: landing ? Math.hypot(landing.p[0], landing.p[2]) : null,
      descentRate: computeDescentRate(samples),
      liftoffMass: mp0.m,
      cdAtLiftoff: samples.find((s) => s.speed > 10)?.cd ?? null,
    },
    env,
    vehicle,
  };
}

function computeDescentRate(samples) {
  const rec = samples.filter((s) => s.phase === 'recovery' && s.recovery >= 1);
  if (rec.length < 10) return null;
  const tail = rec.slice(Math.floor(rec.length * 0.5));
  return -tail.reduce((a, s) => a + s.vy, 0) / tail.length;
}
