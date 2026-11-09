// Particle effects: exhaust smoke, black-powder sparks, pad blast, ejection
// puff, igniter sparks.
//
// Smoke model: puffs are laid down along the path the nozzle travels (by
// distance, so a 100 m/s rocket leaves a continuous trail), start with a small
// exhaust push, then are carried by the wind. Each puff grows quickly at first
// (turbulent mixing), keeps spreading slowly (diffusion ∝ √t), rises a little
// while warm and thins out as it dilutes, so a black-powder trail hangs in the
// sky for half a minute or more and drifts downwind.
import * as THREE from 'three';

const VERT = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute float aRot;
  attribute vec3 aColor;
  varying float vAlpha;
  varying float vRot;
  varying vec3 vColor;
  uniform float uScale;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = min(900.0, aSize * uScale * projectionMatrix[1][1] / max(0.01, -mv.z));
    vAlpha = aAlpha;
    vRot = aRot;
    vColor = aColor;
  }
`;
const FRAG = /* glsl */ `
  varying float vAlpha;
  varying float vRot;
  varying vec3 vColor;
  uniform sampler2D uTex;
  uniform float uAdditive;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float cs = cos(vRot), sn = sin(vRot);
    vec2 r = vec2(cs * c.x - sn * c.y, sn * c.x + cs * c.y) + 0.5;
    if (uAdditive > 0.5) {
      float d = length(c) * 2.0;
      if (d > 1.0) discard;
      gl_FragColor = vec4(vColor, vAlpha * (1.0 - d));
      return;
    }
    vec4 t = texture2D(uTex, r);
    // sun from above: lighter tops, slightly darker undersides
    float shade = mix(0.78, 1.08, 1.0 - gl_PointCoord.y);
    gl_FragColor = vec4(vColor * shade * mix(0.85, 1.0, t.r), t.a * vAlpha);
  }
