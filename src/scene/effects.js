// Particle effects: exhaust smoke trail, black-powder sparks, ejection puff,
// igniter sparks. GPU points with a soft round sprite; CPU-side simulation.
import * as THREE from 'three';

const VERT = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  varying float vAlpha;
  varying vec3 vColor;
  uniform float uScale;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = min(800.0, aSize * uScale * projectionMatrix[1][1] / max(0.01, -mv.z));
    vAlpha = aAlpha;
    vColor = aColor;
  }
`;
const FRAG = /* glsl */ `
  varying float vAlpha;
  varying vec3 vColor;
  uniform float uSoft;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c) * 2.0;
    if (d > 1.0) discard;
    float a = vAlpha * mix(1.0 - d, smoothstep(1.0, 0.0, d), uSoft);
    gl_FragColor = vec4(vColor, a);
  }
`;

class PointPool {
  constructor(scene, max, { additive = false, soft = 1 } = {}) {
    this.max = max;
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.color = new Float32Array(max * 3);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.color, 3).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uScale: { value: 500 }, uSoft: { value: soft } },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    // per-particle sim state
    this.vel = new Float32Array(max * 3);
    this.age = new Float32Array(max).fill(1e9);
    this.life = new Float32Array(max).fill(1);
    this.s0 = new Float32Array(max);
    this.s1 = new Float32Array(max);
    this.a0 = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.next = 0;
  }

  emit(p, v, { life, s0, s1, a0, color, drag = 1.5, grav = 0 }) {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    this.pos.set(p, i * 3);
    this.vel.set(v, i * 3);
    this.age[i] = 0;
    this.life[i] = life;
    this.s0[i] = s0;
    this.s1[i] = s1;
    this.a0[i] = a0;
    this.color.set(color, i * 3);
    this.drag[i] = drag;
    this.grav[i] = grav;
  }

  update(dt, wind) {
    for (let i = 0; i < this.max; i++) {
      if (this.age[i] > this.life[i]) {
        this.alpha[i] = 0;
        continue;
      }
      this.age[i] += dt;
      const f = Math.min(1, this.age[i] / this.life[i]);
      const k = Math.exp(-this.drag[i] * dt);
      for (let j = 0; j < 3; j++) {
        const o = i * 3 + j;
        const w = wind[j];
        this.vel[o] = w + (this.vel[o] - w) * k;
        this.pos[o] += this.vel[o] * dt;
      }
      this.vel[i * 3 + 1] -= this.grav[i] * dt;
      if (this.pos[i * 3 + 1] < 0.02) {
        this.pos[i * 3 + 1] = 0.02;
        this.vel[i * 3 + 1] = Math.abs(this.vel[i * 3 + 1]) * 0.2;
      }
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * Math.sqrt(f);
      this.alpha[i] = this.a0[i] * (1 - f) * Math.min(1, this.age[i] * 20);
    }
    for (const n of ['position', 'aSize', 'aAlpha', 'aColor']) this.geo.attributes[n].needsUpdate = true;
  }

  clear() {
    this.age.fill(1e9);
    this.alpha.fill(0);
    this.geo.attributes.aAlpha.needsUpdate = true;
  }
}

export class Effects {
  constructor(scene) {
    this.smoke = new PointPool(scene, 9000, { soft: 1 });
    this.sparks = new PointPool(scene, 1500, { additive: true, soft: 0 });
    this.wind = [0, 0, 0];
    this.carry = 0;
  }

  setScale(px) {
    this.smoke.mat.uniforms.uScale.value = px;
    this.sparks.mat.uniforms.uScale.value = px;
  }

  /** Exhaust: nozzle world pos, axis (unit, toward nose), rocket velocity, thrust fraction. */
  exhaust(dt, nozzle, axis, vel, frac, look, delayPhase = false) {
    const rate = delayPhase ? 45 * look.delaySmoke : 240 * look.smokeRate * Math.max(0.3, frac);
    this.carry += rate * dt;
    const n = Math.floor(this.carry);
    this.carry -= n;
    const c = look.smoke;
    for (let i = 0; i < n; i++) {
      const f = Math.random();
      // spread emission along the segment travelled this frame so the trail is continuous
      const p = [nozzle[0] - vel[0] * dt * f, nozzle[1] - vel[1] * dt * f, nozzle[2] - vel[2] * dt * f];
      const ex = delayPhase ? 2 : 25 + 10 * Math.random();
      const v = [
        vel[0] * 0.3 - axis[0] * ex + (Math.random() - 0.5) * 2,
        vel[1] * 0.3 - axis[1] * ex + (Math.random() - 0.5) * 2,
        vel[2] * 0.3 - axis[2] * ex + (Math.random() - 0.5) * 2,
      ];
      const shade = 0.78 + Math.random() * 0.14;
      this.smoke.emit(p, v, {
        life: delayPhase ? 4 + Math.random() * 3 : 7 + Math.random() * 6,
        s0: delayPhase ? 0.05 : 0.12,
        s1: delayPhase ? 0.8 + Math.random() * 0.8 : 1.8 + Math.random() * 2,
        a0: delayPhase ? 0.4 : 0.7,
        color: [c[0] * shade, c[1] * shade, c[2] * shade],
        drag: 2.2,
      });
    }
    if (look.sparks && !delayPhase && frac > 0.05) {
      const ns = Math.random() < 0.6 ? 2 : 1;
      for (let i = 0; i < ns; i++) {
        const sp = 15 + Math.random() * 25;
        this.sparks.emit(nozzle, [
          vel[0] * 0.5 - axis[0] * sp + (Math.random() - 0.5) * 6,
          vel[1] * 0.5 - axis[1] * sp + (Math.random() - 0.5) * 6,
          vel[2] * 0.5 - axis[2] * sp + (Math.random() - 0.5) * 6,
        ], { life: 0.25 + Math.random() * 0.35, s0: 0.02, s1: 0.006, a0: 1, color: [1, 0.7, 0.3], drag: 0.6, grav: 9.8 });
      }
    }
  }

  /** Pad blast: smoke billowing sideways off the deflector at ignition. */
  padBlast(pos, amount) {
    for (let i = 0; i < amount; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 1 + Math.random() * 3;
      this.smoke.emit(pos, [Math.cos(a) * s, 0.3 + Math.random() * 0.8, Math.sin(a) * s], {
        life: 4 + Math.random() * 4, s0: 0.05, s1: 0.5 + Math.random() * 0.7, a0: 0.45, color: [0.9, 0.9, 0.88], drag: 1.6,
      });
    }
  }

  ejectionPuff(pos, vel) {
    for (let i = 0; i < 90; i++) {
      const d = [Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5];
      const s = 3 + Math.random() * 4;
      this.smoke.emit(pos, [vel[0] + d[0] * s, vel[1] + d[1] * s, vel[2] + d[2] * s], {
        life: 3 + Math.random() * 3, s0: 0.1, s1: 1 + Math.random() * 1.5, a0: 0.6, color: [0.92, 0.92, 0.9], drag: 2.5,
      });
    }
    for (let i = 0; i < 30; i++) {
      const d = [Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5];
      this.sparks.emit(pos, [d[0] * 10, d[1] * 10, d[2] * 10], { life: 0.3, s0: 0.03, s1: 0.01, a0: 1, color: [1, 0.6, 0.2], drag: 2, grav: 5 });
    }
  }

  igniterSparks(pos) {
    for (let i = 0; i < 3; i++) {
      this.sparks.emit(pos, [(Math.random() - 0.5) * 2, -Math.random() * 2, (Math.random() - 0.5) * 2], { life: 0.2, s0: 0.006, s1: 0.002, a0: 1, color: [1, 0.55, 0.15], drag: 1, grav: 9.8 });
    }
  }

  update(dt) {
    this.smoke.update(dt, this.wind);
    this.sparks.update(dt, [0, 0, 0]);
  }

  clear() {
    this.smoke.clear();
    this.sparks.clear();
  }
}
