import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import './style.css';
import { World, QUALITY } from './scene/world.js';
import { Environment } from './scene/environment.js';
import { LaunchPad, ROD_SPECS } from './scene/launchPad.js';
import { LaunchController, LaunchLead, CORD_LENGTH } from './scene/controller.js';
import { RocketModel, propellantLook } from './scene/rocketModel.js';
import { Starter, IgniterPlug } from './scene/starter.js';
import { PrepTable } from './scene/props.js';
import { Effects } from './scene/effects.js';
import { Sound } from './audio.js';
import { Panel } from './ui/panel.js';
import { LineChart } from './ui/charts.js';
import { Player, isTyping } from './game/player.js';
import { CloseUp, setWorldPosition } from './game/closeup.js';
import { Hud } from './game/hud.js';
import { EXAMPLES } from './data/examples.js';
import { analyzeRocket, estimateAirframeMass, suggestSeparation, detectMotorMounts } from './physics/geometry.js';
import { detectParts, assembleParts, defaultOrder } from './physics/assembly.js';
import { buildVehicle, simulate, clusterOffsets, headingVector } from './physics/simulator.js';
import { getMotor, allMotors } from './physics/motors.js';

const $ = (s) => document.querySelector(s);
const UNIT_SCALE = { mm: 0.001, cm: 0.01, m: 1, in: 0.0254 };
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);

// Range layout (metres). The pad is at the origin.
const TABLE_POS = V(1.75, 0, 1.25);
const JUNCTION = V(-0.28, 0.004, 0.32); // where the launch lead splits into the two clip leads
const CONTROLLER_HOME = V(-3.15, 0.017, 3.85); // at the end of the 17 ft lead

class App {
  constructor() {
    this.world = new World($('#viewport'));
    this.scene = this.world.scene;
    this.pad = new LaunchPad();
    this.scene.add(this.pad.group);
    this.table = new PrepTable();
    this.table.group.position.copy(TABLE_POS);
    this.table.group.rotation.y = -0.5;
    this.scene.add(this.table.group);
    this.controller = new LaunchController();
    this.scene.add(this.controller.group);
    this.lead = new LaunchLead(this.scene);
    this.env = new Environment(this.world);
    this.effects = new Effects(this.scene);
    this.sound = new Sound();
    this.trail = this.makeTrail();
    this.hud = new Hud();

    const cam = this.world.camera;
    this.world.controls.dispose();
    this.orbit = new OrbitControls(cam, this.world.renderer.domElement);
    this.orbit.enabled = false;
    this.orbit.enableDamping = true;
    this.player = new Player(cam, this.world.renderer.domElement);
    this.player.colliders = [
      { x: 0, z: 0, r: 0.55 },
      { x: TABLE_POS.x, z: TABLE_POS.z, r: 0.62 },
    ];
    this.closeup = new CloseUp(this);

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
    // physical state of the range
    this.g = {
      rocketAt: 'table', // table | pickup | hands | loading | pad | flight
      starter: 'kit', // kit | installed | burnt
      plug: 'kit', // kit | installed
      capOn: true,
      clipOn: [null, null], // which starter lead each micro-clip is on
      controller: 'ground', // ground | hand | inspect
      keyPushed: false,
      launchPressed: false,
      heat: 0,
      recovered: false,
      ledSeen: false,
    };
    this.view = 'eyes';
    this.speed = 1;
    this.flight = null;
    this.playT = 0;
    this.track = false;
    this.clock = new THREE.Clock();
    this.time = 0;

    this.panel = new Panel(this);
    this.hudChart = new LineChart($('#hudChart'), { yLabel: 'Alt (m)' });
    this.resChart = new LineChart($('#resChart'));
    this.bindUI();
    let q = 'high';
    try {
      q = localStorage.getItem('rfl-quality') || q;
    } catch {
      /* storage unavailable */
    }
    this.setQuality(QUALITY[q] ? q : 'high');
    this.placeController();
    this.player.lookAt(TABLE_POS.clone().add(V(-0.6, 0.6, -0.6)));
    this.loadExample('sparrow');
    this.loop();
  }

  // ===================================================================== input
  bindUI() {
    document.querySelectorAll('#viewButtons button').forEach((b) => b.addEventListener('click', () => this.setView(b.dataset.view)));
    $('#xray').addEventListener('change', (e) => this.model?.setXray(e.target.checked));
    $('#sound').addEventListener('change', (e) => this.sound.setEnabled(e.target.checked));
    $('#panelToggle').addEventListener('click', () => document.body.classList.toggle('panel-hidden'));
    $('#quality').addEventListener('change', (e) => this.setQuality(e.target.value));
    $('#resetBtn').addEventListener('click', () => this.resetRange());
    $('#reportBtn').addEventListener('click', () => $('#results').classList.remove('hidden'));
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

    const el = this.world.renderer.domElement;
    el.addEventListener('mousedown', (e) => {
      this.sound.ensure();
      if (this.closeup.active || this.view !== 'eyes') return;
      const holding = this.g.controller === 'hand';
      if (e.button === 0) {
        if (holding && (this.player.locked || this.player.lockFailed)) this.setLaunchPressed(true);
        else if (!this.player.locked) {
          this.player.requestLock();
          if (this.player.lockFailed) this.player.beginDragLook(e);
        }
      } else if (e.button === 2) {
        if (holding) this.setKeyPushed(true);
        else this.player.binoHeld = true;
      }
    });
    window.addEventListener('mouseup', (e) => {
      this.player.endDragLook();
      if (this.closeup.active) return;
      if (e.button === 0) this.setLaunchPressed(false);
      if (e.button === 2) {
        this.setKeyPushed(false);
        this.player.binoHeld = this.player.keys.has('KeyZ');
      }
    });

    window.addEventListener('keydown', (e) => {
      if (isTyping(e)) return;
      this.sound.ensure();
      if (e.repeat && !['KeyK', 'Space'].includes(e.code)) return;
      switch (e.code) {
        case 'KeyE':
          this.interact();
          break;
        case 'Escape':
          if (this.closeup.active) this.leaveCloseup();
          break;
        case 'KeyG':
          if (this.g.controller !== 'ground') this.putDownController();
          break;
        case 'KeyK':
          if (this.g.controller !== 'ground') this.setKeyPushed(true);
          break;
        case 'Space':
          if (this.g.controller !== 'ground') {
            e.preventDefault();
            this.setLaunchPressed(true);
          }
          break;
        case 'KeyT':
          this.track = !this.track;
          this.toast(this.track ? 'Track assist ON — your view follows the rocket.' : 'Track assist off.');
          break;
        case 'KeyV': {
          const order = ['eyes', 'chase', 'onboard', 'orbit'];
          this.setView(order[(order.indexOf(this.view) + 1) % order.length]);
          break;
        }
        case 'KeyC':
          this.countdown();
          break;
        case 'Tab':
          e.preventDefault();
          document.body.classList.toggle('panel-hidden');
          break;
        case 'KeyP':
          if (this.reportSim) $('#results').classList.toggle('hidden');
          break;
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'KeyK') this.setKeyPushed(false);
      if (e.code === 'Space') this.setLaunchPressed(false);
    });

    // drag & drop files
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
  }

  /** Graphics preset: renderer, post effects, grass, clouds and smoke budget. */
  setQuality(level) {
    const q = this.world.setQuality(level);
    this.env.setGrass(q.grass, q.grassR);
    this.env.setClouds(q.clouds);
    if (this.effects.smoke.max !== q.smoke) {
      const wind = this.effects.windVec;
      this.effects.dispose();
      this.effects = new Effects(this.scene, q.smoke);
      this.effects.setWind(wind);
    }
    $('#quality').value = level;
    try {
      localStorage.setItem('rfl-quality', level);
    } catch {
      /* storage unavailable */
    }
  }