`;

function puffTexture() {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  // a soft cluster of overlapping blobs gives a billowy, non-circular puff
  for (let i = 0; i < 22; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * S * 0.2;
    const x = S / 2 + Math.cos(a) * r;
    const y = S / 2 + Math.sin(a) * r;
    const rad = S * (0.14 + Math.random() * 0.2);
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    const v = 200 + Math.random() * 55;
    gr.addColorStop(0, `rgba(${v},${v},${v},0.32)`);
    gr.addColorStop(1, `rgba(${v},${v},${v},0)`);
    g.fillStyle = gr;
    g.fillRect(0, 0, S, S);
  }
  // overall radial falloff so edges are soft
  g.globalCompositeOperation = 'destination-in';
  const fall = g.createRadialGradient(S / 2, S / 2, S * 0.1, S / 2, S / 2, S * 0.5);
  fall.addColorStop(0, 'rgba(0,0,0,1)');
  fall.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = fall;
  g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

class PointPool {
  constructor(scene, max, { additive = false } = {}) {
    this.max = max;
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.rot = new Float32Array(max);
    this.color = new Float32Array(max * 3);
    const dyn = (arr, n) => new THREE.BufferAttribute(arr, n).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', dyn(this.pos, 3));
    this.geo.setAttribute('aSize', dyn(this.size, 1));
    this.geo.setAttribute('aAlpha', dyn(this.alpha, 1));
    this.geo.setAttribute('aRot', dyn(this.rot, 1));
    this.geo.setAttribute('aColor', dyn(this.color, 3));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uScale: { value: 500 }, uTex: { value: additive ? null : puffTexture() }, uAdditive: { value: additive ? 1 : 0 } },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
    scene.add(this.points);
    this.vel = new Float32Array(max * 3);
    this.age = new Float32Array(max).fill(1e9);
    this.life = new Float32Array(max).fill(1);
    this.s0 = new Float32Array(max);
    this.s1 = new Float32Array(max);
    this.grow = new Float32Array(max); // fast-mixing time constant
    this.diff = new Float32Array(max); // slow spreading, m/√s
    this.a0 = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.lift = new Float32Array(max);
    this.spin = new Float32Array(max);
    this.next = 0;
  }

  emit(p, v, o) {
    this.dirty = true;
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    this.pos.set(p, i * 3);
    this.vel.set(v, i * 3);
    this.age[i] = 0;
    this.life[i] = o.life;
    this.s0[i] = o.s0;
    this.s1[i] = o.s1;
    this.grow[i] = o.grow ?? 1;
    this.diff[i] = o.diff ?? 0;
    this.a0[i] = o.a0;
    this.color.set(o.color, i * 3);
    this.drag[i] = o.drag ?? 1.5;
    this.grav[i] = o.grav ?? 0;
    this.lift[i] = o.lift ?? 0;
    this.rot[i] = Math.random() * Math.PI * 2;
    this.spin[i] = (Math.random() - 0.5) * 0.3;
  }

  update(dt, windAt) {
    const w = [0, 0, 0];
    let alive = 0;
    for (let i = 0; i < this.max; i++) {
      if (this.age[i] > this.life[i]) {
        if (this.alpha[i] !== 0) {
          this.alpha[i] = 0;
          alive++; // one more upload to hide it
        }
        continue;
      }
      alive++;
      const age = (this.age[i] += dt);
      const f = age / this.life[i];
      const k = Math.exp(-this.drag[i] * dt);
      const o = i * 3;
      windAt(this.pos[o + 1], w);
      for (let j = 0; j < 3; j++) {
        this.vel[o + j] = w[j] + (this.vel[o + j] - w[j]) * k;
        this.pos[o + j] += this.vel[o + j] * dt;
      }
      // warm exhaust rises briefly; sparks fall
      this.pos[o + 1] += this.lift[i] * Math.exp(-age / 4) * dt;
      this.vel[o + 1] -= this.grav[i] * dt;
      if (this.pos[o + 1] < 0.03) {
        this.pos[o + 1] = 0.03;
        this.vel[o + 1] = Math.abs(this.vel[o + 1]) * 0.15;
      }
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * (1 - Math.exp(-age / this.grow[i])) + this.diff[i] * Math.sqrt(age);
      const fadeIn = Math.min(1, age * 12);
      this.alpha[i] = (this.a0[i] * fadeIn * Math.pow(1 - f, 1.4)) / (1 + 0.12 * age);
      this.rot[i] += this.spin[i] * dt;
    }
    // nothing alive (most of the time on the ground): skip the GPU upload entirely
    if (alive || this.dirty) for (const n of ['position', 'aSize', 'aAlpha', 'aColor', 'aRot']) this.geo.attributes[n].needsUpdate = true;
    this.dirty = false;
    this.points.visible = alive > 0;
  }

  clear() {
    this.age.fill(1e9);
    this.alpha.fill(0);
    this.geo.attributes.aAlpha.needsUpdate = true;
  }
}

export class Effects {
  constructor(scene, maxSmoke = 26000) {
    this.scene = scene;
    this.smoke = new PointPool(scene, maxSmoke);
    this.sparks = new PointPool(scene, 2000, { additive: true });
    this.windVec = [0, 0, 0];
    this.carry = 0;
    this.last = null;
  }

  /** Wind at 10 m (world vector); smoke follows a 1/7-power profile with height. */
  setWind(v) {
    this.windVec = v;
  }

  windAt = (h, out) => {
    const prof = Math.pow(Math.max(h, 0.5) / 10, 1 / 7);
    out[0] = this.windVec[0] * prof;
    out[1] = 0;
    out[2] = this.windVec[2] * prof;
  };

  setScale(px) {
    this.smoke.mat.uniforms.uScale.value = px;
    this.sparks.mat.uniforms.uScale.value = px;
  }

  /**
   * Exhaust from one nozzle. dt in sim seconds, nozzle (world), axis (unit,
   * toward the nose), vel (rocket velocity), frac (thrust / peak).
   */
  exhaust(dt, nozzle, axis, vel, frac, look, delayPhase = false, key = 0) {
    const last = (this.lastPos ||= new Map()).get(key);
    this.lastPos.set(key, nozzle.slice());
    const seg = last ? Math.hypot(nozzle[0] - last[0], nozzle[1] - last[1], nozzle[2] - last[2]) : 0;
    const from = last && seg < 50 ? last : nozzle;
    const spacing = delayPhase ? 0.5 : 0.12 / Math.max(0.3, look.smokeRate);
    const timeRate = delayPhase ? 20 * look.delaySmoke : 110 * look.smokeRate * Math.max(0.35, frac);
    this.carry += seg / spacing + timeRate * dt;
    const n = Math.min(400, Math.floor(this.carry));
    this.carry -= n;
    const c = look.smoke;
    for (let i = 0; i < n; i++) {
      const f = Math.random();
      const p = [from[0] + (nozzle[0] - from[0]) * f, from[1] + (nozzle[1] - from[1]) * f, from[2] + (nozzle[2] - from[2]) * f];
      const push = delayPhase ? 1.5 : 6 + 6 * frac;
      const jitter = delayPhase ? 0.4 : 1.2;
      const v = [
        -axis[0] * push + (Math.random() - 0.5) * jitter,
        -axis[1] * push + (Math.random() - 0.5) * jitter,
        -axis[2] * push + (Math.random() - 0.5) * jitter,
      ];
      const shade = 0.82 + Math.random() * 0.16;
      this.smoke.emit(p, v, {
        life: delayPhase ? 14 + Math.random() * 10 : 28 + Math.random() * 22,
        s0: delayPhase ? 0.04 : 0.07,
        s1: delayPhase ? 0.35 + Math.random() * 0.3 : (0.7 + Math.random() * 0.6) * look.smokeSize,
        grow: delayPhase ? 1.5 : 0.8,
        diff: delayPhase ? 0.08 : 0.16,
        a0: delayPhase ? 0.28 * look.delaySmoke + 0.1 : 0.42 * Math.min(1.2, look.smokeRate),
        color: [c[0] * shade, c[1] * shade, c[2] * shade],
        drag: 2.6,
        lift: delayPhase ? 0.05 : 0.25,
      });
    }
    if (look.sparks && !delayPhase && frac > 0.05) {
      const ns = Math.random() < 0.7 ? 2 : 1;
      for (let i = 0; i < ns; i++) {
        const sp = 12 + Math.random() * 22;
        this.sparks.emit(nozzle, [
          vel[0] * 0.4 - axis[0] * sp + (Math.random() - 0.5) * 7,
          vel[1] * 0.4 - axis[1] * sp + (Math.random() - 0.5) * 7,
          vel[2] * 0.4 - axis[2] * sp + (Math.random() - 0.5) * 7,
        ], { life: 0.2 + Math.random() * 0.45, s0: 0.022, s1: 0.006, a0: 1, color: [1, 0.68, 0.28], drag: 0.7, grav: 9.8 });
      }
    }
  }

  resetTrails() {
    this.lastPos = new Map();
    this.carry = 0;
  }

  /** Ignition blast: exhaust hits the deflector and rolls out along the ground. */
  padBlast(pos, amount, look) {
    const c = look?.smoke || [0.88, 0.88, 0.86];
    for (let i = 0; i < amount; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 1.5 + Math.random() * 4;
      this.smoke.emit([pos[0], pos[1] - 0.02, pos[2]], [Math.cos(a) * s, 0.2 + Math.random() * 0.9, Math.sin(a) * s], {
        life: 18 + Math.random() * 14, s0: 0.08, s1: 0.5 + Math.random() * 0.6, grow: 1.2, diff: 0.12, a0: 0.4, color: c, drag: 1.4, lift: 0.15,
      });
    }
  }

  ejectionPuff(pos, vel) {
    for (let i = 0; i < 110; i++) {
      const d = [Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5];
      const s = 2 + Math.random() * 5;
      this.smoke.emit(pos, [vel[0] * 0.5 + d[0] * s, vel[1] * 0.5 + d[1] * s, vel[2] * 0.5 + d[2] * s], {
        life: 16 + Math.random() * 10, s0: 0.1, s1: 0.8 + Math.random() * 1.2, grow: 0.7, diff: 0.15, a0: 0.45, color: [0.9, 0.9, 0.88], drag: 2.2,
      });
    }
    for (let i = 0; i < 30; i++) {
      const d = [Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5];
      this.sparks.emit(pos, [d[0] * 10, d[1] * 10, d[2] * 10], { life: 0.3, s0: 0.03, s1: 0.01, a0: 1, color: [1, 0.6, 0.2], drag: 2, grav: 5 });
    }
  }

  igniterSparks(pos) {
    for (let i = 0; i < 3; i++) {
      this.sparks.emit(pos, [(Math.random() - 0.5) * 1.5, -Math.random() * 1.5, (Math.random() - 0.5) * 1.5], { life: 0.18, s0: 0.005, s1: 0.002, a0: 1, color: [1, 0.55, 0.15], drag: 1, grav: 9.8 });
    }
  }

  /** Thin wisp from a burnt igniter or a fizzled motor. */
  wisp(pos) {
    this.smoke.emit(pos, [(Math.random() - 0.5) * 0.1, 0.25, (Math.random() - 0.5) * 0.1], { life: 4, s0: 0.01, s1: 0.08, grow: 1, diff: 0.03, a0: 0.25, color: [0.7, 0.7, 0.7], drag: 1.5, lift: 0.1 });
  }

  update(dt) {
    this.smoke.update(dt, this.windAt);
    this.sparks.update(dt, (h, out) => {
      out[0] = out[1] = out[2] = 0;
    });
  }

  clear() {
    this.smoke.clear();
    this.sparks.clear();
    this.resetTrails();
  }

  dispose() {
    for (const p of [this.smoke, this.sparks]) {
      this.scene.remove(p.points);
      p.geo.dispose();
      p.mat.dispose();
    }
  }
}
