// Hand-held launch controller modelled on the Estes "Electron Beam" style:
// 4×AA battery handset with a removable safety key, continuity lamp, big red
// LAUNCH push-button and a 15 ft lead ending in two micro-clips.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

function labelTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 1100;
  const g = c.getContext('2d');
  g.fillStyle = '#16181b';
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#ffc928';
  g.fillRect(0, 0, c.width, 120);
  g.fillStyle = '#111';
  g.font = 'bold 54px Arial, sans-serif';
  g.textAlign = 'center';
  g.fillText('LAUNCH', 256, 58);
  g.font = 'bold 40px Arial, sans-serif';
  g.fillText('CONTROLLER', 256, 104);
  g.fillStyle = '#fff';
  g.font = 'bold 34px Arial, sans-serif';
  g.fillText('SAFETY KEY', 256, 175);
  g.font = '24px Arial, sans-serif';
  g.fillStyle = '#ffc928';
  g.fillText('INSERT TO ARM', 256, 395);
  g.fillStyle = '#fff';
  g.font = 'bold 30px Arial, sans-serif';
  g.fillText('CONTINUITY', 256, 450);
  g.fillStyle = '#ff4b3a';
  g.font = 'bold 44px Arial, sans-serif';
  g.fillText('LAUNCH', 256, 640);
  g.fillStyle = '#ccc';
  g.font = '22px Arial, sans-serif';
  g.fillText('PRESS AND HOLD', 256, 960);
  g.fillStyle = '#ffc928';
  g.font = 'bold 22px Arial, sans-serif';
  g.fillText('⚠ REMOVE KEY WHEN NOT LAUNCHING', 256, 1010);
  g.fillStyle = '#888';
  g.font = '20px Arial, sans-serif';
  g.fillText('6 V · 4 × AA · 15 FT LEAD', 256, 1055);
  // border
  g.strokeStyle = '#ffc928';
  g.lineWidth = 6;
  g.strokeRect(10, 130, c.width - 20, c.height - 140);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export class LaunchController {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'LaunchController';
    const W = 0.068;
    const T = 0.036;
    const Lh = 0.17;
    this.size = { W, T, L: Lh };
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x22252a, roughness: 0.55, metalness: 0.05 });
    const gripMat = new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.85 });
    const chrome = new THREE.MeshStandardMaterial({ color: 0xe6e6e6, roughness: 0.15, metalness: 1 });

    const body = new THREE.Mesh(new RoundedBoxGeometry(W, T, Lh, 4, 0.012), bodyMat);
    body.castShadow = true;
    body.receiveShadow = true;
    this.group.add(body);
    this.body = body;
    // grip ridges on the sides of the handle end
    for (let i = 0; i < 9; i++) {
      for (const s of [-1, 1]) {
        const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.003, T * 0.7, 0.004), gripMat);
        ridge.position.set(s * (W / 2 + 0.0005), 0, 0.02 + i * 0.0068);
        this.group.add(ridge);
      }
    }
    // label panel on top
    const label = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.86, Lh * 0.9), new THREE.MeshStandardMaterial({ map: labelTexture(), roughness: 0.6 }));
    label.rotation.x = -Math.PI / 2;
    label.position.y = T / 2 + 0.0004;
    this.group.add(label);
    // battery door seam & screws on the bottom
    const door = new THREE.Mesh(new THREE.BoxGeometry(W * 0.7, 0.001, Lh * 0.5), gripMat);
    door.position.set(0, -T / 2 - 0.0003, 0.02);
    this.group.add(door);
    for (const [x, z] of [[-0.025, -0.07], [0.025, -0.07], [-0.025, 0.07], [0.025, 0.07]]) {
      const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.0022, 0.0022, 0.001, 10), chrome);
      screw.position.set(x, -T / 2 - 0.0005, z);
      this.group.add(screw);
    }

    // label layout maps texture y → z on the top face
    const zAt = (py) => -Lh * 0.45 + (py / 1100) * Lh * 0.9;

    // ---- safety key slot ----
    const slotZ = zAt(280);
    const bezel = new THREE.Mesh(new THREE.CylinderGeometry(0.0095, 0.0095, 0.004, 24), chrome);
    bezel.position.set(0, T / 2 + 0.002, slotZ);
    this.group.add(bezel);
    const slot = new THREE.Mesh(new THREE.BoxGeometry(0.0045, 0.0045, 0.0022), new THREE.MeshBasicMaterial({ color: 0x000000 }));
    slot.position.set(0, T / 2 + 0.0041, slotZ);
    this.group.add(slot);
    this.slotPos = new THREE.Vector3(0, T / 2 + 0.004, slotZ);

    // ---- key ----
    const key = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.026, 0.002), chrome);
    shaft.position.y = -0.008;
    const notch = new THREE.Mesh(new THREE.BoxGeometry(0.0015, 0.006, 0.0021), new THREE.MeshStandardMaterial({ color: 0x777777, metalness: 1, roughness: 0.3 }));
    notch.position.set(0.0015, -0.016, 0);
    const keyGrip = new THREE.Mesh(new RoundedBoxGeometry(0.02, 0.018, 0.006, 3, 0.003), new THREE.MeshStandardMaterial({ color: 0xd61e1e, roughness: 0.4 }));
    keyGrip.position.y = 0.012;
    const hole = new THREE.Mesh(new THREE.TorusGeometry(0.0032, 0.0012, 8, 16), chrome);
    hole.position.y = 0.017;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.009, 0.0007, 6, 24), chrome);
    ring.position.set(0, 0.026, 0);
    ring.rotation.y = Math.PI / 2;
    key.add(shaft, notch, keyGrip, hole, ring);
    key.traverse((o) => (o.castShadow = true));
    this.key = key;
    this.group.add(key);
    // resting pose: lying on the grass beside the controller
    this.keyOut = { pos: new THREE.Vector3(W / 2 + 0.03, -T / 2 + 0.004, slotZ - 0.01), rot: new THREE.Euler(-Math.PI / 2, 0, 0.4) };
    this.keyIn = { pos: new THREE.Vector3(0, T / 2 + 0.017, slotZ), rot: new THREE.Euler(0, 0, 0) };
    this.keyT = 0;
    this.keyTarget = 0;
    this.applyKey();

    // ---- continuity lamp ----
    const lampZ = zAt(520);
    const lampBezel = new THREE.Mesh(new THREE.CylinderGeometry(0.0085, 0.0095, 0.004, 24), chrome);
    lampBezel.position.set(0, T / 2 + 0.002, lampZ);
    this.group.add(lampBezel);
    this.lampMat = new THREE.MeshStandardMaterial({ color: 0x661010, roughness: 0.1, transparent: true, opacity: 0.85, emissive: 0x000000, emissiveIntensity: 3 });
    const lens = new THREE.Mesh(new THREE.SphereGeometry(0.0068, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), this.lampMat);
    lens.position.set(0, T / 2 + 0.004, lampZ);
    this.group.add(lens);
    const filament = new THREE.Mesh(new THREE.TorusGeometry(0.0018, 0.0003, 4, 10), new THREE.MeshBasicMaterial({ color: 0x553300 }));
    filament.position.set(0, T / 2 + 0.0065, lampZ);
    this.filament = filament;
    this.group.add(filament);
    this.lampLight = new THREE.PointLight(0xff3020, 0, 0.25, 2);
    this.lampLight.position.set(0, T / 2 + 0.012, lampZ);
    this.group.add(this.lampLight);

    // ---- launch button ----
    const btnZ = zAt(790);
    const guard = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.02, 0.006, 32), gripMat);
    guard.position.set(0, T / 2 + 0.003, btnZ);
    this.group.add(guard);
    const btnMat = new THREE.MeshStandardMaterial({ color: 0xe0201b, roughness: 0.35 });
    const button = new THREE.Mesh(new THREE.CylinderGeometry(0.0145, 0.015, 0.01, 32), btnMat);
    button.position.set(0, T / 2 + 0.008, btnZ);
    button.castShadow = true;
    const btnTop = new THREE.Mesh(new THREE.SphereGeometry(0.0145, 24, 8, 0, Math.PI * 2, 0, Math.PI * 0.18), btnMat);
    btnTop.position.y = -0.008;
    btnTop.scale.y = 1.4;
    button.add(btnTop);
    this.button = button;
    this.buttonUpY = button.position.y;
    this.group.add(button);

    // ---- cord exit / strain relief ----
    const relief = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.007, 0.022, 12), gripMat);
    relief.rotation.x = Math.PI / 2;
    relief.position.set(0, -0.004, Lh / 2 + 0.008);
    this.group.add(relief);
    this.cordExitLocal = new THREE.Vector3(0, -0.004, Lh / 2 + 0.02);

    this.lampOn = false;
    this.pressed = false;
  }

  cordExitWorld() {
    return this.group.localToWorld(this.cordExitLocal.clone());
  }

  setKey(inserted) {
    this.keyTarget = inserted ? 1 : 0;
  }

  applyKey() {
    const k = this.keyT;
    const e = k * k * (3 - 2 * k);
    // arc from the grass up and into the slot
    this.key.position.lerpVectors(this.keyOut.pos, this.keyIn.pos, e);
    this.key.position.y += Math.sin(e * Math.PI) * 0.05;
    this.key.rotation.set(
      THREE.MathUtils.lerp(this.keyOut.rot.x, this.keyIn.rot.x, e),
      THREE.MathUtils.lerp(0, Math.PI / 2, Math.max(0, (e - 0.85) / 0.15)), // final quarter-turn
      THREE.MathUtils.lerp(this.keyOut.rot.z, this.keyIn.rot.z, e)
    );
  }

  keyInserted() {
    return this.keyT >= 0.999;
  }

  setLamp(on) {
    this.lampOn = on;
  }

  setPressed(p) {
    this.pressed = p;
  }

  update(dt, time) {
    if (this.keyT !== this.keyTarget) {
      const s = Math.sign(this.keyTarget - this.keyT);
      this.keyT = Math.max(0, Math.min(1, this.keyT + s * dt * 1.6));
      this.applyKey();
    }
    const flicker = this.lampOn ? 0.92 + 0.08 * Math.sin(time * 60) : 0;
    this.lampMat.emissive.setRGB(this.lampOn ? 1 : 0, this.lampOn ? 0.18 : 0, this.lampOn ? 0.08 : 0);
    this.lampMat.emissiveIntensity = 2.5 * flicker;
    this.lampLight.intensity = this.lampOn ? 0.05 * flicker : 0;
    this.filament.material.color.setHex(this.lampOn ? 0xffd27a : 0x553300);
    const target = this.pressed ? this.buttonUpY - 0.0035 : this.buttonUpY;
    this.button.position.y += (target - this.button.position.y) * Math.min(1, dt * 30);
  }
}