  toast(msg, ms = 3800) {
    const t = $('#toast');
    t.innerHTML = msg;
    t.classList.remove('hidden');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => t.classList.add('hidden'), ms);
  }

  // ===================================================================== loading
  async loadExample(id) {
    const ex = EXAMPLES.find((e) => e.id === id);
    if (!ex) return;
    // single-file builds embed the example STLs as base64 (no network access needed)
    const embedded = window.__EXAMPLE_STL?.[ex.file];
    const buf = embedded ? base64ToArrayBuffer(embedded) : await (await fetch(ex.file)).arrayBuffer();
    const st = this.state;
    st.exampleId = id;
    st.color = ex.color;
    st.noseColor = ex.noseColor || ex.color;
    st.units = 'mm';
    st.axis = 'auto';
    st.flip = false;
    // real kits fly at their published weight; our own designs use the model estimate
    st.massAuto = ex.massG == null;
    if (ex.massG != null) st.massG = ex.massG;
    st.noseWeightG = ex.noseWeightG || 0;
    st.cdOverride = null;
    st.assembleDisabled = false;
    st.partOrder = [];
    st.stages = ex.stages.map((s) => ({ motorId: s.motorId, count: s.count || 1 }));
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
        this.toast(`Loaded ${name}${this.detected ? ` — ${this.detected.parts.length} separate parts; they'll be stacked when you pick the rocket up` : ''}. It's on the prep table.`);
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
      geom = analyzeRocket(this.raw, { unitScale, axis: st.axis, noseAt: 'auto' });
      if (st.flip) geom = analyzeRocket(this.raw, { unitScale, axis: st.axis, noseAt: geom.noseAtMax ? 'min' : 'max' });
      source = { positions: this.raw };
    }
    this.geom = geom;
    this._mountCache = null;
    this.estimatedMass = estimateAirframeMass(geom);
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
    if (this.model) this.model.dispose();
    this.model = new RocketModel(this.scene, geom, source, { color: st.color });
    this.model.noseMaterial.color.set(st.noseColor);
    this.configChanged(true);
    this.panel.render();
  }

  defaultStages(n) {
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
      stages.push({ motorId: pick(this.mountDiameterForStage(k) || 18, usage), count: 1 });
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
    const key = `${k}|${this.stageBottom(k)}`;
    if (!this._mountCache.has(key)) this._mountCache.set(key, k === 0 ? g.motorMounts : detectMotorMounts(g, this.stageBottom(k)));
    return this._mountCache.get(key);
  }

  mountDiameterForStage(k) {
    const m = this.mountsForStage(k);
    if (m.length) return m[0].motorDiameter;
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
      const overhang = (sg.overhangMM ?? (k === 0 ? 4 : 8)) / 1000;
      let yAft = bottom - overhang;
      if (k > 0 && this.assembly) {
        const lower = this.assembly.placed.filter((p) => p.stage === k - 1 && p.part.hasFins).pop();
        if (lower) yAft = bottom + lower.part.topStub + 0.001 - (sg.overhangMM != null ? sg.overhangMM / 1000 : 0);
      }
      const d = motor.diameter / 1000;
      const mounts = this.mountsForStage(k);
      const lats = mounts.length === sg.count && sg.count > 1 ? mounts.map((m) => [m.x, m.z]) : clusterOffsets(sg.count, d, sg.center);
      return {
        k,
        yBottom: k === 0 ? 0 : st.stations[k - 1],
        yTop: k === st.stages.length - 1 ? L : st.stations[k],
        mountDiameter: this.mountDiameterForStage(k),
        auto: true,
        motors: lats.map((lat) => ({ id: motor.id, motor, x: lat[0], z: lat[1], lat, yAft, len: motor.length / 1000 })),
      };
    });
  }

  setStageCount(n) {
    const st = this.state;
    if (this.assembly) {
      this.toast('The stage count comes from the separate parts in your file.');
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
    return buildVehicle({
      geom: this.geom,
      airframeMass: (st.massAuto ? this.estimatedMass * 1000 : st.massG) / 1000,
      noseWeight: st.noseWeightG / 1000,
      stages: this.motorLayout().map((s) => ({ yBottom: s.yBottom, yTop: s.yTop, motors: s.motors.map((m) => ({ id: m.id, x: m.x, z: m.z, yAft: m.yAft })) })),
      recovery: this.recoverySettings(),
      staging: st.staging,
    });
  }

  /** Rocket tail position on the pad: the motor nozzle rests just above the deflector. */
  tailOnPad() {
    const layout = this.motorLayout();
    const minAft = Math.min(0, ...(layout[0]?.motors.map((m) => m.yAft) || [0]));
    return this.pad.rocketTail(this.geom.refRadius, -minAft + 0.012);
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

  /** Any setting changed. rebuild = the rocket/motors changed: it goes back to the prep table. */
  configChanged(rebuild = false) {
    const st = this.state;
    if (!this.geom) return;
    if (rebuild) {
      this.model.configure(this.motorLayout(), this.recoverySettings());
      this.model.setColor(st.color);
      this.setColor(null, st.noseColor);
      this.model.setXray($('#xray').checked);
      this.padChanged(true);
      this.resetRocketToTable();
    }
    this.updateWind();
    this.flightPrep = null;
    clearTimeout(this._predT);
    this._predT = setTimeout(() => this.predict(), 120);
  }

  /** Rod type / angle / azimuth changed: keep the rocket where it is. */
  padChanged(silent = false) {
    const st = this.state;
    if (this.pad.rodKey !== st.launch.rod) {
      this.pad.setRod(st.launch.rod);
      if (!this.g.capOn) this.pad.removeCap(false);
    }
    this.pad.setTilt(st.launch.angle, st.launch.azimuth);
    if (this.g.rocketAt === 'pad') this.placeOnPad();
    this.flightPrep = null;
    if (!silent) {
      clearTimeout(this._predT);
      this._predT = setTimeout(() => this.predict(), 120);
    }
  }

  updateWind() {
    const L = this.state.launch;
    const wd = headingVector(L.windFrom + 180);
    this.effects.setWind([wd[0] * L.windSpeed, 0, wd[2] * L.windSpeed]);
  }

  predict() {
    try {
      this.prediction = simulate(this.buildVehicle(), { ...this.launchParams(1), variability: false });
      const st0 = this.prediction.stability[0];
      this.model.setMarkers(st0.xcg, st0.xcp);
      this.panel.refreshLive();
    } catch (err) {
      console.error(err);
      this.toast('Simulation error: ' + err.message, 6000);
    }
  }

  // ===================================================================== rocket placement
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

  /** Rocket (or each separate stage part) lying on the prep table. */
  placeOnTable() {
    const m = this.model;
    m.resetAttachments();
    const yaw = this.table.group.rotation.y;
    const along = V(-Math.cos(yaw), 0, Math.sin(yaw)); // nose direction on the table
    const across = V(Math.sin(yaw), 0, Math.cos(yaw)).negate();
    const finR = this.geom.refRadius + Math.max(0, ...this.geom.finSets.map((f) => f.span));
    const h = this.table.height + finR * 0.72;
    const q = new THREE.Quaternion().setFromUnitVectors(UP, along);
    q.multiply(new THREE.Quaternion().setFromAxisAngle(UP, Math.PI / 6));
    const groups = this.assembly ? m.sections.map((s) => [s]) : [m.sections];
    const n = groups.length;
    // lay separate parts side by side, spaced by their own fin size
    const partR = groups.map((secs) => {
      const y0 = Math.min(...secs.map((s) => s.y0));
      const y1 = Math.max(...secs.map((s) => s.y1));
      const L = this.geom.length;
      let r = this.geom.refRadius * 0.6;
      for (const f of this.geom.finSets) {
        const yMid = L - (f.xLE + f.Cr / 2);
        if (yMid >= y0 && yMid <= y1) r = Math.max(r, f.rBody + f.span);
      }
      return r * 0.8;
    });
    const total = partR.reduce((a, r) => a + 2 * r, 0) + 0.02 * (n - 1);
    let acc = -total / 2;
    const offs = partR.map((r) => {
      const o = acc + r;
      acc += 2 * r + 0.02;
      return o;
    });
    groups.forEach((secs, i) => {
      const y0 = Math.min(...secs.map((s) => s.y0));
      const y1 = Math.max(...secs.map((s) => s.y1));
      const off = n > 1 ? offs[i] : 0;
      const centre = TABLE_POS.clone().addScaledVector(across, off - 0.04).setY(h);
      for (const s of secs) {
        s.attached = false;
        s.group.quaternion.copy(q);
        s.group.position.copy(centre).addScaledVector(along, -(y0 + y1) / 2);
      }
    });
    m.updateAttached();
    m.updateClipping();
    this.tableAlong = along;
    this.tableAcross = across;
  }

  resetRocketToTable() {
    this.cancelFlight();
    if (this.closeup.active) this.leaveCloseup();
    this.g.rocketAt = 'table';
    this.g.clipOn = [null, null];
    this.g.heat = 0;
    this.placeOnTable();
    this.newKit();
  }

  /** A fresh starter and plug lying on the table next to the rocket. */
  newKit() {
    for (const o of [this.starter?.group, this.plug?.group]) o?.parent?.remove(o);
    this.starter = new Starter();
    this.plug = new IgniterPlug();
    this.scene.add(this.starter.group, this.plug.group);
    this.g.starter = 'kit';
    this.g.plug = 'kit';
    this.placeKit();
  }

  placeKit() {
    const onTable = this.g.rocketAt === 'table';
    let sp;
    let pp;
    let dir;
    if (onTable) {
      const noz = this.nozzleWorld(0) || TABLE_POS.clone();
      const back = this.tableAlong.clone().negate();
      sp = noz.clone().addScaledVector(back, 0.07).addScaledVector(this.tableAcross, 0.1).setY(this.table.height + 0.002);
      pp = noz.clone().addScaledVector(back, 0.05).addScaledVector(this.tableAcross, 0.15).setY(this.table.height + 0.004);
      dir = this.tableAlong.clone();
    } else {
      // in your hand, at the bottom of the close-up view
      const cam = this.world.camera;
      const f = cam.getWorldDirection(V(0, 0, 0));
      const r = V(1, 0, 0).applyQuaternion(cam.quaternion);
      const u = V(0, 1, 0).applyQuaternion(cam.quaternion);
      sp = cam.position.clone().addScaledVector(f, 0.16).addScaledVector(r, 0.045).addScaledVector(u, -0.045);
      pp = cam.position.clone().addScaledVector(f, 0.16).addScaledVector(r, 0.075).addScaledVector(u, -0.03);
      dir = r.clone().negate();
    }
    if (this.g.starter === 'kit') {
      this.starter.group.position.copy(sp);
      this.starter.group.quaternion.setFromUnitVectors(UP, dir);
      this.starter.group.rotateY(Math.PI / 2);
      this.kitStarterHome = { p: this.starter.group.position.clone(), q: this.starter.group.quaternion.clone() };
    }
    if (this.g.plug === 'kit') {
      this.plug.group.position.copy(pp);
      this.plug.group.quaternion.setFromUnitVectors(UP, V(0, 0, 1).applyAxisAngle(UP, 0.4));
      this.kitPlugHome = { p: this.plug.group.position.clone(), q: this.plug.group.quaternion.clone() };
    }
  }

  nozzleWorld(stageIdx, motorIdx = 0) {
    const m = this.model?.sections[stageIdx]?.motors[motorIdx];
    if (!m) return null;
    m.group.updateMatrixWorld(true);
    return m.group.localToWorld(V(0, -0.001, 0));
  }

  motorAxisWorld() {
    const m = this.model.igniterMotor;
    return V(0, 1, 0).applyQuaternion(m.group.getWorldQuaternion(new THREE.Quaternion()));
  }

  rocketHandPose() {
    const cam = this.world.camera;
    const f = cam.getWorldDirection(V(0, 0, 0)).setY(0).normalize();
    const r = V(-f.z, 0, f.x);
    const axis = UP.clone().multiplyScalar(0.92).addScaledVector(f, 0.3).addScaledVector(r, -0.1).normalize();
    const L = this.geom.length;
    const grip = this.player.pos.clone().add(V(0, 1.12, 0)).addScaledVector(f, 0.38).addScaledVector(r, 0.24);
    return { tail: grip.addScaledVector(axis, -L * 0.42), axis };
  }

  // ===================================================================== interactions
  focusCandidates() {
    const g = this.g;
    const out = [];
    const deflector = this.pad.tilt.localToWorld(V(0, this.pad.deflectorY, 0));
    if (g.rocketAt === 'table') {
      const ready = g.starter === 'installed' && g.plug === 'installed' && this.starter.bend > 0.99;
      out.push({ p: this.table.topPoint(0, 0), reach: 1.9, label: ready ? 'Pick up the rocket' : 'Install the starter (igniter) in the motor', act: () => (ready ? this.pickUpRocket() : this.enterPrep()) });
    }
    if (g.rocketAt === 'hands') {
      out.push({ p: deflector, reach: 1.6, label: g.capOn ? 'Slide the rocket onto the rod (take the rod cap off first)' : 'Slide the rocket onto the launch rod', act: () => this.loadOntoRod() });
      out.push({ p: this.table.topPoint(0, 0), reach: 1.6, label: 'Put the rocket back on the table', act: () => this.resetRocketToTable() });
    }
    if (g.rocketAt !== 'pad' && g.rocketAt !== 'loading' && g.rocketAt !== 'flight') {
      out.push({ p: this.pad.rodTop(), reach: 2.0, label: g.capOn ? 'Remove the rod safety cap' : 'Put the rod cap back on', act: () => this.toggleCap() });
    }
    if (g.rocketAt === 'pad') {
      if (g.starter === 'burnt' || g.starter === 'kit' || g.plug === 'kit') {
        out.push({ p: deflector.clone().add(V(0, 0.1, 0)), reach: 1.7, label: 'Replace the starter', act: () => this.enterPrep() });
      } else {
        out.push({ p: deflector.clone().add(V(0, 0.06, 0)), reach: 1.7, label: g.clipOn.every((c) => c !== null) ? 'Check the micro-clips' : 'Hook up the micro-clips', act: () => this.enterClips() });
      }
      if (g.clipOn.every((c) => c === null)) out.push({ p: deflector.clone().add(V(0, this.geom.length * 0.6, 0)), reach: 1.6, label: 'Take the rocket off the rod', act: () => this.takeOffRod() });
    }
    if (g.controller === 'ground') out.push({ p: this.controller.group.position.clone(), reach: 1.8, label: 'Pick up the launch controller', act: () => this.pickUpController() });
    if (this.flight?.done && !g.recovered) {
      const p = this.model.root.position.clone();
      out.push({ p, reach: 3.0, label: 'Recover the rocket', act: () => this.recoverRocket() });
    }
    return out;
  }

  updateFocus() {
    if (!this.model || !this.starter) return;
    if (this.closeup.active || this.view !== 'eyes' || this.g.rocketAt === 'loading' || this.g.rocketAt === 'pickup') {
      this.focus = null;
      this.hud.setPrompt(null);
      return;
    }
    const eye = this.player.eyePos();
    const fwd = this.player.forward();
    let best = null;
    let bestScore = Infinity;
    for (const c of this.focusCandidates()) {
      const d = c.p.clone().sub(eye);
      const flat = Math.hypot(d.x, d.z);
      if (flat > c.reach) continue;
      const ang = d.angleTo(fwd);
      if (ang > 0.75) continue;
      const score = ang + flat * 0.15;
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    }
    this.focus = best;
    if (best) this.hud.setPrompt(best.label);
    else if (this.g.controller === 'hand' && !this.flight) this.hud.setPrompt('Raise the controller to look at it · G puts it down');
    else this.hud.setPrompt(null);
  }

  interact() {
    if (this.closeup.active) {
      this.leaveCloseup();
      return;
    }
    if (this.focus) {
      this.focus.act();
      return;
    }
    if (this.g.controller === 'hand') this.enterControllerCloseup();
  }

  leaveCloseup() {
    const id = this.closeup.active?.id;
    this.closeup.exit();
    if (id === 'controller') this.g.controller = 'hand';
  }

  toggleCap() {
    if (this.g.capOn) {
      this.pad.removeCap();
      this.g.capOn = false;
    } else {
      this.pad.restoreCap();
      this.g.capOn = true;
    }
    this.sound.click();
  }

  pickUpRocket() {
    const m = this.model;
    // each part (or the whole rocket) flies from the table into your hands; separate stages stack on the way
    const items = m.sections.map((s, i) => ({ s, from: { p: s.group.position.clone(), q: s.group.quaternion.clone() }, start: this.assembly ? i * 0.45 : 0 }));
    this.anim = { kind: 'pickup', t: 0, items, dur: 0.7, total: Math.max(...items.map((i) => i.start)) + 0.75 };
    this.g.rocketAt = 'pickup';
    if (this.assembly) this.toast('Stacking the stages: each coupler slides into the stage above.');
  }

  loadOntoRod() {
    if (this.g.capOn) {
      this.toast('Take the safety cap off the launch rod first (look at the top of the rod and press E).');
      return;
    }
    const tailFinal = this.tailOnPad();
    const dir = this.pad.rodDirection();
    this.alignRoll();
    const qFinal = this.model.orient(dir);
    const rodTopH = this.pad.rodSpec.len + 0.06;
    const from = { p: this.model.root.position.clone(), q: this.model.root.quaternion.clone() };
    const above = tailFinal.clone().addScaledVector(dir, rodTopH);
    this.anim = { kind: 'load', t: 0, from, above, to: { p: tailFinal, q: qFinal }, total: 2.3 };
    this.g.rocketAt = 'loading';
  }

  takeOffRod() {
    this.g.rocketAt = 'hands';
    this.model.resetAttachments();
    this.toast('Rocket off the rod.');
  }

  updateAnim(dt) {
    const A = this.anim;
    if (!A) return;
    A.t += dt;
    const m = this.model;
    if (A.kind === 'pickup') {
      const hp = this.rocketHandPose();
      m.setPose(hp.tail, hp.axis);
      for (const it of A.items) {
        const k = ease(Math.max(0, Math.min(1, (A.t - it.start) / A.dur)));
        it.s.group.position.lerpVectors(it.from.p, m.root.position, k);
        it.s.group.quaternion.slerpQuaternions(it.from.q, m.root.quaternion, k);
      }
      if (A.t >= A.total) {
        this.anim = null;
        for (const s of m.sections) s.attached = true;
        this.g.rocketAt = 'hands';
      }
    } else if (A.kind === 'load') {
      const k = Math.min(1, A.t / A.total);
      if (k < 0.42) {
        const e = ease(k / 0.42);
        m.root.position.lerpVectors(A.from.p, A.above, e);
        m.root.position.y += Math.sin(e * Math.PI) * 0.15;
        m.root.quaternion.slerpQuaternions(A.from.q, A.to.q, e);
      } else {
        const e = ease((k - 0.42) / 0.58);
        m.root.position.lerpVectors(A.above, A.to.p, e);
        m.root.quaternion.copy(A.to.q);
      }
      m.root.updateMatrixWorld(true);
      if (k >= 1) {
        this.anim = null;
        this.g.rocketAt = 'pad';
        this.placeOnPad();
        this.sound.click();
        this.toast('On the pad. Now hook up the micro-clips (look at the bottom of the rocket, press E).');
      }
    }
    m.updateAttached();
    m.updateClipping();
  }

  // ---- close-up: starter + plug -------------------------------------------
  enterPrep() {
    const g = this.g;
    const onPad = g.rocketAt === 'pad';
    if (onPad) {
      if (this.controller.keyState === 'in') {
        this.toast('<b>Safety:</b> take the key out of the launch controller before working on the rocket.');
        return;
      }
      // pull the old (burnt) starter and plug out, unclip, and take a fresh one from your pocket
      g.clipOn = [null, null];
      this.newKit();
      if (onPad) this.toast('You unclip the leads and pull out the old starter. Fresh starter and plug in hand.');
    }
    const motor = this.model.igniterMotor;
    const camPose = () => {
      const N = this.nozzleWorld(0);
      const a = this.motorAxisWorld();
      if (!onPad) {
        const kit = this.kitStarterHome ? this.kitStarterHome.p : N;
        const mid = new THREE.Vector3().lerpVectors(N, kit, 0.45);
        const pos = mid.clone().addScaledVector(a, -0.17).addScaledVector(this.tableAcross, 0.06).add(V(0, 0.16, 0));
        return { pos, look: mid, fov: 44 };
      }
      const side = this.player.pos.clone().setY(0).sub(N.clone().setY(0)).normalize();
      const pos = N.clone().addScaledVector(side, 0.17).add(V(0, -0.02, 0));
      pos.y = Math.max(pos.y, 0.07);
      return { pos, look: N.clone().add(V(0, -0.012, 0)), fov: 46 };
    };
    const target = () => this.nozzleWorld(0).addScaledVector(this.motorAxisWorld(), 0.002);
    const grabAlign = (obj) => {
      obj.quaternion.copy(motor.group.getWorldQuaternion(new THREE.Quaternion()));
    };
    const moveTip = (obj, tipLocal) => (p) => {
      obj.updateMatrixWorld(true);
      const tipW = obj.localToWorld(tipLocal.clone());
      obj.position.add(p.clone().sub(tipW));
    };
    const starterTip = V(0, 0.017, 0);
    const plugTip = V(0, 0.009, 0);
    const spec = {
      id: 'prep',
      cam: camPose,
      draggables: [
        {
          obj: this.starter.group,
          enabled: () => g.starter === 'kit',
          tip: () => this.starter.group.localToWorld(starterTip.clone()),
          onGrab: () => grabAlign(this.starter.group),
          onMove: moveTip(this.starter.group, starterTip),
          targets: () => [{ pos: target(), ok: () => true, onSnap: () => this.installStarter() }],
          onRelease: () => this.returnKit('starter'),
        },
        {
          obj: this.plug.group,
          enabled: () => g.plug === 'kit',
          tip: () => this.plug.group.localToWorld(plugTip.clone()),
          onGrab: () => grabAlign(this.plug.group),
          onMove: moveTip(this.plug.group, plugTip),
          targets: () => [{ pos: target(), ok: () => g.starter === 'installed', why: 'Put the starter in first — the plug holds it against the propellant.', onSnap: () => this.installPlug() }],
          onRelease: () => this.returnKit('plug'),
        },
      ],
      pressables: [
        {
          obj: this.starter.group,
          enabled: () => g.starter === 'installed' && g.plug === 'installed' && this.starter.bend < 0.99,
          onDown: () => {
            this.bendAnim = 0;
            this.sound.click();
          },
        },
      ],
      hint: () => {
        const s1 = g.starter === 'installed';
        const s2 = g.plug === 'installed';
        const s3 = this.starter.bend > 0.99;
        const li = (done, txt) => `<div class="${done ? 'ok' : ''}">${done ? '✓' : '•'} ${txt}</div>`;
        return `<b>Install the starter</b> — drag with the mouse.
          ${li(s1, 'Drag the starter (copper leads, dark tip) into the motor nozzle until the tip touches the propellant.')}
          ${li(s2, 'Drag the red plastic plug into the nozzle to hold the starter in place.')}
          ${li(s3, 'Click the leads to bend them apart so they can’t touch each other.')}
          <div style="margin-top:6px;color:var(--muted)">${s1 && s2 && s3 ? '<span class="ok">Ready.</span> ' : ''}Press <kbd>E</kbd> or <kbd>Esc</kbd> to finish.</div>`;
      },
    };
    if (onPad) this.placeKitInHandAfterTween = true;
    this.closeup.enter(spec);
  }

  returnKit(which) {
    const o = which === 'starter' ? this.starter.group : this.plug.group;
    const h = which === 'starter' ? this.kitStarterHome : this.kitPlugHome;
    if (h) {
      o.position.copy(h.p);
      o.quaternion.copy(h.q);
    }
  }

  installStarter() {
    const motor = this.model.igniterMotor;
    motor.group.attach(this.starter.group);
    (this.slides ||= []).push({ obj: this.starter.group, from: this.starter.group.position.clone(), fromQ: this.starter.group.quaternion.clone(), t: 0 });
    this.g.starter = 'installed';
    this.sound.click();
  }

  installPlug() {
    const motor = this.model.igniterMotor;
    motor.group.attach(this.plug.group);
    (this.slides ||= []).push({ obj: this.plug.group, from: this.plug.group.position.clone(), fromQ: this.plug.group.quaternion.clone(), t: 0 });
    this.g.plug = 'installed';
    this.sound.click();
  }

  updateSlide(dt) {
    for (const S of this.slides || []) {
      S.t = Math.min(1, S.t + dt / 0.3);
      const e = ease(S.t);
      S.obj.position.lerpVectors(S.from, V(0, 0, 0), e);
      S.obj.quaternion.slerpQuaternions(S.fromQ, new THREE.Quaternion(), e);
    }
    if (this.slides) this.slides = this.slides.filter((S) => S.t < 1);
    if (this.bendAnim !== undefined && this.bendAnim !== null) {
      this.bendAnim = Math.min(1, this.bendAnim + dt / 0.45);
      this.starter.setBend(ease(this.bendAnim));
      if (this.bendAnim >= 1) this.bendAnim = null;
    }
  }

  // ---- close-up: micro-clips ---------------------------------------------
  clipParked(i) {
    const N = this.nozzleWorld(0);
    const side = (this.clipSide || V(1, 0, 0)).clone();
    const perp = V(-side.z, 0, side.x);
    const deflY = this.pad.tilt.localToWorld(V(0, this.pad.deflectorY, 0)).y;
    const p = N.clone().addScaledVector(side, 0.047).addScaledVector(perp, i ? 0.022 : -0.022).setY(deflY + 0.003);
    return { p, dir: side.clone().negate() };
  }

  enterClips() {
    const g = this.g;
    if (this.controller.keyState === 'in') {
      this.toast('<b>Safety:</b> never hook up the igniter with the key in the launch controller. Take the key out first.');
      return;
    }
    if (this.starter.bend < 0.99) {
      this.toast('Bend the starter leads apart first.');
      return;
    }
    const N0 = this.nozzleWorld(0);
    this.clipSide = this.player.pos.clone().setY(0).sub(N0.clone().setY(0)).normalize();
    const camPose = () => {
      const N = this.nozzleWorld(0);
      const pos = N.clone().addScaledVector(this.clipSide, 0.2).add(V(0, 0.075, 0));
      return { pos, look: N.clone().addScaledVector(this.clipSide, 0.03).add(V(0, -0.01, 0)), fov: 45 };
    };
    const leadTargets = (i) => () => {
      const ends = this.starter.leadEnds();
      return ends.map((p, lead) => ({
        pos: p,
        ok: () => g.clipOn[1 - i] !== lead,
        why: 'That lead already has a clip. One clip per lead — if the clips touch, the circuit shorts.',
        onSnap: () => {
          g.clipOn[i] = lead;
          this.dragClip = null;
          this.sound.click();
        },
      }));
    };
    const spec = {
      id: 'clips',
      cam: camPose,
      draggables: [0, 1].map((i) => ({
        obj: this.lead.clips[i],
        tip: () => this.lead.clips[i].userData.tip || this.clipParked(i).p,
        onGrab: () => {
          g.clipOn[i] = null;
          this.dragClip = { i, dir: this.clipParked(i).dir };
        },
        onMove: (p) => {
          this.dragClip = { i, p, dir: this.dragClip?.dir || this.clipParked(i).dir };
        },
        targets: leadTargets(i),
        onRelease: () => {
          this.dragClip = null;
        },
      })),
      hint: () => {
        const n = g.clipOn.filter((c) => c !== null).length;
        return `<b>Hook up the micro-clips</b> — drag each clip onto a starter lead.
          <div class="${n === 2 ? 'ok' : ''}">${n === 2 ? '✓ Both clips on — one per lead.' : `${n}/2 clips attached.`}</div>
          <div style="color:var(--muted)">Keep the clips from touching each other, the launch rod and the blast deflector. Then walk back to the controller. <kbd>E</kbd>/<kbd>Esc</kbd> to stand up.</div>`;
      },
    };
    this.closeup.enter(spec);
  }

  updateClips() {
    const g = this.g;
    if (!this.starter || !this.model) return;
    const ends = g.starter !== 'kit' && g.rocketAt === 'pad' ? this.starter.leadEnds() : null;
    const dirs = ends ? this.starter.leadDirs() : null;
    for (let i = 0; i < 2; i++) {
      if (this.dragClip?.i === i && this.dragClip.p) {
        this.lead.setClip(i, this.dragClip.p, this.dragClip.dir);
      } else if (g.clipOn[i] !== null && ends) {
        const L = g.clipOn[i];
        const out = dirs[L].clone();
        const dir = out.negate().add(V(0, -0.35, 0)).normalize();
        this.lead.setClip(i, ends[L], dir);
      } else if (g.rocketAt === 'pad' && this.nozzleWorld(0)) {
        const pk = this.clipParked(i);
        this.lead.setClip(i, pk.p, pk.dir);
      } else {
        // lying in the grass by the pad leg
        const p = V(-0.16 + i * 0.03, 0.006, 0.22 + i * 0.02);
        this.lead.setClip(i, p, V(0.6, 0, -0.8).normalize());
      }
    }
  }

  // ---- launch controller ----------------------------------------------------
  pickUpController() {
    this.g.controller = 'hand';
    this.controller.held = true;
    this.player.tether = { x: JUNCTION.x, z: JUNCTION.z, r: CORD_LENGTH - 0.45 };
    this.sound.click();
    this.enterControllerCloseup();
  }

  putDownController() {
    if (this.closeup.active?.id === 'controller') this.closeup.exit();
    this.g.controller = 'ground';
    this.controller.held = false;
    this.setKeyPushed(false);
    this.setLaunchPressed(false);
    const f = this.player.forward().setY(0).normalize();
    this.controllerGround = this.player.pos.clone().addScaledVector(f, 0.45).setY(0.017);
    this.player.tether = null;
    this.placeController();
    if (this.controller.keyState === 'out') this.toast('Controller down. The safety key is in your pocket.');
  }

  placeController() {
    const c = this.controller.group;
    const home = this.controllerGround || CONTROLLER_HOME;
    c.position.copy(home);
    const toPad = V(0, 0, 0).sub(home).setY(0).normalize();
    c.quaternion.setFromAxisAngle(UP, Math.atan2(toPad.x, toPad.z));
    this.cordDirty = true;
  }

  enterControllerCloseup() {
    this.g.controller = 'inspect';
    const c = this.controller;
    const g = this.g;
    const spec = {
      id: 'controller',
      cam: null,
      draggables: [
        {
          obj: c.key,
          tip: () => c.key.localToWorld(V(0, -0.0195, 0)),
          onGrab: () => {
            c.dragging = true;
            g.keyPushed = false;
            c.setKeyPushed(false);
          },
          onMove: (p) => {
            c.key.rotation.set(0, 0, 0);
            const tipW = c.key.localToWorld(V(0, -0.0195, 0));
            setWorldPosition(c.key, c.key.getWorldPosition(V(0, 0, 0)).add(p.clone().sub(tipW)));
          },
          targets: () => [
            {
              pos: c.slotWorld(),
              ok: () => true,
              onSnap: () => {
                c.dragging = false;
                c.setKeyState('in');
                this.sound.click();
                this.safetyNag();
              },
            },
          ],
          onRelease: () => {
            c.dragging = false;
            // pulled out of the slot and let go: it goes back in your other hand
            if (c.keyState === 'in' && c.key.position.distanceTo(c.keyUp) > 0.012) {
              c.setKeyState('out');
              this.sound.click();
            }
            c.applyKey();
          },
        },
      ],
      pressables: [
        {
          obj: c.button,
          onDown: () => this.setLaunchPressed(true),
          onUp: () => this.setLaunchPressed(false),
        },
      ],
      onRight: (down) => this.setKeyPushed(down),
      hint: () => {
        const keyIn = c.keyState === 'in';
        const li = (done, txt) => `<div class="${done ? 'ok' : ''}">${done ? '✓' : '•'} ${txt}</div>`;
        const cont = this.continuity();
        return `<b>Electron Beam launch controller</b>
          ${li(keyIn, 'Drag the safety key into the slot.')}
          ${li(keyIn && g.keyPushed && cont, 'Push the key down and HOLD it: <kbd>right mouse</kbd> or <kbd>K</kbd>. The LED lights if the circuit is good.')}
          ${li(this.flight, 'Keep holding the key, count down (<kbd>C</kbd>), then press and hold LAUNCH: <kbd>click the button</kbd> or <kbd>Space</kbd>.')}
          ${keyIn && g.keyPushed && !cont ? '<div class="warn">No continuity — check the starter is in and both clips are on the leads.</div>' : ''}
          <div style="margin-top:6px;color:var(--muted)"><kbd>E</kbd> lowers the controller so you can watch the rocket (keys still work) · <kbd>G</kbd> puts it down · drag the key out to remove it.</div>`;
      },
      onExit: () => {},
    };
    this.closeup.enter(spec);
  }

  /** Controller pose: on the ground, held low in your hands, or raised to look at it. */
  updateControllerPose() {
    const c = this.controller.group;
    const g = this.g;
    if (g.controller === 'ground') return;
    const cam = this.world.camera;
    const f = cam.getWorldDirection(V(0, 0, 0));
    const r = V(1, 0, 0).applyQuaternion(cam.quaternion);
    const u = V(0, 1, 0).applyQuaternion(cam.quaternion);
    const inspect = g.controller === 'inspect';
    const watching = !inspect && this.flight && !this.flight.done;
    const p = cam.position.clone().addScaledVector(f, inspect ? 0.27 : 0.32).addScaledVector(r, inspect ? -0.01 : -0.05).addScaledVector(u, inspect ? -0.035 : watching ? -0.3 : -0.2);
    c.position.copy(p);
    const q = cam.quaternion.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(inspect ? 1.05 : 0.8, Math.PI, inspect ? 0 : -0.12)));
    c.quaternion.copy(q);
    this.cordDirty = true;
  }

  continuity() {
    const g = this.g;
    return g.rocketAt === 'pad' && g.starter === 'installed' && g.clipOn[0] !== null && g.clipOn[1] !== null && g.clipOn[0] !== g.clipOn[1];
  }

  setKeyPushed(down) {
    if (this.g.controller === 'ground' && down) return;
    this.g.keyPushed = down && this.controller.keyState === 'in';
    this.controller.setKeyPushed(this.g.keyPushed);
  }

  setLaunchPressed(down) {
    if (this.g.controller === 'ground' && down) return;
    if (down && !this.g.launchPressed) this.sound.click();
    this.g.launchPressed = down;
    this.controller.setPressed(down);
  }

  safetyNag() {
    const near = this.player.pos.length() < 3 && this.g.rocketAt === 'pad';
    if (near) this.toast('<b>Safety:</b> never put the key in while you or anyone else is near a flight-ready rocket. Walk back the full length of the cord.');
  }

  /** Circuit & igniter: LED, heating, ignition (or misfire). */
  updateCircuit(dt) {
    const g = this.g;
    const c = this.controller;
    const armed = c.keyState === 'in' && g.keyPushed;
    const circuit = armed && this.continuity() && g.rocketAt === 'pad';
    // LED shows continuity; it goes out while the button sends current to the starter
    c.setLed(circuit && !g.launchPressed);
    if (circuit && !g.launchPressed) g.ledSeen = true;
    const firing = circuit && g.launchPressed && !this.flight;
    if (firing) {
      if (!this.flightPrep || this.flightPrep.stale) this.prepareFlight();
      g.heat += dt / this.flightPrep.ignitionDelay;
      if (Math.random() < dt * 6) this.sound.fizz();
    } else g.heat = Math.max(0, g.heat - dt * 1.5);
    if (this.starter && g.starter === 'installed') {
      this.starter.setHeat(Math.min(1, g.heat));
      const noz = this.nozzleWorld(0);
      if (g.heat > 0.55 && noz) this.effects.igniterSparks(noz.toArray());
    }
    if (g.heat >= 1 && firing) {
      g.heat = 0;
      if (this.flightPrep.misfire) {
        g.starter = 'burnt';
        this.starter.setBurnt();
        const noz = this.nozzleWorld(0);
        for (let i = 0; i < 6; i++) noz && this.effects.wisp(noz.toArray());
        this.flightPrep = null;
        this.toast('<b>Misfire!</b> The starter burned but the motor didn’t light. Take the key out, wait a minute, then replace the starter.', 7000);
      } else this.startFlight();
    }
    // keep the user honest about pad safety
    if (c.keyState === 'in' && g.rocketAt === 'pad' && this.player.pos.length() < 2.2 && this.time - (this._nagT || -99) > 8) {
      this._nagT = this.time;
      this.toast('<b>Safety:</b> the safety key is still in the controller while you’re at the pad!');
    }
  }

  countdown() {
    if (this._cd) return;
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
        this._cd = null;
        el.textContent = 'LAUNCH!';
        this.sound.beep(990, 0.4, 0.3);
        setTimeout(() => el.classList.add('hidden'), 900);
      }
    }, 1000);
  }

  // ===================================================================== flight
  prepareFlight() {
    const vary = this.state.launch.variability;
    const seed = vary ? (Math.random() * 1e9) | 0 : 1;
    const sim = simulate(this.buildVehicle(), this.launchParams(seed));
    // Estes starters typically fire after ~0.5–1.5 s of current
    this.flightPrep = { sim, ignitionDelay: 0.55 + (vary ? Math.random() : 0.45) * 0.9, misfire: vary && Math.random() < 0.04 };
  }

  startFlight() {
    const sim = this.flightPrep.sim;
    const last = sim.samples[sim.samples.length - 1];
    const boosterEnd = Math.max(0, ...sim.boosters.map((b) => b.landing.t));
    this.flight = { sim, endT: Math.max(last.t, boosterEnd) + 1.5, events: sim.events.slice(), firedEvents: new Set(), lastIdx: 0, done: false };
    this.reportSim = sim;
    this.flightPrep = null; // the next launch gets a fresh simulation
    this.playT = 0;
    this.effects.resetTrails();
    this.trail.geometry.setDrawRange(0, 0);
    this.sound.startRoar();
    // the starter is blown out of the nozzle; the clips drop off
    this.starter.group.visible = false;
    this.plug.group.visible = false;
    this.g.starter = 'spent';
    this.g.clipOn = [null, null];
    this.g.rocketAt = 'flight';
    this.g.recovered = false;
    // look up! drop the controller to your side and lock your view onto the rocket
    if (this.closeup.active) this.leaveCloseup();
    if (this.g.controller === 'inspect') this.g.controller = 'hand';
    if (this.view === 'eyes') {
      this.track = true;
      this.player.lookAt(this.tailOnPad().add(V(0, this.geom.length * 0.6, 0)));
      this.player.zoom = 1;
    }
    $('#hud').classList.remove('hidden');
    this.hudChart.set({ series: [{ name: 'Altitude', color: '#ff6a1f', unit: 'm', points: sim.samples.map((s) => [s.t, s.alt]) }], yLabel: 'Alt (m)' });
    this.renderResults();
    $('#reportBtn').classList.remove('hidden');
  }

  replay() {
    if (!this.reportSim) return;
    $('#results').classList.add('hidden');
    this.placeOnPad();
    this.flightPrep = { sim: this.reportSim };
    this.startFlight();
  }

  cancelFlight() {
    this.flight = null;
    this.sound.stopRoar();
    $('#hud').classList.add('hidden');
    this.trail.geometry.setDrawRange(0, 0);
    this.hud.setMarker(null);
    if (this.model) for (const f of this.model.flames) f.flame.visible = false;
  }

  recoverRocket() {
    const used = this.state.stages.map((s) => getMotor(s.motorId)?.designation).join(' + ');
    this.g.recovered = true;
    this.resetRocketToTable();
    this.toast(`Rocket recovered and back on the prep table. Spent motor out, fresh ${used} in. Install a new starter.`, 5500);
  }

  resetRange() {
    this.closeup.exit();
    this.resetRocketToTable();
    this.g.capOn = true;
    this.pad.restoreCap();
    this.controller.setKeyState('out');
    this.g.controller = 'ground';
    this.controller.held = false;
    this.controllerGround = null;
    this.player.tether = null;
    this.placeController();
    this.effects.clear();
    $('#reportBtn').classList.add('hidden');
    $('#results').classList.add('hidden');
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
    this.rocketSample = s;
    const model = this.model;
    const vehicle = sim.vehicle;

    for (const ev of F.events) {
      if ((ev.t > prevT || (ev.t === 0 && prevT === 0)) && ev.t <= t && !F.firedEvents.has(ev)) {
        F.firedEvents.add(ev);
        this.onEvent(ev, s);
      }
    }

    if (s.phase === 'recovery' || landed) {
      const wd = headingVector(sim.env.windFrom + 180);
      model.poseRecovery(s.p, s.a, s.xcg, Math.min(1, s.recovery * 1.2 + (landed ? 1 : 0)), this.time, landed, wd);
    } else {
      model.setPoseFromCG(s.p, s.a, s.xcg);
      for (const sec of model.sections) if (sec.k >= s.lowIdx) sec.attached = true;
      model.updateAttached();
    }
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
      const p = V(pj[0] + (pk[0] - pj[0]) * k, pj[1] + (pk[1] - pj[1]) * k, pj[2] + (pk[2] - pj[2]) * k);
      const a0 = V(...b.axis0);
      let axis;
      if (t >= b.landing.t) {
        axis = V(0.9, 0, 0.4).normalize();
        p.y = this.geom.refRadius + Math.max(0, ...this.geom.finSets.map((f) => f.span)) * 0.5;
      } else {
        const perp = new THREE.Vector3().crossVectors(a0, V(0, 1, 0.3)).normalize();
        axis = a0.clone().applyAxisAngle(perp, Math.min(1, (t - t0) * 1.5) * (t - t0) * b.spin);
      }
      sec.group.quaternion.copy(this.model.orient(axis));
      sec.group.position.copy(p).addScaledVector(axis, -b.cgFromTail);
    }
    model.updateClipping();

    const simDt = (t - prevT);
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
        if (simDt <= 0) return;
        const noz = mo.group.localToWorld(V(0, -0.003, 0));
        const axis = V(0, 1, 0).applyQuaternion(mo.group.getWorldQuaternion(new THREE.Quaternion()));
        const vel = k >= s.lowIdx ? s.v : [0, 0, 0];
        const key = k * 10 + j;
        const look = propellantLook(mi.motor.propellant);
        if (T > 0) this.effects.exhaust(simDt, noz.toArray(), axis.toArray(), vel, frac, look, false, key);
        else {
          const bo = mi.inst.burnoutTime();
          const ej = mi.inst.ejectionTime();
          if (bo !== null && t > bo && ej !== null && t < ej && k >= s.lowIdx) this.effects.exhaust(simDt, noz.toArray(), axis.toArray(), vel, 0, look, true, key);
          else this.effects.lastPos?.delete(key);
        }
      });
    });
    const camDist = this.world.camera.position.distanceTo(V(...s.p));
    this.sound.setRoar(peakTotal ? thrustTotal / Math.max(8, peakTotal * 0.5) : 0, camDist);

    this.updateTrail(t);
    $('#hudT').textContent = t.toFixed(2);
    $('#hudAlt').textContent = Math.max(0, s.alt).toFixed(1);
    $('#hudVel').textContent = Math.hypot(...s.v).toFixed(1);
    $('#hudAcc').textContent = (s.acc / 9.81).toFixed(1);
    $('#hudThr').textContent = thrustTotal.toFixed(1);
    $('#hudPhase').textContent = landed ? 'landed' : phaseName(s, sim);
    if (Math.floor(t * 10) !== Math.floor(prevT * 10)) this.hudChart.setCursor(t);

    if (t >= F.endT && !F.done) {
      F.done = true;
      this.sound.stopRoar();
      const sm = sim.summary;
      this.toast(`Touchdown ${sm.drift?.toFixed(0) ?? '?'} m from the pad. Apogee ${sm.apogee.toFixed(0)} m. Take the key out, then walk over and recover it (<kbd>P</kbd> for the flight report).`, 8000);
    }
  }

  onEvent(ev, s) {
    const dist = this.world.camera.position.distanceTo(V(...s.p));
    switch (ev.type) {
      case 'ignition': {
        const n = this.nozzleWorld(0);
        const look = propellantLook(this.flight.sim.vehicle.stages[0].instances[0]?.motor.propellant);
        if (n) this.effects.padBlast(n.toArray(), Math.round(160 * look.smokeRate) + 20, look);
        break;
      }
      case 'stage-ignition':
        this.sound.pop(dist);
        break;
      case 'ejection': {
        const top = this.model.sections[this.model.sections.length - 1];
        const p = top.group.localToWorld(V(0, this.model.noseBase, 0));
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
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffb547, transparent: true, opacity: 0.0 }));
    line.frustumCulled = false;
    this.scene.add(line);
    return line;
  }

  updateTrail(t) {
    // the trajectory line is shown only in X-ray (analysis) mode
    this.trail.material.opacity = $('#xray').checked ? 0.55 : 0;
    const pos = this.trail.geometry.attributes.position;
    const S = this.flight.sim.samples;
    let n = 0;
    for (let i = 0; i < S.length && S[i].t <= t && n < pos.count; i++, n++) pos.setXYZ(n, S[i].p[0], S[i].p[1], S[i].p[2]);
    pos.needsUpdate = true;
    this.trail.geometry.setDrawRange(0, n);
  }

  // ===================================================================== results
  renderResults() {
    const sim = this.reportSim;
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
    const sim = this.reportSim;
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
    this.orbit.enabled = v === 'orbit';
    if (v === 'orbit') {
      const target = this.rocketPos();
      this.orbit.target.copy(target);
      this.world.camera.position.copy(target).add(V(1.5, 0.8, 1.5).multiplyScalar(Math.max(1, this.geom.length * 3)));
      this.player.releaseLock();
    }
    if (v !== 'eyes') this.player.releaseLock();
  }

  rocketPos() {
    if (this.flight && this.rocketSample) return V(...this.rocketSample.p);
    return this.model ? this.model.root.position.clone().addScaledVector(V(0, 1, 0).applyQuaternion(this.model.root.quaternion), this.geom.length * 0.5) : V(0, 0.5, 0);
  }

  updateCamera(dt) {
    const cam = this.world.camera;
    const target = this.rocketPos();
    const inCloseupCam = this.closeup.active && this.closeup.active.cam;
    if (this.view === 'eyes') {
      if (!inCloseupCam) {
        // track assist; if you move the mouse it lets go for a moment so you can look around
        if (this.track && this.flight && !this.closeup.active && performance.now() - this.player.lastManualLook > 900) {
          this.player.steerToward(target, dt, this.playT < 1.5 ? 12 : 6);
          // keep the rocket a visible size: zoom like a spotter with binoculars
          const dist = this.player.eyePos().distanceTo(target);
          const want = THREE.MathUtils.clamp((dist * 0.05) / Math.max(0.05, this.geom.length), 1, 20);
          this.player.zoom += (want - this.player.zoom) * (1 - Math.exp(-dt * 2));
        }
        this.player.update(dt);
      } else this.closeup.update(dt);
      if (this.closeup.active && !inCloseupCam) this.closeup.update(dt);
    } else if (this.view === 'chase') {
      let v = V(0, 1, 0);
      if (this.flight && this.rocketSample) {
        v = V(...this.rocketSample.v);
        if (v.length() < 2) v.set(0, 1, 0);
        v.normalize();
      }
      this.chaseDir = (this.chaseDir || v.clone()).lerp(v, 1 - Math.exp(-dt * 3)).normalize();
      const back = Math.max(1.5, this.geom.length * 6);
      const eye = target.clone().addScaledVector(this.chaseDir, -back).add(V(back * 0.25, back * 0.15, back * 0.2));
      if (eye.y < 0.3) eye.y = 0.3;
      cam.position.copy(eye);
      cam.lookAt(target);
      cam.fov = 45;
    } else if (this.view === 'onboard') {
      const root = this.model.root;
      const ax = V(0, 1, 0).applyQuaternion(root.quaternion);
      const side = V(1, 0, 0).applyQuaternion(root.quaternion);
      const eye = root.position.clone().addScaledVector(ax, this.geom.length * 0.75).addScaledVector(side, this.geom.refRadius * 1.6);
      cam.position.copy(eye);
      cam.up.copy(side);
      cam.lookAt(eye.clone().addScaledVector(ax, -10).addScaledVector(side, 0.3));
      cam.up.set(0, 1, 0);
      cam.fov = 75;
    } else if (this.view === 'orbit') {
      const delta = target.clone().sub(this.orbit.target);
      this.orbit.target.add(delta);
      cam.position.add(delta);
      this.orbit.update();
      cam.fov = 50;
    }
    cam.updateProjectionMatrix();
    // shadows follow you around the range
    const sl = this.world.sunLight;
    const focus = this.player.pos.clone().multiplyScalar(0.5);
    sl.target.position.copy(focus);
    sl.position.copy(focus).addScaledVector(this.world.sun, 30);
    this.effects.setScale(this.world.renderer.domElement.height / 2);
  }

  /** Pointer to the rocket when it's off-screen or far away. */
  updateMarker() {
    if (!this.flight || this.g.recovered || this.view !== 'eyes' || this.closeup.active) {
      this.hud.setMarker(null);
      return;
    }
    const p = this.rocketPos();
    const cam = this.world.camera;
    const dist = cam.position.distanceTo(p);
    const ground = Math.hypot(p.x - this.player.pos.x, p.z - this.player.pos.z);
    const v = p.clone().project(cam);
    const behind = v.z > 1;
    const r = this.world.renderer.domElement.getBoundingClientRect();
    let x = ((v.x + 1) / 2) * r.width;
    let y = ((1 - v.y) / 2) * r.height;
    if (behind) {
      x = r.width - x;
      y = r.height - y;
    }
    const onScreen = !behind && x > 30 && x < r.width - 30 && y > 60 && y < r.height - 30;
    const cx = r.width / 2;
    const cy = r.height / 2;
    let angle = 0;
    if (!onScreen) {
      const dx = x - cx;
      const dy = y - cy;
      angle = Math.atan2(dx, -dy);
      const k = Math.min((cx - 40) / Math.abs(dx || 1e-6), (cy - 70) / Math.abs(dy || 1e-6));
      x = cx + dx * k;
      y = cy + dy * k;
    } else y -= 26;
    const landed = this.flight.done;
    const label = landed ? `Rocket · ${ground.toFixed(0)} m away` : `${Math.max(0, this.rocketSample?.alt ?? 0).toFixed(0)} m · ${dist.toFixed(0)} m`;
    if (onScreen && dist < 12 && !landed) {
      this.hud.setMarker(null);
      return;
    }
    this.hud.setMarker({ x, y, angle, onScreen, label });
  }

  updateChecklist() {
    if (!this.starter) return;
    const g = this.g;
    const c = this.controller;
    const flew = !!this.flight;
    const items = [
      { label: 'Install the starter &amp; plug (prep table)', done: flew || (g.starter === 'installed' && g.plug === 'installed' && this.starter.bend > 0.99) },
      { label: 'Take the safety cap off the rod', done: flew || !g.capOn },
      { label: 'Slide the rocket onto the rod', done: flew || g.rocketAt === 'pad' },
      { label: 'Clip a micro-clip to each starter lead', done: flew || (g.clipOn[0] !== null && g.clipOn[1] !== null) },
      { label: 'Walk back the cord length &amp; pick up the controller', done: flew || g.controller !== 'ground' },
      { label: 'Insert the safety key', done: flew || c.keyState === 'in' },
      { label: 'Push &amp; hold the key: continuity LED on', done: flew || (g.keyPushed && this.continuity()) },
      { label: 'Count down, then hold LAUNCH (keep holding the key)', done: flew },
      { label: 'Remove the safety key', done: flew && c.keyState === 'out' },
      { label: 'Recover the rocket', done: false },
    ];
    const cur = items.findIndex((i) => !i.done);
    if (cur >= 0) items[cur].current = true;
    this.hud.setChecklist(items);
  }

  // ===================================================================== main loop
  loop() {
    requestAnimationFrame(() => this.loop());
    const dt = Math.min(0.05, this.clock.getDelta());
    this.time += dt;
    this.pad.update(dt);
    this.updateAnim(dt);
    this.updateSlide(dt);
    if (this.g.rocketAt === 'hands') {
      const hp = this.rocketHandPose();
      this.model.setPose(hp.tail, hp.axis);
    }
    this.updateCamera(dt);
    this.updateControllerPose();
    this.controller.update(dt, this.time);
    this.updateCircuit(dt);
    if (this.flight) this.updateFlight(dt);
    if (this.model) {
      this.model.updateAttached();
      this.model.updateClipping();
    }
    if (this.placeKitInHandAfterTween && this.closeup.tween?.k >= 1) {
      this.placeKitInHandAfterTween = false;
      this.placeKit();
    }
    this.updateClips();
    if (this.cordDirty && this.time - (this._cordT || 0) > 0.05) {
      this._cordT = this.time;
      this.cordDirty = false;
      this.lead.setEnds(this.controller.cordExitWorld(), JUNCTION);
    }
    this.lead.update();
    this.effects.update(dt * (this.flight && !this.flight.done ? this.speed : 1));
    this.env.update(dt, this.time, this.effects.windVec, this.player.pos);
    this.updateFocus();
    this.updateMarker();
    // don't cover the rocket with the crosshair while you're tracking it
    document.body.classList.toggle('tracking', !!(this.track && this.flight && !this.flight.done));
    if (Math.floor(this.time * 4) !== Math.floor((this.time - dt) * 4)) this.updateChecklist();
    this.world.render(this.time);
  }
}

function phaseName(s, sim) {
  if (s.phase === 'pad') return 'ignition';
  if (s.phase === 'rod') return 'on rod';
  if (s.phase === 'recovery') return sim.vehicle.settings.recovery.type === 'streamer' ? 'streamer' : 'parachute';
  if (s.thrust > 0) return 'powered';
  return s.vy > 0 ? 'coasting' : 'falling';
}

function ease(x) {
  return x * x * (3 - 2 * x);
}

function base64ToArrayBuffer(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
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
