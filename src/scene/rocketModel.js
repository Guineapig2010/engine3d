// 3-D rocket built from the user's STL: per-stage sections (clipped or from
// separate parts), separable nose cone, motor casings with Estes-style colour
// bands, igniter, exhaust flames, CG/CP markers and recovery devices.
import * as THREE from 'three';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const USAGE_COLORS = { single: 0xc62828, booster: 0x2e7d32, upper: 0x6a1b9a, plugged: 0x37474f };

function makeGeometry(positions) {
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  if (positions.length / 9 < 400000) g = toCreasedNormals(g, Math.PI / 5);
  else g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

function transformPositions(raw, m) {
  const out = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i += 3) {
    const x = raw[i];
    const y = raw[i + 1];
    const z = raw[i + 2];
    out[i] = m[0] * x + m[1] * y + m[2] * z + m[3];
    out[i + 1] = m[4] * x + m[5] * y + m[6] * z + m[7];
    out[i + 2] = m[8] * x + m[9] * y + m[10] * z + m[11];
  }
  return out;
}

function cgTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  for (let i = 0; i < 4; i++) {
    g.fillStyle = i % 2 ? '#111' : '#fff';
    g.fillRect((i % 2) * 64, Math.floor(i / 2) * 64, 64, 64);
  }
  // checker so opposite quadrants match (classic CG symbol)
  g.fillStyle = '#111';
  g.fillRect(64, 0, 64, 64);
  g.fillRect(0, 64, 64, 64);
  g.fillStyle = '#fff';
  g.fillRect(0, 0, 64, 64);
  g.fillRect(64, 64, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function flameTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.15, 'rgba(255,240,180,1)');
  grad.addColorStop(0.45, 'rgba(255,170,60,0.8)');
  grad.addColorStop(0.8, 'rgba(255,90,20,0.3)');
  grad.addColorStop(1, 'rgba(255,60,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 256);
  // soften the sides
  const side = g.createLinearGradient(0, 0, 64, 0);
  side.addColorStop(0, 'rgba(0,0,0,1)');
  side.addColorStop(0.3, 'rgba(0,0,0,0)');
  side.addColorStop(0.7, 'rgba(0,0,0,0)');
  side.addColorStop(1, 'rgba(0,0,0,1)');
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = side;
  g.fillRect(0, 0, 64, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export const PROPELLANT_LOOK = {
  'Black powder': { flame: 0xffa040, smoke: [0.86, 0.86, 0.84], smokeRate: 1.0, delaySmoke: 0.5, sparks: true },
  'Composite (White Lightning)': { flame: 0xfff3c0, smoke: [0.97, 0.97, 0.97], smokeRate: 1.4, delaySmoke: 0.35, sparks: false },
  'Composite (Blue Thunder)': { flame: 0xb8c8ff, smoke: [0.8, 0.82, 0.86], smokeRate: 0.35, delaySmoke: 0.3, sparks: false },
  'Composite (Black Jack/fast)': { flame: 0xff7a30, smoke: [0.25, 0.24, 0.23], smokeRate: 1.5, delaySmoke: 0.4, sparks: true },
};
export function propellantLook(p) {
  return PROPELLANT_LOOK[p] || PROPELLANT_LOOK['Black powder'];
}

export class RocketModel {
  /**
   * @param scene    THREE.Scene
   * @param geom     analysis (geometry.js)
   * @param source   { positions (raw STL) } or { placed: [...] } from assembly.js
   */
  constructor(scene, geom, source, { color = '#e8e8e8' } = {}) {
    this.scene = scene;
    this.geom = geom;
    this.L = geom.length;
    this.root = new THREE.Object3D(); // virtual transform for the whole stack
    this.paint = new THREE.Color(color);
    this.material = new THREE.MeshStandardMaterial({
      color: this.paint,
      roughness: 0.42,
      metalness: 0.08,
      side: THREE.DoubleSide,
      clipShadows: true,
    });
    this.noseMaterial = this.material.clone();
    this.source = source;
    this.xray = false;
    this.sections = [];
    this.flames = [];
    this.motorMeshes = [];
    this.recoveryObj = null;
    this.flameTex = flameTexture();
    if (source.placed) {
      this.partGeometries = source.placed.map((pl) => ({ stage: pl.stage, geometry: makeGeometry(transformPositions(pl.positions, geom.matrix)) }));
    } else {
      this.fullGeometry = makeGeometry(transformPositions(source.positions, geom.matrix));
    }
    this.markers = this.buildMarkers();
  }

  /** (Re)build stage sections for the given stage boundaries and motor layout. */
  configure(stages, recovery) {
    for (const s of this.sections) {
      this.scene.remove(s.group);
      if (s.noseGroup) this.scene.remove(s.noseGroup);
    }
    this.sections = [];
    this.flames = [];
    this.stages = stages;
    const L = this.L;
    const noseBase = Math.max(0, L - this.geom.noseLength);
    for (let k = 0; k < stages.length; k++) {
      const st = stages[k];
      const isTop = k === stages.length - 1;
      const group = new THREE.Group();
      group.name = `stage${k + 1}`;
      const sec = { k, group, y0: st.yBottom, y1: st.yTop, clips: [], attached: true, isTop };
      const addMesh = (geometry, yLo, yHi, mat, parent) => {
        const m = mat.clone();
        const local = [];
        if (yLo !== null) local.push(new THREE.Plane(new THREE.Vector3(0, 1, 0), -yLo));
        if (yHi !== null) local.push(new THREE.Plane(new THREE.Vector3(0, -1, 0), yHi));
        m.clippingPlanes = local.map((p) => p.clone());
        const mesh = new THREE.Mesh(geometry, m);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        parent.add(mesh);
        sec.clips.push({ mesh, local, parent });
        return mesh;
      };
      if (this.fullGeometry) {
        const lo = k === 0 ? null : st.yBottom;
        const hi = isTop ? noseBase : st.yTop;
        addMesh(this.fullGeometry, lo, hi, this.material, group);
        if (isTop) {
          sec.noseGroup = new THREE.Group();
          addMesh(this.fullGeometry, noseBase, null, this.noseMaterial, sec.noseGroup);
        }
      } else {
        for (const pg of this.partGeometries.filter((p) => p.stage === k)) {
          if (isTop) {
            addMesh(pg.geometry, null, noseBase, this.material, group);
            if (!sec.noseGroup) sec.noseGroup = new THREE.Group();
            addMesh(pg.geometry, noseBase, null, this.noseMaterial, sec.noseGroup);
          } else addMesh(pg.geometry, null, null, this.material, group);
        }
      }
      // motors
      sec.motors = [];
      for (const md of st.motors) {
        const motorObj = this.buildMotor(md);
        group.add(motorObj.group);
        sec.motors.push(motorObj);
        this.flames.push(motorObj);
      }
      this.scene.add(group);
      if (sec.noseGroup) this.scene.add(sec.noseGroup);
      this.sections.push(sec);
    }
    this.noseBase = noseBase;
    this.buildIgniter();
    this.setRecovery(recovery);
    this.setXray(this.xray);
  }

  buildMotor(md) {
    const { motor } = md;
    const r = motor.diameter / 2000;
    const len = motor.length / 1000;
    const g = new THREE.Group();
    const composite = !motor.blackPowder;
    const caseMat = new THREE.MeshStandardMaterial({ color: composite ? 0x2b2b2b : 0xc8a26b, roughness: 0.8 });
    const casing = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 24, 1, true), caseMat);
    casing.position.y = len / 2;
    g.add(casing);
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(r * 1.002, r * 1.002, len * 0.55, 24, 1, true),
      new THREE.MeshStandardMaterial({ color: composite ? 0xeeeeee : USAGE_COLORS[motor.usage] || 0xc62828, roughness: 0.6 })
    );
    band.position.y = len * 0.5;
    g.add(band);
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.98, r * 0.98, 0.006, 24), new THREE.MeshStandardMaterial({ color: composite ? 0x111111 : 0x77736c, roughness: 0.95 }));
    nozzle.position.y = 0.003;
    g.add(nozzle);
    const throat = new THREE.Mesh(new THREE.CircleGeometry(r * 0.35, 16), new THREE.MeshBasicMaterial({ color: 0x050505 }));
    throat.rotation.x = Math.PI / 2;
    throat.position.y = -0.0002;
    g.add(throat);
    const top = new THREE.Mesh(new THREE.CircleGeometry(r, 24), new THREE.MeshStandardMaterial({ color: 0xa88454 }));
    top.rotation.x = -Math.PI / 2;
    top.position.y = len;
    g.add(top);
    g.traverse((o) => (o.castShadow = true));
    g.position.set(md.lat[0], md.yAft, md.lat[1]);

    // flame: two nested additive cones hanging below the nozzle
    const look = propellantLook(motor.propellant);
    const flame = new THREE.Group();
    const mk = (radius, length, color, opacity) => {
      const m = new THREE.Mesh(
        new THREE.ConeGeometry(radius, length, 20, 1, true),
        new THREE.MeshBasicMaterial({ map: this.flameTex, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
      );
      m.rotation.x = Math.PI; // point down
      m.position.y = -length / 2;
      return m;
    };
    const outer = mk(r * 1.6, r * 14, look.flame, 0.75);
    const inner = mk(r * 0.7, r * 7, 0xffffff, 0.95);
    flame.add(outer, inner);
    const glow = new THREE.PointLight(look.flame, 0, 6, 2);
    glow.position.y = -r * 3;
    flame.add(glow);
    flame.visible = false;
    g.add(flame);
    return { group: g, flame, outer, inner, glow, md, r, len, look };
  }

  buildIgniter() {
    if (this.igniter) this.igniter.parent?.remove(this.igniter);
    const m0 = this.sections[0]?.motors[0];
    if (!m0) return;
    const ig = new THREE.Group();
    const plug = new THREE.Mesh(new THREE.CylinderGeometry(m0.r * 0.42, m0.r * 0.3, 0.006, 12), new THREE.MeshStandardMaterial({ color: 0xff6a00, roughness: 0.5 }));
    plug.position.y = -0.002;
    ig.add(plug);
    const copper = new THREE.MeshStandardMaterial({ color: 0xc77b3a, metalness: 1, roughness: 0.35 });
    this.igniterWires = [];
    for (const s of [-1, 1]) {
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(s * 0.0012, 0.002, 0),
        new THREE.Vector3(s * 0.002, -0.002, 0),
        new THREE.Vector3(s * 0.012, -0.0045, 0.006),
        new THREE.Vector3(s * 0.026, -0.0035, 0.016),
      ]);
      const w = new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.00045, 5), copper);
      ig.add(w);
      this.igniterWires.push(curve);
    }
    // pyrogen tip glow (visible when heating)
    this.igniterGlow = new THREE.Mesh(new THREE.SphereGeometry(0.0022, 10, 8), new THREE.MeshBasicMaterial({ color: 0x220000 }));
    this.igniterGlow.position.y = 0.004;
    ig.add(this.igniterGlow);
    m0.group.add(ig);
    this.igniter = ig;
    this.igniterMotor = m0;
  }

  /** World positions of the two igniter lead ends (where the micro-clips bite). */
  igniterLeadEnds() {
    this.updateAttached();
    if (!this.igniter) return null;
    this.igniter.updateMatrixWorld(true);
    return this.igniterWires.map((c) => this.igniter.localToWorld(c.getPoint(1).clone()));
  }

  setIgniterHeat(h) {
    if (!this.igniterGlow) return;
    this.igniterGlow.material.color.setRGB(0.15 + h * 1.2, 0.02 + h * 0.6, h * 0.15);
  }

  setIgniterVisible(v) {
    if (this.igniter) this.igniter.visible = v;
  }

  buildMarkers() {
    const R = Math.max(0.004, this.geom.refRadius * 0.75);
    const cg = new THREE.Mesh(new THREE.SphereGeometry(R, 24, 16), new THREE.MeshBasicMaterial({ map: cgTexture(), depthTest: false }));
    const cp = new THREE.Mesh(new THREE.SphereGeometry(R * 0.85, 24, 16), new THREE.MeshBasicMaterial({ color: 0xff2020, depthTest: false }));
    const dot = new THREE.Mesh(new THREE.SphereGeometry(R * 0.35, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }));
    cp.add(dot);
    dot.position.z = R * 0.6;
    cg.renderOrder = cp.renderOrder = dot.renderOrder = 10;
    this.root.add(cg, cp);
    this.scene.add(this.root);
    return { cg, cp };
  }

  setMarkers(xcg, xcp) {
    this.markers.cg.position.set(0, this.L - xcg, 0);
    this.markers.cp.position.set(0, this.L - xcp, 0);
  }

  setXray(on) {
    this.xray = on;
    const apply = (m) => {
      m.transparent = on;
      m.opacity = on ? 0.28 : 1;
      m.depthWrite = !on;
      m.needsUpdate = true;
    };
    for (const s of this.sections) for (const c of s.clips) apply(c.mesh.material);
    this.markers.cg.visible = on;
    this.markers.cp.visible = on;
  }

  setColor(hex) {
    this.paint.set(hex);
    for (const s of this.sections) for (const c of s.clips) c.mesh.material.color.set(hex);
  }

  /** Place the whole stack: tail position and axis direction (world). */
  setPose(tail, axis) {
    this.root.position.copy(tail);
    this.root.quaternion.copy(this.orient(axis));
    this.root.updateMatrixWorld(true);
  }

  /** Orientation for a body axis, including the fixed roll that keeps the rod between the fins. */
  orient(axis) {
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.clone().normalize());
    return q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.roll || 0));
  }

  /**
   * Roll the rocket so the launch rod (direction rodWorld from the rocket axis)
   * passes midway between two fins of the aft-most fin set.
   */
  alignRollToRod(axis, rodWorld) {
    const fins = [...this.geom.finSets].sort((a, b) => b.xLE - a.xLE)[0];
    if (!fins || !fins.angles?.length) {
      this.roll = 0;
      return;
    }
    const q0 = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.clone().normalize());
    const d = rodWorld.clone().applyQuaternion(q0.invert());
    const psiRod = Math.atan2(d.z, d.x);
    const psiMid = fins.angles[0] + Math.PI / fins.count;
    // three.js rotation about +y by φ maps local angle ψ to ψ − φ (in the x→z sense used here)
    this.roll = -(psiRod - psiMid);
  }

  /** Pose from simulator state (CG position p, axis a, CG distance from nose). */
  setPoseFromCG(p, a, xcg) {
    const ax = new THREE.Vector3(...a);
    const tail = new THREE.Vector3(...p).addScaledVector(ax, -(this.L - xcg));
    this.setPose(tail, ax);
  }

  updateAttached() {
    for (const s of this.sections) {
      if (s.attached) {
        s.group.position.copy(this.root.position);
        s.group.quaternion.copy(this.root.quaternion);
      }
      if (s.noseGroup && !s.noseOff) {
        s.noseGroup.position.copy(s.group.position);
        s.noseGroup.quaternion.copy(s.group.quaternion);
      }
    }
  }

  updateClipping() {
    for (const s of this.sections) {
      for (const c of s.clips) {
        c.parent.updateMatrixWorld(true);
        c.local.forEach((pl, i) => c.mesh.material.clippingPlanes[i].copy(pl).applyMatrix4(c.parent.matrixWorld));
      }
    }
  }

  /** Detach the lowest attached stage and return its section. */
  detachStage(k) {
    const s = this.sections[k];
    if (s) s.attached = false;
    return s;
  }

  resetAttachments() {
    for (const s of this.sections) {
      s.attached = true;
      s.group.visible = true;
      s.noseOff = false;
      if (s.noseGroup) s.noseGroup.visible = true;
    }
    if (this.recoveryObj) this.recoveryObj.group.visible = false;
    for (const f of this.flames) f.flame.visible = false;
  }

  /** Visual state of a motor flame: thrust fraction 0..1. */
  setFlame(motorObj, frac, time) {
    const on = frac > 0.005;
    motorObj.flame.visible = on;
    if (!on) {
      motorObj.glow.intensity = 0;
      return;
    }
    const flick = 0.85 + 0.15 * Math.sin(time * 70 + motorObj.r * 1000) + 0.08 * Math.sin(time * 133);
    const s = Math.max(0.25, Math.sqrt(frac)) * flick;
    motorObj.flame.scale.set(0.8 + 0.4 * s, s, 0.8 + 0.4 * s);
    motorObj.glow.intensity = 2.5 * frac * flick;
  }

  // ---------------- recovery devices ----------------
  setRecovery(rec) {
    if (this.recoveryObj) this.scene.remove(this.recoveryObj.group);
    this.recovery = rec;
    const group = new THREE.Group();
    group.visible = false;
    const obj = { group, type: rec?.type || 'none' };
    const lineMat = new THREE.LineBasicMaterial({ color: 0xf2f2f2 });
    if (rec?.type === 'parachute') {
      const R = rec.diameter / 2;
      const geo = new THREE.SphereGeometry(R, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.42);
      const colors = [];
      const pos = geo.attributes.position;
      const c1 = new THREE.Color(rec.color || '#ff5a1f');
      const c2 = new THREE.Color('#ffffff');
      for (let i = 0; i < pos.count; i++) {
        const ang = Math.atan2(pos.getZ(i), pos.getX(i));
        const gore = Math.floor(((ang + Math.PI) / (Math.PI * 2)) * 8);
        const c = gore % 2 ? c1 : c2;
        colors.push(c.r, c.g, c.b);
      }
      geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      const canopy = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.7, transparent: true, opacity: 0.95 }));
      canopy.scale.y = 0.55;
      canopy.castShadow = true;
      group.add(canopy);
      obj.canopy = canopy;
      obj.R = R;
      const lines = new THREE.BufferGeometry();
      lines.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(8 * 2 * 3), 3));
      obj.shrouds = new THREE.LineSegments(lines, lineMat);
      group.add(obj.shrouds);
    } else if (rec?.type === 'streamer') {
      const geo = new THREE.PlaneGeometry(rec.streamerWidth, rec.streamerLength, 1, 24);
      const ribbon = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: rec.color || '#ff3d6a', side: THREE.DoubleSide, roughness: 0.6 }));
      ribbon.castShadow = true;
      group.add(ribbon);
      obj.ribbon = ribbon;
      obj.base = Float32Array.from(geo.attributes.position.array);
    }
    const cord = new THREE.BufferGeometry();
    cord.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(3 * 12), 3));
    obj.cord = new THREE.Line(cord, new THREE.LineBasicMaterial({ color: 0xffe37a }));
    group.add(obj.cord);
    this.scene.add(group);
    this.recoveryObj = obj;
  }

  /**
   * Pose rocket + recovery under canopy. p = CG world pos, k = deployment 0..1,
   * landed = lying on the ground.
   */
  poseRecovery(p, a, xcg, k, time, landed, windDir) {
    const top = this.sections[this.sections.length - 1];
    const R = this.recoveryObj;
    const P = new THREE.Vector3(...p);
    const L = this.L;
    // body: hang roughly horizontal, gently swinging
    let axis;
    if (landed) axis = new THREE.Vector3(1, 0.0, 0.25).normalize();
    else axis = new THREE.Vector3(Math.cos(time * 0.7) * 0.9, 0.32 + 0.1 * Math.sin(time * 1.3), Math.sin(time * 0.7) * 0.9).normalize();
    if (landed) P.y = this.geom.refRadius + 0.002;
    const tail = P.clone().addScaledVector(axis, -(L - xcg));
    this.setPose(tail, axis);
    this.updateAttached();
    // nose cone hangs from the canopy above the body
    const bodyTop = tail.clone().addScaledVector(axis, this.noseBase);
    const cordLen = Math.min(0.7, 0.25 + 0.6 * L);
    let noseBaseP;
    if (landed) noseBaseP = bodyTop.clone().addScaledVector(axis, 0.12 + 0.3 * k).setY(this.geom.refRadius);
    else noseBaseP = P.clone().add(new THREE.Vector3(0, cordLen * Math.min(1, k * 2), 0));
    if (top.noseGroup) {
      top.noseOff = true;
      const noseAxis = landed ? axis.clone() : new THREE.Vector3(0.05 * Math.sin(time * 2), 1, 0).normalize();
      top.noseGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), noseAxis);
      top.noseGroup.position.copy(noseBaseP).addScaledVector(noseAxis, -this.noseBase);
    }
    R.group.visible = R.type !== 'none';
    // shock cord: from the body top up to the nose base
    const cp = R.cord.geometry.attributes.position;
    for (let i = 0; i < 12; i++) {
      const f = i / 11;
      const q = new THREE.Vector3().lerpVectors(bodyTop, noseBaseP, f);
      q.y -= Math.sin(f * Math.PI) * 0.08 * (landed ? 0 : 1);
      if (landed) q.y = Math.max(q.y, 0.003);
      cp.setXYZ(i, q.x, q.y, q.z);
    }
    cp.needsUpdate = true;
    const noseTip = noseBaseP.clone().add(new THREE.Vector3(0, landed ? 0 : this.geom.noseLength, 0));
    if (R.type === 'parachute') {
      const infl = Math.min(1, k);
      const canopyY = landed ? 0.01 : noseTip.y + R.R * 1.6 * infl + 0.05;
      const cpos = landed
        ? noseBaseP.clone().add(new THREE.Vector3(windDir[0], 0, windDir[2]).multiplyScalar(R.R * 1.3)).setY(0.01)
        : new THREE.Vector3(noseTip.x + Math.sin(time * 1.1) * 0.03, canopyY, noseTip.z);
      R.canopy.position.copy(cpos);
      const sc = landed ? 1 : 0.25 + 0.75 * infl;
      R.canopy.scale.set(sc, landed ? 0.04 : 0.55 * (0.4 + 0.6 * infl), sc);
      R.canopy.rotation.set(landed ? 0 : Math.sin(time * 0.9) * 0.08, time * 0.3, landed ? 0 : Math.cos(time * 0.8) * 0.08);
      R.canopy.updateMatrixWorld(true);
      const sp = R.shrouds.geometry.attributes.position;
      for (let i = 0; i < 8; i++) {
        const ang = (i / 8) * Math.PI * 2;
        const rim = new THREE.Vector3(Math.cos(ang) * R.R * Math.sin(Math.PI * 0.42), Math.cos(Math.PI * 0.42) * R.R, Math.sin(ang) * R.R * Math.sin(Math.PI * 0.42));
        R.canopy.localToWorld(rim);
        sp.setXYZ(i * 2, rim.x, rim.y, rim.z);
        sp.setXYZ(i * 2 + 1, noseTip.x, noseTip.y, noseTip.z);
      }
      sp.needsUpdate = true;
    } else if (R.type === 'streamer') {
      const rib = R.ribbon;
      const pos = rib.geometry.attributes.position;
      const len = this.recovery.streamerLength;
      for (let i = 0; i < pos.count; i++) {
        const by = R.base[i * 3 + 1];
        const f = 0.5 + by / len; // 0 at the attached (lower) end
        const bx = R.base[i * 3];
        const tw = landed ? 0 : f * 2.6 + Math.sin(time * 3 + f * 6) * 0.6; // twisting ribbon
        pos.setX(i, bx * Math.cos(tw) + (landed ? 0 : Math.sin(time * 9 + f * 10) * 0.05 * f * len * 0.3));
        pos.setZ(i, bx * Math.sin(tw) + (landed ? 0 : Math.cos(time * 7 + f * 8) * 0.04 * f));
      }
      pos.needsUpdate = true;
      rib.geometry.computeVertexNormals();
      if (landed) {
        rib.position.copy(noseBaseP).add(new THREE.Vector3(len / 2, 0, 0)).setY(0.004);
        rib.rotation.set(-Math.PI / 2, 0, Math.PI / 2);
      } else {
        rib.position.copy(noseTip).add(new THREE.Vector3(0, (len / 2) * Math.min(1, k * 1.5), 0));
        rib.rotation.set(0, time * 0.5, 0);
        rib.scale.y = Math.max(0.05, Math.min(1, k * 1.5));
      }
    }
  }

  dispose() {
    for (const s of this.sections) {
      this.scene.remove(s.group);
      if (s.noseGroup) this.scene.remove(s.noseGroup);
    }
    if (this.recoveryObj) this.scene.remove(this.recoveryObj.group);
    this.scene.remove(this.root);
    this.fullGeometry?.dispose();
    this.partGeometries?.forEach((p) => p.geometry.dispose());
  }
}
