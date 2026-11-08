import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import './style.css';
import { World } from './scene/world.js';
import { LaunchPad, ROD_SPECS } from './scene/launchPad.js';
import { LaunchController, LaunchLead } from './scene/controller.js';
import { RocketModel, propellantLook } from './scene/rocketModel.js';
import { Effects } from './scene/effects.js';
import { Sound } from './audio.js';
import { Panel } from './ui/panel.js';
import { LineChart } from './ui/charts.js';
import { EXAMPLES } from './data/examples.js';
import { analyzeRocket, estimateAirframeMass, suggestSeparation, detectMotorMounts } from './physics/geometry.js';
import { detectParts, assembleParts, defaultOrder } from './physics/assembly.js';
import { buildVehicle, simulate, clusterOffsets, headingVector } from './physics/simulator.js';
import { getMotor, allMotors } from './physics/motors.js';

const $ = (s) => document.querySelector(s);
const UNIT_SCALE = { mm: 0.001, cm: 0.01, m: 1, in: 0.0254 };
const CONTROLLER_POS = new THREE.Vector3(-2.7, 0.018, 3.65); // ≈ 15 ft from the pad

const SEQ_STEPS = [
  { id: 'load', label: 'Load the rocket onto the launch rod' },
  { id: 'cap', label: 'Remove the rod safety cap' },
  { id: 'clips', label: 'Attach the micro-clips to the igniter' },
  { id: 'walk', label: 'Walk back to the controller (15 ft)' },
  { id: 'key', label: 'Insert the safety key — continuity light on' },
  { id: 'range', label: 'Call “Range is clear, sky is clear!”' },
  { id: 'countdown', label: 'Countdown 5…4…3…2…1' },
  { id: 'fire', label: 'Press and hold LAUNCH' },
  { id: 'flight', label: 'Flight!' },
  { id: 'safe', label: 'Remove the safety key' },
  { id: 'recover', label: 'Recover the rocket' },
];

class App {
  constructor() {
    this.world = new World($('#viewport'));
    this.scene = this.world.scene;
    this.pad = new LaunchPad();
    this.scene.add(this.pad.group);
    this.controller = new LaunchController();
    this.controller.group.position.copy(CONTROLLER_POS);
    const toPad = new THREE.Vector3().subVectors(new THREE.Vector3(0, 0, 0), CONTROLLER_POS).setY(0).normalize();
    this.toPad = toPad;
    this.controller.group.rotation.y = Math.atan2(toPad.x, toPad.z);
    this.scene.add(this.controller.group);
    this.lead = new LaunchLead(this.scene);
    this.effects = new Effects(this.scene);
    this.sound = new Sound();
    this.trail = this.makeTrail();

    this.state = {
      exampleId: null,
      stlName: '',
      units: 'mm',
      axis: 'auto',
      flip: false,
      color: '#f2f2f2',
      noseColor: '#f2f2f2',
      massAuto: true,
      massG: 40,
      noseWeightG: 0,
      cdOverride: null,
      partOrder: [],
      assembleDisabled: false,
      stages: [{ motorId: 'Estes-C6-5', count: 1 }],
      stations: [],
      staging: { method: 'direct', delay: 0 },
      recovery: { type: 'parachute', diameterIn: 12, cd: 0.75, streamerWidth: 50, streamerLength: 750, massG: 8, color: '#ff5a1f' },
      launch: { rod: '1/8x36', angle: 0, azimuth: 0, windSpeed: 2, windFrom: 270, gust: 0.2, tempC: 18, elevation: 200, variability: false },
    };
    this.view = 'pad';
    this.seq = 'load';
    this.speed = 1;
    this.flight = null;
    this.playT = 0;
    this.clock = new THREE.Clock();
    this.time = 0;

    this.panel = new Panel(this);
    this.hudChart = new LineChart($('#hudChart'), { yLabel: 'Alt (m)' });
    this.resChart = new LineChart($('#resChart'));
    this.bindUI();
    this.renderSequence();
    this.loadExample('sparrow');
    this.loop();
  }

  // ===================================================================== UI wiring
  bindUI() {
    document.querySelectorAll('#viewButtons button').forEach((b) => b.addEventListener('click', () => this.setView(b.dataset.view)));
    $('#xray').addEventListener('change', (e) => this.model?.setXray(e.target.checked));
    $('#sound').addEventListener('change', (e) => this.sound.setEnabled(e.target.checked));
    document.querySelectorAll('.hud-controls [data-speed]').forEach((b) =>
      b.addEventListener('click', () => {
        this.speed = +b.dataset.speed;
        document.querySelectorAll('.hud-controls [data-speed]').forEach((x) => x.classList.toggle('active', x === b));
      })
    );
    $('#skipEnd').addEventListener('click', () => {
      if (this.flight) this.playT = this.flight.endT - 0.05;
    });
    $('#replay').addEventListener('click', () => this.replay());
    $('#closeResults').addEventListener('click', () => $('#results').classList.add('hidden'));
    document.querySelectorAll('#resTabs button').forEach((b) =>
      b.addEventListener('click', () => {
        document.querySelectorAll('#resTabs button').forEach((x) => x.classList.toggle('active', x === b));
        this.drawResultChart(b.dataset.chart);
      })
    );

    // 3-D picking (click parts of the pad / controller)
    const el = this.world.renderer.domElement;
    let downAt = null;
    el.addEventListener('pointerdown', (e) => {
      downAt = [e.clientX, e.clientY];
      const hit = this.world.pick(e.clientX, e.clientY);
      if (hit && hit.obj.userData.onPick) {
        const r = hit.obj.userData.onPick('down', e);
        if (r === 'hold') {
          this.world.controls.enabled = false;
          el.setPointerCapture(e.pointerId);
        }
      }
    });
    el.addEventListener('pointerup', (e) => {
      if (this.holding) this.releaseLaunch();
      this.world.controls.enabled = this.view === 'pad' || this.view === 'free';
      if (downAt && Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) < 5) {
        const hit = this.world.pick(e.clientX, e.clientY);
        if (hit && hit.obj.userData.onPick) hit.obj.userData.onPick('click', e);
      }
      downAt = null;
    });
    el.addEventListener('pointermove', (e) => {
      const hit = this.world.pick(e.clientX, e.clientY);
      el.style.cursor = hit ? 'pointer' : '';
    });
    this.world.addPickable(this.pad.cap, (ev) => ev === 'click' && this.seq === 'cap' && this.doStep('cap'));
    for (const c of this.lead.clips) this.world.addPickable(c, (ev) => ev === 'click' && this.seq === 'clips' && this.doStep('clips'));
    this.world.addPickable(this.controller.key, (ev) => {
      if (ev !== 'click') return;
      if (this.seq === 'key') this.doStep('key');
      else if (this.seq === 'safe') this.doStep('safe');
    });
    this.world.addPickable(this.controller.button, (ev) => {
      if (ev === 'down' && this.seq === 'fire') {
        this.pressLaunch();
        return 'hold';
      }
    });
    this.world.addPickable(this.controller.body, (ev) => ev === 'click' && this.seq === 'walk' && this.doStep('walk'));

