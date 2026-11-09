// Launch-field environment: shaded mown grass with large-scale variation,
// gently rolling terrain beyond the field, wind-blown 3-D grass blades around
// you, drifting clouds, a windsock that shows the real wind, the scorched dirt
// patch under the pad, and range furniture (pop-up tent, chairs, flag line).
import * as THREE from 'three';

// --- shared GLSL noise ------------------------------------------------------
const NOISE = /* glsl */ `
  float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; } return s; }
`;

function jsNoise(x, z) {
  // cheap deterministic value noise for terrain heights (CPU side)
  const h = (a, b) => {
    const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const xf = x - xi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = zf * zf * (3 - 2 * zf);
  const a = h(xi, zi);
  const b = h(xi + 1, zi);
  const c = h(xi, zi + 1);
  const d = h(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function grassTexture(renderer) {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#4c7428';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 42000; i++) {
    const x = Math.random() * S;
    const y = Math.random() * S;
    const l = 24 + Math.random() * 30;
    const hue = 72 + Math.random() * 34;
    g.strokeStyle = `hsla(${hue}, ${38 + Math.random() * 25}%, ${l}%, ${0.25 + Math.random() * 0.45})`;
    g.lineWidth = Math.random() < 0.15 ? 1.6 : 1;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (Math.random() - 0.5) * 4, y - 2 - Math.random() * 6);
    g.stroke();
  }
  // clover / weeds / dry spots
  for (let i = 0; i < 260; i++) {
    g.fillStyle = Math.random() < 0.5 ? 'rgba(130,120,60,0.35)' : 'rgba(40,85,30,0.5)';
    g.beginPath();
    g.arc(Math.random() * S, Math.random() * S, 1 + Math.random() * 3, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function dirtTexture() {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, 'rgba(92,72,52,1)');
  grad.addColorStop(0.55, 'rgba(105,86,60,0.95)');
  grad.addColorStop(0.8, 'rgba(98,92,58,0.5)');
  grad.addColorStop(1, 'rgba(80,100,50,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 5000; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * S * 0.42;
    g.fillStyle = `rgba(${60 + Math.random() * 60},${50 + Math.random() * 40},${30 + Math.random() * 30},${Math.random() * 0.5})`;
    g.fillRect(S / 2 + Math.cos(a) * r, S / 2 + Math.sin(a) * r, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
  // exhaust scorch streaks radiating from the pad centre
  for (let i = 0; i < 70; i++) {
    const a = Math.random() * Math.PI * 2;
    const len = S * (0.08 + Math.random() * 0.22);
    g.strokeStyle = `rgba(20,16,12,${0.15 + Math.random() * 0.3})`;
    g.lineWidth = 2 + Math.random() * 8;
    g.beginPath();
    g.moveTo(S / 2, S / 2);
    g.lineTo(S / 2 + Math.cos(a) * len, S / 2 + Math.sin(a) * len);
    g.stroke();
  }
  const soot = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S * 0.18);
  soot.addColorStop(0, 'rgba(15,12,10,0.85)');
  soot.addColorStop(1, 'rgba(15,12,10,0)');
  g.fillStyle = soot;
  g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function cloudTexture() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  for (let i = 0; i < 40; i++) {
    const x = S * (0.2 + Math.random() * 0.6);
    const y = S * (0.35 + Math.random() * 0.35);
    const r = S * (0.08 + Math.random() * 0.16);
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    const shade = 230 + Math.random() * 25;
    gr.addColorStop(0, `rgba(${shade},${shade},${shade + 5},0.55)`);
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, S, S);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Environment {
  constructor(world) {
    this.world = world;
    this.scene = world.scene;
    this.uniforms = { uTime: { value: 0 }, uCenter: { value: new THREE.Vector2() } };
    this.buildGround();
    this.buildPadPatch();
    this.buildWindsock();
    this.buildRangeProps();
    this.clouds = null;
    this.grass = null;
  }

  // ---- ground ------------------------------------------------------------
  buildGround() {
    const old = this.world.ground;
    if (old) this.scene.remove(old);
    const size = 9000;
    const geo = new THREE.PlaneGeometry(size, size, 220, 220);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const r = Math.hypot(x, z);
      // the flying field is flat; gentle rolling farmland further out
      const k = THREE.MathUtils.smoothstep(r, 450, 1400);
      const h = (jsNoise(x / 380, z / 380) * 0.7 + jsNoise(x / 120, z / 120) * 0.3 - 0.45) * 38 * k;
      pos.setY(i, h);
    }
    geo.computeVertexNormals();
    const tex = grassTexture(this.world.renderer);
    tex.repeat.set(size / 3, size / 3);
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.96, metalness: 0 });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWorldP;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorldP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWorldP;\n' + NOISE)
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          {
            vec2 w = vWorldP.xz;
            // large patches of lusher / drier grass so the texture never looks tiled
            float m1 = fbm(w * 0.012);
            float m2 = fbm(w * 0.09 + 7.0);
            vec3 lush = vec3(0.86, 1.02, 0.80);
            vec3 dry = vec3(1.18, 1.08, 0.78);
            diffuseColor.rgb *= mix(lush, dry, smoothstep(0.35, 0.75, m1));
            diffuseColor.rgb *= 0.88 + 0.24 * m2;
            // mowing stripes across the flying field
            float r = length(w);
            float stripe = step(0.5, fract(w.x / 5.0));
            diffuseColor.rgb *= mix(1.0, mix(0.93, 1.06, stripe), 1.0 - smoothstep(120.0, 220.0, r));
            // far fields fade to a hazier, yellower tone
            diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.15, 1.08, 0.85), smoothstep(400.0, 2500.0, r));
          }`
        );
    };
    const ground = new THREE.Mesh(geo, mat);
    ground.receiveShadow = true;
    this.scene.add(ground);
    this.world.ground = ground;
  }

  buildPadPatch() {
    const patch = new THREE.Mesh(
      new THREE.CircleGeometry(1.1, 48),
      new THREE.MeshStandardMaterial({ map: dirtTexture(), transparent: true, roughness: 1, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })
    );
    patch.rotation.x = -Math.PI / 2;
    patch.position.y = 0.004;
    patch.receiveShadow = true;
    this.scene.add(patch);
  }

  // ---- windsock --------------------------------------------------------------
  buildWindsock() {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 3.2, 10), new THREE.MeshStandardMaterial({ color: 0xbfc3c8, metalness: 0.8, roughness: 0.35 }));
    pole.position.y = 1.6;
    pole.castShadow = true;
    g.add(pole);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.012, 6, 20), new THREE.MeshStandardMaterial({ color: 0x999999, metalness: 0.8 }));
    ring.rotation.y = Math.PI / 2;
    const sockPivot = new THREE.Group();
    sockPivot.position.y = 3.1;
    g.add(sockPivot);
    ring.position.set(0, 0, 0);
    sockPivot.add(ring);
    // striped fabric cone along +x, built from 5 bands
    const sock = new THREE.Group();
    const bands = 5;
    for (let i = 0; i < bands; i++) {
      const r0 = 0.16 - (i / bands) * 0.09;
      const r1 = 0.16 - ((i + 1) / bands) * 0.09;
      const band = new THREE.Mesh(
        new THREE.CylinderGeometry(r1, r0, 0.24, 18, 1, true),
        new THREE.MeshStandardMaterial({ color: i % 2 ? 0xffffff : 0xff5a10, roughness: 0.8, side: THREE.DoubleSide })
      );
      band.rotation.z = -Math.PI / 2;
      band.position.x = 0.12 + i * 0.24;
      band.castShadow = true;
      sock.add(band);
    }
    sockPivot.add(sock);
    g.position.set(7.5, 0, -5);
    this.scene.add(g);
    this.windsock = { group: g, pivot: sockPivot, sock };
  }

  // ---- tent, chairs, flag line --------------------------------------------
  buildRangeProps() {
    const props = new THREE.Group();
    // pop-up canopy tent behind the flight line
    const tent = new THREE.Group();
    const frame = new THREE.MeshStandardMaterial({ color: 0x8d9299, metalness: 0.7, roughness: 0.4 });
    const W = 3;
    const H = 2.2;
    for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, H, 8), frame);
      leg.position.set((x * W) / 2, H / 2, (z * W) / 2);
      leg.castShadow = true;
      tent.add(leg);
    }
    const roofGeo = new THREE.ConeGeometry((W / 2) * Math.SQRT2, 0.7, 4, 1, true);
    roofGeo.rotateY(Math.PI / 4);
    const roof = new THREE.Mesh(roofGeo, new THREE.MeshStandardMaterial({ color: 0x1e5aa8, roughness: 0.8, side: THREE.DoubleSide }));
    roof.position.y = H + 0.35;
    roof.castShadow = true;
    tent.add(roof);
    const valanceMat = new THREE.MeshStandardMaterial({ color: 0x1e5aa8, roughness: 0.8, side: THREE.DoubleSide });
    for (let i = 0; i < 4; i++) {
      const v = new THREE.Mesh(new THREE.PlaneGeometry(W, 0.25), valanceMat);
      v.position.y = H - 0.12;
      const a = (i / 4) * Math.PI * 2;
      v.position.x = Math.sin(a) * (W / 2);
      v.position.z = Math.cos(a) * (W / 2);
      v.rotation.y = a;
      tent.add(v);
    }
    // a folding table and cooler under the tent
    const tbl = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.04, 0.6), new THREE.MeshStandardMaterial({ color: 0xe8e4da }));
    tbl.position.set(0, 0.72, -0.6);
    tbl.castShadow = true;
    tent.add(tbl);
    const cooler = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.38, 0.38), new THREE.MeshStandardMaterial({ color: 0xc62828, roughness: 0.4 }));
    cooler.position.set(0.9, 0.19, 0.6);
    cooler.castShadow = true;
    const lid = new THREE.Mesh(new THREE.BoxGeometry(0.57, 0.06, 0.4), new THREE.MeshStandardMaterial({ color: 0xf5f5f5 }));
    lid.position.set(0.9, 0.41, 0.6);
    tent.add(cooler, lid);
    tent.position.set(-9.5, 0, 9);
    tent.rotation.y = 0.35;
    props.add(tent);
    // camp chairs
    for (const [x, z, r] of [[-6.6, 7.6, 2.6], [-5.6, 8.3, 2.9]]) props.add(campChair(x, z, r));
    // spectator flag line (safety distance) — rope with pennants
    const a = new THREE.Vector3(-16, 0.9, 6.2);
    const b = new THREE.Vector3(10, 0.9, 6.2);
    const posts = 6;
    const ropePts = [];
    for (let i = 0; i <= posts; i++) {
      const p = new THREE.Vector3().lerpVectors(a, b, i / posts);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.95, 6), new THREE.MeshStandardMaterial({ color: 0xf5f5f5 }));
      post.position.set(p.x, 0.475, p.z);
      post.castShadow = true;
      props.add(post);
      if (i < posts) {
        const q = new THREE.Vector3().lerpVectors(a, b, (i + 1) / posts);
        for (let k = 0; k <= 10; k++) {
          const f = k / 10;
          const pp = new THREE.Vector3().lerpVectors(p, q, f);
          pp.y -= Math.sin(f * Math.PI) * 0.12;
          ropePts.push(pp);
        }
      }
    }
    const rope = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ropePts), 300, 0.006, 4), new THREE.MeshStandardMaterial({ color: 0xffd600 }));
    props.add(rope);
    const flagColors = [0xff1744, 0x2979ff, 0xffea00, 0x00e676, 0xff9100];
    this.pennants = [];
    for (let i = 0; i < 40; i++) {
      const f = (i + 0.5) / 40;
      const p = new THREE.Vector3().lerpVectors(a, b, f);
      const seg = (f * posts) % 1;
      p.y -= Math.sin(seg * Math.PI) * 0.12;
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-0.09, 0, 0), new THREE.Vector3(0.09, 0, 0), new THREE.Vector3(0, -0.2, 0)]);
      geo.computeVertexNormals();
      const flag = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: flagColors[i % flagColors.length], side: THREE.DoubleSide, roughness: 0.8 }));
      flag.position.copy(p);
      props.add(flag);
      this.pennants.push(flag);
    }
    this.scene.add(props);
  }

  // ---- clouds -------------------------------------------------------------
  setClouds(n) {
    if (this.clouds) {
      this.scene.remove(this.clouds);
      this.clouds = null;
    }
    if (!n) return;
    const tex = cloudTexture();
    const group = new THREE.Group();
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < n; i++) {
      const puff = new THREE.Group();
      const a = rnd() * Math.PI * 2;
      const r = 300 + rnd() * 2600;
      puff.position.set(Math.cos(a) * r, 700 + rnd() * 900, Math.sin(a) * r);
      const parts = 3 + Math.floor(rnd() * 4);
      for (let k = 0; k < parts; k++) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.75 + rnd() * 0.2, fog: false }));
        const s = 220 + rnd() * 380;
        sp.scale.set(s * 1.6, s, 1);
        sp.position.set((rnd() - 0.5) * 400, (rnd() - 0.5) * 60, (rnd() - 0.5) * 300);
        puff.add(sp);
      }
      group.add(puff);
    }
    this.scene.add(group);
    this.clouds = group;
  }

  // ---- 3-D grass blades around the viewer ----------------------------------
  setGrass(count, radius) {
    if (this.grass) {
      this.scene.remove(this.grass);
      this.grass.geometry.dispose();
      this.grass = null;
    }
    if (!count) return;
    const blade = new THREE.PlaneGeometry(0.03, 1, 1, 3);
    blade.translate(0, 0.5, 0);
    const bp = blade.attributes.position;
    const colors = [];
    for (let i = 0; i < bp.count; i++) {
      const y = bp.getY(i);
      bp.setX(i, bp.getX(i) * (1 - y * 0.92)); // taper to a point
      const c = new THREE.Color().setHSL(0.24 + Math.random() * 0.02, 0.5, 0.12 + y * 0.22);
      colors.push(c.r, c.g, c.b);
    }
    blade.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const geo = new THREE.InstancedBufferGeometry().copy(blade);
    geo.instanceCount = count;
    const off = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      off[i * 4] = (Math.random() * 2 - 1) * radius;
      off[i * 4 + 1] = (Math.random() * 2 - 1) * radius;
      off[i * 4 + 2] = Math.random() * Math.PI * 2;
      off[i * 4 + 3] = 0.07 + Math.random() * 0.1; // mown: 7–17 cm
    }
    geo.setAttribute('aBlade', new THREE.InstancedBufferAttribute(off, 4));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    const u = this.uniforms;
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = u.uTime;
      sh.uniforms.uCenter = u.uCenter;
      sh.uniforms.uR = { value: radius };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 aBlade;\nuniform float uTime;\nuniform vec2 uCenter;\nuniform float uR;')
        .replace(
          '#include <begin_vertex>',
          `vec3 transformed = vec3(position);
          // wrap blades around the viewer so the field is endless
          vec2 rel = mod(aBlade.xy - uCenter + uR, 2.0 * uR) - uR;
          float fade = 1.0 - smoothstep(uR * 0.7, uR, length(rel));
          vec2 wp = uCenter + rel;
          if (length(wp) < 1.05) fade = 0.0; // the dirt patch under the pad
          float h = aBlade.w * fade;
          transformed.y *= h;
          float c = cos(aBlade.z), s = sin(aBlade.z);
          transformed.xz = mat2(c, -s, s, c) * transformed.xz;
          float sway = sin(uTime * 1.7 + wp.x * 0.6 + wp.y * 0.4) * 0.5 + sin(uTime * 3.1 + wp.x * 1.7) * 0.25;
          transformed.x += sway * 0.035 * position.y * position.y;
          transformed.xz += wp;`
        );
    };
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.grass = mesh;
  }

  /** wind: world vector (m/s) at 10 m; viewer: player position. */
  update(dt, time, wind, viewer) {
    this.uniforms.uTime.value = time;
    if (viewer) this.uniforms.uCenter.value.set(viewer.x, viewer.z);
    const w = wind || [0, 0, 0];
    const speed = Math.hypot(w[0], w[2]);
    if (this.windsock) {
      // the sock points downwind; it fills and lifts toward horizontal as the wind rises
      const yaw = speed > 0.05 ? Math.atan2(-w[2], w[0]) : this.windsock.pivot.rotation.y;
      const ws = this.windsock;
      ws.pivot.rotation.y += (yaw - ws.pivot.rotation.y) * Math.min(1, dt * 2);
      const droop = (Math.PI / 2) * (1 - Math.min(1, speed / 7));
      ws.sock.rotation.z = -droop + Math.sin(time * 6) * 0.04 * Math.min(1, speed / 3);
      ws.sock.rotation.x = Math.sin(time * 4.3) * 0.08 * Math.min(1, speed / 3);
    }
    if (this.pennants) {
      for (let i = 0; i < this.pennants.length; i++) {
        const f = this.pennants[i];
        f.rotation.x = Math.sin(time * 5 + i) * 0.4 * Math.min(1, speed / 4) + Math.min(1, speed / 6) * 0.9;
      }
    }
    if (this.clouds) {
      this.clouds.position.x += w[0] * dt * 2.5;
      this.clouds.position.z += w[2] * dt * 2.5;
      if (Math.abs(this.clouds.position.x) > 2000) this.clouds.position.x *= -0.95;
      if (Math.abs(this.clouds.position.z) > 2000) this.clouds.position.z *= -0.95;
    }
  }
}

function campChair(x, z, rot) {
  const g = new THREE.Group();
  const fabric = new THREE.MeshStandardMaterial({ color: 0x2e7d32, roughness: 0.9, side: THREE.DoubleSide });
  const metal = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.6, roughness: 0.5 });
  const seat = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.45), fabric);
  seat.rotation.x = -Math.PI / 2 + 0.12;
  seat.position.y = 0.45;
  const back = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), fabric);
  back.position.set(0, 0.72, -0.24);
  back.rotation.x = -0.2;
  g.add(seat, back);
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.62, 6), metal);
    leg.position.set(sx * 0.24, 0.3, sz * 0.2);
    leg.rotation.z = sx * 0.12;
    leg.rotation.x = sz * 0.2;
    g.add(leg);
  }
  g.traverse((o) => (o.castShadow = true));
  g.position.set(x, 0, z);
  g.rotation.y = rot;
  return g;
}