// ---------------------------------------------------------------------------
// Micro-clip (small alligator clip) and the launch lead.
// ---------------------------------------------------------------------------
function microClip(color) {
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0xcfd2d6, metalness: 1, roughness: 0.25 });
  for (const s of [-1, 1]) {
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.0016, 0.024), steel);
    jaw.position.set(0, s * 0.0018, -0.004);
    jaw.rotation.x = s * 0.08;
    g.add(jaw);
    // teeth
    for (let i = 0; i < 4; i++) {
      const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.0008, 0.001), steel);
      tooth.position.set(0, s * 0.0008, -0.013 + i * 0.002);
      g.add(tooth);
    }
  }
  const spring = new THREE.Mesh(new THREE.TorusGeometry(0.0022, 0.0006, 6, 12), steel);
  spring.rotation.y = Math.PI / 2;
  spring.position.z = 0.003;
  g.add(spring);
  const boot = new THREE.Mesh(new THREE.CylinderGeometry(0.0028, 0.0035, 0.012, 10), new THREE.MeshStandardMaterial({ color, roughness: 0.6 }));
  boot.rotation.x = Math.PI / 2;
  boot.position.z = 0.012;
  g.add(boot);
  g.traverse((o) => (o.castShadow = true));
  return g;
}

export class LaunchLead {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.clips = [microClip(0xc81d1d), microClip(0x1d1d1d)];
    for (const c of this.clips) this.group.add(c);
    this.cableMat = new THREE.MeshStandardMaterial({ color: 0x8a1e1e, roughness: 0.7 });
    this.leadMats = [new THREE.MeshStandardMaterial({ color: 0xb01818, roughness: 0.6 }), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6 })];
    this.meshes = [];
    this.attachT = 0;
    this.attachTarget = 0;
  }

  /** start: controller cord exit, parked: [p,p] clip rest positions, attached: [p,p] at the igniter leads. */
  configure({ start, junction, parked, attached }) {
    this.start = start;
    this.junction = junction;
    this.parked = parked;
    this.attached = attached;
    this.rebuild();
  }

  setAttached(on) {
    this.attachTarget = on ? 1 : 0;
  }

  clipPos(i) {
    const k = this.attachT;
    const e = k * k * (3 - 2 * k);
    const p = new THREE.Vector3().lerpVectors(this.parked[i], this.attached[i], e);
    p.y += Math.sin(e * Math.PI) * 0.08;
    return p;
  }

  rebuild() {
    for (const m of this.meshes) {
      this.group.remove(m);
      m.geometry.dispose();
    }
    this.meshes = [];
    const s = this.start;
    const j = this.junction;
    // main twin lead lying on the grass in lazy curves
    const pts = [s.clone()];
    const n = 7;
    for (let i = 1; i < n; i++) {
      const f = i / n;
      const p = new THREE.Vector3().lerpVectors(s, j, f);
      p.y = 0.004;
      p.x += Math.sin(f * 9.3) * 0.18 * (1 - f);
      p.z += Math.cos(f * 7.1) * 0.14 * (1 - f);
      pts.push(p);
    }
    pts.push(j.clone());
    const main = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 80, 0.0022, 6), this.cableMat);
    main.castShadow = true;
    this.group.add(main);
    this.meshes.push(main);
    for (let i = 0; i < 2; i++) {
      const cp = this.clipPos(i);
      const mid = new THREE.Vector3().lerpVectors(j, cp, 0.5);
      mid.y = Math.min(j.y, cp.y) - 0.02;
      mid.y = Math.max(0.006, mid.y);
      const curve = new THREE.CatmullRomCurve3([j.clone(), mid, cp.clone().add(new THREE.Vector3(0, -0.012, 0))]);
      const lead = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.0012, 5), this.leadMats[i]);
      lead.castShadow = true;
      this.group.add(lead);
      this.meshes.push(lead);
      const clip = this.clips[i];
      clip.position.copy(cp);
      clip.lookAt(cp.clone().add(new THREE.Vector3().subVectors(cp, j).setY(0).normalize().negate()));
      if (this.attachT > 0.98) clip.rotation.x += -Math.PI / 2.4;
    }
  }

  update(dt) {
    if (this.attachT !== this.attachTarget) {
      const s = Math.sign(this.attachTarget - this.attachT);
      this.attachT = Math.max(0, Math.min(1, this.attachT + s * dt * 1.4));
      this.rebuild();
    }
  }
}