    // drag & drop
    const hint = $('#dropHint');
    window.addEventListener('dragover', (e) => {
      e.preventDefault();
      hint.classList.remove('hidden');
    });
    window.addEventListener('dragleave', (e) => {
      if (e.target === document.documentElement || e.clientX <= 0 || e.clientY <= 0) hint.classList.add('hidden');
    });
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      hint.classList.add('hidden');
      const f = e.dataTransfer.files[0];
      if (!f) return;
      if (/\.eng$/i.test(f.name)) this.panel.importEng(f);
      else this.loadFile(f);
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && this.seq === 'fire' && !this.holding && e.target.tagName !== 'INPUT') {
        e.preventDefault();
        this.pressLaunch();
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space' && this.holding) this.releaseLaunch();
    });
  }

  toast(msg, ms = 3500) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => t.classList.add('hidden'), ms);
  }

  // ===================================================================== loading
  async loadExample(id) {
    const ex = EXAMPLES.find((e) => e.id === id);
    if (!ex) return;
    const res = await fetch(ex.file);
    const buf = await res.arrayBuffer();
    const st = this.state;
    st.exampleId = id;
    st.color = ex.color;
    st.noseColor = ex.noseColor || ex.color;
    st.units = 'mm';
    st.axis = 'auto';
    st.flip = false;
    st.massAuto = true;
    st.noseWeightG = 0;
    st.cdOverride = null;
    st.assembleDisabled = false;
    st.partOrder = [];
    st.stages = ex.stages.map((s) => ({ motorId: s.motorId, count: 1 }));
    st.presetStations = ex.stations || null;
    st.staging = { method: 'direct', delay: 0 };
    st.recovery = { ...st.recovery, ...ex.recovery };
    st.launch.rod = ex.rod;
    this.ingest(buf, ex.file.split('/').pop(), true);
  }

  async loadFile(file) {
    const buf = await file.arrayBuffer();
    const st = this.state;
    st.exampleId = null;
    st.flip = false;
    st.axis = 'auto';
    st.massAuto = true;
    st.partOrder = [];
    st.assembleDisabled = false;
    st.presetStations = null;
    st.stages = null; // choose for the user after analysis
    this.ingest(buf, file.name, false);
  }

  ingest(buf, name, isExample) {
    $('#loading').classList.remove('hidden');
    setTimeout(() => {
      try {
        const geo = new STLLoader().parse(buf);
        this.raw = geo.attributes.position.array;
        this.state.stlName = name;
        if (!isExample) this.state.units = guessUnits(this.raw);
        this.processGeometry(true);
        this.toast(`Loaded ${name}${this.detected ? ` — ${this.detected.parts.length} separate parts stacked into a ${this.state.stages.length}-stage rocket` : ''}`);
      } catch (err) {
        console.error(err);
        this.toast('Could not load STL: ' + err.message, 6000);
      } finally {
        $('#loading').classList.add('hidden');
      }
    }, 20);
  }

  setGeometryOption(opts) {
    Object.assign(this.state, opts);
    if ('units' in opts || 'axis' in opts || 'assembleDisabled' in opts) this.state.partOrder = [];
    this.processGeometry(false);
  }

  processGeometry(fresh) {
    const st = this.state;
    const unitScale = UNIT_SCALE[st.units];
    const noseAt = st.flip ? 'min' : 'auto';
    this.detected = null;
    let source;
    let geom;
    if (!st.assembleDisabled) this.detected = detectParts(this.raw, { unitScale, axis: st.axis });
    if (this.detected) {
      if (!st.partOrder.length || st.partOrder.length !== this.detected.parts.length) st.partOrder = defaultOrder(this.detected.parts);
      const asm = assembleParts(this.detected, st.partOrder);
      this.assembly = asm;
      geom = analyzeRocket(asm.positions, { unitScale: 1, axis: 'y', noseAt: 'max' });
      source = { placed: asm.placed };
    } else {
      this.assembly = null;
      geom = analyzeRocket(this.raw, { unitScale, axis: st.axis, noseAt: noseAt === 'auto' ? 'auto' : noseAt });
      if (st.flip) {
        // "flip" means: use the opposite of what auto-detection chose
        const auto = analyzeRocket(this.raw, { unitScale, axis: st.axis, noseAt: 'auto', slices: 60 });
        geom = analyzeRocket(this.raw, { unitScale, axis: st.axis, noseAt: auto.noseAtMax ? 'min' : 'max' });
      }
      source = { positions: this.raw };
    }
    this.geom = geom;
    this._mountCache = null;
    this.estimatedMass = estimateAirframeMass(geom);
    if (!st.massAuto && fresh) st.massAuto = true;

    // ---- stages & stations ----
    if (this.assembly) {
      st.stations = this.assembly.stations.slice();
      const n = st.stations.length + 1;
      if (!st.stages || st.stages.length !== n) st.stages = this.defaultStages(n);
    } else {
      if (st.presetStations) st.stations = st.presetStations.slice();
      else if (!st.stages || fresh) {
        const sep = suggestSeparation(geom);
        st.stations = sep ? [sep] : [];
      }
      const n = st.stations.length + 1;
      if (!st.stages || st.stages.length !== n) st.stages = this.defaultStages(n);
    }
    // ---- 3-D model ----
    if (this.model) this.model.dispose();
    this.model = new RocketModel(this.scene, geom, source, { color: st.color });
    this.model.noseMaterial.color.set(st.noseColor);
    this.configChanged(true);
    this.resetToLoad();
    this.panel.render();
  }

  defaultStages(n) {
    const mountDia = (k) => this.mountDiameterForStage(k);
    const pick = (dia, usage) => {
      const prefs = {
        13: { single: 'Estes-A10-3T', booster: 'Estes-A10-0T', upper: 'Estes-A10-3T' },
        18: { single: 'Estes-C6-5', booster: 'Estes-C6-0', upper: 'Estes-C6-7' },
        24: { single: 'Estes-D12-5', booster: 'Estes-D12-0', upper: 'Estes-D12-7' },
        29: { single: 'Estes-F15-6', booster: 'Estes-F15-0', upper: 'Estes-F15-8' },
      };
      const d = [13, 18, 24, 29].reduce((a, b) => (Math.abs(b - dia) < Math.abs(a - dia) ? b : a));
      return prefs[d][usage];
    };
    const stages = [];
    for (let k = 0; k < n; k++) {
      const usage = n === 1 ? 'single' : k < n - 1 ? 'booster' : 'upper';
      stages.push({ motorId: pick(mountDia(k) || 18, usage), count: 1 });
    }
    return stages;
  }

  stageBottom(k) {
    return k === 0 ? this.geom.bodyAftY : this.state.stations[k - 1];
  }

  mountsForStage(k) {
    const g = this.geom;
    if (!g) return [];
    this._mountCache = this._mountCache || new Map();
    const key = `${g.length}|${k}|${this.stageBottom(k)}`;
    if (!this._mountCache.has(key)) this._mountCache.set(key, k === 0 ? g.motorMounts : detectMotorMounts(g, this.stageBottom(k)));
    return this._mountCache.get(key);
  }

  mountDiameterForStage(k) {
    const m = this.mountsForStage(k);
    if (m.length) return m[0].motorDiameter;
    // fall back to the body size
    const d = this.geom.refDiameter * 1000;
    return d < 16 ? 13 : d < 23 ? 18 : d < 30 ? 24 : 29;
  }

  /** Motor positions for every stage (rocket frame), placed automatically. */
  motorLayout() {
    const st = this.state;
    const g = this.geom;
    if (!g || !st.stages) return [];
    const L = g.length;
    return st.stages.map((sg, k) => {
      const motor = getMotor(sg.motorId) || allMotors()[0];
      const bottom = this.stageBottom(k);
      let overhang = (sg.overhangMM ?? (k === 0 ? 4 : 8)) / 1000;
      let yAft = bottom - overhang;
      // separated parts: the lower stage's coupler stub fills the bottom of this stage
      if (k > 0 && this.assembly) {
        const lower = this.assembly.placed.filter((p) => p.stage === k - 1 && p.part.hasFins).pop();
        if (lower) yAft = bottom + lower.part.topStub + 0.001 - (sg.overhangMM != null ? sg.overhangMM / 1000 : 0);
      }
      const d = motor.diameter / 1000;
      const mounts = this.mountsForStage(k);
      let lats;
      if (mounts.length === sg.count && sg.count > 1) lats = mounts.map((m) => [m.x, m.z]);
      else lats = clusterOffsets(sg.count, d, sg.center);
      const yTop = k === st.stages.length - 1 ? L : st.stations[k];
      return {
        k,
        yBottom: k === 0 ? 0 : st.stations[k - 1],
        yTop,
        mountDiameter: this.mountDiameterForStage(k),
        auto: true,
        motors: lats.map((lat) => ({ id: motor.id, motor, x: lat[0], z: lat[1], lat, yAft, len: motor.length / 1000 })),
      };
    });
  }

  setStageCount(n) {
    const st = this.state;
    if (this.assembly) {
      this.toast('Stage count comes from the separate parts in your file.');
      this.panel.render();
      return;
    }
    const L = this.geom.length;
    const sep = suggestSeparation(this.geom);
    st.stations = [];
    if (n >= 2) st.stations.push(sep ?? Math.min(0.09, L * 0.25));
    if (n >= 3) st.stations.push(Math.min(L * 0.6, st.stations[0] + Math.max(0.08, L * 0.2)));
    st.presetStations = null;
    st.stages = this.defaultStages(n).map((d, i) => (st.stages[i] && n === st.stages.length ? st.stages[i] : d));
    this.configChanged(true);
    this.panel.render();
  }

  setColor(body, nose) {
    if (body) {
      this.state.color = body;
      this.model?.setColor(body);
    }
    if (nose) {
      this.state.noseColor = nose;
      this.model?.noseMaterial.color.set(nose);
      this.model?.sections.forEach((s) => s.clips.forEach((c) => c.parent === s.noseGroup && c.mesh.material.color.set(nose)));
    }
  }

  recoverySettings() {
    const r = this.state.recovery;
    return {
      type: r.type,
      diameter: r.diameterIn * 0.0254,
      cd: r.cd,
      streamerWidth: r.streamerWidth / 1000,
      streamerLength: r.streamerLength / 1000,
      mass: r.type === 'none' ? 0 : r.massG / 1000,
      color: r.color,
    };
  }

  buildVehicle() {
    const st = this.state;
    const layout = this.motorLayout();
    return buildVehicle({
      geom: this.geom,
      airframeMass: (st.massAuto ? this.estimatedMass * 1000 : st.massG) / 1000,
      noseWeight: st.noseWeightG / 1000,
      stages: layout.map((s) => ({ yBottom: s.yBottom, yTop: s.yTop, motors: s.motors.map((m) => ({ id: m.id, x: m.x, z: m.z, yAft: m.yAft })) })),
      recovery: this.recoverySettings(),
      staging: st.staging,
    });
  }

  /** Rocket tail position on the pad: the motor nozzle rests on the deflector. */
  tailOnPad() {
    const layout = this.motorLayout();
    const minAft = Math.min(0, ...(layout[0]?.motors.map((m) => m.yAft) || [0]));
    return this.pad.rocketTail(this.geom.refRadius, -minAft + 0.003);
  }

  launchParams(seed) {
    const L = this.state.launch;
    const tail = this.tailOnPad();
    return {
      rodLength: ROD_SPECS[L.rod].len,
      rodAngle: L.angle,
      rodAzimuth: L.azimuth,
      windSpeed: L.windSpeed,
      windFrom: L.windFrom,
      gust: L.gust,
      tempC: L.tempC,
      siteElevation: L.elevation,
      variability: L.variability,
      seed,
      cdOverride: this.state.cdOverride,
      tailStart: [tail.x, tail.y, tail.z],
      padHeight: tail.y,
    };
  }

  /** Called whenever any setting changes. rebuild=true also rebuilds the 3-D rocket. */
  configChanged(rebuild = false) {
    const st = this.state;
    if (!this.geom) return;
    this.pad.setRod(st.launch.rod);
    this.pad.setTilt(st.launch.angle, st.launch.azimuth);
    if (rebuild) {
      const layout = this.motorLayout();
      this.model.configure(layout, this.recoverySettings());
      this.model.setColor(st.color);
      this.setColor(null, st.noseColor);
      this.model.setXray($('#xray').checked);
      if (this.seq !== 'load' && this.seq !== 'flight') this.placeOnPad();
      else if (this.seq === 'load') this.placeForLoading();
      this.configureLead();
    }
    clearTimeout(this._predT);
    this._predT = setTimeout(() => this.predict(), 120);
  }

  predict() {
    try {
      const v = this.buildVehicle();
      this.prediction = simulate(v, { ...this.launchParams(1), variability: false });
      const st0 = this.prediction.stability[0];
      this.model.setMarkers(st0.xcg, st0.xcp);
      this.panel.refreshLive();
    } catch (err) {
      console.error(err);
      this.toast('Simulation error: ' + err.message, 6000);
    }
  }

  // ===================================================================== pad placement
  alignRoll() {
    const tail = this.tailOnPad();
    const rodPt = this.pad.tilt.worldToLocal(tail.clone());
    rodPt.x = 0;
    this.pad.tilt.localToWorld(rodPt);
    this.model.alignRollToRod(this.pad.rodDirection(), rodPt.sub(tail));
  }

  placeOnPad() {
    this.alignRoll();
    const tail = this.tailOnPad();
    this.model.resetAttachments();
    this.model.setPose(tail, this.pad.rodDirection());
    this.model.updateAttached();
    this.model.updateClipping();
  }

  /** Before loading: separated parts lie beside the pad as in the file; one-piece rockets wait above the rod. */
  placeForLoading() {
    this.model.resetAttachments();
    this.alignRoll();
    const tail = this.tailOnPad();
    const dir = this.pad.rodDirection();
    this.model.setPose(tail, dir);
    this.model.updateAttached();
    const base = new THREE.Vector3(0.55, 0, 0.45);
    for (const sec of this.model.sections) {
      sec.attached = false;
      let pos;
      if (this.assembly) {
        const parts = this.assembly.placed.filter((p) => p.stage === sec.k);
        const u = parts.reduce((a, p) => a + p.part.layout.u, 0) / Math.max(1, parts.length);
        const uMean = this.assembly.placed.reduce((a, p) => a + p.part.layout.u, 0) / this.assembly.placed.length;
        const y0 = Math.min(...parts.map((p) => p.y0));
        pos = base.clone().add(new THREE.Vector3((u - uMean) * 1.0, -y0 + 0.002, 0));
        sec.group.quaternion.identity();
      } else {
        // one-piece model: standing upright on the grass beside the pad
        pos = base.clone().add(new THREE.Vector3(0, 0.002, 0));
        sec.group.quaternion.identity();
      }
      sec.group.position.copy(pos);
      sec.layoutPose = { p: pos.clone(), q: sec.group.quaternion.clone() };
    }
    this.model.updateAttached();
    this.model.updateClipping();
    this.model.setIgniterVisible(false);
  }

  /** Animate stacking: each stage (bottom first) moves above the rod, then slides down into place. */
  startLoadAnimation() {
    const tailFinal = this.tailOnPad();
    const dir = this.pad.rodDirection();
    const qFinal = this.model.orient(dir);
    const rodTopH = this.pad.rodSpec.len + 0.1;
    const items = this.model.sections.map((sec, i) => {
      const above = tailFinal.clone().addScaledVector(dir, rodTopH - sec.y0 + 0.05);
      // separate parts are stacked one at a time (bottom stage first); a one-piece model moves as a unit
      const start = this.assembly ? i * 1.6 : 0;
      const lift = this.assembly ? above : tailFinal.clone().addScaledVector(dir, rodTopH + 0.05);
      return { sec, from: sec.layoutPose, mid: { p: lift, q: qFinal }, to: { p: tailFinal.clone(), q: qFinal }, start, dur: this.assembly ? 1.6 : 2.4 };
    });
    this.loadAnim = { t: 0, items, total: Math.max(...items.map((it) => it.start + it.dur)) + 0.2 };
  }

  updateLoadAnimation(dt) {
    const A = this.loadAnim;
    if (!A) return;
    A.t += dt;
    for (const it of A.items) {
      const k = Math.max(0, Math.min(1, (A.t - it.start) / it.dur));
      if (k <= 0) continue;
      let p;
      let q;
      if (k < 0.45) {
        const e = ease(k / 0.45);
        p = new THREE.Vector3().lerpVectors(it.from.p, it.mid.p, e);
        p.y += Math.sin(e * Math.PI) * 0.25;
        q = it.from.q.clone().slerp(it.mid.q, e);
      } else {
        const e = ease((k - 0.45) / 0.55);
        p = new THREE.Vector3().lerpVectors(it.mid.p, it.to.p, e);
        q = it.mid.q.clone();
      }
      it.sec.group.position.copy(p);
      it.sec.group.quaternion.copy(q);
    }
    this.model.updateAttached();
    this.model.updateClipping();
    if (A.t >= A.total) {
      this.loadAnim = null;
      this.placeOnPad();
      this.model.setIgniterVisible(true);
      this.configureLead();
      this.advance();
    }
  }

  configureLead() {
    if (!this.model) return;
    const ends = this.model.igniterLeadEnds() || [new THREE.Vector3(0.02, 0.12, 0), new THREE.Vector3(-0.02, 0.12, 0)];
    const legA = (0 / 3) * Math.PI * 2 + Math.PI / 6;
    const parked = [new THREE.Vector3(Math.cos(legA) * 0.2 + 0.02, 0.012, Math.sin(legA) * 0.2), new THREE.Vector3(Math.cos(legA) * 0.2 - 0.02, 0.012, Math.sin(legA) * 0.2 + 0.03)];
    this.lead.configure({
      start: this.controller.cordExitWorld(),
      junction: new THREE.Vector3(-0.35, 0.004, 0.45),
      parked,
      attached: ends,
    });
  }

  // ===================================================================== sequence
  renderSequence() {
    const idx = SEQ_STEPS.findIndex((s) => s.id === this.seq);
    $('#seqSteps').innerHTML = SEQ_STEPS.map((s, i) => `<li class="${i < idx ? 'done' : i === idx ? 'current' : ''}">${s.label}</li>`).join('');
    const act = $('#seqActions');
    const msg = $('#seqMsg');
    msg.textContent = '';
    const btn = (label, fn, cls = '') => {
      const b = document.createElement('button');
      b.textContent = label;
      if (cls) b.className = cls;
      b.addEventListener('click', fn);
      act.appendChild(b);
      return b;
    };
    act.innerHTML = '';
    switch (this.seq) {
      case 'load':
        btn(this.assembly ? 'Stack stages on the pad' : 'Slide rocket onto the rod', () => this.doStep('load'), 'primary');
        msg.textContent = this.assembly ? 'Your separate stage parts are laid out beside the pad.' : '';
        break;
      case 'cap':
        btn('Remove rod cap', () => this.doStep('cap'), 'primary');
        msg.textContent = 'Tip: you can also click the orange cap on top of the rod.';
        break;
      case 'clips':
        btn('Attach micro-clips', () => this.doStep('clips'), 'primary');
        msg.textContent = 'Clip one lead to each igniter wire — not to each other!';
        break;
      case 'walk':
        btn('Walk to controller', () => this.doStep('walk'), 'primary');
        break;
      case 'key':
        btn('Insert safety key', () => this.doStep('key'), 'primary');
        msg.textContent = 'Click the red safety key next to the controller.';
        break;
      case 'range':
        btn('“Range is clear!”', () => this.doStep('range'), 'primary');
        break;
      case 'countdown':
        btn('Abort', () => this.abortCountdown());
        break;
      case 'fire': {
        const b = btn('HOLD TO LAUNCH', () => {}, 'danger');
        b.id = 'launchHold';
        b.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          this.pressLaunch();
        });
        b.addEventListener('pointerup', () => this.releaseLaunch());
        b.addEventListener('pointerleave', () => this.holding && this.releaseLaunch());
        msg.textContent = 'Hold the button (or the red 3-D button, or Space) until the motor lights.';
        break;
      }
      case 'flight':
        btn('Skip to landing', () => this.flight && (this.playT = this.flight.endT - 0.05));
        break;
      case 'safe':
        btn('Remove safety key', () => this.doStep('safe'), 'primary');
        break;
      case 'recover':
        btn('Recover & reset to pad', () => this.doStep('recover'), 'primary');
        btn('Flight report', () => $('#results').classList.remove('hidden'));
        break;
    }
  }

  advance() {
    const i = SEQ_STEPS.findIndex((s) => s.id === this.seq);
    this.seq = SEQ_STEPS[Math.min(SEQ_STEPS.length - 1, i + 1)].id;
    this.renderSequence();
  }

  doStep(id) {
    if (id !== this.seq) return;
    this.sound.ensure();
    switch (id) {
      case 'load':
        if (this.loadAnim) return;
        this.setView('pad');
        this.startLoadAnimation();
        $('#seqActions').innerHTML = '';
        break;
      case 'cap':
        this.pad.removeCap();
        this.sound.click();
        this.advance();
        break;
      case 'clips':
        this.configureLead();
        this.lead.setAttached(true);
        this.sound.click();
        setTimeout(() => this.advance(), 700);
        $('#seqActions').innerHTML = '';
        break;
      case 'walk':
        this.setView('controller');
        this.advance();
        break;
      case 'key':
        this.controller.setKey(true);
        $('#seqActions').innerHTML = '';
        setTimeout(() => {
          this.sound.click();
          this.controller.setLamp(true);
          this.sound.beep(1200, 0.08, 0.1);
          $('#seqMsg').textContent = 'Continuity light is ON — igniter circuit is good.';
          this.advance();
          $('#seqMsg').textContent = 'Continuity light is ON — the igniter circuit is good. Look around: is the range clear?';
        }, 900);
        break;
      case 'range':
        // pre-compute the flight now (fast), so launch is instant
        this.prepareFlight();
        this.advance();
        this.runCountdown();
        break;
      case 'safe':
        this.controller.setKey(false);
        this.controller.setLamp(false);
        this.sound.click();
        this.advance();
        break;
      case 'recover':
        $('#results').classList.add('hidden');
        this.resetToLoad();
        break;
    }
  }

  runCountdown() {
    const el = $('#countdown');
    let n = 5;
    el.classList.remove('hidden');
    el.textContent = n;
    this.sound.beep(660, 0.15, 0.25);
    this._cd = setInterval(() => {
      n--;
      if (n > 0) {
        el.textContent = n;
        this.sound.beep(660, 0.15, 0.25);
      } else {
        clearInterval(this._cd);
        el.textContent = 'LAUNCH!';
        this.sound.beep(990, 0.4, 0.3);
        setTimeout(() => el.classList.add('hidden'), 900);
        this.advance();
      }
    }, 1000);
  }

  abortCountdown() {
    clearInterval(this._cd);
    $('#countdown').classList.add('hidden');
    this.seq = 'range';
    this.renderSequence();
    $('#seqMsg').textContent = 'Countdown aborted.';
  }

  pressLaunch() {
    if (this.seq !== 'fire' || this.holding) return;
    this.holding = true;
    this.holdT = 0;
    this.controller.setPressed(true);
    this.sound.click();
  }

  releaseLaunch() {
    if (!this.holding) return;
    this.holding = false;
    this.controller.setPressed(false);
    if (this.seq === 'fire' && !this.flightStarted) {
      this.model.setIgniterHeat(0);
      $('#seqMsg').textContent = this.holdT > 0.15 ? 'Released too soon — the igniter cooled off. Hold until the motor lights!' : 'Press and HOLD the button.';
    }
  }

  updateIgnition(dt) {
    if (!this.holding || this.seq !== 'fire' || this.flightStarted) return;
    this.holdT += dt;
    const need = this.flightPrep.ignitionDelay;
    const heat = Math.min(1, this.holdT / need);
    this.model.setIgniterHeat(heat);
    const noz = this.nozzleWorld(0);
    if (heat > 0.5 && noz) this.effects.igniterSparks(noz);
    if (this.holdT > 0.2 && Math.random() < dt * 8) this.sound.fizz();
    if (this.holdT >= need) this.startFlight();
  }

  // ===================================================================== flight
  prepareFlight() {
    const seed = this.state.launch.variability ? (Math.random() * 1e9) | 0 : 1;
    const v = this.buildVehicle();
    const sim = simulate(v, this.launchParams(seed));
    const rand = this.state.launch.variability ? Math.random() : 0.5;
    this.flightPrep = { sim, ignitionDelay: 0.35 + rand * 0.7 };
  }

  startFlight() {
    this.flightStarted = true;
    this.model.setIgniterHeat(0);
    const sim = this.flightPrep.sim;
    const last = sim.samples[sim.samples.length - 1];
    const boosterEnd = Math.max(0, ...sim.boosters.map((b) => b.landing.t));
    this.flight = { sim, endT: Math.max(last.t, boosterEnd) + 2.5, events: sim.events.slice(), firedEvents: new Set(), lastIdx: 0 };
    this.playT = 0;
    this.effects.clear();
    const w = sim.env.windSpeed;
    const wd = headingVector(sim.env.windFrom + 180);
    this.effects.wind = [wd[0] * w * 0.8, 0.15, wd[2] * w * 0.8];
    this.trailPositions = sim.samples.map((s) => s.p);
    this.updateTrail(0);
    this.sound.startRoar();
    this.model.setIgniterVisible(false);
    this.lead.setAttached(false);
    this.seq = 'flight';
    this.renderSequence();
    $('#hud').classList.remove('hidden');
    this.hudChart.set({ series: [{ name: 'Altitude', color: '#ff6a1f', unit: 'm', points: sim.samples.map((s) => [s.t, s.alt]) }], yLabel: 'Alt (m)' });
    this.setView('track');
    this.renderResults();
  }

  replay() {
    if (!this.flightPrep) return;
    $('#results').classList.add('hidden');
    this.placeOnPad();
    this.flightStarted = false;
    this.startFlight();
  }

  resetToLoad() {
    this.flight = null;
    this.flightStarted = false;
    this.holding = false;
    clearInterval(this._cd);
    $('#countdown').classList.add('hidden');
    $('#hud').classList.add('hidden');
    this.sound.stopRoar();
    this.effects.clear();
    this.trail.geometry.setDrawRange(0, 0);
    this.pad.restoreCap();
    this.controller.setKey(false);
    this.controller.setLamp(false);
    this.lead.attachT = 0;
    this.lead.setAttached(false);
    this.seq = 'load';
    if (this.model) {
      this.placeForLoading();
      this.configureLead();
    }
    this.renderSequence();
    this.setView('pad');
  }

  nozzleWorld(stageIdx, motorIdx = 0) {
    const sec = this.model.sections[stageIdx];
    const m = sec?.motors[motorIdx];
    if (!m) return null;
    m.group.updateMatrixWorld(true);
    return m.group.localToWorld(new THREE.Vector3(0, -0.002, 0));
  }

  sampleAt(t) {
    const S = this.flight.sim.samples;
    let i = this.flight.lastIdx;
    if (i >= S.length || S[i].t > t) i = 0;
    while (i < S.length - 1 && S[i + 1].t <= t) i++;
    this.flight.lastIdx = i;
    const a = S[i];
    const b = S[Math.min(S.length - 1, i + 1)];
    const f = b.t > a.t ? Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t))) : 0;
    const lerp = (x, y) => x.map((v, k) => v + (y[k] - v) * f);
    return { ...a, t, p: lerp(a.p, b.p), v: lerp(a.v, b.v), a: lerp(a.a, b.a), alt: a.alt + (b.alt - a.alt) * f, xcg: a.xcg + (b.xcg - a.xcg) * f, recovery: a.recovery + (b.recovery - a.recovery) * f };
  }

  updateFlight(dt) {
    const F = this.flight;
    if (!F) return;
    const prevT = this.playT;
    this.playT = Math.min(F.endT, this.playT + dt * this.speed);
    const t = this.playT;
    const sim = F.sim;
    const S = sim.samples;
    const landT = sim.summary.landing?.t ?? S[S.length - 1].t;
    const landed = t >= landT;
    const s = this.sampleAt(Math.min(t, S[S.length - 1].t));
    const model = this.model;
    const vehicle = sim.vehicle;

    // ---- events (sounds & effects) ----
    for (const ev of F.events) {
      if ((ev.t > prevT || (ev.t === 0 && prevT === 0)) && ev.t <= t && !F.firedEvents.has(ev)) {
        F.firedEvents.add(ev);
        this.onEvent(ev, s);
      }
      if (t < prevT) F.firedEvents.clear();
    }

    // ---- main vehicle pose ----
    if (s.phase === 'recovery' || landed) {
      const wd = headingVector(sim.env.windFrom + 180);
      model.poseRecovery(s.p, s.a, s.xcg, Math.min(1, s.recovery * 1.2 + (landed ? 1 : 0)), this.time, landed, wd);
    } else {
      model.setPoseFromCG(s.p, s.a, s.xcg);
      for (const sec of model.sections) if (sec.k >= s.lowIdx) sec.attached = true;
      model.updateAttached();
    }
    // separated boosters
    for (const b of sim.boosters) {
      const sec = model.sections[b.stageIdx];
      if (!sec) continue;
      const t0 = b.traj[0].t - 0.01;
      if (t < t0) continue;
      sec.attached = false;
      const tr = b.traj;
      let j = 0;
      while (j < tr.length - 1 && tr[j + 1].t <= t) j++;
      const k = tr[j + 1] ? Math.max(0, Math.min(1, (t - tr[j].t) / (tr[j + 1].t - tr[j].t))) : 0;
      const pj = tr[j].p;
      const pk = (tr[j + 1] || tr[j]).p;
      const p = new THREE.Vector3(pj[0] + (pk[0] - pj[0]) * k, pj[1] + (pk[1] - pj[1]) * k, pj[2] + (pk[2] - pj[2]) * k);
      const a0 = new THREE.Vector3(...b.axis0);
      let axis;
      const onGround = t >= b.landing.t;
      if (onGround) {
        axis = new THREE.Vector3(0.9, 0, 0.4).normalize();
        p.y = this.geom.refRadius + this.geom.finSets.reduce((m, f) => Math.max(m, f.span), 0) * 0.5;
      } else {
        const perp = new THREE.Vector3().crossVectors(a0, new THREE.Vector3(0, 1, 0.3)).normalize();
        const ang = Math.min(1, (t - t0) * 1.5) * (t - t0) * b.spin;
        axis = a0.clone().applyAxisAngle(perp, ang);
      }
      sec.group.quaternion.copy(this.model.orient(axis));
      sec.group.position.copy(p).addScaledVector(axis, -b.cgFromTail);
    }
    model.updateClipping();

    // ---- flames & smoke ----
    let thrustTotal = 0;
    let peakTotal = 0;
    vehicle.stages.forEach((stg, k) => {
      stg.instances.forEach((mi, j) => {
        const mo = model.sections[k]?.motors[j];
        if (!mo) return;
        const T = mi.inst.thrust(t);
        const frac = T / mi.motor.peakThrust;
        model.setFlame(mo, frac, this.time);
        thrustTotal += T;
        peakTotal += mi.motor.peakThrust;
        const noz = mo.group.localToWorld(new THREE.Vector3(0, -0.003, 0));
        const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(mo.group.getWorldQuaternion(new THREE.Quaternion()));
        const vel = k >= s.lowIdx ? s.v : [0, 0, 0];
        if (T > 0) this.effects.exhaust(dt * this.speed, noz.toArray(), axis.toArray(), vel, frac, propellantLook(mi.motor.propellant));
        else {
          const bo = mi.inst.burnoutTime();
          const ej = mi.inst.ejectionTime();
          if (bo !== null && t > bo && ej !== null && t < ej && k >= s.lowIdx) this.effects.exhaust(dt * this.speed, noz.toArray(), axis.toArray(), vel, 0, propellantLook(mi.motor.propellant), true);
        }
      });
    });
    const camDist = this.world.camera.position.distanceTo(new THREE.Vector3(...s.p));
    this.sound.setRoar(peakTotal ? thrustTotal / Math.max(8, peakTotal * 0.5) : 0, camDist);

    this.updateTrail(t);
    // ---- HUD ----
    $('#hudT').textContent = t.toFixed(2);
    $('#hudAlt').textContent = Math.max(0, s.alt).toFixed(1);
    $('#hudVel').textContent = Math.hypot(...s.v).toFixed(1);
    $('#hudAcc').textContent = (s.acc / 9.81).toFixed(1);
    $('#hudThr').textContent = thrustTotal.toFixed(1);
    $('#hudPhase').textContent = landed ? 'landed' : phaseName(s, t, sim);
    if (Math.floor(t * 10) !== Math.floor(prevT * 10)) this.hudChart.setCursor(t);

    if (t >= F.endT && this.seq === 'flight') {
      this.sound.stopRoar();
      this.advance();
      $('#results').classList.remove('hidden');
      $('#seqMsg').textContent = 'Flight complete. Remove the safety key before approaching the pad.';
    }
  }

  onEvent(ev, s) {
    const dist = this.world.camera.position.distanceTo(new THREE.Vector3(...s.p));
    switch (ev.type) {
      case 'ignition': {
        const n = this.nozzleWorld(0);
        if (n) this.effects.padBlast(n, 120);
        break;
      }
      case 'stage-ignition':
        this.sound.pop(dist);
        break;
      case 'ejection': {
        const top = this.model.sections[this.model.sections.length - 1];
        const p = top.group.localToWorld(new THREE.Vector3(0, this.model.noseBase, 0));
        this.effects.ejectionPuff(p.toArray(), s.v);
        this.sound.pop(dist);
        break;
      }
      case 'staging-fail':
      case 'no-liftoff':
        this.toast(ev.label, 5000);
        break;
    }
  }

  makeTrail() {
    const max = 40000;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(max * 3), 3));
    geo.setDrawRange(0, 0);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffb547, transparent: true, opacity: 0.55 }));
    line.frustumCulled = false;
    this.scene.add(line);
    return line;
  }

  updateTrail(t) {
    const pos = this.trail.geometry.attributes.position;
    const S = this.flight.sim.samples;
    let n = 0;
    for (let i = 0; i < S.length && S[i].t <= t && n < pos.count; i++, n++) pos.setXYZ(n, S[i].p[0], S[i].p[1], S[i].p[2]);
    pos.needsUpdate = true;
    this.trail.geometry.setDrawRange(0, n);
  }

  // ===================================================================== results
  renderResults() {
    const sim = this.flightPrep.sim;
    const s = sim.summary;
    const m = (v, l) => `<div class="metric"><div class="v">${v}</div><div class="l">${l}</div></div>`;
    $('#resSummary').innerHTML = [
      m(`${s.apogee.toFixed(1)} m`, `Apogee (${(s.apogee * 3.281).toFixed(0)} ft)`),
      m(`${s.maxSpeed.toFixed(1)} m/s`, `Max speed (Mach ${s.maxMach.toFixed(2)})`),
      m(`${(s.maxAccel / 9.81).toFixed(1)} g`, 'Max acceleration'),
      m(s.apogeeTime ? `${s.apogeeTime.toFixed(2)} s` : '—', 'Time to apogee'),
      m(s.rodExitSpeed ? `${s.rodExitSpeed.toFixed(1)} m/s` : '—', 'Rod exit speed'),
      m(s.ejection ? `${s.ejection.v.toFixed(1)} m/s` : 'none', s.ejection ? `Ejection @ ${s.ejection.t.toFixed(2)} s, ${s.ejection.alt.toFixed(0)} m` : 'Ejection'),
      m(s.descentRate ? `${s.descentRate.toFixed(1)} m/s` : '—', 'Descent rate'),
      m(s.drift !== null ? `${s.drift.toFixed(0)} m` : '—', `Drift · flight ${s.flightTime.toFixed(1)} s`),
    ].join('');
    $('#resEvents').innerHTML = sim.events.map((e) => `<span><b>${e.t.toFixed(2)} s</b> ${e.label}${e.alt > 0.5 ? ` · ${e.alt.toFixed(0)} m` : ''}</span>`).join('');
    const stab = sim.stability.map((x, i) => `${sim.stability.length > 1 ? `Stage ${i + 1}+: ` : ''}CG ${(x.xcg * 1000).toFixed(0)} mm, CP ${(x.xcp * 1000).toFixed(0)} mm → ${x.margin.toFixed(2)} cal`).join(' · ');
    $('#resWarnings').innerHTML =
      `<div class="ok">Stability: ${stab}. Motors: ${this.state.stages.map((sg) => `${sg.count > 1 ? sg.count + '× ' : ''}${getMotor(sg.motorId)?.designation}`).join(' → ')}.</div>` +
      (sim.warnings.length ? sim.warnings.map((w) => `<div>${w}</div>`).join('') : '<div class="ok">No problems found — a textbook flight.</div>');
    this.drawResultChart(document.querySelector('#resTabs button.active')?.dataset.chart || 'alt');
  }

  drawResultChart(kind) {
    const sim = this.flightPrep?.sim;
    if (!sim) return;
    const S = sim.samples.filter((s) => s.t >= 0);
    const P = (f) => S.map((s) => [s.t, f(s)]);
    const markers = sim.events.filter((e) => ['burnout', 'apogee', 'ejection', 'separation', 'stage-ignition'].includes(e.type)).map((e) => ({ x: e.t }));
    let series;
    let yLabel;
    let xLabel = 't (s)';
    switch (kind) {
      case 'alt':
        series = [{ name: 'Altitude', color: '#ff6a1f', unit: 'm', points: P((s) => s.alt) }];
        for (const b of sim.boosters) series.push({ name: `Stage ${b.stageIdx + 1} booster`, color: '#4fc3f7', unit: 'm', dash: [4, 3], points: b.traj.map((q) => [q.t, q.p[1] - sim.env.padHeight]) });
        yLabel = 'Altitude (m)';
        break;
      case 'vel':
        series = [
          { name: 'Vertical', color: '#4fc3f7', unit: 'm/s', points: P((s) => s.vy) },
          { name: 'Total speed', color: '#ff6a1f', unit: 'm/s', points: P((s) => s.speed) },
        ];
        yLabel = 'Velocity (m/s)';
        break;
      case 'acc':
        series = [{ name: 'Acceleration', color: '#81c784', unit: 'g', points: P((s) => s.acc / 9.81) }];
        yLabel = 'Acceleration (g)';
        break;
      case 'thrust':
        series = [
          { name: 'Thrust', color: '#ff6a1f', unit: 'N', points: P((s) => s.thrust) },
          { name: 'Mass ×100', color: '#ce93d8', unit: '', points: P((s) => s.mass * 100) },
        ];
        yLabel = 'Thrust (N) · mass (hg)';
        break;
      case 'aoa':
        series = [
          { name: 'Angle of attack', color: '#ffd54f', unit: '°', points: P((s) => (s.phase === 'flight' ? s.alpha : 0)) },
          { name: 'Mach ×100', color: '#4fc3f7', unit: '', points: P((s) => s.mach * 100) },
        ];
        yLabel = 'α (°) · Mach×100';
        break;
      case 'track':
        series = [{ name: 'Ground track (east vs north)', color: '#ff6a1f', unit: 'm N', points: S.map((s) => [s.p[0], -s.p[2]]) }];
        xLabel = 'east (m)';
        yLabel = 'north (m)';
        break;
    }
    this.resChart.set({ series, markers: kind === 'track' ? [] : markers, yLabel, xLabel });
  }

  // ===================================================================== cameras
  setView(v) {
    this.view = v;
    document.querySelectorAll('#viewButtons button').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
    const c = this.world.controls;
    c.enabled = v === 'pad' || v === 'free';
    const cam = this.world.camera;
    const from = { p: cam.position.clone(), l: cam.position.clone().add(cam.getWorldDirection(new THREE.Vector3()).multiplyScalar(2)), fov: cam.fov };
    let to = null;
    if (v === 'pad') {
      const L = this.geom ? this.geom.length : 0.4;
      const look = new THREE.Vector3(0.15, 0.15 + L * 0.45, 0.1);
      const d = Math.max(1.2, L * 3.2);
      to = { p: new THREE.Vector3(d * 0.75, 0.6 + L * 0.5, d * 0.95), l: look, fov: 50 };
    } else if (v === 'controller') {
      const C = CONTROLLER_POS;
      to = {
        p: C.clone().addScaledVector(this.toPad, -0.3).add(new THREE.Vector3(0, 0.36, 0)),
        l: C.clone().addScaledVector(this.toPad, 0.9).add(new THREE.Vector3(0, 0.02, 0)),
        fov: 55,
      };
    } else if (v === 'free') {
      cam.fov = 50;
    }
    // eased camera move that arcs up to standing eye height (like walking over)
    this.camTween = to && from.p.distanceTo(to.p) > 0.05 ? { from, to, k: 0, dur: Math.min(2.2, 0.8 + from.p.distanceTo(to.p) * 0.25) } : null;
    if (to && !this.camTween) {
      cam.position.copy(to.p);
      cam.lookAt(to.l);
      if (v === 'pad') c.target.copy(to.l);
    }
    this.camTo = to;
    cam.updateProjectionMatrix();
  }

  updateCameraTween(dt) {
    const T = this.camTween;
    const cam = this.world.camera;
    T.k = Math.min(1, T.k + dt / T.dur);
    const e = ease(T.k);
    cam.position.lerpVectors(T.from.p, T.to.p, e);
    const lift = Math.max(0, 1.6 - Math.min(T.from.p.y, T.to.p.y)) * Math.sin(Math.PI * e) * Math.min(1, T.from.p.distanceTo(T.to.p) / 3);
    cam.position.y += lift;
    cam.lookAt(new THREE.Vector3().lerpVectors(T.from.l, T.to.l, e));
    cam.fov = T.from.fov + (T.to.fov - T.from.fov) * e;
    cam.updateProjectionMatrix();
    if (T.k >= 1) {
      this.camTween = null;
      if (this.view === 'pad') this.world.controls.target.copy(T.to.l);
    }
  }

  updateCamera(dt) {
    if (this.camTween) {
      this.updateCameraTween(dt);
      return;
    }
    const cam = this.world.camera;
    const target = this.model ? this.model.root.position.clone().addScaledVector(new THREE.Vector3(0, 1, 0).applyQuaternion(this.model.root.quaternion), this.geom.length * 0.5) : new THREE.Vector3();
    const flying = !!this.flight;
    if (flying && this.flight.sim.samples.length) {
      const s = this.sampleAt(Math.min(this.playT, this.flight.sim.samples[this.flight.sim.samples.length - 1].t));
      target.set(...s.p);
    }
    const ease = 1 - Math.exp(-dt * 4);
    switch (this.view) {
      case 'controller': {
        const C = CONTROLLER_POS;
        void C;
        cam.position.copy(this.camTo.p);
        cam.lookAt(this.camTo.l);
        cam.fov = this.camTo.fov;
        break;
      }
      case 'track': {
        const eye = CONTROLLER_POS.clone().addScaledVector(this.toPad, -0.6).add(new THREE.Vector3(0.4, 1.6, 0));
        cam.position.lerp(eye, ease);
        cam.lookAt(target);
        const dist = cam.position.distanceTo(target);
        const want = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2 * Math.atan((this.geom.length * 3 + 0.002 * dist) / dist)), 1.2, 40);
        cam.fov += (want - cam.fov) * (1 - Math.exp(-dt * 2));
        break;
      }
      case 'chase': {
        let v = new THREE.Vector3(0, 1, 0);
        if (flying) {
          const s = this.sampleAt(Math.min(this.playT, this.flight.sim.samples[this.flight.sim.samples.length - 1].t));
          v = new THREE.Vector3(...s.v);
          if (v.length() < 2) v.set(0, 1, 0);
          v.normalize();
        }
        const back = Math.max(1.5, this.geom.length * 6);
        const eye = target.clone().addScaledVector(v, -back).add(new THREE.Vector3(back * 0.25, back * 0.15, back * 0.2));
        if (eye.y < 0.3) eye.y = 0.3;
        cam.position.lerp(eye, 1 - Math.exp(-dt * 6));
        cam.lookAt(target);
        cam.fov += (45 - cam.fov) * ease;
        break;
      }
      case 'onboard': {
        const root = this.model.root;
        const ax = new THREE.Vector3(0, 1, 0).applyQuaternion(root.quaternion);
        const side = new THREE.Vector3(1, 0, 0).applyQuaternion(root.quaternion);
        const eye = root.position.clone().addScaledVector(ax, this.geom.length * 0.75).addScaledVector(side, this.geom.refRadius * 1.6);
        cam.position.copy(eye);
        cam.up.copy(side);
        cam.lookAt(eye.clone().addScaledVector(ax, -10).addScaledVector(side, 0.3));
        cam.up.set(0, 1, 0);
        cam.fov = 75;
        break;
      }
      case 'free': {
        // orbit around the rocket wherever it is
        if (flying) {
          const delta = target.clone().sub(this.world.controls.target);
          this.world.controls.target.add(delta);
          cam.position.add(delta);
        }
        this.world.controls.update();
        break;
      }
      case 'pad':
      default:
        this.world.controls.update();
    }
    cam.updateProjectionMatrix();
    // keep shadows near the camera's area of interest
    const sl = this.world.sunLight;
    const focus = this.view === 'controller' ? CONTROLLER_POS.clone().addScaledVector(this.toPad, 2) : new THREE.Vector3(0, 0, 0);
    sl.target.position.copy(focus);
    sl.position.copy(focus).addScaledVector(this.world.sun, 30);
    this.effects.setScale(this.world.renderer.domElement.height / 2);
  }

  // ===================================================================== main loop
  loop() {
    requestAnimationFrame(() => this.loop());
    const dt = Math.min(0.05, this.clock.getDelta());
    this.time += dt;
    this.pad.update(dt);
    this.controller.update(dt, this.time);
    this.lead.update(dt);
    this.updateLoadAnimation(dt);
    this.updateIgnition(dt);
    if (this.flight) this.updateFlight(dt);
    else if (this.model && !this.loadAnim) {
      this.model.updateAttached();
      this.model.updateClipping();
    }
    this.effects.update(dt * (this.flight ? this.speed : 1));
    this.updateCamera(dt);
    this.world.render();
  }
}

function phaseName(s, t, sim) {
  if (s.phase === 'pad') return 'ignition';
  if (s.phase === 'rod') return 'on rod';
  if (s.phase === 'recovery') return sim.vehicle.settings.recovery.type === 'streamer' ? 'streamer' : 'parachute';
  if (s.thrust > 0) return 'powered';
  return s.vy > 0 ? 'coasting' : 'falling';
}

function ease(x) {
  return x * x * (3 - 2 * x);
}

function guessUnits(pos) {
  let mn = Infinity;
  let mx = -Infinity;
  for (let i = 0; i < pos.length; i++) {
    if (pos[i] < mn) mn = pos[i];
    if (pos[i] > mx) mx = pos[i];
  }
  const ext = mx - mn;
  if (ext > 40) return 'mm';
  if (ext > 6) return 'cm';
  if (ext > 2.5) return 'in';
  return 'm';
}

window.app = new App();
